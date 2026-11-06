/**
 * Context Builder (ADR-131). 유형별 검색 결과(코드베이스 실시간 탐색 · 문서 하이브리드)를 LLM에 넘기기 전에
 * 중복 제거 → 관련성 선별 → 무관 결과 제외 → 예산 배분 → 토큰(글자) 예산 → 버전 충돌 확인 → 번호 재부여를 한다.
 * 점수 척도가 엔진마다 다르므로 방식별로 0~1 정규화한 뒤 섞는다. 원문 문맥 확장은 엔진(expand)이 이미 한 텍스트를 쓴다.
 */
import type { KnowledgeRoute } from './router';
import { splitBudget } from './router';
import type { Evidence, RetrievalMethod, RetrievalNotice } from './types';

export interface ContextBuildOptions {
  /** 최대 근거 수 */
  maxItems: number;
  /** 근거 본문 글자 합 상한 (토큰 예산 근사: 한국어·코드 혼합 기준 약 3자 ≈ 1토큰) */
  maxChars: number;
  /** 방식별 최고 점수 대비 이 비율 미만은 무관한 결과로 본다 (기본 0.2) */
  relativeFloor?: number;
}

export interface ContextBuildResult {
  evidence: Evidence[];
  notices: RetrievalNotice[];
  /** 중복으로 합친 수 */
  deduped: number;
  /** 관련성·예산 때문에 뺀 수 */
  dropped: number;
}

/** 근거 한 건의 최소 글자 수: 예산이 이보다 적게 남으면 더 넣지 않는다 */
const MIN_ITEM_CHARS = 200;

const methodOf = (e: Evidence): RetrievalMethod => e.method ?? 'hybrid';

function overlaps(a: Evidence, b: Evidence): boolean {
  if (a.kbId !== b.kbId || a.path !== b.path) return false;
  if (a.chunkId === b.chunkId) return true;
  if (a.lineStart !== undefined && b.lineStart !== undefined) {
    const ae = a.lineEnd ?? a.lineStart;
    const be = b.lineEnd ?? b.lineStart;
    return a.lineStart <= be && b.lineStart <= ae;
  }
  if (a.page !== undefined && a.page === b.page) return normHead(a.text) === normHead(b.text);
  return false;
}

const normHead = (s: string) => s.replace(/\s+/g, ' ').trim().slice(0, 160).toLowerCase();

/** 같은 KB·파일의 겹치는 줄 범위, 같은 청크, 같은 쪽의 같은 본문을 하나로 합친다 (점수 높은 쪽 유지, 채널 합침) */
export function dedupeEvidence(items: readonly Evidence[]): { items: Evidence[]; merged: number } {
  const out: Evidence[] = [];
  let merged = 0;
  const sorted = [...items].sort((a, b) => b.score - a.score);
  for (const e of sorted) {
    const prev = out.find((o) => overlaps(o, e));
    if (prev) {
      merged++;
      if (e.matched?.length) prev.matched = [...new Set([...(prev.matched ?? []), ...e.matched])];
      continue;
    }
    out.push({ ...e, ...(e.matched ? { matched: [...e.matched] } : {}) });
  }
  return { items: out, merged };
}

/** 방식별 0~1 정규화 (최고 점수 = 1) */
function normalize(items: Evidence[]): { e: Evidence; rel: number }[] {
  const top = items.reduce((m, e) => Math.max(m, e.score), 0);
  return items.map((e) => ({ e, rel: top > 0 ? e.score / top : 0 }));
}

// ── 버전 충돌 ───────────────────────────────────────

/** `Name 1.2`, `Name v1.2.3`, `Name@1.2.3` 꼴 */
const VERSION_RE = /\b([A-Za-z][A-Za-z0-9_.-]{1,30})(?:\s+|@|\s*v)v?(\d+\.\d+(?:\.\d+)?)\b/g;
const VERSION_STOP = new Set(['version', 'v', 'page', 'line', 'section', 'chapter', 'step', 'figure', 'table', 'node', 'python', 'es']);

/** 근거들 사이에서 같은 이름에 서로 다른 버전이 (서로 다른 출처에서) 나오면 그 이름 목록 */
export function findVersionConflicts(items: readonly Evidence[]): string[] {
  const byName = new Map<string, Map<string, Set<string>>>();
  for (const e of items) {
    const src = `${e.kbId}\u0000${e.docId}`;
    for (const m of e.text.matchAll(VERSION_RE)) {
      const name = m[1]!.toLowerCase().replace(/[.-]+$/, '');
      if (VERSION_STOP.has(name) || /^\d/.test(name)) continue;
      const ver = m[2]!;
      const vers = byName.get(name) ?? new Map<string, Set<string>>();
      const srcs = vers.get(ver) ?? new Set<string>();
      srcs.add(src);
      vers.set(ver, srcs);
      byName.set(name, vers);
    }
  }
  const out: string[] = [];
  for (const [name, vers] of byName) {
    if (vers.size < 2) continue;
    // 서로 다른 출처가 서로 다른 버전을 말할 때만 (한 문서 안의 변경 이력은 충돌이 아니다)
    const allSrc = new Set<string>();
    for (const s of vers.values()) for (const x of s) allSrc.add(x);
    if (allSrc.size >= 2) out.push(name);
  }
  return out.sort();
}

/**
 * 유형별 결과를 합쳐 최종 근거를 만든다. route가 없으면 근거의 method로 나눈다.
 * 반환 근거의 n은 1부터 다시 매긴다.
 */
export function buildKnowledgeContext(
  items: readonly Evidence[],
  route: Pick<KnowledgeRoute, 'agentic' | 'hybrid' | 'weights' | 'intent'> | undefined,
  opts: ContextBuildOptions,
): ContextBuildResult {
  const { items: uniq, merged } = dedupeEvidence(items);
  const floor = opts.relativeFloor ?? 0.2;
  const groups: Record<RetrievalMethod, { e: Evidence; rel: number }[]> = { agentic: [], hybrid: [] };
  for (const m of ['agentic', 'hybrid'] as const) {
    groups[m] = normalize(uniq.filter((e) => methodOf(e) === m))
      .filter((x) => x.e.score > 0 && x.rel >= floor)
      .sort((a, b) => b.rel - a.rel);
  }
  const r = route ?? {
    agentic: groups.agentic.length ? ['_'] : [],
    hybrid: groups.hybrid.length ? ['_'] : [],
    intent: 'both' as const,
    weights: { agentic: 0.5, hybrid: 0.5 },
  };
  // 실제 결과가 있는 쪽만 예산을 받는다 (한쪽이 비면 다른 쪽이 전부)
  const effRoute = {
    ...r,
    agentic: groups.agentic.length ? r.agentic : [],
    hybrid: groups.hybrid.length ? r.hybrid : [],
  };
  const quota = splitBudget(opts.maxItems, effRoute);
  const pickA = groups.agentic.slice(0, quota.agentic);
  const pickH = groups.hybrid.slice(0, quota.hybrid);
  // 남은 자리는 남은 후보 중 상대 점수 높은 순으로 채운다
  const rest = [...groups.agentic.slice(quota.agentic), ...groups.hybrid.slice(quota.hybrid)].sort((a, b) => b.rel - a.rel);
  const picked = [...pickA, ...pickH];
  // 두 유형이 다 있으면 splitBudget이 각 1개를 보장하므로 maxItems보다 하나 많을 수 있다
  while (picked.length < opts.maxItems && rest.length) picked.push(rest.shift()!);
  picked.sort((a, b) => b.rel - a.rel);

  // 글자 예산
  const out: Evidence[] = [];
  let left = opts.maxChars;
  for (const { e } of picked) {
    if (left < MIN_ITEM_CHARS && out.length) break;
    const text = e.text.length > left ? `${e.text.slice(0, Math.max(0, left - 1))}…` : e.text;
    left -= text.length;
    out.push({ ...e, text, method: methodOf(e), n: out.length + 1 });
  }

  const notices: RetrievalNotice[] = findVersionConflicts(out).length ? [{ code: 'version_conflict' }] : [];
  return { evidence: out, notices, deduped: merged, dropped: uniq.length - out.length };
}

/** 출처 위치 표기: 코드 = `path:L10-20`, PDF·쪽 = `제목 p.3`, 그 밖 = 경로 */
export function citationLocation(c: { path: string; title?: string; page?: number; lineStart?: number; lineEnd?: number }): string {
  if (c.lineStart !== undefined) {
    const end = c.lineEnd !== undefined && c.lineEnd !== c.lineStart ? `-${c.lineEnd}` : '';
    return `${c.path}:L${c.lineStart}${end}`;
  }
  if (c.page !== undefined) return `${c.title || c.path} p.${c.page}`;
  return c.path;
}
