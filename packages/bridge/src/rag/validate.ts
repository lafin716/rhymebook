import {
  DEFAULT_RAG_SETTINGS,
  isKnowledgeId,
  t,
  type DocKind,
  type QueryPlan,
  type RagSettings,
  type RetrievalRequest,
} from '@branch/core';

/**
 * 검색 요청 검증 (main 파이프와 worker 양쪽이 같이 쓴다).
 * 모양이 틀리면 던지고, 숫자 설정은 허용 범위로 자른다.
 */

/** 한 번에 검색할 KB 수 상한 */
export const MAX_RETRIEVAL_KBS = 20;
const MAX_QUERY_CHARS = 2000;
const MAX_VECTOR_TEXT_CHARS = 4000;
const MAX_TERM_CHARS = 100;
const MAX_TERMS = 64;
const MAX_PATH_PREFIX_CHARS = 500;
const DOC_KINDS: readonly DocKind[] = ['markdown', 'text', 'html', 'pdf', 'code', 'config'];

const bad = (): never => {
  throw new Error(t('knowledge.error.badQuery'));
};

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function str(v: unknown, max: number): string {
  if (typeof v !== 'string' || v.length > max) bad();
  return v as string;
}

function strList(v: unknown, maxItems: number, maxChars: number): string[] {
  if (!Array.isArray(v) || v.length > maxItems) bad();
  return (v as unknown[]).map((x) => str(x, maxChars));
}

function bool(v: unknown, fallback: boolean): boolean {
  if (v === undefined) return fallback;
  if (typeof v !== 'boolean') bad();
  return v as boolean;
}

/** 숫자 설정: 없으면 기본값, 있으면 숫자인지 확인하고 [min, max]로 자른다 */
function num(v: unknown, fallback: number, min: number, max: number): number {
  if (v === undefined) return fallback;
  if (typeof v !== 'number' || !Number.isFinite(v)) bad();
  return Math.min(max, Math.max(min, v as number));
}

export function parseRagSettings(v: unknown): RagSettings {
  if (v === undefined) return { ...DEFAULT_RAG_SETTINGS };
  if (!isObj(v)) bad();
  const o = v as Record<string, unknown>;
  const d = DEFAULT_RAG_SETTINGS;
  return {
    enabled: bool(o.enabled, d.enabled),
    candidates: Math.round(num(o.candidates, d.candidates, 1, 200)),
    rrfK: Math.round(num(o.rrfK, d.rrfK, 1, 1000)),
    keywordWeight: num(o.keywordWeight, d.keywordWeight, 0, 10),
    vectorWeight: num(o.vectorWeight, d.vectorWeight, 0, 10),
    rerank: bool(o.rerank, d.rerank),
    topK: Math.round(num(o.topK, d.topK, 1, 50)),
    maxContextChars: Math.round(num(o.maxContextChars, d.maxContextChars, 500, 50_000)),
    expandParent: bool(o.expandParent, d.expandParent),
    minScore: num(o.minScore, d.minScore, 0, 1),
    expandQuery: bool(o.expandQuery, d.expandQuery),
  };
}

export function parseQueryPlan(v: unknown): QueryPlan {
  if (!isObj(v)) bad();
  const o = v as Record<string, unknown>;
  return {
    original: str(o.original, MAX_QUERY_CHARS),
    rewritten: str(o.rewritten, MAX_QUERY_CHARS),
    keywords: strList(o.keywords, MAX_TERMS, MAX_TERM_CHARS),
    contextTerms: strList(o.contextTerms, MAX_TERMS, MAX_TERM_CHARS),
    vectorText: str(o.vectorText, MAX_VECTOR_TEXT_CHARS),
    keywordQuery: strList(o.keywordQuery, MAX_TERMS, MAX_TERM_CHARS),
    contextual: bool(o.contextual, false),
  };
}

function parseFilter(v: unknown): RetrievalRequest['filter'] {
  if (v === undefined || v === null) return undefined;
  if (!isObj(v)) bad();
  const o = v as Record<string, unknown>;
  const filter: NonNullable<RetrievalRequest['filter']> = {};
  if (o.pathPrefix !== undefined) filter.pathPrefix = str(o.pathPrefix, MAX_PATH_PREFIX_CHARS);
  if (o.kinds !== undefined) {
    const kinds = strList(o.kinds, DOC_KINDS.length, 16);
    if (!kinds.every((k) => (DOC_KINDS as readonly string[]).includes(k))) bad();
    filter.kinds = kinds as DocKind[];
  }
  return filter;
}

/** renderer·IPC에서 온 검색 요청을 검증하고 정규화한다. 잘못되면 Error를 던진다 */
export function parseRetrievalRequest(v: unknown): RetrievalRequest {
  if (!isObj(v)) bad();
  const o = v as Record<string, unknown>;
  if (!Array.isArray(o.kbIds) || o.kbIds.length > MAX_RETRIEVAL_KBS) bad();
  const kbIds = (o.kbIds as unknown[]).map((x) => {
    if (!isKnowledgeId(x)) bad();
    return x as string;
  });
  const req: RetrievalRequest = {
    kbIds,
    plan: parseQueryPlan(o.plan),
    settings: parseRagSettings(o.settings),
  };
  const filter = parseFilter(o.filter);
  if (filter) req.filter = filter;
  return req;
}
