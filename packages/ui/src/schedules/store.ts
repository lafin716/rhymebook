import { hasScheduleIntent, isDocSession, parseScheduleBlock, type ResponseComplete, type Schedule, type ScheduleInput } from '@branch/core';
import { create } from 'zustand';
import { remoteMode } from '../app/capabilities';
import { isDemo, presentWindowId, sessionWindowId } from '../app/runtime';
import { actions, appStore, db, persistence } from '../app/store';
import { pushNotice } from '../app/sync';
import { createScheduleEngine } from './engine';
import { scheduleRepository } from './repository';
import { scheduleText as tx } from './scheduleText';

export const scheduleAvailable = !remoteMode && !sessionWindowId && !presentWindowId;
const repo = scheduleRepository(db);
interface SchedulesState {
  items: Schedule[];
  loaded: boolean;
  error: string | null;
  refresh(): Promise<void>;
  save(input: ScheduleInput, sessionId: string, id?: string): Promise<void>;
  remove(id: string): Promise<void>;
  toggle(id: string): Promise<void>;
}
const errorText = () => tx('예약 저장소를 읽거나 쓰지 못했어요. 다시 시도해 주세요.', 'Could not read or write schedules. Please try again.');
const requireAvailable = () => {
  if (!scheduleAvailable || isDemo()) throw new Error(tx('예약은 이 기기 프로필의 실제 대화에서 관리해 주세요.', 'Manage schedules in real conversations using the local device profile.'));
};
export const useSchedules = create<SchedulesState>((set, get) => ({
  items: [], loaded: false, error: null,
  async refresh() {
    if (!scheduleAvailable || isDemo()) { set({ items: [], loaded: true }); return; }
    try { set({ items: await repo.list(), loaded: true, error: null }); }
    catch { set({ loaded: true, error: errorText() }); }
  },
  async save(input, sessionId, id) {
    requireAvailable();
    const session = appStore.getState().sessions[sessionId];
    if (!session || isDocSession(session)) throw new Error(tx('실행할 대화 세션을 선택해 주세요.', 'Choose a conversation to run the task.'));
    await persistence.flush();
    await repo.save(input, sessionId, id);
    await get().refresh();
  },
  async remove(id) { requireAvailable(); await repo.remove(id); await get().refresh(); },
  async toggle(id) { requireAvailable(); await repo.toggle(id); await get().refresh(); },
}));

export function handleScheduleResponse(event: ResponseComplete): void {
  if (!scheduleAvailable || isDemo() || event.scheduleRun) return;
  const user = appStore.getState().messages[event.sessionId]?.find((m) => m.id === event.userMessageId);
  if (!user || user.scheduleRun || !(user.skill?.name === 'schedule' || hasScheduleIntent(user.content))) return;
  const input = parseScheduleBlock(event.content);
  if (!input) {
    if (/^\s*```schedule\b/m.test(event.content)) pushNotice(tx('예약 정보를 저장하지 못했어요. 날짜·시간을 명확히 적어 다시 요청하거나 예약 관리에서 등록해 주세요.', 'Could not save the schedule. Specify the date and time or use Schedule management.'));
    return;
  }
  void persistence.flush().then(() => repo.save(input, event.sessionId, undefined, event.userMessageId)).then(async () => {
    await useSchedules.getState().refresh();
    pushNotice(tx('예약을 등록했어요. 사이드바의 예약 관리에서 확인할 수 있어요.', 'Schedule created. View it in Schedule management.'));
  }).catch(() => pushNotice(tx('예약을 저장하지 못했어요. 예약 관리에서 다시 등록해 주세요.', 'Could not save the schedule. Please create it in Schedule management.')));
}

/** One owner per origin/database. The lifetime lock is released on page close or stop. */
export async function startScheduleService(): Promise<() => void> {
  if (!scheduleAvailable || isDemo()) return () => {};
  await useSchedules.getState().refresh();
  if (!navigator.locks) {
    useSchedules.setState({ error: tx('이 환경은 예약 자동 실행을 지원하지 않아요. 데스크톱 앱을 이용해 주세요.', 'Automatic scheduling is unavailable here. Use the desktop app.') });
    return () => {};
  }
  const controller = new AbortController();
  let release = () => {};
  let tickTimer: ReturnType<typeof setInterval> | undefined;
  let stopEngine = () => {};
  const onWake = () => { void useSchedules.getState().refresh(); };
  window.addEventListener('focus', onWake);
  const lockName = `octobooks-scheduler:${db.name}`;
  void navigator.locks.request(lockName, { signal: controller.signal }, async () => {
    const engine = createScheduleEngine(appStore, repo, () => persistence.flush(), () => useSchedules.getState().refresh(), async (sessionId, receiptId) => {
      await persistence.flush();
      if (appStore.getState().streaming[sessionId]) return false;
      // Another local tab may create a session or persist a dispatch receipt while
      // waiting for this owner. Read the canonical target without reloading the app.
      const target = await db.transaction('r', db.sessions, db.messages, async () => ({
        session: await db.sessions.get(sessionId),
        messages: await db.messages.where('sessionId').equals(sessionId).sortBy('seq'),
      }));
      const state = appStore.getState();
      if (state.streaming[sessionId]) return false;
      const hasReceipt = target.messages.some((m) => m.id === receiptId);
      if (!hasReceipt && target.messages.some((m) => m.status === 'streaming' && state.messages[sessionId]?.find((old) => old.id === m.id)?.status !== 'stopped')) return false;
      const sessions = { ...state.sessions };
      if (target.session) sessions[sessionId] = target.session;
      else delete sessions[sessionId];
      state.applyRemote({ sessions, messages: { ...state.messages, [sessionId]: target.messages.map(({ seq: _seq, ...message }) => (
        // A pending scheduler receipt belongs to the previous lock owner. If its
        // response was interrupted, show a stopped response rather than a spinner.
        hasReceipt && message.status === 'streaming' ? { ...message, status: 'stopped' as const } : message
      )) } });
      return true;
    });
    stopEngine = engine.stop;
    const tick = () => { if (!isDemo()) void engine.tick().catch(() => useSchedules.setState({ error: errorText() })); };
    tick();
    tickTimer = setInterval(tick, 1000);
    await new Promise<void>((resolve) => { release = resolve; });
    engine.stop();
  }).catch((error: unknown) => {
    if (!controller.signal.aborted) useSchedules.setState({ error: error instanceof Error ? error.message : errorText() });
  });
  // Pull changes made in another tab while its engine holds the lock.
  const viewTimer = setInterval(() => { if (actions().overlay === 'schedules') void useSchedules.getState().refresh(); }, 3000);
  return () => {
    controller.abort(); release(); stopEngine();
    if (tickTimer) clearInterval(tickTimer);
    clearInterval(viewTimer); window.removeEventListener('focus', onWake);
  };
}
