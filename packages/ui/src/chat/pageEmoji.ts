/** `:` 이모지 검색어 찾기 (ADR-087 P3) — 후보 목록은 PageEditor가 슬래시 메뉴처럼 그린다 */

/** 커서 바로 앞이 `:검색어` 인지 확인. `:` 는 줄 처음이나 공백 뒤에만, 코드/URL 제외 */
export function getEmojiQuery(text: string, caret: number): { start: number; query: string } | null {
  const MAX_QUERY = 30;
  const from = Math.max(0, caret - MAX_QUERY - 1);

  // 코드 블록/인라인 코드 확인
  let fence: string | null = null;
  const lines = text.slice(0, caret).split('\n');
  for (const line of lines.slice(0, -1)) {
    const f = /^[ \t]*(`{3,}|~{3,})/.exec(line);
    if (f) {
      if (!fence) fence = f[1]!;
      else if (f[1]![0] === fence[0] && f[1]!.length >= fence.length) fence = null;
    }
  }
  let inCode = fence !== null;

  const curLine = lines[lines.length - 1]!;
  const backtickCount = (curLine.match(/`/g)?.length ?? 0);
  if (backtickCount % 2 === 1) inCode = true;
  if (inCode) return null;

  for (let i = caret - 1; i >= from; i--) {
    const c = text[i]!;
    if (/\s/.test(c)) return null;
    if (c !== ':') continue;

    const prev = text[i - 1];
    if (prev !== undefined && !/[\s([{]/.test(prev)) return null;

    // URL 다음 `:` 무시
    if (i > 4 && text.slice(i - 5, i) === 'http:') return null;
    if (i > 5 && text.slice(i - 6, i) === 'https:') return null;

    return { start: i, query: text.slice(i + 1, caret) };
  }
  return null;
}
