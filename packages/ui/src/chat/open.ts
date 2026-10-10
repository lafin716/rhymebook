import type { ID, OpenTarget } from '@branch/core';
import { actions } from '../app/store';
import { isMobileNow } from '../app/useBreakpoint';

/** 가지(서브세션)를 여는 기본 위치: 모바일 → 바텀시트, 그 외 → 설정(팝업/분할) */
export function branchTarget(): OpenTarget {
  if (isMobileNow()) return 'sheet';
  return actions().settings.anchorOpenTarget;
}

export function openBranch(sessionId: ID) {
  actions().openSession(sessionId, branchTarget());
}

/** 원문 위치로 이동: 부모 세션을 메인에 열고 앵커를 스크롤·강조한다 */
export function revealAnchor(sessionId: ID) {
  const s = actions().sessions[sessionId];
  if (!s?.parentId) return;
  actions().openSession(s.parentId, 'main');
  let tries = 0;
  const tick = () => {
    const el = document.querySelector<HTMLElement>(`[data-panel="main"] mark.anchor[data-session-ids~="${sessionId}"]`)
      ?? document.querySelector<HTMLElement>(`mark.anchor[data-session-ids~="${sessionId}"]`);
    if (!el) {
      if (tries++ < 20) requestAnimationFrame(tick);
      return;
    }
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    el.classList.remove('anchor-flash');
    void el.offsetWidth;
    el.classList.add('anchor-flash');
  };
  requestAnimationFrame(tick);
}

/** 해당 가지의 앵커 하이라이트를 강조/해제 (요약 카드 hover 연동) */
export function setAnchorActive(sessionId: ID, active: boolean) {
  document.querySelectorAll<HTMLElement>(`mark.anchor[data-session-ids~="${sessionId}"]`).forEach((el) => {
    if (active) el.dataset.active = 'true';
    else delete el.dataset.active;
  });
}
