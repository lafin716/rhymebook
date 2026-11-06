import type { KbSearchItem } from '@branch/core';

/**
 * 문서형(색인·키워드)과 코드베이스(실시간) 결과를 한 목록으로 합친다.
 * 둘 다 결과가 있으면 코드베이스에 limit의 절반(올림)을 먼저 보장하고, 쓰지 않은 칸은 반대편이 가져간다.
 * 각 쪽 내부 순서는 그대로 두고, 최종 목록은 두 쪽을 번갈아 배치한다.
 */
export function mergeFairly(docs: KbSearchItem[], live: KbSearchItem[], limit: number): KbSearchItem[] {
  if (limit <= 0) return [];
  const reserve = docs.length && live.length ? Math.ceil(limit / 2) : 0;
  const liveTake = Math.min(live.length, Math.max(reserve, limit - docs.length));
  const docTake = Math.min(docs.length, limit - liveTake);
  const d = docs.slice(0, docTake);
  const l = live.slice(0, liveTake);
  const out: KbSearchItem[] = [];
  for (let i = 0; i < Math.max(d.length, l.length); i++) {
    if (i < d.length) out.push(d[i]!);
    if (i < l.length) out.push(l[i]!);
  }
  return out;
}
