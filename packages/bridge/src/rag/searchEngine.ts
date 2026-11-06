/**
 * 하이브리드 검색: KB별 벡터(brute force) + FTS5 키워드 + 심볼 + 경로(파일명) → RRF 융합 → 근거 선택(core selectEvidence).
 * KB 간 섞임을 막으려고 각 KB의 색인·임베딩 모델을 따로 쓴다. KB 하나의 실패는 그 KB만 건너뛴다.
 */
import { performance } from 'node:perf_hooks';
import {
  embeddingKey,
  lexicalReranker,
  selectEvidence,
  type CandidateChunk,
  type Chunk,
  type EmbeddingProvider,
  type FolderHint,
  type FolderMeta,
  matchFolders,
  type QueryPlan,
  type RagSettings,
  type Reranker,
  type RetrievalNotice,
  type RetrievalRequest,
  type RetrievalResult,
  type RetrievalTimings,
  type SearchHit,
  type SourceView,
  tokenize,
} from '@branch/core';
import { throwIfAborted } from './ingestion';
import type { ChunkRow, IndexRepository, SearchFilter } from './sqliteRepository';

/** 벡터 후보 최소 코사인: 이보다 낮은 벡터 이웃은 질의와 무관한 것으로 보고 버린다 */
export const VECTOR_MIN_COS = 0.1;
/** 어휘 신호(키워드·심볼·경로) 없이 벡터로만 잡힌 후보의 최소 코사인 */
export const VECTOR_ONLY_MIN_COS = 0.35;

export interface KbSearchTarget {
  kbId: string;
  kbName: string;
  /** 색인 저장소. 없으면 건너뛴다 */
  repo?: IndexRepository;
  /** KB 색인 모델의 임베딩 제공자 (없으면 키워드만) */
  provider?: EmbeddingProvider;
  /** 이 KB를 건너뛰는 이유 (색인 없음·실패 등) */
  skipReason?: string;
  /** 폴더 메타데이터 (없으면 폴더 후보를 내지 않는다 = 원문 검색만) */
  folders?: FolderMeta[];
}

export interface SearchOptions {
  signal?: AbortSignal;
  reranker?: Reranker;
  now?: () => number;
}

export interface RankList {
  kind: 'vector' | 'keyword' | 'symbol' | 'path';
  weight: number;
  keys: string[];
  /** 가산 신호: 정규화 분모에서 빼서, 없는 질의의 점수를 깎지 않는다 (ADR-115 심볼) */
  bonus?: boolean;
}

type Fused = { score: number; vectorRank?: number; keywordRank?: number; symbolRank?: number; pathRank?: number };

/** 여러 랭킹 목록을 RRF로 합친다. 점수는 0~1로 정규화, 목록별 순위를 함께 돌려준다 */
export function fuseRrf(lists: RankList[], k: number): Map<string, Fused> {
  const out = new Map<string, Fused>();
  // 정규화 분모: 가산(bonus) 목록을 뺀 가중치 합. 가산 목록만 있으면 전체 합으로 대신한다
  const base = lists.reduce((s, l) => s + (l.bonus ? 0 : l.weight), 0);
  const total = base > 0 ? base : lists.reduce((s, l) => s + l.weight, 0);
  const maxPossible = total / (k + 1);
  for (const list of lists) {
    list.keys.forEach((key, idx) => {
      const cur = out.get(key) ?? { score: 0 };
      cur.score += list.weight / (k + idx + 1);
      if (list.kind === 'vector' && cur.vectorRank === undefined) cur.vectorRank = idx + 1;
      if (list.kind === 'keyword' && cur.keywordRank === undefined) cur.keywordRank = idx + 1;
      if (list.kind === 'symbol' && cur.symbolRank === undefined) cur.symbolRank = idx + 1;
      if (list.kind === 'path' && cur.pathRank === undefined) cur.pathRank = idx + 1;
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

const IDENT_RE = /[A-Za-z_$][\w$]*(?:(?:\.|::|->|#)[A-Za-z_$][\w$]*)*/g;

/**
 * 심볼 검색어 (ADR-115): 질의 속 식별자(`UserService.getById` → 마지막 조각 포함), 키워드,
 * 이웃 키워드 2~3개를 붙인 것(`get user by id` → `getuserbyid`의 일부). 키 비교는 저장소가 정규화한다.
 */
export function symbolTermsOf(plan: QueryPlan): string[] {
  const out = new Set<string>();
  for (const src of [plan.original, plan.rewritten]) {
    for (const m of (src ?? '').matchAll(IDENT_RE)) {
      out.add(m[0]);
      const last = m[0].split(/\.|::|->|#/).at(-1);
      if (last) out.add(last);
    }
  }
  const toks = tokenize(plan.original);
  for (const t of plan.keywordQuery) out.add(t);
  for (let i = 0; i < toks.length; i++) {
    for (let n = 2; n <= 3 && i + n <= toks.length; n++) out.add(toks.slice(i, i + n).join(''));
  }
  return [...out].filter((t) => t.replace(/[^\p{L}\p{N}]+/gu, '').length >= 3).slice(0, 64);
}

function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError';
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

const round1 = (n: number) => Math.round(n * 10) / 10;

interface Ctx {
  plan: QueryPlan;
  settings: RagSettings;
  filter?: SearchFilter;
  signal?: AbortSignal;
  /** 임베딩 키별 질의 벡터 (null = 실패, 같은 질의에서 다시 부르지 않는다) */
  queryVecs: Map<string, Float32Array | null>;
  notices: RetrievalNotice[];
  timing: Required<Pick<RetrievalTimings, 'embedMs' | 'keywordMs' | 'vectorMs' | 'symbolMs' | 'pathMs' | 'fetchMs' | 'selectMs'>>;
}

function addNotice(notices: RetrievalNotice[], n: RetrievalNotice): void {
  if (!notices.some((x) => x.code === n.code && x.kbId === n.kbId)) notices.push(n);
}

/** 질의 벡터 한 번 (키별 캐시). 실패하면 알림을 남기고 undefined — 키워드 계열만으로 검색한다 */
async function queryVectorOf(p: EmbeddingProvider, ctx: Ctx): Promise<Float32Array | undefined> {
  const key = embeddingKey(p.info);
  if (ctx.queryVecs.has(key)) return ctx.queryVecs.get(key) ?? undefined;
  const t0 = performance.now();
  try {
    const [v] = await p.embed([ctx.plan.vectorText || ctx.plan.original], ctx.signal);
    ctx.queryVecs.set(key, v ?? null);
    return v;
  } catch (err) {
    if (isAbortError(err)) throw err;
    ctx.queryVecs.set(key, null);
    addNotice(ctx.notices, { code: 'embed_failed' });
    return undefined;
  } finally {
    ctx.timing.embedMs += performance.now() - t0;
  }
}

interface Stage {
  target: KbSearchTarget;
  repo: IndexRepository;
  lists: { vector: number[]; keyword: number[]; symbol: number[]; path: number[] };
  /** 벡터 후보의 코사인 (rowid → cos) */
  cos: Map<number, number>;
  /** 이 KB에서 실제로 벡터 검색을 했는가 */
  semantic: boolean;
}

type Probe = { stage: Stage } | { skip: string; notify: boolean };

/** KB 하나의 후보 목록 (벡터·키워드·심볼·경로). 모델이 맞지 않으면 벡터만 끈다 */
async function probeKb(target: KbSearchTarget, ctx: Ctx): Promise<Probe> {
  const repo = target.repo;
  if (!repo) return { skip: target.skipReason ?? 'index missing', notify: true };
  if (target.skipReason) return { skip: target.skipReason, notify: true };
  const model = repo.getModel();
  if (!model || repo.stats().leafCount === 0) return { skip: 'empty', notify: false };

  const { plan, settings, filter, timing } = ctx;
  const provider = target.provider && target.provider.info.provider !== 'none' ? target.provider : undefined;
  // mode 'fast': 벡터 검색을 건너뛴다 (질의 임베딩도 하지 않음). 키워드·심볼·경로·폴더만 쓴다
  const wantVector = settings.mode !== 'fast';
  const kbVector = model.provider !== 'none';
  const usable = wantVector && kbVector && provider !== undefined && embeddingKey(provider.info) === embeddingKey(model);
  if (wantVector && kbVector && !usable) addNotice(ctx.notices, { code: 'semantic_unavailable', kbId: target.kbId });
  const qv = usable && provider ? await queryVectorOf(provider, ctx) : undefined;

  const lists: Stage['lists'] = { vector: [], keyword: [], symbol: [], path: [] };
  const cos = new Map<number, number>();
  if (qv) {
    throwIfAborted(ctx.signal);
    const t0 = performance.now();
    for (const h of repo.vectorSearch(qv, settings.candidates, filter)) {
      if (h.score < VECTOR_MIN_COS) continue;
      lists.vector.push(h.chunkRowid);
      cos.set(h.chunkRowid, h.score);
    }
    timing.vectorMs += performance.now() - t0;
  }

  throwIfAborted(ctx.signal);
  let t0 = performance.now();
  lists.keyword = repo.keywordSearch(plan.keywordQuery, settings.candidates, filter).map((h) => h.chunkRowid);
  timing.keywordMs += performance.now() - t0;

  throwIfAborted(ctx.signal);
  t0 = performance.now();
  lists.symbol = repo.symbolSearch(symbolTermsOf(plan), settings.candidates, filter).map((h) => h.chunkRowid);
  timing.symbolMs += performance.now() - t0;

  throwIfAborted(ctx.signal);
  t0 = performance.now();
  lists.path = repo.pathSearch(plan.keywordQuery, settings.candidates, filter).map((h) => h.chunkRowid);
  timing.pathMs += performance.now() - t0;

  return { stage: { target, repo, lists, cos, semantic: qv !== undefined } };
}

/** 여러 KB를 검색해 근거를 고른다 */
export async function retrieveFrom(
  targets: KbSearchTarget[],
  req: RetrievalRequest,
  opts: SearchOptions = {},
): Promise<RetrievalResult> {
  const now = opts.now ?? (() => Date.now());
  const started = now();
  const t0 = performance.now();
  const { plan, settings } = req;
  const skipped: RetrievalResult['skipped'] = [];
  const notices: RetrievalNotice[] = [];
  const ctx: Ctx = {
    plan,
    settings,
    filter: filterOf(req),
    signal: opts.signal,
    queryVecs: new Map(),
    notices,
    timing: { embedMs: 0, keywordMs: 0, vectorMs: 0, symbolMs: 0, pathMs: 0, fetchMs: 0, selectMs: 0 },
  };
  const wanted = targets.filter((t) => req.kbIds.includes(t.kbId));

  // 1) KB별 후보 (KB 하나가 실패하면 그 KB만 건너뛴다)
  const stages: Stage[] = [];
  for (const target of wanted) {
    throwIfAborted(opts.signal);
    try {
      const probe = await probeKb(target, ctx);
      if ('skip' in probe) {
        skipped.push({ kbId: target.kbId, reason: probe.skip });
        if (probe.notify) addNotice(notices, { code: 'kb_skipped', kbId: target.kbId });
        continue;
      }
      stages.push(probe.stage);
    } catch (err) {
      if (isAbortError(err)) throw err;
      skipped.push({ kbId: target.kbId, reason: errorMessage(err) });
      addNotice(notices, { code: 'kb_skipped', kbId: target.kbId });
    }
  }

  // 2) KB별 목록을 전역 키(kbId:rowid)로 바꿔 RRF
  const lists: RankList[] = [];
  const cosOf = new Map<string, number>();
  for (const s of stages) {
    const kb = s.target.kbId;
    const keys = (xs: number[]) => xs.map((x) => `${kb}:${x}`);
    for (const [rid, c] of s.cos) cosOf.set(`${kb}:${rid}`, c);
    if (s.lists.vector.length) lists.push({ kind: 'vector', weight: settings.vectorWeight, keys: keys(s.lists.vector) });
    if (s.lists.keyword.length) lists.push({ kind: 'keyword', weight: settings.keywordWeight, keys: keys(s.lists.keyword) });
    // 경로(파일명)는 가산 신호: 질의 어휘가 경로에만 맞는 문서를 올리되, 내용 근거(키워드·벡터) 순위를 밀어내지 않는다
    if (s.lists.path.length) lists.push({ kind: 'path', weight: settings.keywordWeight, bonus: true, keys: keys(s.lists.path) });
    if (s.lists.symbol.length) lists.push({ kind: 'symbol', weight: settings.keywordWeight, bonus: true, keys: keys(s.lists.symbol) });
  }
  const fused = fuseRrf(lists, settings.rrfK);
  // 벡터 신호만 있는 후보는 코사인이 충분할 때만 남긴다 (질의와 무관한 이웃 차단)
  for (const [key, f] of fused) {
    const lexical = f.keywordRank !== undefined || f.symbolRank !== undefined || f.pathRank !== undefined;
    if (!lexical && (cosOf.get(key) ?? 0) < VECTOR_ONLY_MIN_COS) fused.delete(key);
  }
  const ranked = [...fused.entries()].sort((a, b) => b[1].score - a[1].score).slice(0, Math.max(settings.candidates, settings.topK * 3));

  const byKb = new Map<string, number[]>();
  for (const [key] of ranked) {
    const [kbId, rid] = splitKey(key);
    const list = byKb.get(kbId) ?? [];
    list.push(rid);
    byKb.set(kbId, list);
  }

  // 3) 후보 조회: KB마다 한 번에 가져온다 (청크·문서·부모 섹션)
  const candidates: CandidateChunk[] = [];
  for (const s of stages) {
    const kb = s.target.kbId;
    const rowids = byKb.get(kb);
    if (!rowids?.length) continue;
    throwIfAborted(opts.signal);
    const tf = performance.now();
    try {
      const rows = s.repo.getChunksWithDocByRowids(rowids);
      const parentIds = [...new Set([...rows.values()].map((r) => r.parentId).filter((p): p is string => !!p))];
      const sections = s.repo.getSectionsByIds(parentIds);
      for (const rid of rowids) {
        const row = rows.get(rid);
        if (!row || row.level !== 'leaf') continue;
        const f = fused.get(`${kb}:${rid}`);
        if (!f) continue;
        const parentRow = row.parentId ? sections.get(row.parentId) : undefined;
        const hit: SearchHit = {
          kbId: kb,
          chunkId: row.chunkId,
          docId: row.docId,
          score: f.score,
          vectorRank: f.vectorRank,
          keywordRank: f.keywordRank,
          symbolRank: f.symbolRank,
          pathRank: f.pathRank,
        };
        candidates.push({
          hit,
          chunk: toCoreChunk(row),
          parent: parentRow ? toCoreChunk(parentRow) : undefined,
          doc: { path: row.path, title: row.title, kind: row.kind, url: row.url },
          kbName: s.target.kbName,
        });
      }
    } catch (err) {
      if (isAbortError(err)) throw err;
      skipped.push({ kbId: kb, reason: errorMessage(err) });
      addNotice(notices, { code: 'kb_skipped', kbId: kb });
    } finally {
      ctx.timing.fetchMs += performance.now() - tf;
    }
  }

  // 4) 근거 선택
  throwIfAborted(opts.signal);
  const ts = performance.now();
  const evidence = selectEvidence(plan, candidates, settings, opts.reranker ?? lexicalReranker);
  ctx.timing.selectMs = performance.now() - ts;

  const semanticKbIds = stages.filter((s) => s.semantic).map((s) => s.target.kbId);
  const timings: RetrievalTimings = {
    embedMs: round1(ctx.timing.embedMs),
    keywordMs: round1(ctx.timing.keywordMs),
    vectorMs: round1(ctx.timing.vectorMs),
    symbolMs: round1(ctx.timing.symbolMs),
    pathMs: round1(ctx.timing.pathMs),
    fetchMs: round1(ctx.timing.fetchMs),
    selectMs: round1(ctx.timing.selectMs),
    totalMs: round1(performance.now() - t0),
  };
  const folders: FolderHint[] = wanted
    .flatMap((t) => matchFolders(t.folders ?? [], plan, t.kbId, 3))
    .sort((a, b) => b.score - a.score || (a.kbId < b.kbId ? -1 : a.kbId > b.kbId ? 1 : 0))
    .slice(0, 5);
  const result: RetrievalResult = {
    plan,
    evidence,
    skipped,
    tookMs: now() - started,
    timings,
    semanticKbIds,
    notices,
    ...(folders.length ? { folders } : {}),
  };
  if (settings.debug) {
    const perList = { vector: 0, keyword: 0, symbol: 0, path: 0 };
    for (const s of stages) {
      perList.vector += s.lists.vector.length;
      perList.keyword += s.lists.keyword.length;
      perList.symbol += s.lists.symbol.length;
      perList.path += s.lists.path.length;
    }
    result.debug = { candidates: fused.size, perList };
  }
  return result;
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
