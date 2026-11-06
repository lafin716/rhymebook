import 'fake-indexeddb/auto';
import { splitUpload, SyncRpcFailure, uploadChunkArgs, type DesktopKnowledgeApi } from '@branch/core';
import { describe, expect, it, vi } from 'vitest';

const added: { id: string; name: string; size: number; dest?: string }[] = [];
const removed: string[] = [];
const fakeKnowledge = {
  list: async () => [],
  create: async (name: string) => ({ id: 'kbabc123', name }),
  remove: async (id: string) => { removed.push(id); },
  removeEntry: async () => { throw new Error("Error invoking remote method 'knowledge:removeEntry': Error: 디스크 오류"); },
  addFiles: async (id: string, files: { name: string; data: Uint8Array }[], dest?: string) => {
    for (const f of files) added.push({ id, name: f.name, size: f.data.length, ...(dest ? { dest } : {}) });
    return { added: files.map((f) => f.name) };
  },
} as unknown as DesktopKnowledgeApi;

vi.mock('../src/app/runtime', async (orig) => ({ ...(await orig<object>()), desktop: { knowledge: fakeKnowledge } }));

const { createSyncRpcHandler, scheduleSignature } = await import('../src/app/syncRpc');

const setup = (allow = false) => {
  const events: string[] = [];
  const h = createSyncRpcHandler({ allowDelete: () => allow, emit: (t) => events.push(t) });
  return { h, events };
};
const code = async (p: Promise<unknown>) => {
  try { await p; return 'ok'; } catch (e) { return e instanceof SyncRpcFailure ? e.code : `error:${(e as Error).message}`; }
};

describe('PC 원격 관리 처리기 (ADR-116)', () => {
  it('host.info와 잘못된 인자', async () => {
    const { h } = setup(true);
    const info = await h.handle('p', 'host.info', []) as { knowledge: boolean; allowDelete: boolean; timeZone: string };
    expect(info).toMatchObject({ knowledge: true, allowDelete: true });
    expect(info.timeZone).toBeTruthy();
    expect(await code(h.handle('p', 'knowledge.rename', ['nope', 'x']))).toBe('invalid');
  });

  it('지식베이스 변경은 knowledge 이벤트, 없는 선택 메서드는 unsupported, IPC 접두어 제거', async () => {
    const { h, events } = setup();
    await h.handle('p', 'knowledge.create', ['노트']);
    expect(events).toEqual(['knowledge']);
    expect(await code(h.handle('p', 'knowledge.docs', ['kbabc123']))).toBe('unsupported');
    expect(await code(h.handle('p', 'knowledge.preview', ['kbabc123', 'a.md']))).toMatch(/^error:/);
  });

  it('원격 삭제가 꺼져 있으면 forbidden, 켜져 있으면 지운다', async () => {
    expect(await code(setup(false).h.handle('p', 'knowledge.remove', ['kbabc123']))).toBe('forbidden');
    expect(await code(setup(false).h.handle('p', 'knowledge.removeEntry', ['kbabc123', 'a.md']))).toBe('forbidden');
    const { h } = setup(true);
    await h.handle('p', 'knowledge.remove', ['kbabc123']);
    expect(removed).toEqual(['kbabc123']);
    expect(await code(h.handle('p', 'knowledge.removeEntry', ['kbabc123', 'a.md']))).toBe('error:디스크 오류');
  });

  it('조각 업로드를 조립해 addFiles로 넣고, 끊긴 피어의 조립은 버린다', async () => {
    const { h, events } = setup();
    const data = new Uint8Array(1024 * 1024 + 7).map((_, i) => i % 251);
    const chunks = splitUpload('kbabc123', 'up1', '사진.png', data, 'inbox');
    expect(chunks).toHaveLength(3);
    expect(await h.handle('p', 'knowledge.upload', uploadChunkArgs(chunks[0]!))).toEqual({ received: 512 * 1024 });
    await h.handle('p', 'knowledge.upload', uploadChunkArgs(chunks[1]!));
    expect(await h.handle('p', 'knowledge.upload', uploadChunkArgs(chunks[2]!))).toEqual({ added: ['사진.png'] });
    expect(added.at(-1)).toEqual({ id: 'kbabc123', name: '사진.png', size: data.length, dest: 'inbox' });
    expect(events).toEqual(['knowledge']);

    await h.handle('p', 'knowledge.upload', uploadChunkArgs(chunks[0]!));
    h.peerGone('p');
    expect(await code(h.handle('p', 'knowledge.upload', uploadChunkArgs(chunks[1]!)))).toBe('invalid');
  });

  it('예약 서명은 실행 상태 변화만 반영한다', () => {
    const row = { id: 's1', updatedAt: 1, nextRunAt: 2, enabled: true } as Parameters<typeof scheduleSignature>[0][number];
    expect(scheduleSignature([row])).toBe(scheduleSignature([{ ...row }]));
    expect(scheduleSignature([row])).not.toBe(scheduleSignature([{ ...row, pendingRunAt: 3 }]));
  });
});
