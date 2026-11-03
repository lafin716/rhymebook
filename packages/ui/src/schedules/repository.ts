import { newId, nextScheduleRun, validateScheduleInput, type Schedule, type ScheduleInput, type SkillRef } from '@branch/core';
import type { BranchDB } from '../persist/db';

/** All read/modify/write transitions use one transaction across browser tabs. */
export function scheduleRepository(db: BranchDB) {
  return {
    list: () => db.schedules.orderBy('nextRunAt').toArray(),
    /** skill: undefined keeps the previous skill, null removes it. */
    async save(input: ScheduleInput, sessionId: string, id?: string, sourceMessageId?: string, skill?: SkillRef | null) {
      const now = Date.now();
      const valid = validateScheduleInput(input, now);
      if (!valid || !sessionId) throw new Error('예약 제목·작업·미래 날짜와 시간을 확인해 주세요.');
      return db.transaction('rw', db.schedules, db.scheduleSources, async () => {
        if (sourceMessageId && await db.scheduleSources.get(sourceMessageId)) return;
        const prev = id ? await db.schedules.get(id) : undefined;
        if (id && !prev) throw new Error('예약을 찾을 수 없어요. 목록을 다시 확인해 주세요.');
        if (prev?.pendingRunAt !== undefined) throw new Error('실행 중인 예약은 완료 후 수정할 수 있어요.');
        const at = Date.parse(valid.runAt);
        // Title/task edits must not move a Jan 31 monthly anchor to Feb 28.
        const sameBasis = prev && at === prev.nextRunAt && valid.repeat === prev.repeat;
        const nextSkill = skill === undefined ? prev?.skill : skill ?? undefined;
        await db.schedules.put({
          ...prev, id: prev?.id ?? newId('sched'), sessionId, skill: nextSkill,
          title: valid.title, prompt: valid.prompt, repeat: valid.repeat,
          nextRunAt: at, originAt: sameBasis ? prev.originAt : at, anchorDay: sameBasis ? prev.anchorDay : new Date(at).getDate(),
          enabled: true, createdAt: prev?.createdAt ?? now, updatedAt: now,
          lastError: undefined, ...(sourceMessageId ? { sourceMessageId } : {}),
        });
        if (sourceMessageId) await db.scheduleSources.put({ id: sourceMessageId });
      });
    },
    async toggle(id: string) {
      await db.transaction('rw', db.schedules, async () => {
        const row = await db.schedules.get(id);
        if (!row) return;
        if (row.pendingRunAt !== undefined) throw new Error('실행 중인 예약은 완료 후 변경할 수 있어요.');
        if (!row.enabled && row.repeat === 'once' && row.lastRunAt !== undefined) throw new Error('완료된 예약은 날짜를 수정해 다시 예약해 주세요.');
        // Paused overdue tasks execute once when resumed, just like app resume.
        await db.schedules.update(id, { enabled: !row.enabled, updatedAt: Date.now(), lastError: undefined });
      });
    },
    async remove(id: string) {
      await db.transaction('rw', db.schedules, async () => {
        const row = await db.schedules.get(id);
        if (row?.pendingRunAt !== undefined) throw new Error('실행 중인 예약은 완료 후 삭제할 수 있어요.');
        await db.schedules.delete(id);
      });
    },
    async claim(id: string, now: number): Promise<Schedule | null> {
      return db.transaction('rw', db.schedules, async () => {
        const row = await db.schedules.get(id);
        if (!row?.enabled || row.nextRunAt > now) return null;
        if (row.pendingRunAt !== undefined) return row;
        const claimed = { ...row, pendingRunAt: row.nextRunAt, updatedAt: now };
        await db.schedules.put(claimed);
        return claimed;
      });
    },
    async finish(row: Schedule, error?: string) {
      await db.transaction('rw', db.schedules, async () => {
        const current = await db.schedules.get(row.id);
        if (!current || current.pendingRunAt !== row.pendingRunAt) return;
        const now = Date.now();
        const next = nextScheduleRun(row.originAt, row.repeat, now, row.anchorDay);
        await db.schedules.put({ ...current, pendingRunAt: undefined, lastRunAt: now,
          nextRunAt: next ?? current.nextRunAt, enabled: next !== null && current.enabled,
          updatedAt: now, lastError: error });
      });
    },
    async disable(id: string, error: string) {
      await db.schedules.update(id, { enabled: false, pendingRunAt: undefined, lastError: error, updatedAt: Date.now() });
    },
  };
}

export const scheduleMessageId = (row: Schedule) => `scheduled-${row.id}-${row.pendingRunAt ?? row.nextRunAt}`;
