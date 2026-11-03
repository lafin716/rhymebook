import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAppStore, ProviderRegistry, emptyView, type ScheduleInput } from '@branch/core';
import { BranchDB } from '../src/persist/db';
import { scheduleMessageId, scheduleRepository } from '../src/schedules/repository';
import { createScheduleEngine } from '../src/schedules/engine';

let serial = 0;
const databases: BranchDB[] = [];
function fixture() {
  const db = new BranchDB(`schedules-${++serial}`); databases.push(db);
  return { db, repo: scheduleRepository(db) };
}
const input = (): ScheduleInput => ({ title: '복습', prompt: '어텐션을 복습하자', runAt: new Date(Date.now() + 60_000).toISOString(), repeat: 'once' });
afterEach(async () => { vi.useRealTimers(); await Promise.all(databases.splice(0).map((db) => db.delete())); });

describe('local schedule repository', () => {
  it('persists CRUD across connections and rejects invalid dates', async () => {
    const { db, repo } = fixture();
    await expect(repo.save({ ...input(), runAt: 'bad' }, 's')).rejects.toThrow();
    await repo.save(input(), 's'); const [row] = await repo.list();
    const second = new BranchDB(db.name); databases.push(second);
    expect((await scheduleRepository(second).list())[0]?.title).toBe('복습');
    await repo.toggle(row!.id); expect((await repo.list())[0]?.enabled).toBe(false);
    await repo.save({ ...input(), title: '새 복습', repeat: 'weekly' }, 's', row!.id);
    expect((await repo.list())[0]).toMatchObject({ title: '새 복습', enabled: true, repeat: 'weekly' });
    await repo.remove(row!.id); expect(await repo.list()).toEqual([]);
  });
  it('keeps, replaces and removes the attached skill snapshot', async () => {
    const { repo } = fixture();
    const quiz = { id: 'k1', name: 'quiz', title: '퀴즈', prompt: '문제를 낸다' };
    await repo.save(input(), 's', undefined, undefined, quiz); const [row] = await repo.list();
    expect(row!.skill).toEqual(quiz);
    await repo.save({ ...input(), title: '이름만' }, 's', row!.id);
    expect((await repo.list())[0]!.skill).toEqual(quiz);
    await repo.save(input(), 's', row!.id, undefined, null);
    expect((await repo.list())[0]!.skill).toBeUndefined();
  });
  it('deduplicates the source user message, including after deletion', async () => {
    const { repo } = fixture();
    await Promise.all([repo.save(input(), 's', undefined, 'user1'), repo.save(input(), 's', undefined, 'user1')]);
    expect(await repo.list()).toHaveLength(1);
    await repo.remove((await repo.list())[0]!.id);
    await repo.save(input(), 's', undefined, 'user1');
    expect(await repo.list()).toHaveLength(0);
  });
  it('keeps a pending receipt until finish and recovers its deterministic id after restart', async () => {
    const { repo, db } = fixture(); await repo.save(input(), 's');
    const [row] = await repo.list(); const due = Date.now() - 100;
    await db.schedules.update(row!.id, { nextRunAt: due });
    const claimed = (await repo.claim(row!.id, Date.now()))!;
    expect(claimed.nextRunAt).toBe(due);
    const second = new BranchDB(db.name); databases.push(second);
    const recovered = (await scheduleRepository(second).claim(row!.id, Date.now()))!;
    expect(scheduleMessageId(recovered)).toBe(scheduleMessageId(claimed));
    await expect(repo.remove(row!.id)).rejects.toThrow();
    await expect(repo.save(input(), 's', row!.id)).rejects.toThrow();
    await repo.finish(recovered);
    expect((await repo.list())[0]).toMatchObject({ enabled: false, pendingRunAt: undefined });
    await expect(repo.toggle(row!.id)).rejects.toThrow();
  });
  it('coalesces missed recurring runs and preserves errors', async () => {
    const { repo, db } = fixture(); await repo.save({ ...input(), repeat: 'daily' }, 's');
    const [row] = await repo.list(); await db.schedules.update(row!.id, { nextRunAt: Date.now() - 5 * 86400000 });
    const claimed = (await repo.claim(row!.id, Date.now()))!;
    await repo.finish(claimed, 'offline');
    const [finished] = await repo.list();
    expect(finished!.nextRunAt).toBeGreaterThan(Date.now());
    expect(finished!.lastError).toBe('offline'); expect(finished!.enabled).toBe(true);
  });
  it('preserves the monthly anchor when only the task title is edited', async () => {
    const { repo, db } = fixture();
    const origin = new Date(2099, 0, 31, 9).getTime();
    const february = new Date(2099, 1, 28, 9).getTime();
    await repo.save({ ...input(), runAt: new Date(origin).toISOString(), repeat: 'monthly' }, 's');
    const [row] = await repo.list();
    await db.schedules.update(row!.id, { nextRunAt: february });
    await repo.save({ ...input(), title: '다른 제목', runAt: new Date(february).toISOString(), repeat: 'monthly' }, 's', row!.id);
    expect((await repo.list())[0]).toMatchObject({ anchorDay: 31, originAt: origin, nextRunAt: february });
  });
});

function storeFixture() {
  const registry = new ProviderRegistry();
  registry.register({ id: 'mock', label: 'Mock', available: async () => ({ status: 'ready' }),
    async *stream() { yield { type: 'delta', text: '복습 완료' } as const; yield { type: 'done' } as const; } });
  const store = createAppStore({ registry, initial: { settings: { defaultProviderId: 'mock' } as never, view: emptyView() } });
  const sessionId = store.getState().newRootSession() as string;
  return { store, sessionId };
}
const settle = async (check: () => boolean | Promise<boolean>) => { await vi.waitFor(async () => expect(await check()).toBe(true)); };

describe('schedule engine', () => {
  it('dispatches once with provenance and completes the row', async () => {
    const { repo, db } = fixture(); const { store, sessionId } = storeFixture();
    await repo.save(input(), sessionId); const [row] = await repo.list();
    await db.schedules.update(row!.id, { nextRunAt: Date.now() - 100 });
    const engine = createScheduleEngine(store, repo, async () => {}, async () => {});
    await engine.tick(); await engine.tick();
    await settle(async () => (await repo.list())[0]?.enabled === false);
    expect(store.getState().messages[sessionId]?.filter((m) => m.role === 'user')).toHaveLength(1);
    expect(store.getState().messages[sessionId]?.[0]?.scheduleRun).toBe(true);
    engine.stop();
  });
  it('recovers after claim without replaying a previously persisted user message', async () => {
    const { repo, db } = fixture(); const { store, sessionId } = storeFixture();
    await repo.save(input(), sessionId); const [row] = await repo.list();
    await db.schedules.update(row!.id, { nextRunAt: Date.now() - 100 });
    const pending = (await repo.claim(row!.id, Date.now()))!;
    store.getState().applyRemote({ messages: { [sessionId]: [{ id: scheduleMessageId(pending), sessionId, role: 'user', content: pending.prompt, scheduleRun: true, createdAt: 1 }] } });
    const send = vi.spyOn(store.getState(), 'sendMessage');
    const engine = createScheduleEngine(store, repo, async () => {}, async () => {});
    await engine.tick(); await settle(async () => (await repo.list())[0]?.enabled === false);
    expect(send).not.toHaveBeenCalled();
    expect((await repo.list())[0]?.lastError).toContain('중단'); engine.stop();
  });
  it('disables a schedule whose session was deleted', async () => {
    const { repo, db } = fixture(); const { store } = storeFixture();
    await repo.save(input(), 'deleted'); const [row] = await repo.list(); await db.schedules.update(row!.id, { nextRunAt: Date.now() - 100 });
    const engine = createScheduleEngine(store, repo, async () => {}, async () => {});
    await engine.tick(); await settle(async () => (await repo.list())[0]?.enabled === false);
    expect((await repo.list())[0]?.lastError).toContain('삭제'); engine.stop();
  });
  it('runs with the resolved skill and reports start and finish', async () => {
    const { repo, db } = fixture(); const { store, sessionId } = storeFixture();
    const snapshot = { id: 'k1', name: 'quiz', title: '퀴즈', prompt: 'old' };
    await repo.save(input(), sessionId, undefined, undefined, snapshot); const [row] = await repo.list();
    await db.schedules.update(row!.id, { nextRunAt: Date.now() - 100 });
    const events: string[] = [];
    const engine = createScheduleEngine(store, repo, async () => {}, async () => {}, undefined, {
      resolveSkill: (r) => r.skill && { ...r.skill, prompt: 'live' },
      onStart: (r) => events.push(`start:${r.title}`),
      onFinish: (r, error) => events.push(`finish:${r.title}:${error ?? 'ok'}`),
    });
    await engine.tick();
    await settle(async () => (await repo.list())[0]?.enabled === false);
    await settle(() => events.length === 2);
    expect(store.getState().messages[sessionId]?.[0]?.skill).toMatchObject({ name: 'quiz', prompt: 'live' });
    expect(events).toEqual(['start:복습', 'finish:복습:ok']);
    engine.stop();
  });
});
