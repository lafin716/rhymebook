import type { Overlay } from '@branch/core';
import { isDemo } from './runtime';
import { appStore } from './store';

const LAST_PAGE_KEY = 'branch.lastPage';

/** 앱을 다시 켰을 때 되살리는 전체 화면 페이지. 검색·설정은 잠깐 여는 창이라 기억하지 않는다 */
const RESTORABLE: readonly Overlay[] = ['notes', 'skills', 'vault'];

const isRestorable = (v: unknown): v is Overlay => RESTORABLE.includes(v as Overlay);

/**
 * 마지막으로 열어 둔 페이지(보관함·스킬·노트)를 기기별로 기억했다가 시작 시 다시 연다.
 * 열린 세션·분할·팝업은 view로 이미 저장소에 남는다. 데모 모드에서는 읽지도 쓰지도 않는다.
 */
export function restoreLastPage() {
  if (!isDemo()) {
    try {
      const saved = localStorage.getItem(LAST_PAGE_KEY);
      if (isRestorable(saved) && appStore.getState().overlay === 'none') appStore.getState().setOverlay(saved);
    } catch {
      /* 저장소 접근 불가 */
    }
  }
  appStore.subscribe((s, prev) => {
    if (s.overlay === prev.overlay || isDemo()) return;
    try {
      if (isRestorable(s.overlay)) localStorage.setItem(LAST_PAGE_KEY, s.overlay);
      // 검색·설정을 위에 띄운 것만으로는 지우지 않고, 페이지를 닫았을 때 지운다
      else if (s.overlay === 'none') localStorage.removeItem(LAST_PAGE_KEY);
    } catch {
      /* 저장소 접근 불가 */
    }
  });
}
