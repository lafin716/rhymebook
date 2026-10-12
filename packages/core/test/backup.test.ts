import { describe, expect, it } from 'vitest';
import {
  AUTO_BACKUP_IDLE_MS,
  BackupError,
  BackupTargetError,
  DAY_MS,
  applyBackup,
  backupFileName,
  backupToMarkdown,
  createBackupManager,
  createDriveTarget,
  createGithubTarget,
  createSnapshot,
  decryptText,
  encryptText,
  memoryBackupTarget,
  openBackup,
  parseBackupFileName,
  readBackupHeader,
  serializeBackup,
  shouldAutoBackup,
  utf8ToBase64,
  base64ToUtf8,
} from '../src/backup';
import type { Message, Session } from '../src/model';
import type { StoredData } from '../src/persist';
import { connectionPrefs, toStoredData } from '../src/persist';
import { createSeed, DEFAULT_SETTINGS, emptyView, initialConnections, SEED_IDS } from '../src/seed';

const sess = (id: string, updatedAt = 1, extra: Partial<Session> = {}): Session => ({
  id,
  parentId: null,
  rootId: id,
  title: id,
  createdAt: 1,
  updatedAt,
  ...extra,
});
const msg = (id: string, sessionId: string, content = id): Message => ({ id, sessionId, role: 'assistant', content, createdAt: 1 });

const seedStored = (): StoredData => {
  const seed = createSeed(0);
  return toStoredData({ ...seed, view: emptyView(SEED_IDS.cos), settings: DEFAULT_SETTINGS, connections: initialConnections() });
};

describe('backup snapshot', () => {
  it('round-trips the seed tree without connections or secrets', async () => {
    const data = seedStored();
    const text = await serializeBackup(createSnapshot(data, 1000));
    expect(text).not.toContain('connections');
    expect(text).not.toMatch(/apiKey|sk-|token/i);
    const back = await openBackup(text);
    expect(back.createdAt).toBe(1000);
    expect(back.data.sessions).toEqual(data.sessions);
    expect(back.data.messages).toEqual(data.messages);
    expect(back.data.view?.activeSessionId).toBe(SEED_IDS.cos);
    expect(readBackupHeader(text)).toEqual({ createdAt: 1000, encrypted: false });
  });

  it('encrypts with a passphrase and rejects a wrong or missing one', async () => {
    const data = seedStored();
    const text = await serializeBackup(createSnapshot(data, 5), '비밀 암호');
    expect(text).not.toContain(data.sessions[0]!.title);
    expect(readBackupHeader(text)).toEqual({ createdAt: 5, encrypted: true });
    await expect(openBackup(text)).rejects.toMatchObject({ code: 'passphrase-required' });
    await expect(openBackup(text, 'nope')).rejects.toMatchObject({ code: 'wrong-passphrase' });
    expect((await openBackup(text, '비밀 암호')).data.sessions).toEqual(data.sessions);
  });

  it('crypto helpers round-trip unicode', async () => {
    expect(base64ToUtf8(utf8ToBase64('가지 🌱'))).toBe('가지 🌱');
    const enc = await encryptText('안녕', 'pw', 1000);
    expect(await decryptText(enc, 'pw')).toBe('안녕');
    await expect(decryptText(enc, 'px')).rejects.toThrow();
  });

  it('rejects foreign, broken and newer files', async () => {
    await expect(openBackup('not json')).rejects.toBeInstanceOf(BackupError);
    await expect(openBackup(JSON.stringify({ app: 'other', schemaVersion: 1, createdAt: 1, data: {} }))).rejects.toMatchObject({ code: 'invalid' });
    await expect(
      openBackup(JSON.stringify({ app: 'branch-learn', schemaVersion: 1, createdAt: 1, data: { sessions: [{ id: 1 }], messages: [] } })),
    ).rejects.toMatchObject({ code: 'invalid' });
    await expect(openBackup(JSON.stringify({ app: 'branch-learn', schemaVersion: 99, createdAt: 1, data: { sessions: [], messages: [] } }))).rejects.toMatchObject({
      code: 'newer-version',
    });
  });
});

describe('applyBackup', () => {
  const local: StoredData = {
    sessions: [sess('a', 5), sess('b', 1)],
    messages: [msg('a1', 'a', 'local a'), msg('b1', 'b', 'local b')],
    view: emptyView('a'),
    settings: { contextWindow: 4 },
    connections: connectionPrefs(Object.values(initialConnections())),
  };
  const backup = {
    sessions: [sess('a', 2), sess('b', 9), sess('c', 3)],
    messages: [msg('a1', 'a', 'old a'), msg('b1', 'b', 'new b'), msg('b2', 'b', 'new b2'), msg('c1', 'c')],
    view: emptyView('c'),
    settings: { contextWindow: 8 },
  };

  it('merge keeps the newer side per session and adds missing ones', () => {
    const out = applyBackup(local, backup, 'merge');
    expect(out.sessions.map((s) => [s.id, s.updatedAt])).toEqual([
      ['a', 5],
      ['b', 9],
      ['c', 3],
    ]);
    const content = (sid: string) => out.messages.filter((m) => m.sessionId === sid).map((m) => m.content);
    expect(content('a')).toEqual(['local a']);
    expect(content('b')).toEqual(['new b', 'new b2']);
    expect(content('c')).toEqual(['c1']);
    expect(out.view?.activeSessionId).toBe('a');
    expect(out.settings).toEqual({ contextWindow: 4 });
    expect(out.connections).toBe(local.connections);
  });

  it('replace takes the backup but keeps device connections', () => {
    const out = applyBackup(local, backup, 'replace');
    expect(out.sessions.map((s) => s.id)).toEqual(['a', 'b', 'c']);
    expect(out.messages).toEqual(backup.messages);
    expect(out.view?.activeSessionId).toBe('c');
    expect(out.settings).toEqual({ contextWindow: 8 });
    expect(out.connections).toBe(local.connections);
  });
});

describe('shouldAutoBackup', () => {
  it('waits for idle on change mode and a day on daily mode', () => {
    const base = { lastBackupAt: 0, lastChangeAt: 1000 };
    expect(shouldAutoBackup({ ...base, mode: 'off', now: DAY_MS * 9 })).toBe(false);
    expect(shouldAutoBackup({ ...base, mode: 'change', now: 1000 + AUTO_BACKUP_IDLE_MS - 1 })).toBe(false);
    expect(shouldAutoBackup({ ...base, mode: 'change', now: 1000 + AUTO_BACKUP_IDLE_MS })).toBe(true);
    expect(shouldAutoBackup({ ...base, mode: 'daily', now: DAY_MS - 1 })).toBe(false);
    expect(shouldAutoBackup({ ...base, mode: 'daily', now: DAY_MS })).toBe(true);
    expect(shouldAutoBackup({ mode: 'change', lastBackupAt: 2000, lastChangeAt: 1000, now: DAY_MS })).toBe(false);
  });
});

describe('backup file names and markdown', () => {
  it('encodes time and encryption in the name', () => {
    expect(parseBackupFileName(backupFileName(1760000000000, true))).toEqual({ at: 1760000000000, encrypted: true });
    expect(parseBackupFileName(backupFileName(1760000000000, false))).toEqual({ at: 1760000000000, encrypted: false });
    expect(parseBackupFileName('latest.md')).toBeNull();
  });

  it('renders the tree with anchors and summaries', () => {
    const md = backupToMarkdown(seedStored(), 0);
    expect(md).toMatch(/^# rhymebook 백업/);
    expect(md).toContain('↳ ');
    expect(md).toContain('> 원문: "');
    expect(md).toContain('**가지 요약**');
  });
});

/** Contents API 최소 모의 서버 */
function fakeGithub(opts: { push?: boolean } = {}) {
  const files = new Map<string, { content: string; sha: string }>();
  const calls: { method: string; url: string; auth: string | null }[] = [];
  let n = 0;
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const fetch = async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? 'GET';
    const headers = init.headers as Record<string, string>;
    calls.push({ method, url, auth: headers.Authorization ?? null });
    if (headers.Authorization !== 'Bearer good') return json({ message: 'Bad credentials' }, 401);
    const u = new URL(url);
    if (u.pathname === '/repos/me/notes') return json({ permissions: { push: opts.push ?? true } });
    const m = /^\/repos\/me\/notes\/contents\/(.+)$/.exec(u.pathname);
    if (!m) return json({}, 404);
    const path = decodeURIComponent(m[1]!);
    if (method === 'PUT') {
      const body = JSON.parse(init.body as string) as { content: string; sha?: string };
      const cur = files.get(path);
      if (cur && body.sha !== cur.sha) return json({ message: 'sha mismatch' }, 409);
      files.set(path, { content: body.content, sha: `s${++n}` });
      return json({}, cur ? 200 : 201);
    }
    if (method === 'DELETE') {
      files.delete(path);
      return json({});
    }
    const f = files.get(path);
    if (f) return json({ name: path, sha: f.sha, encoding: 'base64', content: f.content });
    const dir = [...files.entries()].filter(([p]) => p.startsWith(`${path}/`));
    if (!dir.length) return json({ message: 'Not Found' }, 404);
    return json(dir.map(([p, v]) => ({ name: p.slice(path.length + 1), type: 'file', size: base64ToUtf8(v.content).length, sha: v.sha })));
  };
  return { files, calls, fetch };
}

describe('GitHub target', () => {
  it('puts, lists, gets, updates latest.md and removes', async () => {
    const gh = fakeGithub();
    const t = createGithubTarget({ repo: 'me/notes', getToken: async () => 'good', fetch: gh.fetch, baseUrl: 'https://gh.test' });
    await t.verify();
    expect(await t.list()).toEqual([]);
    await t.put('{"a":1}', { at: 1760000000001, encrypted: false, markdown: '# one' });
    await t.put('{"a":2}', { at: 1760000000002, encrypted: true });
    await t.put('{"a":3}', { at: 1760000000003, encrypted: false, markdown: '# three' });
    const list = await t.list();
    expect(list.map((e) => [e.at, e.encrypted])).toEqual([
      [1760000000003, false],
      [1760000000002, true],
      [1760000000001, false],
    ]);
    expect(base64ToUtf8(gh.files.get('branch-learn/latest.md')!.content)).toBe('# three');
    expect(await t.get(list[1]!.id)).toBe('{"a":2}');
    await t.remove(list[2]!.id);
    expect((await t.list()).length).toBe(2);
    expect(gh.calls.every((c) => c.auth === 'Bearer good')).toBe(true);
  });

  it('maps auth and permission failures to readable errors', async () => {
    const gh = fakeGithub({ push: false });
    const bad = createGithubTarget({ repo: 'me/notes', getToken: async () => 'bad', fetch: gh.fetch, baseUrl: 'https://gh.test' });
    await expect(bad.list()).rejects.toMatchObject({ status: 401 });
    const ro = createGithubTarget({ repo: 'me/notes', getToken: async () => 'good', fetch: gh.fetch, baseUrl: 'https://gh.test' });
    await expect(ro.verify()).rejects.toBeInstanceOf(BackupTargetError);
    const none = createGithubTarget({ repo: 'me/notes', getToken: async () => null, fetch: gh.fetch });
    expect(await none.available()).toBe(false);
    await expect(none.list()).rejects.toMatchObject({ status: 401 });
  });
});

describe('Drive target', () => {
  it('uses appDataFolder for list, multipart upload, media get and delete', async () => {
    const store = new Map<string, { name: string; body: string }>();
    const seen: string[] = [];
    const fetch = async (url: string, init: RequestInit = {}) => {
      const method = init.method ?? 'GET';
      seen.push(`${method} ${url}`);
      const u = new URL(url);
      if (method === 'POST') {
        const body = init.body as string;
        const meta = JSON.parse(/\r\n\r\n(\{.*?\})\r\n/.exec(body)![1]!) as { name: string; parents: string[] };
        expect(meta.parents).toEqual(['appDataFolder']);
        const content = body.split('\r\n\r\n')[2]!.split('\r\n--')[0]!;
        const id = `f${store.size + 1}`;
        store.set(id, { name: meta.name, body: content });
        return new Response(JSON.stringify({ id }));
      }
      if (u.pathname.endsWith('/about')) return new Response(JSON.stringify({ user: { emailAddress: 'me@example.com' } }));
      if (u.pathname.endsWith('/files')) {
        expect(u.searchParams.get('spaces')).toBe('appDataFolder');
        return new Response(JSON.stringify({ files: [...store].map(([id, f]) => ({ id, name: f.name, size: String(f.body.length) })) }));
      }
      const id = decodeURIComponent(u.pathname.split('/').pop()!);
      if (method === 'DELETE') {
        store.delete(id);
        return new Response(null, { status: 204 });
      }
      expect(u.searchParams.get('alt')).toBe('media');
      return new Response(store.get(id)!.body);
    };
    const t = createDriveTarget({ getToken: async () => 'tok', fetch });
    expect(await t.account()).toBe('me@example.com');
    const e1 = await t.put('{"x":1}', { at: 1760000000001, encrypted: false });
    await t.put('{"x":2}', { at: 1760000000002, encrypted: true });
    const list = await t.list();
    expect(list.map((e) => e.at)).toEqual([1760000000002, 1760000000001]);
    expect(list[0]!.encrypted).toBe(true);
    expect(await t.get(e1.id)).toBe('{"x":1}');
    await t.remove(e1.id);
    expect((await t.list()).length).toBe(1);
    expect(seen.some((s) => s.includes('uploadType=multipart'))).toBe(true);
  });
});

describe('backup manager', () => {
  it('backs up to device and remotes, prunes to keep N, and reports failures per target', async () => {
    const device = memoryBackupTarget('file');
    const gh = memoryBackupTarget('github');
    const broken = { ...memoryBackupTarget('gdrive'), put: async () => Promise.reject(new Error('드라이브 실패')) };
    let t = 1760000000000;
    const data = seedStored();
    const m = createBackupManager({ device, remotes: () => [gh, broken], getData: () => data, now: () => ++t });
    for (let i = 0; i < 4; i++) await m.backupNow({ keep: 2 });
    expect((await device.list()).length).toBe(2);
    expect((await gh.list()).length).toBe(2);
    expect(gh.files.get('latest.md')).toContain('# rhymebook 백업');
    const r = await m.backupNow({ keep: 2 });
    expect(r.failures).toEqual([{ targetId: 'gdrive', message: '드라이브 실패' }]);
    const all = await m.list();
    expect(all.entries.length).toBe(4);
    expect(all.entries[0]!.at).toBeGreaterThan(all.entries[3]!.at);
  });

  it('encrypted backups carry no plaintext markdown', async () => {
    const gh = memoryBackupTarget('github');
    const m = createBackupManager({ device: memoryBackupTarget('file'), remotes: () => [gh], getData: seedStored, now: () => 1760000000000 });
    const r = await m.backupNow({ keep: 5, passphrase: 'pw' });
    expect(r.entries.every((e) => e.encrypted)).toBe(true);
    expect(gh.files.has('latest.md')).toBe(false);
  });

  it('restore opens first, then saves a pre-restore backup, then merges', async () => {
    const device = memoryBackupTarget('file');
    let data: StoredData = { sessions: [sess('a', 1)], messages: [msg('a1', 'a')] };
    let t = 1760000000000;
    const m = createBackupManager({ device, remotes: () => [], getData: () => data, now: () => ++t });
    const { entries } = await m.backupNow({ keep: 5, passphrase: 'pw' });
    data = { sessions: [sess('b', 1)], messages: [msg('b1', 'b')] };

    await expect(m.restore(entries[0]!, 'merge', { keep: 5 })).rejects.toMatchObject({ code: 'passphrase-required' });
    expect((await device.list()).length).toBe(1); // 실패 시 자동 백업도 하지 않는다

    const out = await m.restore(entries[0]!, 'merge', { keep: 5, passphrase: 'pw' });
    expect(out.data.sessions.map((s) => s.id).sort()).toEqual(['a', 'b']);
    expect(out.preBackup).not.toBeNull();
    const pre = await openBackup(await device.get(out.preBackup!.id));
    expect(pre.data.sessions.map((s) => s.id)).toEqual(['b']);
  });
});
