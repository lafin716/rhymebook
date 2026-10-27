const COPY = [
  'boxSizing', 'width', 'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
  'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'fontFamily', 'fontSize', 'fontWeight',
  'fontStyle', 'letterSpacing', 'lineHeight', 'textTransform', 'wordSpacing', 'tabSize', 'textIndent',
] as const;

/** textarea 안 pos 위치 커서의 좌표 (textarea 왼쪽 위 기준, 스크롤 무시) — 같은 글꼴의 거울 div로 잰다 */
export function caretOffset(area: HTMLTextAreaElement, pos: number): { left: number; top: number; height: number } {
  const style = getComputedStyle(area);
  const mirror = document.createElement('div');
  for (const k of COPY) mirror.style[k] = style[k];
  Object.assign(mirror.style, { position: 'absolute', visibility: 'hidden', top: '0', left: '-9999px', whiteSpace: 'pre-wrap', overflowWrap: 'break-word' });
  mirror.textContent = area.value.slice(0, pos);
  const mark = document.createElement('span');
  mark.textContent = area.value.slice(pos) || '.';
  mirror.appendChild(mark);
  document.body.appendChild(mirror);
  const lh = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.5;
  const r = { left: mark.offsetLeft, top: mark.offsetTop, height: lh };
  mirror.remove();
  return r;
}
