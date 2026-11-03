import { Fragment, type ReactNode } from 'react';
import { create } from 'zustand';
import { LANGUAGES, getLocale, interpolate, rawMessage, t, type Locale, type MessageKey } from '@branch/core';
import { LOCALE_KEY, hadPriorUse, storageAvailable, storedLocale } from './init';

export { t, LANGUAGES, getLocale, type Locale, type MessageKey };
export { intlLocale } from '@branch/core';

/**
 * 문구 안에 React 노드를 끼운다: tx('chat.hint', { key: <kbd>Enter</kbd> }).
 * 문자열 변수만 있으면 t()와 같다.
 */
export function tx(key: MessageKey, vars: Record<string, ReactNode>): ReactNode {
  const count = typeof vars.count === 'number' ? vars.count : undefined;
  const raw = rawMessage(key, getLocale(), count) ?? key;
  const strVars: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(vars)) if (typeof v === 'string' || typeof v === 'number') strVars[k] = v;
  const text = interpolate(raw, strVars);
  const parts = text.split(/\{(\w+)\}/g);
  if (parts.length === 1) return text;
  return parts.map((p, i) => (i % 2 === 1 ? <Fragment key={i}>{p in vars ? vars[p] : `{${p}}`}</Fragment> : p || null));
}

interface LocaleState {
  locale: Locale;
  /** 첫 실행 언어 선택 창을 띄울지 */
  needsPrompt: boolean;
  /** 언어를 정한다. 지금과 다르면 앱을 다시 불러와 모든 문구를 바꾼다 */
  choose(locale: Locale): void;
}

function persist(locale: Locale) {
  try {
    localStorage.setItem(LOCALE_KEY, locale);
  } catch {
    // 저장소를 못 써도 이번 실행 동안은 고른 언어로 보인다
  }
}

// 이전 버전을 쓰던 기기는 묻지 않고 한국어로 둔다
if (!storedLocale && hadPriorUse) persist(getLocale());

export const useLocale = create<LocaleState>((set) => ({
  locale: getLocale(),
  needsPrompt: storageAvailable && !storedLocale && !hadPriorUse,
  choose(locale) {
    persist(locale);
    if (locale !== getLocale()) {
      location.reload();
      return;
    }
    set({ needsPrompt: false });
  },
}));

// 다른 창(세션 창 등)에서 언어를 바꾸면 이 창도 다시 불러온다
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === LOCALE_KEY && e.newValue && e.newValue !== getLocale()) location.reload();
  });
}
