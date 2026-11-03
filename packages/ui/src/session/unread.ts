import { nextUnread, visibleSessionIds, type AppState, type ID } from '@branch/core';
import { create } from 'zustand';
import { appStore, useApp } from '../app/store';
import { mobile } from '../app/runtime';

const KEY = 'octobooks.unreadSessions';

function loadIds(): ID[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(raw) ? raw.filter((x): x is ID => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

/** 응답이 끝났지만 아직 열어 보지 않은 세션 (기기별, localStorage) */
export const useUnread = create<{ ids: readonly ID[] }>(() => ({ ids: loadIds() }));

/**
 * 생성 종료·화면 표시를 지켜보며 안 읽음 표시를 갱신한다.
 * 창이 숨겨졌거나 모바일 앱이 백그라운드면 보이는 세션이 없는 것으로 본다.
 */
export function startUnreadTracker(): () => void {
  let foreground = typeof document === 'undefined' || document.visibilityState !== 'hidden';
  let prevStreaming = appStore.getState().streaming;
  const update = (st: AppState) => {
    const visible = foreground ? visibleSessionIds(st.view) : new Set<ID>();
    // 세션 목록이 아직 비어 있으면(불러오기 전·원격 연결 전) 지우지 않는다
    const loaded = Object.keys(st.sessions).length > 0;
    const exists = (id: ID) => !loaded || !!st.sessions[id];
    const cur = useUnread.getState().ids;
    const next = nextUnread(cur, prevStreaming, st.streaming, visible, exists);
    prevStreaming = st.streaming;
    if (next !== cur) {
      useUnread.setState({ ids: next });
      try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* 저장 실패는 무시 */ }
    }
  };
  const setForeground = (v: boolean) => {
    foreground = v;
    update(appStore.getState());
  };
  const onVisibility = () => setForeground(document.visibilityState !== 'hidden');
  document.addEventListener('visibilitychange', onVisibility);
  const stopActive = mobile?.onActiveChange?.((active) => setForeground(active));
  const stopStore = appStore.subscribe(update);
  update(appStore.getState());
  return () => {
    stopStore();
    stopActive?.();
    document.removeEventListener('visibilitychange', onVisibility);
  };
}

export type ActivityState = 'streaming' | 'unread' | null;

/** 세션 하나의 상태 */
export function useSessionActivity(id: ID): ActivityState {
  const streaming = useApp((st) => !!st.streaming[id]);
  const unread = useUnread((u) => u.ids.includes(id));
  return streaming ? 'streaming' : unread ? 'unread' : null;
}

/** 최상위 세션: 자신이나 하위 세션 중 하나라도 생성 중·안 읽음이면 표시 */
export function useTreeActivity(rootId: ID): ActivityState {
  const streaming = useApp((st) => Object.keys(st.streaming).some((id) => id === rootId || st.sessions[id]?.rootId === rootId));
  const unreadIds = useUnread((u) => u.ids);
  const unread = useApp((st) => unreadIds.some((id) => id === rootId || st.sessions[id]?.rootId === rootId));
  return streaming ? 'streaming' : unread ? 'unread' : null;
}
