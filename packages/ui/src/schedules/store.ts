import { hasScheduleIntent, isDocSession, matchTaskSkill, parseScheduleBlock, rpcErrorText, skillRef, type ResponseComplete, type Schedule, type ScheduleInput, type Skill, type SkillRef, type SyncHostInfo, type SyncRpcMethod } from '@branch/core';
import { create } from 'zustand';
import { remoteMode } from '../app/capabilities';
import { isDemo, presentWindowId, sessionWindowId } from '../app/runtime';
import { rpcErrorMessage } from '../app/remoteManage';
import { actions, appStore, db, persistence } from '../app/store';
import { pushNotice, syncClient } from '../app/sync';
import { showAppNotification } from '../notifications/service';
import { useSkills } from '../skills/skillsStore';
import { createScheduleEngine } from './engine';
import { scheduleRepository } from './repository';
import { scheduleText as tx } from './scheduleText';

/** PC 엔진·알림을 가진 창 (기기 프로필의 메인 창). 예약 실행과 저장은 여기서만 한다. */
export const scheduleAvailable = !remoteMode && !sessionWindowId && !presentWindowId;
/** 원격 창(휴대폰·웹·PC 세션 창): 예약은 PC의 데이터를 sync.rpc로 다룬다. */
export const scheduleRemote = () => remoteMode && !isDemo();
const repo = scheduleRepository(db);
export interface ScheduleFinished { id: string; title: string; sessionId: string; at: number; error?: string }
interface SchedulesState {
  items: Schedule[];
  loaded: boolean;
  error: string | null;
  /** Schedules running now (id → title and session). Drives the indicator. */
  running: Record<string, { title: string; sessionId: string }>;
  /** Finished runs not yet opened from the notification panel, oldest finish first. */
  finished: ScheduleFinished[];
  /** 원격: 연결된 PC의 시간대 (IANA). 모르면 null. 예약 시각은 이 시간대 기준이다. */
  timeZone: string | null;
  /** Opens a finished run's conversation and drops it from the notifications. */
  openFinished(id: string): void;
  /** Opens a running schedule's conversation. */
  openRunning(id: string): void;
  /** Drops one finished notification, or all of them without an id. */
  dismissFinished(id?: string): void;
  /** 원격: PC 시간대를 가져온다 (한 번 받으면 재사용). */
  ensureTimeZone(): Promise<string>;
  refresh(): Promise<void>;
  /** skill: undefined keeps the current skill, null removes it. */
  save(input: ScheduleInput, sessionId: string, id?: string, skill?: SkillRef | null): Promise<void>;
  remove(id: string): Promise<void>;
  toggle(id: string): Promise<void>;
}
const errorText = () => tx('예약 저장소를 읽거나 쓰지 못했어요. 다시 시도해 주세요.', 'Could not read or write schedules. Please try again.');
const requireAvailable = () => {
  if (isDemo() || (!scheduleAvailable && !scheduleRemote())) throw new Error(tx('예약은 이 기기 프로필의 실제 대화에서 관리해 주세요.', 'Manage schedules in real conversations using the local device profile.'));
};

/** 원격 관리 호출. 실패는 사용자 문구의 Error로 바꿔 던진다. */
async function remoteCall<T>(method: SyncRpcMethod, args?: unknown[]): Promise<T> {
  if (!syncClient) throw new Error(errorText());
  try { return await syncClient.rpc<T>(method, args); }
  catch (cause) { throw new Error(rpcErrorMessage(cause), { cause }); }
}

async function remoteTimeZone(): Promise<string> {
  const known = useSchedules.getState().timeZone;
  if (known) return known;
  const info = await remoteCall<SyncHostInfo>('host.info');
  useSchedules.setState({ timeZone: info.timeZone });
  return info.timeZone;
}

/** 늦게 도착한 이전 목록 응답이 새 응답을 덮지 않게 요청 순번을 센다 */
let remoteRefreshSeq = 0;

async function refreshRemote(): Promise<void> {
  const seq = ++remoteRefreshSeq;
  const client = syncClient;
  if (!client) return;
  const st = client.state.getState();
  // 연결 중에는 기다린다. 연결이 끊기면 목록 대신 안내를 보인다.
  if (st.status === 'connecting') return;
  if (st.status !== 'online') { useSchedules.setState({ loaded: true, error: rpcErrorText('offline') }); return; }
  // 스냅샷 전: manage를 알 때까지 기다린다 (상태 구독이 다시 부른다)
  if (st.manage === undefined) return;
  // 옛 PC: 관리 호출을 보내지 않고 화면이 업데이트 안내를 보인다
  if (st.manage === false) { useSchedules.setState({ items: [], running: {}, loaded: true, error: null }); return; }
  try {
    const [, items] = await Promise.all([remoteTimeZone(), remoteCall<Schedule[]>('schedules.list')]);
    if (seq !== remoteRefreshSeq) return;
    const running = Object.fromEntries(items.filter((item) => item.pendingRunAt !== undefined).map((item) => [item.id, { title: item.title, sessionId: item.sessionId }]));
    useSchedules.setState({ items, running, loaded: true, error: null });
  } catch (cause) {
    if (seq !== remoteRefreshSeq) return;
    useSchedules.setState({ loaded: true, error: cause instanceof Error ? cause.message : errorText() });
  }
}

/** 연결된 PC가 바뀌면 이전 PC의 예약·시간대를 버린다. */
export function resetRemoteSchedules(): void {
  useSchedules.setState({ items: [], running: {}, timeZone: null, loaded: false, error: null });
}

export const useSchedules = create<SchedulesState>((set, get) => ({
  items: [], loaded: false, error: null, running: {}, finished: [], timeZone: null,
  async ensureTimeZone() {
    if (!scheduleRemote()) return Intl.DateTimeFormat().resolvedOptions().timeZone;
    return remoteTimeZone();
  },
  openFinished(id) {
    const item = get().finished.find((f) => f.id === id);
    set((st) => ({ finished: st.finished.filter((f) => f.id !== id) }));
    if (item) openScheduleSession(item.sessionId);
  },
  openRunning(id) {
    const item = get().running[id];
    if (item) openScheduleSession(item.sessionId);
  },
  dismissFinished(id) {
    set((st) => ({ finished: id ? st.finished.filter((f) => f.id !== id) : [] }));
  },
  async refresh() {
    if (scheduleRemote()) { await refreshRemote(); return; }
    if (!scheduleAvailable || isDemo()) { set({ items: [], loaded: true }); return; }
    try { set({ items: await repo.list(), loaded: true, error: null }); }
    catch { set({ loaded: true, error: errorText() }); }
  },
  async save(input, sessionId, id, skill) {
    requireAvailable();
    if (scheduleRemote()) {
      // PC가 대화·스킬을 검사하고 저장한다. skill을 생략하면 현재 스킬을 유지하고, null이면 제거한다.
      // 새 예약은 id 자리에 null을 보낸다 (PC 핸들러는 null을 id 없음으로 본다).
      const args: unknown[] = [input, sessionId, id ?? null];
      if (skill !== undefined) args.push(skill);
      await remoteCall('schedules.save', args);
      await get().refresh();
      return;
    }
    const session = appStore.getState().sessions[sessionId];
    if (!session || isDocSession(session)) throw new Error(tx('실행할 대화 세션을 선택해 주세요.', 'Choose a conversation to run the task.'));
    await persistence.flush();
    await repo.save(input, sessionId, id, undefined, skill);
    await get().refresh();
  },
  async remove(id) {
    requireAvailable();
    if (scheduleRemote()) await remoteCall('schedules.remove', [id]);
    else await repo.remove(id);
    await get().refresh();
  },
  async toggle(id) {
    requireAvailable();
    if (scheduleRemote()) await remoteCall('schedules.toggle', [id]);
    else await repo.toggle(id);
    await get().refresh();
  },
}));

function openScheduleSession(sessionId: string) {
  if (!appStore.getState().sessions[sessionId]) return;
  actions().openSession(sessionId);
  actions().setOverlay('none');
}

export function handleScheduleResponse(event: ResponseComplete): void {
  if (!scheduleAvailable || isDemo() || event.scheduleRun) return;
  const user = appStore.getState().messages[event.sessionId]?.find((m) => m.id === event.userMessageId);
  if (!user || user.scheduleRun || !(user.skill?.name === 'schedule' || hasScheduleIntent(user.content))) return;
  const input = parseScheduleBlock(event.content);
  if (!input) {
    if (/^\s*```schedule\b/m.test(event.content)) pushNotice(tx('예약 정보를 저장하지 못했어요. 날짜·시간을 명확히 적어 다시 요청하거나 예약 관리에서 등록해 주세요.', 'Could not save the schedule. Specify the date and time or use Schedule management.'));
    return;
  }
  // The skill the user picked among several wins over what the AI wrote (ADR-111).
  const chosen = user.taskSkill;
  const live = chosen ? useSkills.getState().skills.find((s) => s.id === chosen.id) : undefined;
  const picked = scheduleSkill(input, user.content);
  const skill: SkillRef | null = chosen ? (live ? skillRef(live) : chosen) : picked ? skillRef(picked) : null;
  void persistence.flush().then(() => repo.save(input, event.sessionId, undefined, event.userMessageId, skill)).then(async () => {
    await useSchedules.getState().refresh();
    pushNotice(skill
      ? tx(`'${skill.title}' 스킬과 함께 예약을 등록했어요. 사이드바의 예약 관리에서 확인할 수 있어요.`, `Schedule created with the '${skill.title}' skill. View it in Schedule management.`)
      : tx('예약을 등록했어요. 사이드바의 예약 관리에서 확인할 수 있어요.', 'Schedule created. View it in Schedule management.'));
  }).catch(() => pushNotice(tx('예약을 저장하지 못했어요. 예약 관리에서 다시 등록해 주세요.', 'Could not save the schedule. Please create it in Schedule management.')));
}

/**
 * Skill for a schedule the AI created: the name the AI picked, else a skill inferred
 * from the task, else one inferred from the original request ("매일 3시 퀴즈 내줘" → quiz).
 */
export function scheduleSkill(input: ScheduleInput, request: string, skills: readonly Skill[] = useSkills.getState().skills): Skill | null {
  const usable = skills.filter((s) => s.name !== 'schedule');
  if (input.skill) {
    const named = usable.find((s) => s.name === input.skill);
    if (named) return named;
  }
  return matchTaskSkill(input.prompt, usable) ?? matchTaskSkill(request, usable);
}

/** At run time use the current skill with the same id (edits apply), else the saved snapshot. */
function currentSkill(row: Schedule): SkillRef | undefined {
  if (!row.skill) return undefined;
  const live = useSkills.getState().skills.find((s) => s.id === row.skill!.id);
  return live ? skillRef(live) : row.skill;
}

function markRunning(row: Schedule, on: boolean, error?: string) {
  useSchedules.setState((st) => {
    const running = { ...st.running };
    // A schedule appears once in the queue: its latest finish replaces an older unopened one.
    const finished = st.finished.filter((f) => f.id !== row.id);
    if (on) running[row.id] = { title: row.title, sessionId: row.sessionId };
    else {
      delete running[row.id];
      finished.push({ id: row.id, title: row.title, sessionId: row.sessionId, at: Date.now(), ...(error ? { error } : {}) });
    }
    return { running, finished };
  });
}

const scheduleHooks = {
  resolveSkill: currentSkill,
  onStart(row: Schedule) {
    markRunning(row, true);
    pushNotice(tx(`예약 작업을 시작했어요 · ${row.title}`, `Scheduled task started · ${row.title}`));
    void showAppNotification({
      sessionId: row.sessionId, tag: `schedule-${row.id}`,
      title: tx('예약 작업을 시작했어요', 'Scheduled task started'), body: row.title,
    });
  },
  onFinish(row: Schedule, error?: string) {
    markRunning(row, false, error);
    pushNotice(error ? tx(`예약 작업이 실패했어요 · ${row.title}`, `Scheduled task failed · ${row.title}`)
      : tx(`예약 작업을 마쳤어요 · ${row.title}`, `Scheduled task finished · ${row.title}`));
    void showAppNotification({
      sessionId: row.sessionId, tag: `schedule-${row.id}`,
      title: error ? tx('예약 작업이 실패했어요', 'Scheduled task failed') : tx('예약 작업을 마쳤어요', 'Scheduled task finished'),
      body: error ? `${row.title} — ${error}` : row.title,
    });
  },
};

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
    }, scheduleHooks);
    stopEngine = engine.stop;
    const tick = () => { if (!isDemo()) void engine.tick().catch(() => useSchedules.setState({ error: errorText() })); };
    tick();
    tickTimer = setInterval(tick, 1000);
    await new Promise<void>((resolve) => { release = resolve; });
    engine.stop();
    useSchedules.setState({ running: {} });
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
