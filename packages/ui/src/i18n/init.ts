import { DEFAULT_LOCALE, intlLocale, isLocale, setLocale, type Locale } from '@branch/core/i18n';

/**
 * 앱 언어 초기화 (ADR-105). main.tsx에서 가장 먼저 import해 다른 모듈보다 먼저 언어를 정한다.
 * 언어는 기기마다 따로 둔다(localStorage). PC의 학습 데이터에는 쓰지 않는다.
 */
export const LOCALE_KEY = 'octobooks.locale';

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** 저장소를 쓸 수 있는지. 못 쓰면 고른 언어를 기억할 수 없으므로 첫 실행 언어 창을 띄우지 않는다 */
export const storageAvailable: boolean = (() => {
  try {
    void localStorage.length;
    return true;
  } catch {
    return false;
  }
})();

/** 이 기기에 저장된 언어. 아직 고르지 않았으면 null */
export const storedLocale: Locale | null = (() => {
  const v = read(LOCALE_KEY);
  return isLocale(v) ? v : null;
})();

/** 이전 버전을 이미 쓰던 기기인지 (설치 후 첫 실행이 아님). 다른 모듈이 저장소를 쓰기 전에 본다 */
export const hadPriorUse: boolean = (() => {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k !== LOCALE_KEY && (k.startsWith('branch.') || k.startsWith('octobooks.'))) return true;
    }
  } catch {
    // 저장소를 못 쓰면 첫 실행으로 본다
  }
  return false;
})();

export const initialLocale: Locale = storedLocale ?? DEFAULT_LOCALE;

setLocale(initialLocale);
if (typeof document !== 'undefined') document.documentElement.lang = initialLocale;
// 데스크톱 main 프로세스(트레이·알림·CLI 오류 문구)도 같은 언어를 쓴다
if (typeof window !== 'undefined') window.branchDesktop?.setLocale?.(initialLocale);

export { intlLocale };
