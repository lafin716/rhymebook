import { useEffect } from 'react';
import { useApp } from './store';

const KEY = 'branch.theme';

/** settings.theme → <html class="dark"> 동기화 (index.html 인라인 스크립트와 같은 키 사용) */
export function useThemeSync() {
  const pref = useApp((s) => s.settings.theme);
  useEffect(() => {
    try {
      localStorage.setItem(KEY, pref);
    } catch {
      // 저장소 접근 불가 시 무시
    }
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const dark = pref === 'dark' || (pref === 'system' && mq.matches);
      document.documentElement.classList.toggle('dark', dark);
      document
        .querySelectorAll('meta[name="theme-color"]')
        .forEach((m) => m.setAttribute('content', dark ? '#16171a' : '#f7f6f2'));
    };
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [pref]);
}

export function initialThemePref(): 'system' | 'light' | 'dark' {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'light' || v === 'dark' || v === 'system') return v;
  } catch {
    // ignore
  }
  return 'system';
}
