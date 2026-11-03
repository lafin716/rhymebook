import type { AppStore } from '@branch/core';

/** A cold-start tap may arrive before the remote session snapshot. Bound that wait. */
export function notificationNavigation(store: AppStore, scope: () => string, unavailable: () => void) {
  let pending: { sessionId: string; scope: string } | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const clear = () => { pending = null; if (timer) clearTimeout(timer); timer = undefined; };
  const attempt = () => {
    if (!pending) return;
    if (scope() !== pending.scope) { clear(); unavailable(); return; }
    const target = pending.sessionId;
    if (!store.getState().sessions[target]) return;
    clear();
    store.getState().openSession(target);
    store.getState().setOverlay('none');
  };
  const stop = store.subscribe(attempt);
  return {
    open(sessionId: string, origin?: string) {
      clear();
      if (!/^[\w-]{1,64}$/.test(sessionId) || (origin !== undefined && origin !== scope())) { unavailable(); return; }
      pending = { sessionId, scope: scope() };
      timer = setTimeout(() => { clear(); unavailable(); }, 30_000);
      attempt();
    },
    cancel() { if (pending) { clear(); unavailable(); } },
    dispose() { clear(); stop(); },
  };
}
