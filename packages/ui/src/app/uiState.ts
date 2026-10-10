import { create } from 'zustand';

/** 화면 전용 일시 상태 (도메인 스토어에 넣지 않는 것) */
interface UiState {
  drawerOpen: boolean;
  setDrawer(open: boolean): void;
  /** 딥링크로 받은 페어링 링크. 설정 › 원격 Bridge 폼이 가져가면 비운다 */
  pairLink: string | null;
}

export const useUi = create<UiState>((set) => ({
  drawerOpen: false,
  setDrawer: (drawerOpen) => set({ drawerOpen }),
  pairLink: null,
}));
