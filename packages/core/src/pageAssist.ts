import { DEFAULT_PROMPTS, promptText, type PromptOverrides } from './prompts';
import type { StreamRequest } from './provider';

/* ── 페이지 AI 도우미 (ADR-076) ── */

export const PAGE_ORGANIZE_SYSTEM = DEFAULT_PROMPTS.pageOrganize;

export const PAGE_FILL_SYSTEM = DEFAULT_PROMPTS.pageFill;

const FILL_MARK = '[여기에 채우기]';
const LIST = /^\s*(?:[-*+]|\d+[.)]) /;

/** 노트 전체를 정리해 달라는 요청 */
export function buildPageOrganizeRequest(input: { title: string; content: string; request?: string; prompts?: PromptOverrides }): StreamRequest {
  const parts = [`## 페이지 제목\n${input.title}`, '', '## 노트', input.content];
  if (input.request?.trim()) parts.push('', '## 추가 요청', input.request.trim());
  return { system: promptText('pageOrganize', input.prompts), messages: [{ role: 'user', content: parts.join('\n') }], purpose: 'page' };
}

/** 커서 자리(before|after 사이)에 내용을 채워 달라는 요청 */
export function buildPageFillRequest(input: { title: string; before: string; after: string; request?: string; prompts?: PromptOverrides }): StreamRequest {
  const parts = [`## 페이지 제목\n${input.title}`, '', '## 노트', `${input.before}${FILL_MARK}${input.after}`, '', '## 요청'];
  parts.push(input.request?.trim() || '앞뒤 맥락에 맞는 내용을 채워 줘.');
  return { system: promptText('pageFill', input.prompts), messages: [{ role: 'user', content: parts.join('\n') }], purpose: 'page' };
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
