import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createKnowledgeStore, INDEX_FILE, KB_MIGRATION_MARKER, runKnowledgeMigration, type KnowledgeStore } from '../src';
import { restoreLatestIndexBackup } from '../src/knowledgeBackup';

/**
 * 롤백·가드 경로 (T7): setKind 롤백, 색인 백업 복원 충돌 거부, 마이그레이션 표식 보류, updateSource 유형 재확인.
 */

let base: string;
let root: string;
let project: string;
let store: KnowledgeStore;

beforeEach(async () => {
  base = await mkdtemp(path.join(os.tmpdir(), 'kb-rollback-'));
  root = path.join(base, 'knowledge');
  project = path.join(base, 'project');
  await mkdir(path.join(project, 'src'), { recursive: true });
  await writeFile(path.join(project, 'src', 'main.ts'), 'export const x = 1;\n');
  store = createKnowledgeStore({ root });
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

async function rawMeta(id: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(path.join(root, id, 'meta.json'), 'utf8')) as Record<string, unknown>;
}

async function snapshotDir(dir: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  async function walk(d: string): Promise<void> {
    for (const e of await readdir(d, { withFileTypes: true })) {
      const abs = path.join(d, e.name);
      if (e.isDirectory()) await walk(abs);
      else out[path.relative(dir, abs)] = await readFile(abs, 'utf8');
    }
  }
  if (existsSync(dir)) await walk(dir);
  return out;
}

describe('setKind 롤백', () => {
  it('색인 파일 옮기기가 막히면 메타 유형을 원래대로 되돌리고 오류를 다시 던진다', async () => {
    const kb = await store.create('롤백 문서');
    const kbDir = path.join(root, kb.id);
    await writeFile(path.join(kbDir, INDEX_FILE), 'LIVE');
    // backup 자리에 파일을 두어 backup/<ts>/ 를 만들 수 없게 한다
    await writeFile(path.join(kbDir, 'backup'), 'blocker');

    await expect(store.setKind(kb.id, 'codebase')).rejects.toThrow();

    expect((await rawMeta(kb.id)).kind).toBe('document');
    const listed = (await store.list()).find((k) => k.id === kb.id);
    expect(listed?.kind).toBe('document');
    // 옮기지 못했으므로 색인 파일은 제자리에 그대로 있다
    expect(await readFile(path.join(kbDir, INDEX_FILE), 'utf8')).toBe('LIVE');
  });
});

describe('restoreLatestIndexBackup 충돌 거부', () => {
  async function kbWithBackup(): Promise<string> {
    const kbDir = path.join(base, 'kb-restore');
    const bak = path.join(kbDir, 'backup', '2026-01-01T00-00-00-000Z');
    await mkdir(bak, { recursive: true });
    await writeFile(path.join(bak, 'index.sqlite'), 'BAK-MAIN');
    await writeFile(path.join(bak, 'index.prev.sqlite'), 'BAK-PREV');
    await writeFile(path.join(bak, 'manifest.json'), JSON.stringify({ version: 1, createdAt: 1, reason: 'test', files: ['index.sqlite', 'index.prev.sqlite'] }));
    return kbDir;
  }

  it.each(['index.sqlite', 'index.next.sqlite', 'index.prev.sqlite', 'index.sqlite-wal', 'index.next.sqlite-shm', 'index.prev.sqlite-wal'])(
    '%s 가 목적지에 있으면 false를 돌려주고 아무것도 덮어쓰지 않는다',
    async (blocker) => {
      const kbDir = await kbWithBackup();
      await writeFile(path.join(kbDir, blocker), 'EXISTING');

      expect(restoreLatestIndexBackup(kbDir)).toBe(false);

      expect(await readFile(path.join(kbDir, blocker), 'utf8')).toBe('EXISTING');
      expect(existsSync(path.join(kbDir, 'backup', '2026-01-01T00-00-00-000Z', 'index.sqlite'))).toBe(true);
      // 다른 파일도 옮겨지지 않았다
      if (blocker !== 'index.sqlite') expect(existsSync(path.join(kbDir, 'index.sqlite'))).toBe(false);
      if (blocker !== 'index.prev.sqlite') expect(existsSync(path.join(kbDir, 'index.prev.sqlite'))).toBe(false);
    },
  );

  it('목적지가 비어 있으면 백업을 되돌린다 (true)', async () => {
    const kbDir = await kbWithBackup();
    expect(restoreLatestIndexBackup(kbDir)).toBe(true);
    expect(await readFile(path.join(kbDir, 'index.sqlite'), 'utf8')).toBe('BAK-MAIN');
    expect(await readFile(path.join(kbDir, 'index.prev.sqlite'), 'utf8')).toBe('BAK-PREV');
  });
});

describe('마이그레이션 표식 보류', () => {
  it('meta가 깨진 KB 폴더가 있으면 표식을 쓰지 않고, 고친 뒤 다음 실행에서 표식을 쓴다', async () => {
    const ok = await store.create('정상 문서');
    const broken = await store.create('깨진 문서');
    const brokenDir = path.join(root, broken.id);
    await mkdir(path.join(brokenDir, 'files'), { recursive: true });
    await writeFile(path.join(brokenDir, 'files', 'note.md'), '# 원본\n');
    const filesBefore = await snapshotDir(path.join(brokenDir, 'files'));
    await writeFile(path.join(brokenDir, 'meta.json'), '{ 깨진 json');

    const first = await runKnowledgeMigration({ root, store });
    expect(first.skippedUnreadable).toBeGreaterThan(0);
    expect(first.markerWritten).toBe(false);
    expect(existsSync(path.join(root, KB_MIGRATION_MARKER))).toBe(false);
    expect(await snapshotDir(path.join(brokenDir, 'files'))).toEqual(filesBefore);

    // meta를 고친다 (유형 없는 정상 형식)
    await writeFile(
      path.join(brokenDir, 'meta.json'),
      JSON.stringify({ id: broken.id, name: '깨진 문서', createdAt: 1, updatedAt: 1, sources: [] }),
    );
    const second = await runKnowledgeMigration({ root, store });
    expect(second.skippedUnreadable).toBe(0);
    expect(second.markerWritten).toBe(true);
    expect(existsSync(path.join(root, KB_MIGRATION_MARKER))).toBe(true);
    expect(await snapshotDir(path.join(brokenDir, 'files'))).toEqual(filesBefore);
    expect((await store.list()).some((k) => k.id === ok.id)).toBe(true);
  });
});

describe('updateSource 유형 재확인', () => {
  it('받는 도중 유형이 바뀌면 badSettings로 실패하고, 새로 받은 항목을 치우며 원본은 남긴다', async () => {
    const kb = await store.create('폴더 출처');
    await store.addPaths(kb.id, [path.join(project, 'src')]);
    const meta = await rawMeta(kb.id);
    const src = (meta.sources as { id: string }[])[0]!;

    const filesDir = path.join(root, kb.id, 'files');
    const before = await snapshotDir(filesDir);

    // 받는 중(serial 밖)에 유형을 바꾼다
    const orig = store.addPaths.bind(store);
    vi.spyOn(store, 'addPaths').mockImplementation(async (...args) => {
      const r = await orig(...args);
      await store.setKind(kb.id, 'codebase');
      return r;
    });

    await expect(store.updateSource(kb.id, src.id)).rejects.toThrow('색인 설정 값이 올바르지 않습니다');

    expect((await rawMeta(kb.id)).kind).toBe('codebase');
    // 원본 파일과 스테이징된 새 복사본이 모두 원래대로여야 한다 (새 복사본은 치워진다)
    expect(await snapshotDir(filesDir)).toEqual(before);
  });
});
