/**
 * 검색 평가 지표 (순수 함수). 평가 하네스(packages/bridge/eval)와 단위 테스트에서 쓴다.
 * 입력 `ranked`는 관련도 순으로 정렬된 문서(또는 청크) 키 목록이다. 같은 키가 여러 번 나오면 첫 번째만 센다.
 */

/** 순위 목록에서 중복을 없앤 첫 등장 순서 */
export function uniqueRanked(ranked: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const k of ranked) {
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(k);
  }
  return out;
}

/** 상위 k개 안에서 찾은 관련 항목 비율 (관련 항목이 없으면 0) */
export function recallAtK(relevant: ReadonlySet<string>, ranked: readonly string[], k: number): number {
  if (relevant.size === 0) return 0;
  const top = uniqueRanked(ranked).slice(0, k);
  let hit = 0;
  for (const key of top) if (relevant.has(key)) hit++;
  return hit / relevant.size;
}

/** 상위 k개 안에 관련 항목이 하나라도 있으면 1 */
export function hitAtK(relevant: ReadonlySet<string>, ranked: readonly string[], k: number): number {
  return uniqueRanked(ranked).slice(0, k).some((key) => relevant.has(key)) ? 1 : 0;
}

/** 첫 관련 항목 순위의 역수 (없으면 0) */
export function reciprocalRank(relevant: ReadonlySet<string>, ranked: readonly string[]): number {
  const uniq = uniqueRanked(ranked);
  for (let i = 0; i < uniq.length; i++) {
    if (relevant.has(uniq[i] as string)) return 1 / (i + 1);
  }
  return 0;
}

/** 여러 질의의 평균 역순위 */
export function mrr(
  items: readonly { relevant: ReadonlySet<string>; ranked: readonly string[] }[],
): number {
  return mean(items.map((it) => reciprocalRank(it.relevant, it.ranked)));
}

/**
 * nDCG@k (이진 관련도). DCG = Σ rel_i / log2(i+2), IDCG는 관련 항목을 앞에 모두 놓았을 때.
 * 관련 항목이 없으면 0.
 */
export function ndcgAtK(relevant: ReadonlySet<string>, ranked: readonly string[], k: number): number {
  if (relevant.size === 0) return 0;
  const top = uniqueRanked(ranked).slice(0, k);
  let dcg = 0;
  top.forEach((key, i) => {
    if (relevant.has(key)) dcg += 1 / Math.log2(i + 2);
  });
  const ideal = Math.min(relevant.size, k);
  let idcg = 0;
  for (let i = 0; i < ideal; i++) idcg += 1 / Math.log2(i + 2);
  return idcg === 0 ? 0 : dcg / idcg;
}

/**
 * 백분위수 (선형 보간). p는 0~100. 빈 입력은 NaN.
 * 지연 시간 P50/P95 보고에 쓴다.
 */
export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 1) return sorted[0] as number;
  const clamped = Math.min(100, Math.max(0, p));
  const pos = (clamped / 100) * (sorted.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  const a = sorted[lo] as number;
  const b = sorted[hi] as number;
  return a + (b - a) * (pos - lo);
}

/** 산술 평균. 빈 입력은 NaN (집계 표에서 '데이터 없음'으로 보이게) */
export function mean(values: readonly number[]): number {
  if (values.length === 0) return Number.NaN;
  let s = 0;
  for (const v of values) s += v;
  return s / values.length;
}

/**
 * 관련 항목 키 집합과 "관련 있는 청크인가"를 함께 쓸 때의 구간 겹침 판정.
 * 같은 경로이고 [a1,a2]와 [b1,b2]가 겹치면 true. 줄 정보가 없으면 경로만 본다.
 */
export function spanOverlaps(
  gold: { startLine?: number; endLine?: number },
  got: { lineStart?: number; lineEnd?: number },
): boolean {
  if (gold.startLine === undefined) return true;
  if (got.lineStart === undefined) return false;
  const gStart = gold.startLine;
  const gEnd = gold.endLine ?? gold.startLine;
  const hEnd = got.lineEnd ?? got.lineStart;
  return got.lineStart <= gEnd && gStart <= hEnd;
}
