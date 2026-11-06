import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { KnowledgePolicyError } from '@branch/core';
import { createKnowledgeStore, INDEX_FILE, type KnowledgeStore } from '../src';

/**
 * 저장소 가드 (ADR-127·132): 연결 폴더 검증, 유형 전환 잠금, 색인 백업과 복원.
 */

let base: string;
let root: string;
let project: string;
let store: KnowledgeStore;
let released: string[];
/** releaseIndex가 불릴 때 색인 파일이 아직 있었는지 (연결을 먼저 닫고 나서 옮겨야 한다) */
let indexPresentAtRelease: boolean[];

beforeEach(async () => {
  base = await mkdtemp(path.join(os.tmpdir(), 'kb-store-guard-'));
  root = path.join(base, 'knowledge');
  project = path.join(base, 'project');
  await mkdir(path.join(project, 'src'), { recursive: true });
  await writeFile(path.join(project, 'src', 'main.ts'), 'export const x = 1;\n');
  released = [];
  indexPresentAtRelease = [];
  store = createKnowledgeStore({
    root,
    releaseIndex: async (kbId) => {
      released.push(kbId);
      const dir = path.join(root, kbId);
      indexPresentAtRelease.push(existsSync(path.join(dir, INDEX_FILE)));
    },
  });
});

afterEach(async () => {
  await rm(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

function policyCode(p: Promise<unknown>): Promise<string | undefined> {
  return p.then(
    () => undefined,
    (err: unknown) => (err instanceof KnowledgePolicyError ? err.code : `not-policy:${String(err)}`),
  );
}

/** 색인 파일 흉내 (내용은 상관없다. 옮겨지는지와 내용 보존만 본다) */
async function plantIndex(kbId: string, text: string): Promise<void> {
  await writeFile(path.join(root, kbId, INDEX_FILE), text);
}

async function backupDirs(kbId: string): Promise<string[]> {
  const dir = path.join(root, kbId, 'backup');
  if (!existsSync(dir)) return [];
  return readdir(dir);
}

describe('연결 폴더 생성 검증', () => {
  it('상대 경로 연결은 folder_not_allowed로 거부한다', async () => {
    expect(await policyCode(store.create('상대', { kind: 'codebase', linkedPath: 'relative/dir' }))).toBe(
      'folder_not_allowed',
    );
  });

  it('없는 절대 경로 연결은 거부한다', async () => {
    expect(
      await policyCode(store.create('없음', { kind: 'codebase', linkedPath: path.join(base, 'nope') })),
    ).toBe('folder_not_allowed');
  });

  it('앱 지식 폴더 안을 연결하면 거부한다 (순환 색인 방지)', async () => {
    await mkdir(path.join(root, 'inside'), { recursive: true });
    expect(
      await policyCode(store.create('안쪽', { kind: 'codebase', linkedPath: path.join(root, 'inside') })),
    ).toBe('folder_not_allowed');
  });

  it('문서형에 연결 폴더를 붙이면 linked_kind_locked로 거부한다', async () => {
    expect(await policyCode(store.create('문서+연결', { kind: 'document', linkedPath: project }))).toBe(
      'linked_kind_locked',
    );
  });

  it('정상 연결 코드베이스는 실제 경로(realpath)로 저장된다', async () => {
    const kb = await store.create('정상', { kind: 'codebase', linkedPath: project });
    const list = await store.list();
    const saved = list.find((k) => k.id === kb.id);
    expect(saved?.kind).toBe('codebase');
    expect(saved?.linkedPath).toBe(await (await import('node:fs/promises')).realpath(project));
  });
});

describe('유형 전환 잠금과 색인 백업', () => {
  it('연결 코드베이스를 문서형으로 바꾸면 linked_kind_locked, 색인 파일은 그대로다', async () => {
    const kb = await store.create('연결', { kind: 'codebase', linkedPath: project });
    await plantIndex(kb.id, 'LIVE');
    expect(await policyCode(store.setKind(kb.id, 'document'))).toBe('linked_kind_locked');
    expect(await readFile(path.join(root, kb.id, INDEX_FILE), 'utf8')).toBe('LIVE');
    expect(released).toEqual([]);
  });

  it('setKind(codebase)는 색인을 먼저 release하고, 그 다음 색인 파일을 backup/으로 옮긴다', async () => {
    const kb = await store.create('일반 문서');
    await plantIndex(kb.id, 'OLD-INDEX');
    await store.setKind(kb.id, 'codebase');

    expect(released).toEqual([kb.id]);
    // release 시점에는 아직 색인 파일이 제자리에 있었다 (연결을 닫은 뒤 옮긴다)
    expect(indexPresentAtRelease).toEqual([true]);
    expect(existsSync(path.join(root, kb.id, INDEX_FILE))).toBe(false);

    const dirs = await backupDirs(kb.id);
    expect(dirs.length).toBe(1);
    const dir = path.join(root, kb.id, 'backup', dirs[0]!);
    expect(await readFile(path.join(dir, INDEX_FILE), 'utf8')).toBe('OLD-INDEX');
    const manifest = JSON.parse(await readFile(path.join(dir, 'manifest.json'), 'utf8')) as {
      files: string[];
      reason: string;
      fromKind?: string;
      toKind?: string;
    };
    expect(manifest.files).toContain(INDEX_FILE);
    expect(manifest.reason).toBe('kind_change');
    expect(manifest.fromKind).toBe('document');
    expect(manifest.toKind).toBe('codebase');
  });

  it('색인 파일이 없으면 backup/을 만들지 않는다', async () => {
    const kb = await store.create('빈 문서');
    await store.setKind(kb.id, 'codebase');
    expect(await backupDirs(kb.id)).toEqual([]);
  });
});

describe('색인 백업 복원 (restoreIndexBackup)', () => {
  it('코드베이스 KB는 복원하지 않는다 (false)', async () => {
    const kb = await store.create('코드', { kind: 'codebase', linkedPath: project });
    expect(await store.restoreIndexBackup(kb.id)).toBe(false);
  });

  it('살아 있는 색인이 있으면 복원하지 않는다 (false, 백업은 그대로)', async () => {
    const kb = await store.create('문서 복원 방지');
    await plantIndex(kb.id, 'OLD');
    await store.setKind(kb.id, 'codebase');
    await store.setKind(kb.id, 'document');
    await plantIndex(kb.id, 'LIVE-NEW');
    expect(await store.restoreIndexBackup(kb.id)).toBe(false);
    expect(await readFile(path.join(root, kb.id, INDEX_FILE), 'utf8')).toBe('LIVE-NEW');
    expect((await backupDirs(kb.id)).length).toBe(1);
  });

  it('코드베이스 → 문서형으로 되돌린 뒤 옛 색인을 복원할 수 있다 (true)', async () => {
    const kb = await store.create('되돌림');
    await plantIndex(kb.id, 'OLD-INDEX');
    await store.setKind(kb.id, 'codebase');
    await store.setKind(kb.id, 'document');

    expect(await store.restoreIndexBackup(kb.id)).toBe(true);
    expect(await readFile(path.join(root, kb.id, INDEX_FILE), 'utf8')).toBe('OLD-INDEX');
  });

  it('백업이 없으면 false다', async () => {
    const kb = await store.create('백업 없음');
    expect(await store.restoreIndexBackup(kb.id)).toBe(false);
  });
});
