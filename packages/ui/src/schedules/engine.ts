import { isDocSession, type AppStore, type Schedule, type SkillRef } from '@branch/core';
import type { scheduleRepository } from './repository';
import { scheduleMessageId } from './repository';

type Repo = ReturnType<typeof scheduleRepository>;

/** Runs only inside the single browser Web Lock owner. Pending rows survive crashes. */
export interface ScheduleEngineHooks {
  /** Skill to apply at run time. Defaults to the schedule's snapshot. */
  resolveSkill?(row: Schedule): SkillRef | undefined;
  /** A scheduled question was sent (not called for crash recovery of an already sent receipt). */
  onStart?(row: Schedule): void;
  /** The run ended. error is set when the answer failed or stopped. */
  onFinish?(row: Schedule, error?: string): void;
}

export function createScheduleEngine(store: AppStore, repo: Repo, flush: () => Promise<void>, changed: () => Promise<void>, prepareSession?: (sessionId: string, receiptId: string) => Promise<boolean>, hooks: ScheduleEngineHooks = {}) {
  const safely = (fn: () => void) => { try { fn(); } catch { /* Indicators must not break the run. */ } };
  const running = new Set<string>();
  let stopped = false;
  const waiters = new Set<() => void>();
  const idle = (sessionId: string) => new Promise<void>((resolve) => {
    let off = () => {};
    const done = () => { off(); waiters.delete(done); resolve(); };
    off = store.subscribe((state) => { if (!state.streaming[sessionId]) done(); });
    waiters.add(done);
    if (stopped || !store.getState().streaming[sessionId]) done();
  });
  const run = async (id: string, sessionId: string) => {
    try {
      const row = await repo.claim(id, Date.now());
      if (!row || stopped) return;
      const messageId = scheduleMessageId(row);
      if (prepareSession && !await prepareSession(sessionId, messageId)) return;
      if (stopped || store.getState().streaming[sessionId]) return;
      const state = store.getState();
      if (!state.sessions[sessionId] || isDocSession(state.sessions[sessionId])) {
        await repo.disable(id, '대상 세션이 삭제되었거나 대화 세션이 아니에요.');
        return;
      }
      // A saved user message is the dispatch receipt; never replay it after a crash.
      const existing = state.messages[sessionId]?.find((m) => m.id === messageId);
      let started = false;
      if (!existing) {
        let skill: SkillRef | undefined;
        try { skill = hooks.resolveSkill ? hooks.resolveSkill(row) : row.skill; } catch { skill = row.skill; }
        const sent = state.sendMessage(sessionId, row.prompt, messageId, { scheduleRun: true, ...(skill ? { skill } : {}) });
        if (!sent) {
          const error = '예약 작업을 시작하지 못했어요. 세션과 연결 상태를 확인해 주세요.';
          await repo.disable(id, error);
          safely(() => hooks.onFinish?.(row, error));
          return;
        }
        started = true;
        safely(() => hooks.onStart?.(row));
        await flush();
        await idle(sessionId);
        if (stopped) return; // Keep pending for restart recovery.
        await flush();
      }
      const list = store.getState().messages[sessionId] ?? [];
      const pos = list.findIndex((m) => m.id === messageId);
      const answer = pos >= 0 ? list[pos + 1] : undefined;
      const error = answer?.role === 'assistant' && answer.status === 'done' ? undefined
        : answer?.error?.message ?? '예약 실행이 중단되었어요. 세션에서 응답을 다시 시도할 수 있어요.';
      await repo.finish(row, error);
      if (started || existing) safely(() => hooks.onFinish?.(row, error));
    } finally {
      running.delete(sessionId);
      await changed();
    }
  };
  return {
    async tick() {
      if (stopped) return;
      const rows = await repo.list();
      for (const row of rows) {
        if (!row.enabled || row.nextRunAt > Date.now() || running.has(row.sessionId) || store.getState().streaming[row.sessionId]) continue;
        running.add(row.sessionId);
        void run(row.id, row.sessionId).catch(() => {
          // Persistence failure leaves pending intact for next tick/restart; UI refresh shows DB failure.
        });
      }
    },
    stop() { stopped = true; for (const done of [...waiters]) done(); },
  };
}
