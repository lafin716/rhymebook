import type { StreamRequest } from './provider';

/* ── 페이지 AI 도우미 (ADR-076) ── */

const BASE = [
  '너는 마크다운 학습 노트 편집을 돕는다.',
  '- 결과는 페이지에 그대로 들어갈 마크다운 본문만 쓴다. 인사·설명·머리말("다음은…")을 붙이지 않는다.',
  '- 전체를 ``` 코드 울타리로 감싸지 않는다.',
  '- 노트의 언어를 따른다 (비어 있으면 한국어).',
  '- `[제목](#page:…)` 형태의 하위 페이지 링크는 글자 하나 바꾸지 않고 남긴다.',
].join('\n');

export const PAGE_ORGANIZE_SYSTEM = [
  BASE,
  '',
  '할 일: 노트 전체를 읽기 좋게 정리한다.',
  '- 내용(사실·예시·수식·코드·링크)은 빠뜨리지 않는다. 지어내지 않는다.',
  '- 중복을 합치고, 흐름에 맞게 제목(##, ###)·목록·표로 구조를 잡는다.',
  '- 어색한 문장과 맞춤법을 다듬되 원래 말투는 유지한다.',
].join('\n');

export const PAGE_FILL_SYSTEM = [
  BASE,
  '',
  '할 일: 노트의 [여기에 채우기] 자리에 들어갈 내용만 쓴다.',
  '- 앞뒤 글과 이어지게 쓰고, 앞뒤에 이미 있는 내용을 되풀이하지 않는다.',
  '- 바로 앞이 제목이면 그 제목 아래 본문을, 목록 중간이면 같은 모양의 목록 항목을 쓴다.',
  '- 정확한 내용만 쓴다. 확실하지 않으면 짧게 쓴다.',
].join('\n');

const FILL_MARK = '[여기에 채우기]';
const LIST = /^\s*(?:[-*+]|\d+[.)]) /;

/** 노트 전체를 정리해 달라는 요청 */
export function buildPageOrganizeRequest(input: { title: string; content: string; request?: string }): StreamRequest {
  const parts = [`## 페이지 제목\n${input.title}`, '', '## 노트', input.content];
  if (input.request?.trim()) parts.push('', '## 추가 요청', input.request.trim());
  return { system: PAGE_ORGANIZE_SYSTEM, messages: [{ role: 'user', content: parts.join('\n') }], purpose: 'page' };
}

/** 커서 자리(before|after 사이)에 내용을 채워 달라는 요청 */
export function buildPageFillRequest(input: { title: string; before: string; after: string; request?: string }): StreamRequest {
  const parts = [`## 페이지 제목\n${input.title}`, '', '## 노트', `${input.before}${FILL_MARK}${input.after}`, '', '## 요청'];
  parts.push(input.request?.trim() || '앞뒤 맥락에 맞는 내용을 채워 줘.');
  return { system: PAGE_FILL_SYSTEM, messages: [{ role: 'user', content: parts.join('\n') }], purpose: 'page' };
}

/** AI 출력에서 페이지에 넣을 본문만 — 전체를 감싼 ```markdown 울타리와 남은 채우기 표시를 걷어 낸다 */
export function cleanPageAssist(raw: string, partial = false): string {
  let t = raw.replace(/^\s*\n/, '');
  const open = /^```(?:markdown|md)?[ \t]*\n/i.exec(t);
  if (open) {
    t = t.slice(open[0].length);
    const close = t.search(/\n```\s*$/);
    if (close >= 0) t = t.slice(0, close);
    else if (partial) t = t.replace(/\n`{1,3}$/, '');
  }
  t = t.split(FILL_MARK).join('');
  return partial ? t : t.trim();
}

/**
 * 채운 글을 커서 자리에 맞게 붙인다. 덩어리(여러 줄)는 앞뒤 문단과 빈 줄로 띄우고,
 * 한 줄은 그대로 이어 쓴다.
 */
export function joinPageFill(before: string, fill: string, after: string): string {
  if (!fill) return fill;
  const block = fill.includes('\n') || /^(#{1,6} |[-*+] |\d+[.)] |> |\|)/.test(fill);
  if (!block) return fill;
  let out = fill;
  const prevLine = before.slice(before.lastIndexOf('\n') + 1);
  // 목록 끝에서 목록을 이어 쓰면 한 줄만 띄운다 (빈 줄이면 느슨한 목록이 된다)
  if (LIST.test(prevLine) && LIST.test(fill)) out = `\n${out}`;
  else if (prevLine.trim()) out = `\n\n${out}`;
  else if (before && !before.endsWith('\n\n') && before.trim()) out = `\n${out}`;
  const nextLine = after.split('\n', 1)[0] ?? '';
  if (nextLine.trim()) out = `${out}\n\n`;
  else if (after.trim() && !after.startsWith('\n\n')) out = `${out}\n`;
  return out;
}
