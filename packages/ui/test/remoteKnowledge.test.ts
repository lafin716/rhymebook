import { describe, expect, it } from 'vitest';
import { SYNC_RPC_LIMITS, SyncRpcCallError, type SyncEventTopic, type SyncRpcMethod } from '@branch/core';
import { createRemoteKnowledgeApi, isRemoteForbidden, type RemoteRpc, type UploadSource } from '../src/knowledge/remoteKnowledge';

type Call = { method: SyncRpcMethod; args: unknown[] };

function fakeRpc(handler?: (method: SyncRpcMethod, args: unknown[]) => unknown | Promise<unknown>) {
  const calls: Call[] = [];
  const rpc: RemoteRpc = async <T>(method: SyncRpcMethod, args: unknown[] = []) => {
    calls.push({ method, args });
    return (await handler?.(method, args)) as T;
  };
  return { rpc, calls };
}

function makeApi(opts: { rpc: RemoteRpc; pickFiles?: () => Promise<UploadSource[]>; events?: Array<[SyncEventTopic, unknown]> }) {
  const listeners: Array<(topic: SyncEventTopic, data: unknown) => void> = [];
  const api = createRemoteKnowledgeApi({
    rpc: opts.rpc,
    onEvent: (l) => {
      listeners.push(l);
      return () => {
        const i = listeners.indexOf(l);
        if (i >= 0) listeners.splice(i, 1);
      };
    },
    pickFiles: opts.pickFiles ?? (async () => []),
    sleep: async () => {},
  });
  const emit = (topic: SyncEventTopic, data: unknown) => listeners.forEach((l) => l(topic, data));
  return { api, emit };
}

describe('remote knowledge api: 기본 호출', () => {
  it('목록 조회는 knowledge.list를 보낸다', async () => {
    const { rpc, calls } = fakeRpc(() => [{ id: 'kb1', name: 'a', fileCount: 0 }]);
    const { api } = makeApi({ rpc });
    const list = await api.list();
    expect(list).toHaveLength(1);
    expect(calls).toEqual([{ method: 'knowledge.list', args: [] }]);
  });

  it('삭제·항목 삭제는 허용 목록에 있는 메서드로 인자를 보낸다', async () => {
    const { rpc, calls } = fakeRpc();
    const { api } = makeApi({ rpc });
    await api.remove('kb1');
    await api.removeEntry('kb1', 'a/b.md');
    expect(calls).toEqual([
      { method: 'knowledge.remove', args: ['kb1'] },
      { method: 'knowledge.removeEntry', args: ['kb1', 'a/b.md'] },
    ]);
  });

  it('선택적 인자는 생략하면 보내지 않는다', async () => {
    const { rpc, calls } = fakeRpc();
    const { api } = makeApi({ rpc });
    await api.indexStates!();
    await api.reindex!('kb1');
    await api.docs!('kb1');
    expect(calls.map((c) => c.args)).toEqual([[], ['kb1'], ['kb1']]);
  });

  it('retrieve는 원격에 두지 않는다 (답변은 PC에서 실행)', () => {
    const { rpc } = fakeRpc();
    const { api } = makeApi({ rpc });
    expect(api.retrieve).toBeUndefined();
  });

  it('pathForFile은 빈 문자열, open과 addPaths는 거절한다', async () => {
    const { rpc } = fakeRpc();
    const { api } = makeApi({ rpc });
    expect(api.pathForFile({} as File)).toBe('');
    await expect(api.open('kb1')).rejects.toThrow();
    await expect(api.addPaths('kb1', ['/x'])).rejects.toThrow();
  });
});

describe('remote knowledge api: 업로드', () => {
  it('조각을 순서대로 나눠 보내고, 마지막 응답을 결과로 돌려준다', async () => {
    const size = SYNC_RPC_LIMITS.chunkBytes * 2 + 10;
    const { rpc, calls } = fakeRpc((method, args) => {
      if (method !== 'knowledge.upload') return undefined;
      const index = args[3] as number;
      return index === 2 ? { added: ['files/a.bin'], skipped: 1 } : { received: index + 1 };
    });
    const { api } = makeApi({ rpc });
    const result = await api.addFiles('kb1', [{ name: 'a.bin', data: new Uint8Array(size) }], 'docs');

    expect(result).toEqual({ added: ['files/a.bin'], skipped: 1 });
    const uploads = calls.filter((c) => c.method === 'knowledge.upload');
    expect(uploads).toHaveLength(3);
    const indexes = uploads.map((c) => c.args[3]);
    expect(indexes).toEqual([0, 1, 2]);
    expect(uploads.every((c) => c.args[4] === 3 && c.args[5] === size)).toBe(true);
    expect(uploads.every((c) => c.args[0] === 'kb1' && c.args[2] === 'a.bin' && c.args[7] === 'docs')).toBe(true);
    // 같은 파일의 조각은 같은 uploadId를 쓴다
    expect(new Set(uploads.map((c) => c.args[1])).size).toBe(1);
    // 마지막 조각은 남은 바이트만 담는다
    expect(uploads[2]!.args[6]).toBe(Buffer.from(new Uint8Array(10)).toString('base64'));
  });

  it('파일마다 다른 uploadId를 쓴다', async () => {
    const { rpc, calls } = fakeRpc(() => ({ added: ['x'], skipped: 0 }));
    const { api } = makeApi({ rpc });
    await api.addFiles('kb1', [
      { name: 'a.txt', data: new Uint8Array(3) },
      { name: 'b.txt', data: new Uint8Array(3) },
    ]);
    const ids = calls.map((c) => c.args[1]);
    expect(ids).toHaveLength(2);
    expect(ids[0]).not.toBe(ids[1]);
  });

  it('크기 한도를 넘거나 이름이 규칙에 맞지 않는 파일은 보내지 않고 건너뛴 것으로 센다', async () => {
    const { rpc, calls } = fakeRpc(() => ({ added: ['ok.txt'], skipped: 0 }));
    const { api } = makeApi({ rpc });
    const tooBig: UploadSource = { name: 'big.bin', size: SYNC_RPC_LIMITS.fileBytes + 1, bytes: async () => new Uint8Array(0) };
    const result = await api.addFiles('kb1', [
      { name: 'ok.txt', data: new Uint8Array(1) },
      { name: 'bad/name.txt', data: new Uint8Array(1) },
      { name: '..', data: new Uint8Array(1) },
    ]);
    expect(result.skipped).toBe(2);
    expect(calls.filter((c) => c.method === 'knowledge.upload')).toHaveLength(1);
    // 한도 초과 파일도 내용을 읽지 않는다
    const picked = makeApi({ rpc, pickFiles: async () => [tooBig] });
    const r2 = await picked.api.pickFiles('kb1');
    expect(r2).toEqual({ added: [], skipped: 1 });
  });

  it('고른 파일이 없으면 아무것도 보내지 않는다', async () => {
    const { rpc, calls } = fakeRpc();
    const { api } = makeApi({ rpc, pickFiles: async () => [] });
    expect(await api.pickFiles('kb1')).toEqual({ added: [], skipped: 0 });
    expect(calls).toHaveLength(0);
  });

  it('속도 제한은 잠시 뒤 같은 조각을 다시 보낸다', async () => {
    let tries = 0;
    const { rpc, calls } = fakeRpc(() => {
      tries++;
      if (tries === 1) throw new SyncRpcCallError('rate-limit', '잠시 후 다시');
      return { added: ['a.txt'], skipped: 0 };
    });
    const { api } = makeApi({ rpc });
    const r = await api.addFiles('kb1', [{ name: 'a.txt', data: new Uint8Array(4) }]);
    expect(r.added).toEqual(['a.txt']);
    expect(calls.filter((c) => c.method === 'knowledge.upload')).toHaveLength(2);
  });

  it('진행률은 로컬 리스너와 PC 진행 이벤트를 함께 받는다', async () => {
    const { rpc } = fakeRpc(() => ({ added: [], skipped: 0 }));
    const { api, emit } = makeApi({ rpc });
    const seen: string[] = [];
    const off = api.onProgress?.((p) => seen.push(`local:${p.phase}`));
    const offPc = api.onProgress?.((p) => seen.push(`pc:${p.phase}`));
    await api.addFiles('kb1', [{ name: 'a.txt', data: new Uint8Array(4) }]);
    emit('knowledge.progress', { phase: 'download', ratio: 0.5 });
    expect(seen).toContain('local:copy');
    expect(seen).toContain('pc:download');
    off?.();
    offPc?.();
  });

  it('취소하면 남은 조각을 보내지 않는다', async () => {
    const size = SYNC_RPC_LIMITS.chunkBytes * 3;
    const holder: { api?: ReturnType<typeof makeApi>['api'] } = {};
    const { rpc, calls } = fakeRpc(async (method, args) => {
      if (method === 'knowledge.upload' && args[3] === 0) await holder.api?.cancel?.();
      return method === 'knowledge.upload' ? { received: 1 } : undefined;
    });
    const { api } = makeApi({ rpc });
    holder.api = api;
    await expect(api.addFiles('kb1', [{ name: 'a.bin', data: new Uint8Array(size) }])).rejects.toThrow();
    expect(calls.filter((c) => c.method === 'knowledge.upload')).toHaveLength(1);
  });
});

describe('remote knowledge api: 색인 이벤트와 오류', () => {
  it('색인 상태 이벤트만 전달한다', () => {
    const { rpc } = fakeRpc();
    const { api, emit } = makeApi({ rpc });
    const got: unknown[] = [];
    api.onIndexState?.((s) => got.push(s));
    emit('knowledge.index', { kbId: 'kb1' });
    emit('knowledge', {});
    expect(got).toEqual([{ kbId: 'kb1' }]);
  });

  it('forbidden 판별', () => {
    expect(isRemoteForbidden(new SyncRpcCallError('forbidden', 'x'))).toBe(true);
    expect(isRemoteForbidden(new SyncRpcCallError('timeout', 'x'))).toBe(false);
    expect(isRemoteForbidden(new Error('forbidden'))).toBe(false);
  });
});
