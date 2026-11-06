import { afterEach, describe, expect, it } from 'vitest';
import { createAppStore, type AppStore } from '../src/store';
import { createSyncHost, type SyncHost } from '../src/sync/host';
import { createSyncClient, SyncRpcCallError, type SyncClient } from '../src/sync/client';
import type { SyncLink } from '../src/bridge/remote';
import { createDemoRegistry } from '../src/providers/demo';
import { createSeed, emptyView, SEED_IDS } from '../src/seed';
import { isSyncServerMsg, validateSyncClientMsg, type SyncClientMsg, type SyncServerMsg } from '../src/bridge/sync';
import {
  base64Length,
  createUploadAssembler,
  splitUpload,
  SYNC_RPC_LIMITS,
  SyncRpcFailure,
  uploadChunkArgs,
  uploadChunkFromArgs,
  validateRpcArgs,
  type SyncRpcMethod,
} from '../src/bridge/syncRpc';

const until = async (cond: () => boolean, ms = 3000) => {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error('until: timeout');
    await new Promise((r) => setTimeout(r, 5));
  }
};

const bytes = (n: number, seed = 1) => Uint8Array.from({ length: n }, (_, i) => (i * 31 + seed) & 0xff);

describe('validateRpcArgs', () => {
  it('accepts known methods with well-formed args and fills optional ones', () => {
    expect(validateRpcArgs('host.info', [])).toEqual([]);
    expect(validateRpcArgs('knowledge.rename', ['kbabc123', '새 이름'])).toEqual(['kbabc123', '새 이름']);
    expect(validateRpcArgs('knowledge.docs', ['kbabc123'])).toEqual(['kbabc123', undefined]);
    expect(validateRpcArgs('knowledge.reindex', ['kbabc123', { full: true }])).toEqual(['kbabc123', { full: true }]);
    const input = { title: 't', prompt: 'p', runAt: '2026-11-06T09:00', repeat: 'none' };
    expect(validateRpcArgs('schedules.save', [input, 's-1'])).toEqual([input, 's-1', undefined, undefined]);
  });

  it('keeps null skill on schedules.save (remove skill) distinct from undefined', () => {
    const input = { title: 't', prompt: 'p', runAt: '2026-11-06T09:00', repeat: 'daily' };
    expect(validateRpcArgs('schedules.save', [input, 's-1', 'sch-1', null])![3]).toBe(null);
  });

  it('rejects unknown methods, extra args, and bad shapes', () => {
    expect(validateRpcArgs('fs.read', [])).toBe(null);
    expect(validateRpcArgs('host.info', [1])).toBe(null);
    expect(validateRpcArgs('knowledge.rename', ['kbabc123'])).toBe(null);
    expect(validateRpcArgs('knowledge.rename', ['../x', 'n'])).toBe(null);
    expect(validateRpcArgs('knowledge.removeEntry', ['kbabc123', '../etc/passwd'])).toBe(null);
    expect(validateRpcArgs('knowledge.removeEntry', ['kbabc123', '/abs'])).toBe(null);
    expect(validateRpcArgs('knowledge.setDescription', ['kbabc123', 'x'.repeat(501)])).toBe(null);
    expect(validateRpcArgs('schedules.save', [{ title: 't' }, 's-1'])).toBe(null);
    expect(validateRpcArgs('prompts.set', [[]])).toBe(null);
    expect(validateRpcArgs('knowledge.list', 'x')).toBe(null);
  });

  it('knowledge.source rejects path separators and dot segments', () => {
    expect(validateRpcArgs('knowledge.source', ['kbabc123', 'notes.md'])).toEqual(['kbabc123', 'notes.md']);
    for (const bad of ['a/b', 'a\\b', '.', '..', '']) expect(validateRpcArgs('knowledge.source', ['kbabc123', bad])).toBeNull();
  });

  it('checks upload chunk consistency', () => {
    const [c] = splitUpload('kbabc123', 'u1', 'a.txt', bytes(10));
    expect(validateRpcArgs('knowledge.upload', uploadChunkArgs(c!))).toBeTruthy();
    // 이름에 경로 구분자 금지
    expect(validateRpcArgs('knowledge.upload', uploadChunkArgs({ ...c!, name: 'a/b.txt' }))).toBe(null);
    expect(validateRpcArgs('knowledge.upload', uploadChunkArgs({ ...c!, name: '..' }))).toBe(null);
    // 선언한 크기와 데이터 길이가 다르면 거절
    expect(validateRpcArgs('knowledge.upload', uploadChunkArgs({ ...c!, size: 11 }))).toBe(null);
    // 파일 한도 초과
    expect(validateRpcArgs('knowledge.upload', uploadChunkArgs({ ...c!, size: SYNC_RPC_LIMITS.fileBytes + 1, total: 41 }))).toBe(null);
    // 빈 파일은 조각 하나
    const [empty] = splitUpload('kbabc123', 'u2', 'e.txt', new Uint8Array());
    expect(validateRpcArgs('knowledge.upload', uploadChunkArgs(empty!))).toBeTruthy();
  });
});

describe('sync.rpc messages', () => {
  it('validates client and server rpc messages', () => {
    expect(validateSyncClientMsg({ type: 'sync.rpc', reqId: 'r1', method: 'knowledge.list', args: [] })).toEqual({ type: 'sync.rpc', reqId: 'r1', method: 'knowledge.list', args: [] });
    expect(validateSyncClientMsg({ type: 'sync.rpc', reqId: 'r1', method: 'nope', args: [] })).toBe(null);
    expect(validateSyncClientMsg({ type: 'sync.rpc', reqId: '', method: 'knowledge.list', args: [] })).toBe(null);
    expect(isSyncServerMsg({ type: 'sync.rpc', reqId: 'r1', ok: true, data: [1] })).toBe(true);
    expect(isSyncServerMsg({ type: 'sync.rpc', reqId: 'r1', ok: false, error: 'forbidden' })).toBe(true);
    expect(isSyncServerMsg({ type: 'sync.rpc', reqId: 'r1', ok: false, error: 'weird' })).toBe(false);
    expect(isSyncServerMsg({ type: 'sync.event', topic: 'knowledge' })).toBe(true);
    expect(isSyncServerMsg({ type: 'sync.event', topic: 'secrets' })).toBe(false);
  });
});

describe('upload assembler', () => {
  it('round-trips a multi-chunk file', () => {
    const data = bytes(SYNC_RPC_LIMITS.chunkBytes * 2 + 123);
    const chunks = splitUpload('kbabc123', 'u1', 'big.pdf', data, 'docs');
    expect(chunks).toHaveLength(3);
    expect(base64Length(chunks[2]!.data)).toBe(123);
    for (const c of chunks) expect(validateRpcArgs('knowledge.upload', uploadChunkArgs(c))).toBeTruthy();
    const asm = createUploadAssembler();
    const results = chunks.map((c) => asm.push(uploadChunkFromArgs(validateRpcArgs('knowledge.upload', uploadChunkArgs(c))!)));
    expect(results[0]).toEqual({ ok: true, done: false, received: SYNC_RPC_LIMITS.chunkBytes });
    const last = results[2]!;
    expect(last.ok && last.done).toBe(true);
    if (last.ok && last.done) {
      expect(last.file.name).toBe('big.pdf');
      expect(last.file.dest).toBe('docs');
      expect(last.file.data).toEqual(data);
    }
    expect(asm.size).toBe(0);
  });

  it('rejects out-of-order or mismatched chunks and drops the upload', () => {
    const chunks = splitUpload('kbabc123', 'u1', 'a.bin', bytes(SYNC_RPC_LIMITS.chunkBytes + 5));
    const asm = createUploadAssembler();
    expect(asm.push(chunks[1]!)).toEqual({ ok: false, error: 'invalid' });
    expect(asm.push(chunks[0]!).ok).toBe(true);
    expect(asm.push({ ...chunks[1]!, name: 'other.bin' })).toEqual({ ok: false, error: 'invalid' });
    // 버려졌으므로 이어 보내도 실패
    expect(asm.push(chunks[1]!)).toEqual({ ok: false, error: 'invalid' });
  });

  it('limits concurrent uploads and expires idle ones', () => {
    let t = 0;
    const asm = createUploadAssembler({ now: () => t, maxActive: 2, idleMs: 1000 });
    const first = (id: string) => splitUpload('kbabc123', id, 'f.bin', bytes(SYNC_RPC_LIMITS.chunkBytes + 1))[0]!;
    expect(asm.push(first('a')).ok).toBe(true);
    expect(asm.push(first('b')).ok).toBe(true);
    expect(asm.push(first('c'))).toEqual({ ok: false, error: 'busy' });
    t = 2000;
    expect(asm.size).toBe(0);
    expect(asm.push(first('c')).ok).toBe(true);
  });
});

/** 호스트 1 + 피어 1 메모리 링크 */
function makePair(opts: { rpc?: (peerId: string, method: SyncRpcMethod, args: unknown[]) => Promise<unknown> }) {
  const hostStore: AppStore = createAppStore({
    registry: createDemoRegistry(() => hostStore.getState().connections),
    initial: { ...createSeed(0), view: emptyView(SEED_IDS.root) },
  });
  const clientStore: AppStore = createAppStore({
    registry: createDemoRegistry(() => clientStore.getState().connections),
    initial: { view: emptyView(null) },
    remote: true,
  });
  const listeners = new Set<(m: SyncServerMsg) => void>();
  const gone = new Set<() => void>();
  const sent: SyncClientMsg[] = [];
  const received: SyncServerMsg[] = [];
  let connected = true;
  const peersGone: string[] = [];
  const host: SyncHost = createSyncHost({
    store: hostStore,
    hostName: () => 'pc',
    throttleMs: 0,
    send: (_peerId, msg) => {
      const copy = JSON.parse(JSON.stringify(msg)) as SyncServerMsg;
      setTimeout(() => {
        if (!connected) return;
        received.push(copy);
        for (const l of listeners) l(copy);
      }, 0);
    },
    ...(opts.rpc ? { rpc: opts.rpc } : {}),
    onPeerGone: (id) => peersGone.push(id),
  });
  const link: SyncLink = {
    send(msg) {
      if (!connected) return false;
      sent.push(msg);
      const valid = validateSyncClientMsg(JSON.parse(JSON.stringify(msg)));
      if (valid) setTimeout(() => connected && host.receive('p1', valid), 0);
      return true;
    },
    subscribe(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    onDisconnect(cb) {
      gone.add(cb);
      return () => gone.delete(cb);
    },
    async ensure() {
      if (!connected) throw new Error('offline');
      return {};
    },
  };
  const client: SyncClient = createSyncClient({ store: clientStore, link, isPaired: async () => true, timeoutMs: 300, autoReconnect: false });
  return {
    host,
    client,
    sent,
    received,
    peersGone,
    disconnect() {
      connected = false;
      host.peerGone('p1');
      for (const cb of [...gone]) cb();
    },
  };
}

describe('sync rpc host ↔ client', () => {
  const cleanups: (() => void)[] = [];
  afterEach(() => {
    for (const c of cleanups.splice(0)) c();
  });
  const start = async (rpc?: (peerId: string, method: SyncRpcMethod, args: unknown[]) => Promise<unknown>) => {
    const pair = makePair(rpc ? { rpc } : {});
    cleanups.push(() => {
      pair.client.stop();
      pair.host.dispose();
    });
    pair.client.start();
    await until(() => pair.client.state.getState().status === 'online');
    return pair;
  };

  it('advertises manage only with an rpc handler and resolves calls', async () => {
    const calls: unknown[][] = [];
    const { client } = await start(async (peerId, method, args) => {
      calls.push([peerId, method, args]);
      return method === 'knowledge.list' ? [{ id: 'kbabc123' }] : undefined;
    });
    expect(client.state.getState().manage).toBe(true);
    expect(await client.rpc('knowledge.list')).toEqual([{ id: 'kbabc123' }]);
    expect(await client.rpc('knowledge.rename', ['kbabc123', 'x'])).toBeUndefined();
    expect(calls).toEqual([
      ['p1', 'knowledge.list', []],
      ['p1', 'knowledge.rename', ['kbabc123', 'x']],
    ]);
  });

  it('old hosts without an rpc handler → outdated, without sending', async () => {
    const { client, sent } = await start();
    expect(client.state.getState().manage).toBeFalsy();
    await expect(client.rpc('knowledge.list')).rejects.toMatchObject({ code: 'outdated' });
    expect(sent.some((m) => m.type === 'sync.rpc')).toBe(false);
  });

  it('malformed args fail fast as invalid', async () => {
    const { client, sent } = await start(async () => 1);
    await expect(client.rpc('knowledge.rename', ['../x', 'n'])).rejects.toMatchObject({ code: 'invalid' });
    expect(sent.some((m) => m.type === 'sync.rpc')).toBe(false);
  });

  it('maps handler failures to codes and messages', async () => {
    const { client } = await start(async (_p, method) => {
      if (method === 'knowledge.remove') throw new SyncRpcFailure('forbidden');
      if (method === 'schedules.remove') throw new SyncRpcFailure('not-found', '예약이 없습니다');
      throw new Error('디스크가 가득 찼습니다');
    });
    const err = await client.rpc('knowledge.remove', ['kbabc123']).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SyncRpcCallError);
    expect((err as SyncRpcCallError).code).toBe('forbidden');
    expect((err as SyncRpcCallError).message).toBeTruthy();
    await expect(client.rpc('schedules.remove', ['sch-1'])).rejects.toMatchObject({ code: 'not-found', message: '예약이 없습니다' });
    await expect(client.rpc('knowledge.list')).rejects.toMatchObject({ code: 'failed', message: '디스크가 가득 찼습니다' });
  });

  it('times out slow calls and rejects pending ones on disconnect', async () => {
    const pair = await start(() => new Promise(() => {}));
    await expect(pair.client.rpc('knowledge.list', [], { timeoutMs: 30 })).rejects.toMatchObject({ code: 'timeout' });
    const pending = pair.client.rpc('knowledge.list', [], { timeoutMs: 5000 });
    pair.disconnect();
    await expect(pending).rejects.toMatchObject({ code: 'offline' });
    expect(pair.peersGone).toEqual(['p1']);
    await expect(pair.client.rpc('knowledge.list')).rejects.toMatchObject({ code: 'offline' });
  });

  it('rate-limits rpc per peer', async () => {
    const { client } = await start(async () => 1);
    const results = await Promise.allSettled(Array.from({ length: SYNC_RPC_LIMITS.count + 5 }, () => client.rpc('knowledge.list')));
    const limited = results.filter((r) => r.status === 'rejected' && (r.reason as SyncRpcCallError).code === 'rate-limit');
    expect(limited).toHaveLength(5);
  });

  it('broadcasts events to synced peers', async () => {
    const { host, client } = await start(async () => undefined);
    const got: unknown[] = [];
    const off = client.onEvent((topic, data) => got.push([topic, data]));
    host.emit('knowledge.progress', { kbId: 'kbabc123', done: 1 });
    await until(() => got.length === 1);
    expect(got[0]).toEqual(['knowledge.progress', { kbId: 'kbabc123', done: 1 }]);
    off();
    host.emit('schedules');
    await new Promise((r) => setTimeout(r, 20));
    expect(got).toHaveLength(1);
  });
});
