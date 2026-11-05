import { effectiveKnowledgeIds, knowledgeInherited, type ID } from '@branch/core';
import { actions, useApp, useAppShallow } from '../app/store';

/**
 * 세션에 적용되는 지식베이스 상태 (ADR-113).
 * ids: 실제로 검색에 쓰이는 목록 (상속 포함). inherited: 부모 가지에서 물려받는 중. overridden: 이 세션이 직접 정한 목록이 있다.
 */
export function useSessionKnowledge(sessionId: ID) {
  const ids = useAppShallow((s) => effectiveKnowledgeIds(s.sessions, sessionId));
  const inherited = useApp((s) => knowledgeInherited(s.sessions, sessionId));
  const overridden = useApp((s) => {
    const cur = s.sessions[sessionId];
    return !!cur?.parentId && cur.knowledgeIds !== undefined;
  });
  return { ids, inherited, overridden };
}

/** 지식베이스 하나를 연결하거나 끊는다. 상속 중이면 부모 목록을 이 세션의 목록으로 옮긴 뒤 바꾼다 */
export function toggleSessionKnowledge(sessionId: ID, currentIds: readonly string[], kbId: string) {
  const next = currentIds.includes(kbId) ? currentIds.filter((id) => id !== kbId) : [...currentIds, kbId];
  actions().setSessionKnowledgeIds(sessionId, next);
}

/** 가지의 지식베이스 덮어쓰기를 풀고 부모를 따른다 */
export function resetSessionKnowledge(sessionId: ID) {
  actions().setSessionKnowledgeIds(sessionId, null);
}
