import { useEffect } from 'react';
import { useApp } from './store';
import { isPalette, PALETTE_KEY, usePalette } from './palette';

const KEY = 'branch.theme';

/** Apply mode and palette to all shared UI, including floating session windows. */
export function useThemeSync() {
  const pref = useApp((s) => s.settings.theme);
  const palette = usePalette((s) => s.palette);
  useEffect(() => {
    try { localStorage.setItem(KEY, pref); } catch { /* unavailable storage */ }
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const html = document.documentElement;
      html.classList.toggle('dark', pref === 'dark' || (pref === 'system' && mq.matches));
      html.dataset.palette = palette;
      const background = getComputedStyle(html).getPropertyValue('--bg').trim();
      document.querySelectorAll('meta[name="theme-color"]').forEach((meta) => meta.setAttribute('content', background));
    };
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [pref, palette]);

  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key === PALETTE_KEY || event.key === null) {
        usePalette.setState({ palette: isPalette(event.newValue) ? event.newValue : 'ocean' });
      }
    };
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, []);
}

export function initialThemePref(): 'system' | 'light' | 'dark' {
  try {
    const value = localStorage.getItem(KEY);
    if (value === 'light' || value === 'dark' || value === 'system') return value;
  } catch { /* unavailable storage */ }
  return 'system';
}
