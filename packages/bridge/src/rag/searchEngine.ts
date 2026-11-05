/**
 * 하이브리드 검색: KB별 벡터(brute force) + FTS5 키워드 → RRF 융합 → 근거 선택(core selectEvidence).
 * KB 간 섞임을 막으려고 각 KB의 색인·임베딩 모델을 따로 쓴다.
 */
import {
  embeddingKey,
  lexicalReranker,
  selectEvidence,
  type CandidateChunk,
  type Chunk,
  type EmbeddingProvider,
  type QueryPlan,
  type RagSettings,
  type Reranker,
  type RetrievalRequest,
  type RetrievalResult,
  type SearchHit,
  type SourceView,
} from '@branch/core';
import { throwIfAborted } from './ingestion';
import type { ChunkRow, IndexRepository, SearchFilter } from './sqliteRepository';

export interface KbSearchTarget {
  kbId: string;
  kbName: string;
  /** 색인 저장소. 없으면 건너뛴다 */
  repo?: IndexRepository;
  /** KB 색인 모델의 임베딩 제공자 (없으면 키워드만) */
  provider?: EmbeddingProvider;
  /** 이 KB를 건너뛰는 이유 (색인 없음·실패 등) */
  skipReason?: string;
}

export interface SearchOptions {
  signal?: AbortSignal;
  reranker?: Reranker;
  now?: () => number;
}

export interface RankList {
  kind: 'vector' | 'keyword';
  weight: number;
  keys: string[];
}

/** 여러 랭킹 목록을 RRF로 합친다. 점수는 0~1로 정규화, 목록별 순위를 함께 돌려준다 */
export function fuseRrf(
  lists: RankList[],
  k: number,
): Map<string, { score: number; vectorRank?: number; keywordRank?: number }> {
  const out = new Map<string, { score: number; vectorRank?: number; keywordRank?: number }>();
  const maxPossible = lists.reduce((s, l) => s + l.weight, 0) / (k + 1);
  for (const list of lists) {
    list.keys.forEach((key, idx) => {
      const cur = out.get(key) ?? { score: 0 };
      cur.score += list.weight / (k + idx + 1);
      if (list.kind === 'vector' && cur.vectorRank === undefined) cur.vectorRank = idx + 1;
      if (list.kind === 'keyword' && cur.keywordRank === undefined) cur.keywordRank = idx + 1;
      out.set(key, cur);
    });
  }
  for (const v of out.values()) v.score = maxPossible > 0 ? Math.min(1, v.score / maxPossible) : 0;
  return out;
}

export function filterOf(req: RetrievalRequest): SearchFilter | undefined {
  if (!req.filter) return undefined;
  return { pathPrefix: req.filter.pathPrefix, kinds: req.filter.kinds };
}

/** 저장소 행 → core Chunk (embedText는 검색 시점에 쓰지 않으므로 본문으로 채운다) */
export function toCoreChunk(row: ChunkRow): Chunk {
  return {
    id: row.chunkId,
    docId: row.docId,
    parentId: row.parentId,
    level: row.level,
    ordinal: row.ordinal,
    headingPath: row.headingPath,
    text: row.text,
    embedText: row.text,
    page: row.page,
    lineStart: row.lineStart,
    lineEnd: row.lineEnd,
    symbol: row.symbol,
    hash: row.hash,
  };
}

/** 한 KB의 후보 키 (벡터·키워드 각각 상위 candidates) */
async function candidatesOf(
  target: KbSearchTarget,
  plan: QueryPlan,
  settings: RagSettings,
  filter: SearchFilter | undefined,
  queryVecs: Map<string, Float32Array>,
  signal?: AbortSignal,
): Promise<{ vector: number[]; keyword: number[] } | { skip: string }> {
  const repo = target.repo;
  if (!repo) return { skip: target.skipReason ?? 'index missing' };
  if (target.skipReason) return { skip: target.skipReason };
  const model = repo.getModel();
  if (!model || repo.stats().leafCount === 0) return { skip: 'empty' };
  let vector: number[] = [];
  if (target.provider) {
    if (embeddingKey(target.provider.info) !== embeddingKey(model)) return { skip: 'model_mismatch' };
    throwIfAborted(signal);
    const key = embeddingKey(target.provider.info);
    let qv = queryVecs.get(key);
    if (!qv) {
      try {
        const [v] = await target.provider.embed([plan.vectorText || plan.original], signal);
        if (v) queryVecs.set(key, v);
        qv = v;
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') throw err;
        // 임베딩 실패는 키워드 검색으로 대신한다
        qv = undefined;
      }
    }
    if (qv) {
      vector = repo.vectorSearch(qv, settings.candidates, filter).map((h) => h.chunkRowid);
    }
  }
  const kw = repo.keywordSearch(plan.keywordQuery, settings.candidates, filter);
  return { vector, keyword: kw.map((h) => h.chunkRowid) };
}

/** 여러 KB를 검색해 근거를 고른다 */
export async function retrieveFrom(
  targets: KbSearchTarget[],
  req: RetrievalRequest,
  opts: SearchOptions = {},
): Promise<RetrievalResult> {
  const now = opts.now ?? (() => Date.now());
  const started = now();
  const { plan, settings } = req;
  const filter = filterOf(req);
  const skipped: RetrievalResult['skipped'] = [];
  const queryVecs = new Map<string, Float32Array>();

  const wanted = targets.filter((t) => req.kbIds.includes(t.kbId));
  const perKb = new Map<string, { vector: number[]; keyword: number[] }>();
  for (const target of wanted) {
    const res = await candidatesOf(target, plan, settings, filter, queryVecs, opts.signal);
    if ('skip' in res) {
      skipped.push({ kbId: target.kbId, reason: res.skip });
      continue;
    }
    perKb.set(target.kbId, res);
  }

  // KB별 rowid를 전역 키(kbId:rowid)로 바꿔 RRF (KB 경계 보존)
  const lists: RankList[] = [];
  for (const [kbId, r] of perKb) {
    lists.push({ kind: 'vector', weight: settings.vectorWeight, keys: r.vector.map((x) => `${kbId}:${x}`) });
    lists.push({ kind: 'keyword', weight: settings.keywordWeight, keys: r.keyword.map((x) => `${kbId}:${x}`) });
  }
  const fused = fuseRrf(lists, settings.rrfK);
  const ranked = [...fused.entries()]
    .sort((a, b) => b[1].score - a[1].score)
    .slice(0, Math.max(settings.candidates, settings.topK * 3));

  // KB별 rowid 묶음
  const byKb = new Map<string, number[]>();
  for (const [key] of ranked) {
    const [kbId, rid] = splitKey(key);
    const list = byKb.get(kbId) ?? [];
    list.push(rid);
    byKb.set(kbId, list);
  }

  const candidates: CandidateChunk[] = [];
  for (const target of wanted) {
    const rowids = byKb.get(target.kbId);
    const repo = target.repo;
    if (!rowids || !repo) continue;
    const rows = repo.getChunksByRowids(rowids);
    const docCache = new Map<string, ReturnType<IndexRepository['docById']>>();
    for (const rid of rowids) {
      const row = rows.get(rid);
      if (!row || row.level !== 'leaf') continue;
      const f = fused.get(`${target.kbId}:${rid}`);
      if (!f) continue;
      let doc = docCache.get(row.docId);
      if (doc === undefined) {
        doc = repo.docById(row.docId);
        docCache.set(row.docId, doc);
      }
      if (!doc) continue;
      const info = repo.getChunk(row.chunkId);
      const parentRow = row.parentId ? repo.getSection(row.parentId) : undefined;
      const hit: SearchHit = {
        kbId: target.kbId,
        chunkId: row.chunkId,
        docId: row.docId,
        score: f.score,
        vectorRank: f.vectorRank,
        keywordRank: f.keywordRank,
      };
      candidates.push({
        hit,
        chunk: toCoreChunk(row),
        parent: parentRow ? toCoreChunk(parentRow) : undefined,
        doc: { path: doc.path, title: doc.title, kind: doc.kind, url: info?.url ?? doc.url },
        kbName: target.kbName,
      });
    }
  }

  const evidence = selectEvidence(plan, candidates, settings, opts.reranker ?? lexicalReranker);
  return { plan, evidence, skipped, tookMs: now() - started };
}

function splitKey(key: string): [string, number] {
  const i = key.lastIndexOf(':');
  return [key.slice(0, i), Number(key.slice(i + 1))];
}

/** 출처 보기: 청크 본문과 부모 섹션 본문 */
export function sourceFrom(target: KbSearchTarget | undefined, chunkId: string): SourceView | undefined {
  const repo = target?.repo;
  if (!target || !repo) return undefined;
  const ch = repo.getChunk(chunkId);
  if (!ch) return undefined;
  const section = ch.parentId ? repo.getSection(ch.parentId) : undefined;
  return {
    kbId: target.kbId,
    path: ch.path,
    title: ch.title,
    kind: ch.kind,
    url: ch.url,
    page: ch.page,
    lineStart: ch.lineStart,
    lineEnd: ch.lineEnd,
    headingPath: ch.headingPath,
    chunkText: ch.text,
    sectionText: section?.text ?? ch.text,
  };
}
