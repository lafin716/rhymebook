import { t } from './i18n';
import { defaultPrompt, PROMPT_MAX_CHARS, promptInfo, promptText, type PromptKey, type PromptOverrides } from './prompts';
import type { StreamRequest } from './provider';

/**
 * AI로 시스템 프롬프트 고치기 (ADR-112). 스킬 도우미(ADR-037)처럼 태그로 결과를 받아,
 * 스트리밍 중에도 편집 칸에 부분 결과를 채운다. 저장은 사용자가 한다.
 */
export interface PromptAssistInput {
  /** 고칠 프롬프트 */
  key: PromptKey;
  /** 편집 칸의 지금 문구 (비어 있으면 기본 문구를 바탕으로 고친다) */
  current: string;
  /** 바꾸고 싶은 점. 비면 전체적으로 다듬는다 */
  request: string;
  /** 사용자가 고친 시스템 프롬프트 (도우미 지시 자체도 고칠 수 있다) */
  prompts?: PromptOverrides;
}

export interface PromptAssistResult {
  prompt?: string;
  note?: string;
}

export function buildPromptAssistRequest(input: PromptAssistInput): StreamRequest {
  const info = promptInfo().find((p) => p.key === input.key);
  const current = input.current.trim() ? input.current : defaultPrompt(input.key);
  const content = [
    t('llm.promptAssist.targetHeading'),
    `${info?.label ?? input.key} — ${info?.description ?? ''}`,
    '',
    t('llm.promptAssist.currentHeading'),
    '<prompt>',
    current,
    '</prompt>',
    '',
    t('llm.promptAssist.requestHeading'),
    input.request.trim() || t('llm.promptAssist.defaultEdit'),
  ].join('\n');
  return { system: promptText('promptAssist', input.prompts), messages: [{ role: 'user', content }], purpose: 'skill' };
}

/** 끝에 걸린 미완성 태그(`</pro`, `<`)를 떼어 낸다 */
const stripPartialTag = (s: string) => s.replace(/<\/?[a-z]*$/i, '');

function tag(raw: string, name: 'prompt' | 'note', partial: boolean): string | undefined {
  const open = raw.indexOf(`<${name}>`);
  if (open < 0) return undefined;
  const start = open + name.length + 2;
  const close = raw.indexOf(`</${name}>`, start);
  let value = close >= 0 ? raw.slice(start, close) : raw.slice(start);
  if (close < 0) {
    // 닫는 태그를 빠뜨리고 다음 태그가 나오면 거기까지
    const next = value.search(name === 'prompt' ? /\n<note>/ : /\n?<prompt>/);
    if (next >= 0) value = value.slice(0, next);
    else if (partial) value = stripPartialTag(value);
    else if (name === 'note') return undefined;
  }
  return name === 'prompt' ? value.replace(/^\n+|\s+$/g, '') : value.replace(/\s+/g, ' ').trim();
}

/**
 * 모델 출력에서 고친 프롬프트와 메모를 읽는다. partial이면 닫히지 않은 태그도 지금까지만큼.
 * 본문 안의 `<note>`는 프롬프트의 일부일 수 있어, 메모는 프롬프트가 닫힌 뒤에서 찾는다.
 */
export function parsePromptAssist(raw: string, partial = false): PromptAssistResult {
  const out: PromptAssistResult = {};
  const prompt = tag(raw, 'prompt', partial);
  if (prompt !== undefined) out.prompt = prompt;
  const close = raw.indexOf('</prompt>');
  const note = tag(close >= 0 ? raw.slice(close) : raw.includes('<prompt>') ? '' : raw, 'note', partial);
  if (note) out.note = note;
  return out;
}

/** 최종 문구. 읽지 못했거나 비면 null, 길면 한도에 맞춘다 */
export function finalizePromptAssist(result: PromptAssistResult): string | null {
  const text = result.prompt?.trim();
  return text ? text.slice(0, PROMPT_MAX_CHARS) : null;
}
