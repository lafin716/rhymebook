import { mkdtemp, readFile, readdir, rm, unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi, type MockedFunction } from 'vitest';
import {
  createHashEmbedder,
  DEFAULT_RAG_SETTINGS,
  KnowledgePolicyError,
  type EmbeddingProvider,
  type KnowledgeIndexSettings,
  type QueryPlan,
  type RetrievalRequest,
} from '@branch/core';
import { createKnowledgeIndexer, createKnowledgeStore, type KnowledgeIndexer, type KnowledgeStore } from '../src';

/**
 * meta.json fail closed (T7): 읽을 수 없는 meta(없음·깨짐·알 수 없는 kind)면
 * 색인·벡터·임베딩 경로를 모두 막는다. 임베딩 호출 0, 색인 파일 0.
 */

let base: string;
let root: string;
let kbId: string;
let store: KnowledgeStore;
let indexer: KnowledgeIndexer;
let embedderFor: MockedFunction<(kbId: string, settings: KnowledgeIndexSettings) => EmbeddingProvider>;
let embedCalls: number;

function planFor(question: string): QueryPlan {
  const keywords = question.toLowerCase().split(/\s+/).filter(Boolean);
  return { original: question, rewritten: question, keywords, contextTerms: [], vectorText: question, keywordQuery: keywords, contextual: false };
}

function requestFor(kbIds: string[], question: string): RetrievalRequest {
  return { kbIds, plan: planFor(question), settings: DEFAULT_RAG_SETTINGS };
}

async function indexFilesIn(dir: string): Promise<string[]> {
  return (await readdir(dir)).filter((n) => n.startsWith('index'));
}

function expectUnreadable(p: Promise<unknown>): Promise<void> {
  return p.then(
    () => {
      throw new Error('expected kb_meta_unreadable');
    },
    (err: unknown) => {
      expect(err).toBeInstanceOf(KnowledgePolicyError);
      expect((err as KnowledgePolicyError).code).toBe('kb_meta_unreadable');
    },
  );
}

beforeEach(async () => {
  base = await mkdtemp(path.join(os.tmpdir(), 'kb-meta-'));
  root = path.join(base, 'knowledge');
  store = createKnowledgeStore({ root });
  const kb = await store.create('손상 테스트');
  kbId = kb.id;
  await store.setSettings(kbId, { embedding: { provider: 'none' } });
  await store.addFiles(kbId, [{ name: 'a.md', data: new TextEncoder().encode('# A\n\nquartzRefund 절차.\n') }]);
  embedCalls = 0;
  const base0 = createHashEmbedder();
  const spy: EmbeddingProvider = {
    info: base0.info,
    batchSize: base0.batchSize,
    async embed(texts, signal) {
      embedCalls++;
      return base0.embed(texts, signal);
    },
  };
  embedderFor = vi.fn((_id: string, _s: KnowledgeIndexSettings) => spy);
  indexer = createKnowledgeIndexer({ root, getOpenAIKey: () => 'sk-test-not-used', embedderFor, retryDelayMs: 1 });
});

afterEach(async () => {
  await indexer.close();
  await rm(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

const CASES: { name: string; damage: (metaPath: string) => Promise<void> }[] = [
  { name: 'meta.json이 깨진 JSON', damage: (p) => writeFile(p, '{not json') },
  { name: 'meta.json이 객체가 아님', damage: (p) => writeFile(p, '[1,2,3]') },
  { name: 'meta.json의 kind가 알 수 없는 값', damage: (p) => writeFile(p, JSON.stringify({ name: 'x', createdAt: 1, updatedAt: 1, kind: 'wiki' })) },
  { name: 'meta.json의 kind가 null', damage: (p) => writeFile(p, JSON.stringify({ name: 'x', createdAt: 1, updatedAt: 1, kind: null })) },
  { name: 'meta.json 없음', damage: (p) => unlink(p) },
];

describe.each(CASES)('읽을 수 없는 meta: $name', ({ damage }) => {
  it('색인·임베딩 경로는 kb_meta_unreadable로 거부하고 임베딩·색인 파일을 만들지 않는다', async () => {
    await damage(path.join(root, kbId, 'meta.json'));

    await expectUnreadable(indexer.enqueue(kbId, 'full'));
    await expectUnreadable(indexer.reindex(kbId, { full: true }));
    await expectUnreadable(indexer.verify(kbId));

    expect(embedderFor).not.toHaveBeenCalled();
    expect(embedCalls).toBe(0);
    expect(await indexFilesIn(path.join(root, kbId))).toEqual([]);
  });

  it('검색 라우팅에서 빠지고 임베딩·색인 파일을 만들지 않는다', async () => {
    await damage(path.join(root, kbId, 'meta.json'));

    const res = await indexer.retrieve(requestFor([kbId], 'quartzRefund'));

    expect(res.evidence.some((e) => e.kbId === kbId)).toBe(false);
    expect(res.skipped.some((s) => s.kbId === kbId && s.reason === 'kb_meta_unreadable')).toBe(true);
    expect(embedderFor).not.toHaveBeenCalled();
    expect(embedCalls).toBe(0);
    expect(await indexFilesIn(path.join(root, kbId))).toEqual([]);
  });
});

describe('meta.json 읽기 규칙', () => {
  it('kind 키가 없는 meta.json은 미분류(레거시)로 보고 색인을 막지 않는다', async () => {
    const metaPath = path.join(root, kbId, 'meta.json');
    const raw = JSON.parse(await readFile(metaPath, 'utf8')) as Record<string, unknown>;
    delete raw.kind;
    await writeFile(metaPath, JSON.stringify(raw));

    await expect(indexer.enqueue(kbId, 'full')).resolves.toBeUndefined();
    expect(embedderFor).toHaveBeenCalled();
  });
});
