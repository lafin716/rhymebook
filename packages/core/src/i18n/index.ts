import ko from './locales/ko';
import en from './locales/en';
import ja from './locales/ja';
import zh from './locales/zh';
import vi from './locales/vi';

/**
 * 다국어 (ADR-105). 문구는 언어별 JSON 파일(locales/<언어>/<이름공간>.json)에 두고 코드는 키만 쓴다.
 * - 기준 언어는 한국어(ko). 다른 언어에 없는 키는 한국어로, 그것도 없으면 키 그대로 보인다.
 * - 자리표시자: "{name}" → vars.name. 영어 복수형: vars.count === 1이면 "<키>_one"을 먼저 찾는다.
 * - 플랫폼 무관: 저장(localStorage 등)은 각 앱이 하고 setLocale로 알려 준다.
 * 새 언어 추가 방법은 docs/i18n.md.
 */

/** 번역 사전 모양 (한국어 파일 기준) */
export type MessageDict = typeof ko;

type Leaves<T, P extends string = ''> = {
  [K in keyof T & string]: T[K] extends string ? `${P}${K}` : Leaves<T[K], `${P}${K}.`>;
}[keyof T & string];

/** 'settings.tabs.general' 같은 문구 키 */
export type MessageKey = Leaves<MessageDict>;

export type TranslateVars = Record<string, string | number>;

export interface LanguageInfo {
  id: string;
  /** 그 언어로 쓴 이름 (언어 선택 목록에 그대로 보인다) */
  name: string;
  /** Intl·음성 등에 쓰는 BCP 47 태그 */
  bcp47: string;
}

/** 지원 언어. 새 언어는 locales/<id>/ 폴더를 만들고 여기와 DICTS에 한 줄씩 추가한다 */
export const LANGUAGES = [
  { id: 'ko', name: '한국어', bcp47: 'ko-KR' },
  { id: 'en', name: 'English', bcp47: 'en-US' },
  { id: 'ja', name: '日本語', bcp47: 'ja-JP' },
  { id: 'zh', name: '简体中文', bcp47: 'zh-CN' },
  { id: 'vi', name: 'Tiếng Việt', bcp47: 'vi-VN' },
] as const satisfies readonly LanguageInfo[];

export type Locale = (typeof LANGUAGES)[number]['id'];

export const DEFAULT_LOCALE: Locale = 'ko';

const DICTS: Record<Locale, unknown> = { ko, en, ja, zh, vi };

export function isLocale(value: unknown): value is Locale {
  return LANGUAGES.some((l) => l.id === value);
}

/** 'en-US', 'en_GB.UTF-8' 같은 값을 지원 언어로 (없으면 null) */
export function matchLocale(value: string | null | undefined): Locale | null {
  if (!value) return null;
  const base = value.toLowerCase().split(/[-_.]/)[0];
  return isLocale(base) ? base : null;
}

let current: Locale = DEFAULT_LOCALE;
const listeners = new Set<(locale: Locale) => void>();

export function getLocale(): Locale {
  return current;
}

export function setLocale(locale: Locale): void {
  if (!isLocale(locale) || locale === current) return;
  current = locale;
  for (const fn of listeners) fn(locale);
}

export function onLocaleChange(fn: (locale: Locale) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** 지금 언어의 BCP 47 태그 (Intl.DateTimeFormat 등) */
export function intlLocale(locale: Locale = current): string {
  return LANGUAGES.find((l) => l.id === locale)?.bcp47 ?? 'ko-KR';
}

const flatCache = new Map<Locale, Map<string, string>>();

/** 중첩 사전을 'a.b.c' → 문구 맵으로 편다 */
export function flattenMessages(dict: unknown, prefix = '', out = new Map<string, string>()): Map<string, string> {
  if (dict && typeof dict === 'object') {
    for (const [k, v] of Object.entries(dict as Record<string, unknown>)) {
      const key = prefix ? `${prefix}.${k}` : k;
      if (typeof v === 'string') out.set(key, v);
      else flattenMessages(v, key, out);
    }
  }
  return out;
}

function flat(locale: Locale): Map<string, string> {
  let m = flatCache.get(locale);
  if (!m) {
    m = flattenMessages(DICTS[locale]);
    flatCache.set(locale, m);
  }
  return m;
}

/** 언어 파일의 원문 (자리표시자를 채우기 전). 없으면 undefined */
export function rawMessage(key: string, locale: Locale = current, count?: number): string | undefined {
  const order: Locale[] = locale === DEFAULT_LOCALE ? [locale] : [locale, DEFAULT_LOCALE];
  for (const l of order) {
    const m = flat(l);
    if (count === 1) {
      const one = m.get(`${key}_one`);
      if (one !== undefined) return one;
    }
    const v = m.get(key);
    if (v !== undefined) return v;
  }
  return undefined;
}

/** "{name}" 자리표시자를 채운다. 없는 변수는 그대로 둔다 */
export function interpolate(text: string, vars?: TranslateVars): string {
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (all, name: string) => (name in vars ? String(vars[name]) : all));
}

/** 문구 키 → 지금 언어 문구 */
export function t(key: MessageKey, vars?: TranslateVars): string {
  const count = typeof vars?.count === 'number' ? vars.count : undefined;
  return interpolate(rawMessage(key, current, count) ?? key, vars);
}

/** 지금 언어의 사전 (그 언어에 없는 키는 빠져 있다). 언어 검사 테스트용 */
export function messagesOf(locale: Locale): Map<string, string> {
  return flat(locale);
}
