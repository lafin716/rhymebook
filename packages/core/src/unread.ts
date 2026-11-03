import type { ID, ViewState } from './model';

/** 화면에 보이고 있는 세션 (메인·분할·팝업·바텀시트) */
export function visibleSessionIds(v: ViewState): Set<ID> {
  const ids = new Set<ID>();
  if (v.activeSessionId) ids.add(v.activeSessionId);
  for (const id of v.splitSessionIds) ids.add(id);
  for (const p of v.popups) ids.add(p.sessionId);
  for (const id of v.sheetSessionIds) ids.add(id);
  return ids;
}

/**
 * 안 읽은 응답 표시 갱신 (사이드바 인디케이터).
 * - 생성이 끝난 세션이 지금 보이지 않으면 안 읽음으로 표시한다.
 * - 보이는 세션은 읽은 것으로 지운다. 사라진 세션도 지운다.
 * 바뀐 것이 없으면 같은 배열을 돌려준다.
 */
export function nextUnread(
  unread: readonly ID[],
  prevStreaming: Record<ID, unknown>,
  streaming: Record<ID, unknown>,
  visible: ReadonlySet<ID>,
  exists: (id: ID) => boolean,
): readonly ID[] {
  const set = new Set(unread);
  for (const id of Object.keys(prevStreaming)) {
    if (!(id in streaming) && !visible.has(id) && exists(id)) set.add(id);
  }
  for (const id of [...set]) if (visible.has(id) || !exists(id)) set.delete(id);
  if (set.size === unread.length && unread.every((id) => set.has(id))) return unread;
  return [...set];
}
