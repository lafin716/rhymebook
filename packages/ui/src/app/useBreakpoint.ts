import { useSyncExternalStore } from 'react';

export type Breakpoint = 'mobile' | 'tablet' | 'desktop';

/** UX-SPEC 반응형 기준: mobile < 768 ≤ tablet < 1024 ≤ desktop */
const MQ_TABLET = '(min-width: 768px)';
const MQ_DESKTOP = '(min-width: 1024px)';

function read(): Breakpoint {
  if (typeof window === 'undefined') return 'desktop';
  if (window.matchMedia(MQ_DESKTOP).matches) return 'desktop';
  if (window.matchMedia(MQ_TABLET).matches) return 'tablet';
  return 'mobile';
}

function subscribe(cb: () => void) {
  const a = window.matchMedia(MQ_TABLET);
  const b = window.matchMedia(MQ_DESKTOP);
  a.addEventListener('change', cb);
  b.addEventListener('change', cb);
  return () => {
    a.removeEventListener('change', cb);
    b.removeEventListener('change', cb);
  };
}

export function useBreakpoint(): Breakpoint {
  return useSyncExternalStore(subscribe, read, () => 'desktop');
}

export const isMobileNow = () => read() === 'mobile';
