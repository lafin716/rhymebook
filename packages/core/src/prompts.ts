
/**
 * 앱이 모델에 보내는 시스템 프롬프트 모음 (ADR-098).
 * 기본 문구는 언어 파일(i18n/locales/<언어>/llm.json)에 두고, 사용자가 프롬프트 관리에서 고친 문구(Settings.prompts)가 있으면 그것을 쓴다.
 * 기본 문구는 호출할 때마다 현재 언어로 읽는다 (모듈 로드 시점에 고정하지 않는다).
 */
import { t, type MessageKey } from './i18n';

export type PromptKey =
  | 'base'
  | 'branch'
  | 'subsession'
  | 'branchSuggest'
  | 'summary'
  | 'title'
  | 'pageOrganize'
  | 'pageFill'
  | 'skillAssist'
  | 'promptAssist';

/** 사용자가 고친 프롬프트. 없거나 빈 값이면 기본 문구 */
export type PromptOverrides = Partial<Record<PromptKey, string>>;

const PROMPT_KEYS: readonly PromptKey[] = [
  'base',
  'branch',
  'subsession',
  'branchSuggest',
  'summary',
  'title',
  'pageOrganize',
  'pageFill',
  'skillAssist',
  'promptAssist',
];

/** 키별 기본 문구 (지금 언어) */
export function defaultPrompt(key: PromptKey): string {
  if (key === 'pageOrganize') return `${t('llm.prompts.pageBase')}\n\n${t('llm.prompts.pageOrganizeTask')}`;
  if (key === 'pageFill') return `${t('llm.prompts.pageBase')}\n\n${t('llm.prompts.pageFillTask')}`;
  return t(`llm.prompts.${key}` as MessageKey);
}

/** 모든 키의 기본 문구 (지금 언어) */
export function defaultPrompts(): Record<PromptKey, string> {
  const out = {} as Record<PromptKey, string>;
  for (const key of PROMPT_KEYS) out[key] = defaultPrompt(key);
  return out;
}

export interface PromptInfo {
  key: PromptKey;
  group: string;
  label: string;
  description: string;
}

const PROMPT_GROUP: Record<PromptKey, 'chat' | 'branch' | 'auto' | 'page' | 'assist'> = {
  base: 'chat',
  branchSuggest: 'chat',
  branch: 'branch',
  subsession: 'branch',
  summary: 'branch',
  title: 'auto',
  pageOrganize: 'page',
  pageFill: 'page',
  skillAssist: 'assist',
  promptAssist: 'assist',
};

/** 프롬프트 관리 화면에 보여 줄 순서와 설명 (지금 언어) */
export function promptInfo(): readonly PromptInfo[] {
  return PROMPT_KEYS.map((key) => ({
    key,
    group: t(`llm.info.groups.${PROMPT_GROUP[key]}` as MessageKey),
    label: t(`llm.info.${key}.label` as MessageKey),
    description: t(`llm.info.${key}.description` as MessageKey),
  }));
}

export const PROMPT_MAX_CHARS = 20000;

/** 실제로 쓸 프롬프트: 고친 문구가 있으면 그것, 아니면 기본 문구 */
export function promptText(key: PromptKey, overrides?: PromptOverrides): string {
  const v = overrides?.[key];
  return typeof v === 'string' && v.trim() ? v : defaultPrompt(key);
}

/** 저장된 값을 정리한다: 아는 키·문자열만, 비었거나 기본과 같으면 뺀다 */
export function sanitizePromptOverrides(raw: unknown): PromptOverrides {
  if (!raw || typeof raw !== 'object') return {};
  const out: PromptOverrides = {};
  for (const key of PROMPT_KEYS) {
    const v = (raw as Record<string, unknown>)[key];
    if (typeof v !== 'string' || !v.trim() || v === defaultPrompt(key)) continue;
    out[key] = v.slice(0, PROMPT_MAX_CHARS);
  }
  return out;
}
