import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi, type MockedFunction } from 'vitest';
import {
  createHashEmbedder,
  DEFAULT_RAG_SETTINGS,
  type EmbeddingProvider,
  type KnowledgeIndexSettings,
  type KnowledgeIndexState,
  type QueryPlan,
  type RetrievalRequest,
} from '@branch/core';
import { createKnowledgeIndexer, createKnowledgeStore, type KnowledgeIndexer, type KnowledgeStore } from '../src';

/**
 * 혼합 라우팅 (ADR-131): 코드베이스 KB는 실시간 탐색, 문서 KB는 하이브리드. 결과만 합치고 각자 정책을 지킨다.
 */

const TERMINAL = new Set(['ready', 'stale', 'empty', 'error']);

function planFor(question: string): QueryPlan {
  const keywords = question.toLowerCase().split(/\s+/).filter(Boolean);
  return {
    original: question,
    rewritten: question,
    keywords,
    contextTerms: [],
    vectorText: question,
    keywordQuery: keywords,
    contextual: false,
  };
}

let base: string;
let root: string;
let store: KnowledgeStore;
let indexer: KnowledgeIndexer;
let codeKb: string;
let docKb: string;
let embedCalls: string[][];
let embedderFor: MockedFunction<(kbId: string, settings: KnowledgeIndexSettings) => EmbeddingProvider>;

beforeEach(async () => {
  base = await mkdtemp(path.join(os.tmpdir(), 'kb-mixed-'));
  root = path.join(base, 'knowledge');
  const project = path.join(base, 'project');
  await mkdir(path.join(project, 'src'), { recursive: true });
  await writeFile(path.join(project, 'src', 'billing.ts'), 'export function zebraInvoice() {\n  return 42;\n}\n');
  await writeFile(path.join(project, 'README.md'), '# 청구 서비스\n');
  store = createKnowledgeStore({ root });
  codeKb = (await store.create('청구 코드', { kind: 'codebase', linkedPath: project })).id;
  docKb = (await store.create('청구 매뉴얼')).id;
  await mkdir(path.join(root, docKb, 'files'), { recursive: true });
  await writeFile(
    path.join(root, docKb, 'files', 'manual.md'),
    '# 매뉴얼\n\nquartzRefund 절차는 영업일 3일 안에 처리된다.\n',
  );
  embedCalls = [];
  const hash = createHashEmbedder();
  const spy: EmbeddingProvider = {
    info: hash.info,
    batchSize: hash.batchSize,
    async embed(texts, signal) {
      embedCalls.push([...texts]);
      return hash.embed(texts, signal);
    },
  };
  embedderFor = vi.fn((_kbId: string, _settings: KnowledgeIndexSettings) => spy);
  indexer = createKnowledgeIndexer({
    root,
    getOpenAIKey: () => undefined,
    retryDelayMs: 1,
    embedderFor,
  });
});

afterEach(async () => {
  await indexer.close();
  await rm(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

function runJob(kbId: string): Promise<KnowledgeIndexState> {
  return new Promise((resolve, reject) => {
    const off = indexer.onState((s) => {
      if (s.kbId !== kbId || !TERMINAL.has(s.status)) return;
      off();
      resolve(s);
    });
    indexer.enqueue(kbId).catch((e: unknown) => {
      off();
      reject(e);
    });
  });
}

function requestFor(kbIds: string[], question: string): RetrievalRequest {
  return { kbIds, plan: planFor(question), settings: DEFAULT_RAG_SETTINGS };
}

describe('혼합 라우팅: 코드베이스 + 문서', () => {
  it('각 KB를 정책대로 검색하고 routed 정보를 돌려준다', async () => {
    expect((await runJob(docKb)).status).toBe('ready');
    embedCalls = [];

    const res = await indexer.retrieve(requestFor([codeKb, docKb], 'zebraInvoice quartzRefund'));

    expect(res.routed).toBeDefined();
    expect(res.routed?.agentic).toEqual([codeKb]);
    expect(res.routed?.hybrid).toEqual([docKb]);

    const fromCode = res.evidence.filter((e) => e.kbId === codeKb);
    const fromDoc = res.evidence.filter((e) => e.kbId === docKb);
    expect(fromCode.length).toBeGreaterThan(0);
    expect(fromCode.every((e) => e.method === 'agentic')).toBe(true);
    expect(fromDoc.length).toBeGreaterThan(0);
    expect(fromDoc.every((e) => e.method !== 'agentic')).toBe(true);
  });

  it('임베딩 공급자는 문서 KB에만 요청되고, 코드베이스 KB에는 요청되지 않는다', async () => {
    await runJob(docKb);
    embedderFor.mockClear();
    embedCalls = [];
    await indexer.retrieve(requestFor([codeKb, docKb], 'zebraInvoice quartzRefund'));
    const askedFor = embedderFor.mock.calls.map((c) => c[0]);
    expect(askedFor.every((id) => id === docKb)).toBe(true);
  });

  it('코드베이스 KB 단독 검색에도 색인 파일이 생기지 않는다', async () => {
    const res = await indexer.retrieve(requestFor([codeKb], 'zebraInvoice'));
    expect(res.evidence.some((e) => e.kbId === codeKb)).toBe(true);
    const files = await readdir(path.join(root, codeKb));
    expect(files.some((f) => f.startsWith('index'))).toBe(false);
    expect(embedCalls).toEqual([]);
  });
});
