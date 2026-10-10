let counter = 0;

/** 정렬 가능한 짧은 id (시간 + 카운터 + 난수) */
export function newId(prefix = ''): string {
  counter = (counter + 1) % 1296;
  const t = Date.now().toString(36);
  const c = counter.toString(36).padStart(2, '0');
  const r = Math.random().toString(36).slice(2, 6);
  return `${prefix}${t}${c}${r}`;
}
