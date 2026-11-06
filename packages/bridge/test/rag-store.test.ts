import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_INDEX_SETTINGS, NEW_DOCUMENT_INDEX_SETTINGS, t } from '@branch/core';
import { createKnowledgeStore, type KnowledgeStore } from '../src';

function htmlResponse(body: string): Response {
  return new Response(body, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
}

let root: string;
let srcDir: string;
let store: KnowledgeStore;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'rag-store-root-'));
  srcDir = await mkdtemp(path.join(os.tmpdir(), 'rag-store-src-'));
  fetchMock = vi.fn(async () => htmlResponse('<html><title>Page</title><body>hello world</body></html>'));
  store = createKnowledgeStore({ root, fetch: fetchMock as unknown as typeof fetch, env: { PATH: process.env.PATH } });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
  await rm(srcDir, { recursive: true, force: true });
});

describe('knowledge store: RAG 확장', () => {
  it('설명은 다듬고 500자로 자른다', async () => {
    const kb = await store.create('설명 테스트');
    const updated = await store.setDescription(kb.id, `  ${'가'.repeat(600)}  `);
    expect(updated.description).toHaveLength(500);
    expect(updated.description?.startsWith('가')).toBe(true);
  });

  it('새 문서 KB는 로컬 해시 임베딩으로 만든다 (유형별 기본값)', async () => {
    const kb = await store.create('설정 기본');
    expect(await store.getSettings(kb.id)).toEqual(NEW_DOCUMENT_INDEX_SETTINGS);
  });

  it('설정이 없는 기존 KB는 예전 기본값(local-hash)으로 읽는다 (호환)', async () => {
    const kb = await store.create('설정 없음');
    const metaFile = path.join(root, kb.id, 'meta.json');
    const raw = JSON.parse(await readFile(metaFile, 'utf8')) as Record<string, unknown>;
    delete raw.settings;
    await writeFile(metaFile, JSON.stringify(raw));
    const fresh = createKnowledgeStore({ root, fetch: fetchMock as unknown as typeof fetch, env: { PATH: process.env.PATH } });
    expect(await fresh.getSettings(kb.id)).toEqual(DEFAULT_INDEX_SETTINGS);
  });

  it('OpenAI 출력 차원 수를 보존한다', async () => {
    const kb = await store.create('차원');
    await store.setSettings(kb.id, { embedding: { provider: 'openai', model: 'text-embedding-3-large', dimensions: 1024 } });
    expect(await store.getSettings(kb.id)).toEqual({ embedding: { provider: 'openai', model: 'text-embedding-3-large', dimensions: 1024 } });
  });

  it('설정을 저장하고 다시 읽는다', async () => {
    const kb = await store.create('설정 저장');
    await store.setSettings(kb.id, { embedding: { provider: 'openai', model: 'text-embedding-3-small' } });
    expect(await store.getSettings(kb.id)).toEqual({ embedding: { provider: 'openai', model: 'text-embedding-3-small' } });
  });

  it('자동 색인 끔 설정을 보존하고, 켜면 기본값으로 돌아간다', async () => {
    const kb = await store.create('자동 색인');
    await store.setSettings(kb.id, { embedding: { provider: 'local-hash' }, autoIndex: false });
    expect(await store.getSettings(kb.id)).toEqual({ embedding: { provider: 'local-hash' }, autoIndex: false });
    await store.setSettings(kb.id, { embedding: { provider: 'local-hash' }, autoIndex: true });
    expect((await store.getSettings(kb.id)).autoIndex).toBeUndefined();
  });

  it('잘못된 설정은 거절한다', async () => {
    const kb = await store.create('설정 오류');
    await expect(
      store.setSettings(kb.id, { embedding: { provider: 'unknown' } } as unknown as Parameters<KnowledgeStore['setSettings']>[1]),
    ).rejects.toThrow();
  });

  it('파일 추가는 출처를 기록한다', async () => {
    const kb = await store.create('출처 파일');
    await store.addFiles(kb.id, [{ name: 'note.md', data: new TextEncoder().encode('# 메모\n내용') }]);
    const sources = await store.sources(kb.id);
    expect(sources).toHaveLength(1);
    expect(sources[0]?.type).toBe('files');
    expect(sources[0]?.id).toMatch(/^src[0-9a-f]+$/);
  });

  it('폴더 추가는 출처에 원래 경로를 남긴다', async () => {
    const kb = await store.create('출처 폴더');
    const folder = path.join(srcDir, 'notes');
    await mkdir(folder);
    await writeFile(path.join(folder, 'a.md'), '# A');
    await store.addPaths(kb.id, [folder]);
    const sources = await store.sources(kb.id);
    expect(sources).toHaveLength(1);
    expect(sources[0]?.type).toBe('folder');
    expect(sources[0]?.location).toBe(folder);
  });

  it('링크 추가는 web 출처를 남긴다', async () => {
    const kb = await store.create('출처 링크');
    await store.addLink(kb.id, 'https://example.com/page');
    const sources = await store.sources(kb.id);
    expect(sources.map((s) => s.type)).toEqual(['web']);
    expect(sources[0]?.location).toBe('https://example.com/page');
  });

  it('폴더 출처는 원본을 다시 읽어 갱신한다', async () => {
    const kb = await store.create('갱신 폴더');
    const folder = path.join(srcDir, 'guide');
    await mkdir(folder);
    await writeFile(path.join(folder, 'a.md'), '# A');
    await store.addPaths(kb.id, [folder]);
    const [src] = await store.sources(kb.id);
    expect(src).toBeDefined();

    await writeFile(path.join(folder, 'b.md'), '# B 새 문서');
    const result = await store.updateSource(kb.id, src!.id);
    expect(result).toBeDefined();
    const tree = JSON.stringify(await store.tree(kb.id));
    expect(tree).toContain('b.md');
    const after = await store.sources(kb.id);
    expect(after).toHaveLength(1);
    expect(after[0]?.id).toBe(src!.id);
  });

  it('링크 출처는 다시 가져오고 출처 행은 하나로 유지한다', async () => {
    const kb = await store.create('갱신 링크');
    await store.addLink(kb.id, 'https://example.com/doc');
    const [src] = await store.sources(kb.id);
    fetchMock.mockClear();
    await store.updateSource(kb.id, src!.id);
    expect(fetchMock).toHaveBeenCalled();
    expect(await store.sources(kb.id)).toHaveLength(1);
  });

  it('파일 출처는 원본이 없어 갱신할 수 없다', async () => {
    const kb = await store.create('갱신 불가');
    await store.addFiles(kb.id, [{ name: 'only.md', data: new TextEncoder().encode('# only') }]);
    const [src] = await store.sources(kb.id);
    await expect(store.updateSource(kb.id, src!.id)).rejects.toThrow(t('bridge.knowledge.sourceNoOrigin'));
  });

  it('지식베이스를 지우면 색인 파일과 출처 기록도 사라진다', async () => {
    const kb = await store.create('삭제 정리');
    await store.addFiles(kb.id, [{ name: 'x.md', data: new TextEncoder().encode('# x') }]);
    const dir = store.dirFor(kb.id);
    await writeFile(path.join(dir, 'index.sqlite'), 'placeholder');
    await store.remove(kb.id);
    await expect(stat(dir)).rejects.toThrow();
    expect((await store.list()).map((k) => k.id)).not.toContain(kb.id);
  });

  it('메타 파일에 설명과 출처가 보존된다', async () => {
    const kb = await store.create('메타 보존');
    await store.setDescription(kb.id, '설명');
    await store.addLink(kb.id, 'https://example.com/keep');
    const metaFiles = await readFile(path.join(store.dirFor(kb.id), '..', 'meta.json'), 'utf8').catch(() => '');
    const raw = metaFiles || (await readFile(path.join(root, kb.id, 'kb.json'), 'utf8').catch(() => ''));
    expect(raw).toContain('설명');
    expect(raw).toContain('https://example.com/keep');
  });
});

describe('knowledge store: 링크 연결 직전 주소 재검사', () => {
  it('요청 전에는 공인 주소였지만 연결 직전에 사설 주소로 바뀌면 소켓을 열지 않고 거부한다', async () => {
    // 첫 조회(요청 전 검사)는 공인, 두 번째 조회(연결 직전)는 루프백 → DNS 리바인딩 시나리오
    let calls = 0;
    const lookup = vi.fn(async () => (calls++ === 0 ? ['93.184.216.34'] : ['127.0.0.1']));
    const pinned = createKnowledgeStore({ root, lookup, env: { PATH: process.env.PATH } });
    const kb = await pinned.create('리바인딩');
    await expect(pinned.addLink(kb.id, 'http://rebind.example.test/page')).rejects.toThrow(
      t('bridge.knowledge.privateHost'),
    );
    expect(lookup).toHaveBeenCalledTimes(2);
    expect(await pinned.sources(kb.id)).toHaveLength(0);
  });
});
