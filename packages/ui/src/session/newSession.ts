import { findDraftSession } from '@branch/core';
import { actions, appStore } from '../app/store';

/** 새로 만들기: 빈 대화 화면을 연다. 목록에는 첫 메시지를 보내야 나타나고, 남겨 둔 초안은 다시 쓴다 (ADR-074) */
export function startNewSession() {
  const s = appStore.getState();
  const draft = findDraftSession(s.sessions, s.messages);
  if (draft) actions().openSession(draft, 'main');
  else actions().newRootSession();
}
