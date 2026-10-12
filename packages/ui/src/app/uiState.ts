import { create } from 'zustand';

const SIDEBAR_KEY = 'branch.sidebarCollapsed';

/** 화면 전용 일시 상태 (도메인 스토어에 넣지 않는 것) */
interface UiState {
  drawerOpen: boolean;
  setDrawer(open: boolean): void;
  /** 데스크톱 고정 사이드바 접힘 (기기별, localStorage) */
  sidebarCollapsed: boolean;
  toggleSidebar(): void;
  /** 딥링크로 받은 페어링 링크. 설정 › 원격 Bridge 폼이 가져가면 비운다 */
  pairLink: string | null;
}

function loadCollapsed(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_KEY) === '1';
  } catch {
    return false;
  }
}

export const useUi = create<UiState>((set, get) => ({
  drawerOpen: false,
  setDrawer: (drawerOpen) => set({ drawerOpen }),
  sidebarCollapsed: loadCollapsed(),
  toggleSidebar: () => {
    const sidebarCollapsed = !get().sidebarCollapsed;
    set({ sidebarCollapsed });
    try {
      localStorage.setItem(SIDEBAR_KEY, sidebarCollapsed ? '1' : '0');
    } catch {
      /* 저장소 접근 불가 */
    }
  },
  pairLink: null,
}));
