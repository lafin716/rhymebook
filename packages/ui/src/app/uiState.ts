import { isMarkColor, parseTtsPrefs, type MarkColor, type TtsPrefs } from '@branch/core';
import { create } from 'zustand';
import { NAV_DOCK_KEY, parseNavDock, type NavDock } from '../chat/navDock';

const SIDEBAR_KEY = 'branch.sidebarCollapsed';
const TRIGGER_KEY = 'branch.selectionTrigger';
const QUOTE_KEY = 'branch.quoteCollapsed';
const FAVORITES_KEY = 'branch.favoriteColors';
const TTS_KEY = 'branch.tts';
const AUTO_SKILL_KEY = 'branch.autoSkill';
const VAULT_FULL_KEY = 'branch.vaultFull';

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
  /** 읽어 주기 엔진·OpenAI 음성 (기기별. API 키가 기기마다 다르므로 동기화하지 않는다, ADR-050) */
  tts: TtsPrefs;
  setTts(patch: Partial<TtsPrefs>): void;
  /** 요청에 맞는 스킬 자동 사용 (기기별, 기본 켬, IMP-21) */
  autoSkill: boolean;
  setAutoSkill(v: boolean): void;
  /** 모바일 세션 내비게이션 핸들 위치·숨김 (기기별, ADR-056) */
  navDock: NavDock;
  setNavDock(patch: Partial<NavDock>): void;
  /** 태블릿·데스크톱에서 보관함을 전체 화면으로 (기기별, ADR-058) */
  vaultFull: boolean;
  toggleVaultFull(): void;
  /** 딥링크로 받은 페어링 링크. 설정 › 원격 Bridge 폼이 가져가면 비운다 */
  pairLink: string | null;
  /** 사이드바에서 끌고 있는 세션 (분할 놓기 영역 표시용) */
  dragSessionId: string | null;
  setDragSession(id: string | null): void;
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

function loadTts(): TtsPrefs {
  try {
    return parseTtsPrefs(JSON.parse(load(TTS_KEY) ?? 'null'));
  } catch {
    return parseTtsPrefs(null);
  }
}

function loadNavDock(): NavDock {
  try {
    return parseNavDock(JSON.parse(load(NAV_DOCK_KEY) ?? 'null'));
  } catch {
    return parseNavDock(null);
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
  tts: loadTts(),
  setTts: (patch) => {
    const tts = { ...get().tts, ...patch };
    set({ tts });
    save(TTS_KEY, JSON.stringify(tts));
  },
  autoSkill: load(AUTO_SKILL_KEY) !== '0',
  setAutoSkill: (autoSkill) => {
    set({ autoSkill });
    save(AUTO_SKILL_KEY, autoSkill ? '1' : '0');
  },
  navDock: loadNavDock(),
  setNavDock: (patch) => {
    const navDock = { ...get().navDock, ...patch };
    set({ navDock });
    save(NAV_DOCK_KEY, JSON.stringify(navDock));
  },
  vaultFull: load(VAULT_FULL_KEY) === '1',
  toggleVaultFull: () => {
    const vaultFull = !get().vaultFull;
    set({ vaultFull });
    save(VAULT_FULL_KEY, vaultFull ? '1' : '0');
  },
  pairLink: null,
  dragSessionId: null,
  setDragSession: (dragSessionId) => set({ dragSessionId }),
}));
