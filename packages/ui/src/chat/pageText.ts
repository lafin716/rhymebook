/** 페이지 편집 유틸리티 — minimalChange (ADR-087 P9) */

/** 바뀐 가운데만 고쳐 커서·되돌리기 기록을 지킨다 */
export function minimalChange(before: string, after: string) {
  let head = 0;
  const max = Math.min(before.length, after.length);
  while (head < max && before[head] === after[head]) head++;
  let tail = 0;
  while (tail < max - head && before[before.length - 1 - tail] === after[after.length - 1 - tail]) tail++;
  return { from: head, to: before.length - tail, insert: after.slice(head, after.length - tail) };
}
