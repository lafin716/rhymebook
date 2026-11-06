import { existsSync } from 'node:fs';
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  KB_MIGRATION_MARKER,
  KB_MIGRATION_VERSION,
  runKnowledgeMigration,
  type KnowledgeStore,
  createKnowledgeStore,
} from '../src';

/**
 * 유형 마이그레이션 (ADR-132): 확실한 것만 분류, 코드베이스 색인은 백업 폴더로 이동(삭제 아님), 멱등.
 * 원본(files/)·세션 파일은 바뀌지 않아야 한다.
 */

let base: string;
let root: string;
let store: KnowledgeStore;

beforeEach(async () => {
  base = await mkdtemp(path.join(os.tmpdir(), 'kb-migrate-'));
  root = path.join(base, 'knowledge');
  store = createKnowledgeStore({ root });
});

afterEach(async () => {
  await rm(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

/** 유형이 없는 옛 형식의 KB를 만든다 (meta.json에서 kind 제거) */
async function legacyKb(name: string, files: { name: string; text: string }[]): Promise<string> {
  const kb = await store.create(name);
  // 폴더 구조는 dest로 만든다 (name은 파일 이름만)
  for (const f of files) {
    const dir = path.posix.dirname(f.name);
    await store.addFiles(
      kb.id,
      [{ name: path.posix.basename(f.name), data: new TextEncoder().encode(f.text) }],
      dir === '.' ? undefined : dir,
    );
  }
  const metaPath = path.join(root, kb.id, 'meta.json');
  const raw = JSON.parse(await readFile(metaPath, 'utf8')) as Record<string, unknown>;
  delete raw.kind;
  delete raw.kindSuggestion;
  delete raw.migratedFrom;
  await writeFile(metaPath, JSON.stringify(raw));
  return kb.id;
}

async function metaRaw(id: string): Promise<string> {
  return readFile(path.join(root, id, 'meta.json'), 'utf8');
}

/** files/ 아래 모든 파일의 상대 경로 → 내용 해시 대신 전체 내용 (작은 테스트 파일이라 충분) */
async function snapshot(dir: string): Promise<Record<string, string>> {
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

describe('유형 분류', () => {
  it('문서만 있는 옛 KB는 문서형으로 확실히 분류한다', async () => {
    const id = await legacyKb('노트', [
      { name: 'a.md', text: '# a' },
      { name: 'b.txt', text: 'b' },
    ]);
    const report = await runKnowledgeMigration({ root, store });
    const kb = (await store.list()).find((k) => k.id === id);
    expect(kb?.kind).toBe('document');
    const raw = JSON.parse(await metaRaw(id)) as { migratedFrom?: { version: string } };
    expect(raw.migratedFrom?.version).toBe(KB_MIGRATION_VERSION);
    expect(report.classified).toBeGreaterThanOrEqual(1);
  });

  it('프로젝트 표식 + 코드 3개 이상이면 코드베이스로 확실히 분류한다', async () => {
    const id = await legacyKb('앱 소스', [
      { name: 'package.json', text: '{"name":"app"}' },
      { name: 'src/a.ts', text: 'export const a = 1;' },
      { name: 'src/b.ts', text: 'export const b = 2;' },
      { name: 'src/c.ts', text: 'export const c = 3;' },
    ]);
    await runKnowledgeMigration({ root, store });
    const kb = (await store.list()).find((k) => k.id === id);
    expect(kb?.kind).toBe('codebase');
    const raw = JSON.parse(await metaRaw(id)) as { migratedFrom?: unknown };
    expect(raw.migratedFrom).toBeDefined();
  });

  it('애매한 혼합은 유형을 정하지 않고 추정만 남긴다 (미분류 유지)', async () => {
    const id = await legacyKb('섞임', [
      { name: 'a.md', text: '# a' },
      { name: 'b.md', text: '# b' },
      { name: 'c.ts', text: 'export {};' },
      { name: 'd.ts', text: 'export {};' },
    ]);
    const report = await runKnowledgeMigration({ root, store });
    const kb = (await store.list()).find((k) => k.id === id);
    expect(kb?.kind).toBeUndefined();
    expect(kb?.kindSuggestion?.kind).toBe('document');
    expect(report.suggested).toBeGreaterThanOrEqual(1);
    expect(report.entries.find((e) => e.id === id)?.action).toBe('suggested');
  });
});

describe('코드베이스 색인 백업', () => {
  it('색인 파일은 backup/<ts>/로 옮겨지고 내용은 보존되며 manifest가 남는다', async () => {
    const id = await legacyKb('옛 코드', [{ name: 'package.json', text: '{}' }]);
    // 코드베이스로 확정된 상태 + 남아 있는 색인 파일 (삭제되면 안 된다)
    const metaPath = path.join(root, id, 'meta.json');
    const raw = JSON.parse(await readFile(metaPath, 'utf8')) as Record<string, unknown>;
    raw.kind = 'codebase';
    await writeFile(metaPath, JSON.stringify(raw));
    await writeFile(path.join(root, id, 'index.sqlite'), 'DUMMY-INDEX');
    await writeFile(path.join(root, id, 'index.sqlite-wal'), 'DUMMY-WAL');

    const report = await runKnowledgeMigration({ root, store });

    expect(report.backedUp).toBe(1);
    expect(existsSync(path.join(root, id, 'index.sqlite'))).toBe(false);
    const backups = await readdir(path.join(root, id, 'backup'));
    expect(backups.length).toBe(1);
    const dir = path.join(root, id, 'backup', backups[0]!);
    expect(await readFile(path.join(dir, 'index.sqlite'), 'utf8')).toBe('DUMMY-INDEX');
    expect(await readFile(path.join(dir, 'index.sqlite-wal'), 'utf8')).toBe('DUMMY-WAL');
    const manifest = JSON.parse(await readFile(path.join(dir, 'manifest.json'), 'utf8')) as { files: string[]; reason: string };
    expect(manifest.files).toContain('index.sqlite');
    expect(manifest.reason).toBe('codebase_index_backup');
    expect((await stat(dir)).isDirectory()).toBe(true);
  });
});

describe('멱등성과 원본 보존', () => {
  it('두 번째 실행은 alreadyMigrated로 끝나고 아무것도 바꾸지 않는다', async () => {
    await legacyKb('노트', [{ name: 'a.md', text: '# a' }]);
    const first = await runKnowledgeMigration({ root, store });
    expect(first.markerWritten).toBe(true);
    const second = await runKnowledgeMigration({ root, store });
    expect(second.alreadyMigrated).toBe(true);
    expect(second.classified + second.backedUp + second.suggested).toBe(0);
  });

  it('표식을 지우고 다시 돌려도 meta.json·files/는 바뀌지 않는다', async () => {
    const docId = await legacyKb('노트', [{ name: 'a.md', text: '# a' }]);
    const ambId = await legacyKb('섞임', [
      { name: 'a.md', text: '# a' },
      { name: 'b.md', text: '# b' },
      { name: 'c.ts', text: 'x' },
      { name: 'd.ts', text: 'y' },
    ]);
    await runKnowledgeMigration({ root, store });
    const metaBefore = { doc: await metaRaw(docId), amb: await metaRaw(ambId) };
    const filesBefore = { doc: await snapshot(path.join(root, docId, 'files')) };

    await rm(path.join(root, KB_MIGRATION_MARKER), { force: true });
    const rerun = await runKnowledgeMigration({ root, store });

    expect(rerun.alreadyMigrated).toBe(false);
    expect(rerun.errors).toBe(0);
    expect(await metaRaw(docId)).toBe(metaBefore.doc);
    expect(await metaRaw(ambId)).toBe(metaBefore.amb);
    expect(await snapshot(path.join(root, docId, 'files'))).toEqual(filesBefore.doc);
  });

  it('files/ 원본과 세션 파일(sessions.json)은 마이그레이션 전후로 같다', async () => {
    const id = await legacyKb('노트', [
      { name: 'a.md', text: '# a 원본' },
      { name: 'sub/b.txt', text: 'b 원본' },
    ]);
    const sessions = path.join(root, '..', 'sessions.json');
    const sessionText = JSON.stringify({ sessions: [{ id: 's1', knowledgeIds: [id] }] });
    await writeFile(sessions, sessionText);

    const filesBefore = await snapshot(path.join(root, id, 'files'));
    await runKnowledgeMigration({ root, store });

    expect(await snapshot(path.join(root, id, 'files'))).toEqual(filesBefore);
    expect(await readFile(sessions, 'utf8')).toBe(sessionText);
  });

  it('오류가 하나라도 있으면 표식을 남기지 않아 다음 시작 때 다시 시도한다', async () => {
    await legacyKb('노트', [{ name: 'a.md', text: '# a' }]);
    const failing: KnowledgeStore = {
      ...store,
      setKind: async () => {
        throw new Error('disk full');
      },
    };
    const report = await runKnowledgeMigration({ root, store: failing });
    expect(report.errors).toBe(1);
    expect(report.markerWritten).toBe(false);
    expect(existsSync(path.join(root, KB_MIGRATION_MARKER))).toBe(false);

    const retry = await runKnowledgeMigration({ root, store });
    expect(retry.errors).toBe(0);
    expect(retry.markerWritten).toBe(true);
  });
});
