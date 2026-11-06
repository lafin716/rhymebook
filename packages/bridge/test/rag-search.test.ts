import { DatabaseSync } from 'node:sqlite';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createHashEmbedder,
  EmbeddingError,
  DEFAULT_RAG_SETTINGS,
  embeddingKey,
  tokenize,
  type EmbeddingProvider,
  type KnowledgeIndexState,
  type QueryPlan,
  type RetrievalRequest,
} from '@branch/core';
import { createKnowledgeIndexer, INDEX_FILE, type KnowledgeIndexer } from '../src';
import { IndexRepository, IndexSchemaError, SCHEMA_VERSION, topKBy } from '../src/rag/sqliteRepository';
import { retrieveFrom, type KbSearchTarget } from '../src/rag/searchEngine';

const KB_A = 'kbalpha000001';
const KB_B = 'kbbravo000002';
const TERMINAL = new Set(['ready', 'stale', 'empty', 'error']);

const DOCS: Record<string, string> = {
  'ingress.md': [
    '# 쿠버네티스 Ingress',
    '',
    '쿠버네티스의 Ingress 설정은 외부 HTTP 요청을 서비스로 라우팅하는 규칙을 정의합니다.',
    'spec.rules 아래에 host와 path를 적고 backend.service 이름과 포트를 지정합니다.',
  ].join('\n'),
  'jwt-verify.md': [
    '# JWT 검증',
    '',
    'JWT 토큰 검증 로직은 서명을 확인하고 exp 클레임으로 만료 시각을 검사합니다.',
    '검증에 실패하면 401 응답을 반환합니다.',
  ].join('\n'),
  'rrf-notes.md': [
    '# 검색 융합',
    '',
    'RRF는 여러 랭킹 목록의 순위를 합치는 방법입니다. 점수는 1/(k+rank)로 더합니다.',
  ].join('\n'),
  'deployment-guide.md': [
    '# 배포 가이드',
    '',
    'deployment 파이프라인은 빌드 후 스테이징에 먼저 배포하고 승인을 받습니다.',
  ].join('\n'),
};

/** core tokenize 기반 질의 계획 (CJK 2-gram 포함) */
function planKo(question: string): QueryPlan {
  const keywords = [...new Set(tokenize(question))];
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

function requestFor(kbIds: string[], question: string): RetrievalRequest {
  return { kbIds, plan: planKo(question), settings: DEFAULT_RAG_SETTINGS };
}

let root: string;
const indexers: KnowledgeIndexer[] = [];

function filesOf(kbId: string): string {
  return path.join(root, kbId, 'files');
}

function dbOf(kbId: string): string {
  return path.join(root, kbId, INDEX_FILE);
}

function make(opts: Partial<Parameters<typeof createKnowledgeIndexer>[0]> = {}): KnowledgeIndexer {
  const ix = createKnowledgeIndexer({ root, getOpenAIKey: () => undefined, retryDelayMs: 1, ...opts });
  indexers.push(ix);
  return ix;
}

function runJob(ix: KnowledgeIndexer, kbId: string): Promise<KnowledgeIndexState> {
  return new Promise((resolve, reject) => {
    const off = ix.onState((s) => {
      if (s.kbId !== kbId || !TERMINAL.has(s.status)) return;
      off();
      resolve(s);
    });
    ix.enqueue(kbId).catch((e: unknown) => {
      off();
      reject(e);
    });
  });
}

/** KB 설정(meta.json)을 직접 쓴다: 'none'이면 벡터 없이 색인한다 */
async function setProvider(kbId: string, provider: 'none' | 'local-hash'): Promise<void> {
  const dir = path.join(root, kbId);
  await mkdir(dir, { recursive: true });
  const settings = provider === 'none' ? { embedding: { provider: 'none' } } : { embedding: { provider: 'local-hash' } };
  await writeFile(path.join(dir, 'meta.json'), JSON.stringify({ settings }));
}

async function seedDocs(kbId: string): Promise<void> {
  await mkdir(filesOf(kbId), { recursive: true });
  for (const [name, body] of Object.entries(DOCS)) await writeFile(path.join(filesOf(kbId), name), body);
}

async function indexKb(kbId: string, provider: 'none' | 'local-hash'): Promise<void> {
  await seedDocs(kbId);
  await setProvider(kbId, provider);
  const ix = make();
  const state = await runJob(ix, kbId);
  expect(state.status).toBe('ready');
  await ix.close();
  indexers.splice(indexers.indexOf(ix), 1);
}

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'rag-search-'));
});

afterEach(async () => {
  for (const ix of indexers.splice(0)) await ix.close();
  await rm(root, { recursive: true, force: true });
});

describe('keyless(none) 색인과 검색', () => {
  it("'none' KB는 벡터 행을 만들지 않고 키워드·경로로 검색한다", async () => {
    await indexKb(KB_A, 'none');
    const repo = IndexRepository.openReadOnly(dbOf(KB_A));
    try {
      expect(repo.stats().leafCount).toBeGreaterThan(0);
      expect(repo.getModel()?.provider).toBe('none');
    } finally {
      repo.close();
    }
    const raw = new DatabaseSync(dbOf(KB_A), { readOnly: true });
    try {
      const n = (raw.prepare('SELECT COUNT(*) AS n FROM vectors').get() as { n: number }).n;
      expect(n).toBe(0);
    } finally {
      raw.close();
    }

    const ix = make();
    const res = await ix.retrieve(requestFor([KB_A], 'deployment 파이프라인 승인'));
    expect(res.evidence[0]?.path).toMatch(/deployment-guide\.md$/);
    expect(res.semanticKbIds).toEqual([]);
  });

  it('파일명 질의는 경로 채널로 파일을 찾는다', async () => {
    await indexKb(KB_A, 'none');
    const ix = make();
    const res = await ix.retrieve(requestFor([KB_A], 'jwt-verify'));
    expect(res.evidence[0]?.path).toMatch(/jwt-verify\.md$/);
    expect(res.evidence[0]?.matched).toContain('path');
  });
});

describe('CJK 질의', () => {
  beforeEach(async () => {
    await indexKb(KB_A, 'none');
  });

  it('"쿠버네티스의 Ingress 설정은?"은 Ingress 문서를 찾는다', async () => {
    const ix = make();
    const res = await ix.retrieve(requestFor([KB_A], '쿠버네티스의 Ingress 설정은?'));
    expect(res.evidence[0]?.path).toMatch(/ingress\.md$/);
  });

  it('"JWT 토큰 검증 로직"은 JWT 문서를 찾는다', async () => {
    const ix = make();
    const res = await ix.retrieve(requestFor([KB_A], 'JWT 토큰 검증 로직'));
    expect(res.evidence[0]?.path).toMatch(/jwt-verify\.md$/);
  });

  it('"RRF가 뭐야"는 RRF 문서를 찾는다', async () => {
    const ix = make();
    const res = await ix.retrieve(requestFor([KB_A], 'RRF가 뭐야'));
    expect(res.evidence[0]?.path).toMatch(/rrf-notes\.md$/);
  });

  it('관련 없는 질의에는 억지 근거를 붙이지 않는다', async () => {
    const ix = make();
    const res = await ix.retrieve(requestFor([KB_A], '오늘 점심 메뉴 추천해 줘'));
    expect(res.evidence).toEqual([]);
  });
});

describe('저장소 조회', () => {
  it('배치 조회(getChunksWithDocByRowids)는 단건 조회와 같은 청크를 준다', async () => {
    await indexKb(KB_A, 'none');
    const repo = IndexRepository.openReadOnly(dbOf(KB_A));
    try {
      const rowids = repo.keywordSearch(['배포'], 50).map((h) => h.chunkRowid);
      expect(rowids.length).toBeGreaterThan(0);
      const single = repo.getChunksByRowids(rowids);
      const batch = repo.getChunksWithDocByRowids(rowids);
      expect(batch.size).toBe(single.size);
      for (const rid of rowids) {
        const a = single.get(rid);
        const b = batch.get(rid);
        expect(b?.chunkId).toBe(a?.chunkId);
        expect(b?.text).toBe(a?.text);
        expect(b?.path).toMatch(/\.md$/);
      }
    } finally {
      repo.close();
    }
  });

  it('readOnly는 없는 파일을 만들지 않고 실패한다', () => {
    expect(() => IndexRepository.openReadOnly(path.join(root, 'nope', INDEX_FILE))).toThrow();
  });

  it('v3 DB를 열면 v4로 올리며 기존 문서의 경로 색인을 채운다', async () => {
    await indexKb(KB_A, 'none');
    // v3 상태 재현: path_fts와 docs.path_fts_id를 걷어내고 user_version을 3으로 낮춘다
    const raw = new DatabaseSync(dbOf(KB_A));
    raw.exec('DROP INDEX IF EXISTS docs_path_fts_id; DROP TABLE IF EXISTS path_fts; ALTER TABLE docs DROP COLUMN path_fts_id; PRAGMA user_version = 3;');
    raw.close();

    // 읽기 전용은 마이그레이션 전 DB를 거부한다
    expect(() => IndexRepository.openReadOnly(dbOf(KB_A))).toThrow(IndexSchemaError);

    const repo = IndexRepository.open(dbOf(KB_A));
    try {
      const hits = repo.pathSearch(['jwt', 'verify'], 10);
      expect(hits.length).toBeGreaterThan(0);
      const docs = repo.listDocs();
      expect(docs.some((d) => d.path.endsWith('jwt-verify.md'))).toBe(true);
    } finally {
      repo.close();
    }
    const check = new DatabaseSync(dbOf(KB_A), { readOnly: true });
    try {
      expect((check.prepare('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(SCHEMA_VERSION);
    } finally {
      check.close();
    }
  });
});

describe('Top-K와 KB 단위 격리', () => {
  it('topKBy는 전체 정렬 후 자르기와 같은 결과를 준다 (동점은 먼저 온 항목 우선)', () => {
    let seed = 7;
    const rnd = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    for (let trial = 0; trial < 50; trial++) {
      const items = Array.from({ length: 200 }, (_, i) => ({ i, s: Math.round(rnd() * 20) / 20 }));
      const k = 1 + Math.floor(rnd() * 30);
      const expected = [...items].sort((a, b) => b.s - a.s).slice(0, k);
      expect(topKBy(items, k, (x) => x.s)).toEqual(expected);
    }
  });

  it('취소 신호가 KB 사이에서 켜지면 다음 KB를 읽지 않고 AbortError로 끝난다', async () => {
    await indexKb(KB_A, 'local-hash');
    await indexKb(KB_B, 'local-hash');
    const ctrl = new AbortController();
    const base = createHashEmbedder();
    const trigger: EmbeddingProvider = {
      info: base.info,
      batchSize: base.batchSize,
      async embed(texts, signal) {
        ctrl.abort();
        return base.embed(texts, signal);
      },
    };
    const repoA = IndexRepository.openReadOnly(dbOf(KB_A));
    const repoB = IndexRepository.openReadOnly(dbOf(KB_B));
    try {
      const targets: KbSearchTarget[] = [
        { kbId: KB_A, kbName: 'A', repo: repoA, provider: trigger },
        { kbId: KB_B, kbName: 'B', repo: repoB, provider: trigger },
      ];
      await expect(retrieveFrom(targets, requestFor([KB_A, KB_B], 'JWT 토큰 검증'), { signal: ctrl.signal })).rejects.toMatchObject({
        name: 'AbortError',
      });
    } finally {
      repoA.close();
      repoB.close();
    }
  });

  it('모델이 다른 KB는 벡터만 끄고 키워드 결과와 semantic_unavailable 알림을 준다', async () => {
    await indexKb(KB_A, 'local-hash');
    const repo = IndexRepository.openReadOnly(dbOf(KB_A));
    const other: EmbeddingProvider = {
      info: { provider: 'openai', model: 'text-embedding-3-small', dim: 3 },
      batchSize: 8,
      async embed(texts) {
        return texts.map(() => new Float32Array([1, 0, 0]));
      },
    };
    try {
      expect(embeddingKey(other.info)).not.toBe(embeddingKey(repo.getModel()!));
      const res = await retrieveFrom(
        [{ kbId: KB_A, kbName: 'A', repo, provider: other }],
        requestFor([KB_A], 'JWT 토큰 검증 로직'),
      );
      expect(res.semanticKbIds).toEqual([]);
      expect(res.notices?.some((n) => n.code === 'semantic_unavailable' && n.kbId === KB_A)).toBe(true);
      expect(res.evidence[0]?.path).toMatch(/jwt-verify\.md$/);
    } finally {
      repo.close();
    }
  });

  it('임베딩 실패는 embed_failed 알림을 남기고 키워드 검색으로 계속한다', async () => {
    await indexKb(KB_A, 'local-hash');
    const repo = IndexRepository.openReadOnly(dbOf(KB_A));
    const broken: EmbeddingProvider = {
      info: createHashEmbedder().info,
      batchSize: 8,
      async embed() {
        throw new EmbeddingError('네트워크 오류', false);
      },
    };
    try {
      const res = await retrieveFrom(
        [{ kbId: KB_A, kbName: 'A', repo, provider: broken }],
        requestFor([KB_A], 'RRF가 뭐야'),
      );
      expect(res.notices?.some((n) => n.code === 'embed_failed')).toBe(true);
      expect(res.evidence[0]?.path).toMatch(/rrf-notes\.md$/);
    } finally {
      repo.close();
    }
  });

  it("mode 'fast'는 질의 임베딩 없이 키워드 검색만 한다", async () => {
    await indexKb(KB_A, 'local-hash');
    const repo = IndexRepository.openReadOnly(dbOf(KB_A));
    const base = createHashEmbedder();
    let calls = 0;
    const counting: EmbeddingProvider = {
      info: base.info,
      batchSize: base.batchSize,
      async embed(texts, signal) {
        calls += 1;
        return base.embed(texts, signal);
      },
    };
    try {
      const req = { ...requestFor([KB_A], 'JWT 토큰 검증 로직'), settings: { ...DEFAULT_RAG_SETTINGS, mode: 'fast' as const } };
      const res = await retrieveFrom([{ kbId: KB_A, kbName: 'A', repo, provider: counting }], req);
      expect(calls).toBe(0);
      expect(res.semanticKbIds).toEqual([]);
      expect(res.notices?.some((n) => n.code === 'semantic_unavailable')).toBe(false);
      expect(res.evidence[0]?.path).toMatch(/jwt-verify\.md$/);
    } finally {
      repo.close();
    }
  });

  it('debug 설정이면 후보 수와 채널별 개수를 채운다', async () => {
    await indexKb(KB_A, 'local-hash');
    const repo = IndexRepository.openReadOnly(dbOf(KB_A));
    try {
      const req = { ...requestFor([KB_A], 'JWT 토큰 검증 로직'), settings: { ...DEFAULT_RAG_SETTINGS, debug: true } };
      const res = await retrieveFrom([{ kbId: KB_A, kbName: 'A', repo }], req);
      expect(res.debug?.candidates).toBeGreaterThan(0);
      expect(res.debug?.perList.keyword).toBeGreaterThan(0);
    } finally {
      repo.close();
    }
  });
});
