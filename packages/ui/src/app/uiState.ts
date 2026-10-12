import { isMarkColor, type MarkColor } from '@branch/core';
import { create } from 'zustand';

const SIDEBAR_KEY = 'branch.sidebarCollapsed';
const TRIGGER_KEY = 'branch.selectionTrigger';
const QUOTE_KEY = 'branch.quoteCollapsed';
const FAVORITES_KEY = 'branch.favoriteColors';

/** 텍스트를 드래그했을 때 가지·서식 메뉴를 띄우는 방식 (PC·웹. 모바일은 항상 자동) */
export type SelectionTrigger = 'auto' | 'contextmenu';

/** 즐겨찾기 색은 최대 이만큼 */
export const MAX_FAVORITE_COLORS = 12;

/** 화면 전용 일시 상태 (도메인 스토어에 넣지 않는 것) */
interface UiState {
  drawerOpen: boolean;
  setDrawer(open: boolean): void;
  /** 데스크톱 고정 사이드바 접힘 (기기별, localStorage) */
  sidebarCollapsed: boolean;
  toggleSidebar(): void;
  /** 드래그 메뉴 표시 방식 (기기별) */
  selectionTrigger: SelectionTrigger;
  setSelectionTrigger(v: SelectionTrigger): void;
  /** 가지 헤더의 부모 원문 인용을 한 줄로 접기 (기기별) */
  quoteCollapsed: boolean;
  toggleQuote(): void;
  /** 서식 색 즐겨찾기 (기기별) */
  favoriteColors: MarkColor[];
  toggleFavoriteColor(c: MarkColor): void;
  /** 딥링크로 받은 페어링 링크. 설정 › 원격 Bridge 폼이 가져가면 비운다 */
  pairLink: string | null;
}

function load(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function save(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* 저장소 접근 불가 */
  }
}

function loadFavorites(): MarkColor[] {
  try {
    const v: unknown = JSON.parse(load(FAVORITES_KEY) ?? '[]');
    return Array.isArray(v) ? v.filter(isMarkColor).slice(0, MAX_FAVORITE_COLORS) : [];
  } catch {
    return [];
  }
}

export const useUi = create<UiState>((set, get) => ({
  drawerOpen: false,
  setDrawer: (drawerOpen) => set({ drawerOpen }),
  sidebarCollapsed: load(SIDEBAR_KEY) === '1',
  toggleSidebar: () => {
    const sidebarCollapsed = !get().sidebarCollapsed;
    set({ sidebarCollapsed });
    save(SIDEBAR_KEY, sidebarCollapsed ? '1' : '0');
  },
  selectionTrigger: load(TRIGGER_KEY) === 'contextmenu' ? 'contextmenu' : 'auto',
  setSelectionTrigger: (selectionTrigger) => {
    set({ selectionTrigger });
    save(TRIGGER_KEY, selectionTrigger);
  },
  quoteCollapsed: load(QUOTE_KEY) === '1',
  toggleQuote: () => {
    const quoteCollapsed = !get().quoteCollapsed;
    set({ quoteCollapsed });
    save(QUOTE_KEY, quoteCollapsed ? '1' : '0');
  },
  favoriteColors: loadFavorites(),
  toggleFavoriteColor: (c) => {
    const cur = get().favoriteColors;
    const favoriteColors = cur.includes(c) ? cur.filter((x) => x !== c) : [...cur, c].slice(-MAX_FAVORITE_COLORS);
    set({ favoriteColors });
    save(FAVORITES_KEY, JSON.stringify(favoriteColors));
  },
  pairLink: null,
}));
