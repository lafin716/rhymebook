import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createAppStore, type AppStore } from '../src/store';
import { createSyncHost, type SyncHost } from '../src/sync/host';
import { createSyncClient, type SyncClient } from '../src/sync/client';
import type { SyncLink } from '../src/bridge/remote';
import { createDemoRegistry } from '../src/providers/demo';
import { mockControl } from '../src/providers/mock';
import { createSeed, emptyView, SEED_IDS } from '../src/seed';
import { branchQuestion } from '../src/context';
import type { ID } from '../src/model';
import type { SyncClientMsg, SyncServerMsg } from '../src/bridge/sync';
import { SYNC_LIMITS, validateSyncClientMsg, isSyncServerMsg } from '../src/bridge/sync';

const tick = () => new Promise((r) => setTimeout(r, 0));
const settle = async (n = 10) => {
  for (let i = 0; i < n; i++) await tick();
};
const until = async (cond: () => boolean, ms = 5000) => {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error('until: timeout');
    await new Promise((r) => setTimeout(r, 5));
  }
};
const idle = (store: AppStore) => until(() => Object.keys(store.getState().streaming).length === 0);

describe('sync validators', () => {
  it('accepts valid client messages', () => {
    expect(validateSyncClientMsg({ type: 'sync.hello' })).toEqual({ type: 'sync.hello' });
    expect(validateSyncClientMsg({ type: 'sync.messages', sessionId: 's-123' })).toBeTruthy();
    expect(validateSyncClientMsg({ type: 'act', reqId: 'r1', op: { kind: 'stop', sessionId: 's-1' } })).toBeTruthy();
    expect(validateSyncClientMsg({ type: 'act', reqId: 'r1', op: { kind: 'send', sessionId: 's1', text: 'hi', messageId: 'm1' } })).toBeTruthy();
  });

  it('rejects malformed client messages', () => {
    expect(validateSyncClientMsg(null)).toBe(null);
    expect(validateSyncClientMsg({ type: 'sync.unknown' })).toBe(null);
    expect(validateSyncClientMsg({ type: 'sync.messages' })).toBe(null);
    expect(validateSyncClientMsg({ type: 'sync.messages', sessionId: '../x' })).toBe(null);
    expect(validateSyncClientMsg({ type: 'act' })).toBe(null);
    expect(validateSyncClientMsg({ type: 'act', reqId: 'r1', op: { kind: 'send', sessionId: 's1', messageId: 'm1' } })).toBe(null);
    expect(validateSyncClientMsg({ type: 'act', reqId: 'r'.repeat(70), op: { kind: 'stop', sessionId: 's-1' } })).toBe(null);
    expect(
      validateSyncClientMsg({ type: 'act', reqId: 'r1', op: { kind: 'send', sessionId: 's1', text: 'x'.repeat(SYNC_LIMITS.text + 1), messageId: 'm1' } }),
    ).toBe(null);
    expect(validateSyncClientMsg({ type: 'act', reqId: 'r1', op: { kind: 'exec', cmd: 'rm' } })).toBe(null);
  });

  it('recognizes server messages', () => {
    expect(isSyncServerMsg({ type: 'sync.snapshot', hostName: 'pc', sessions: {}, streaming: {}, summaryDrafts: {} })).toBe(true);
    expect(isSyncServerMsg({ type: 'sync.reset' })).toBe(true);
    expect(isSyncServerMsg({ type: 'chat.delta' })).toBe(false);
  });
});

/** 호스트 1 + 피어 N 을 잇는 메모리 링크. 메시지는 비동기(매크로태스크)로 순서대로 전달된다 */
function createNet(host: () => SyncHost) {
  const peers = new Map<string, { connected: boolean; listeners: Set<(m: SyncServerMsg) => void>; gone: Set<() => void>; received: SyncServerMsg[]; sent: SyncClientMsg[]; dropActs: boolean }>();

  const deliver = (peerId: string, msg: SyncServerMsg) => {
    const p = peers.get(peerId);
    if (!p?.connected) return;
    const copy = JSON.parse(JSON.stringify(msg)) as SyncServerMsg;
    setTimeout(() => {
      if (!p.connected) return;
      p.received.push(copy);
      for (const l of p.listeners) l(copy);
    }, 0);
  };

  return {
    hostSend(peerId: string, msg: SyncServerMsg) {
      if (peerId === '*') for (const id of peers.keys()) deliver(id, msg);
      else deliver(peerId, msg);
    },
    peer(peerId: string) {
      const p = { connected: true, listeners: new Set<(m: SyncServerMsg) => void>(), gone: new Set<() => void>(), received: [] as SyncServerMsg[], sent: [] as SyncClientMsg[], dropActs: false };
      peers.set(peerId, p);
      const link: SyncLink = {
        send(msg) {
          if (!p.connected) return false;
          p.sent.push(msg);
          if (msg.type === 'act' && p.dropActs) return true;
          const copy = JSON.parse(JSON.stringify(msg)) as SyncClientMsg;
          setTimeout(() => p.connected && host().receive(peerId, copy), 0);
          return true;
        },
        subscribe(cb) {
          p.listeners.add(cb);
          return () => p.listeners.delete(cb);
        },
        onDisconnect(cb) {
          p.gone.add(cb);
          return () => p.gone.delete(cb);
        },
        async ensure() {
          if (!p.connected) throw new Error('offline');
          return {};
        },
      };
      return {
        link,
        state: p,
        disconnect() {
          p.connected = false;
          host().peerGone(peerId);
          for (const cb of [...p.gone]) cb();
        },
        connect() {
          p.connected = true;
        },
      };
    },
  };
}

function makeHostStore() {
  const store: AppStore = createAppStore({
    registry: createDemoRegistry(() => store.getState().connections),
    initial: { ...createSeed(0), view: emptyView(SEED_IDS.root) },
  });
  return store;
}

function makeClientStore() {
  const store: AppStore = createAppStore({
    registry: createDemoRegistry(() => store.getState().connections),
    initial: { view: emptyView(null) },
    remote: true,
  });
  return store;
}

describe('sync host ↔ client', () => {
  let hostStore: AppStore;
  let host: SyncHost;
  let net: ReturnType<typeof createNet>;
  let allowDelete: boolean;
  const clients: SyncClient[] = [];

  const connectClient = async (peerId = 'p1', opts: { timeoutMs?: number } = {}) => {
    const store = makeClientStore();
    const peer = net.peer(peerId);
    const client = createSyncClient({
      store,
      link: peer.link,
      isPaired: async () => true,
      timeoutMs: opts.timeoutMs ?? 1000,
      backoff: { base: 20, max: 40 },
    });
    clients.push(client);
    client.start();
    await until(() => client.state.getState().status === 'online');
    return { store, client, peer };
  };

  beforeEach(() => {
    mockControl.firstTokenDelay = 0;
    mockControl.speed = 0;
    mockControl.failNext = false;
    allowDelete = false;
    hostStore = makeHostStore();
    // 이 테스트의 호스트·넷끼리만 잇는다 (이전 테스트에서 지연된 메시지가 새 호스트로 새지 않게)
    let own: SyncHost | undefined;
    const ownNet = createNet(() => own!);
    net = ownNet;
    host = own = createSyncHost({
      store: hostStore,
      hostName: () => 'test-pc',
      send: (peerId, msg) => ownNet.hostSend(peerId, msg),
      throttleMs: 0,
      allowDelete: () => allowDelete,
    });
  });

  afterEach(() => {
    for (const c of clients.splice(0)) c.stop();
    host.dispose();
  });

  it('hello → snapshot with sessions only; messages load lazily when opened', async () => {
    const { store, client } = await connectClient();
    const s = store.getState();
    expect(client.state.getState().hostName).toBe('test-pc');
    expect(Object.keys(s.sessions).sort()).toEqual(Object.keys(hostStore.getState().sessions).sort());
    expect(s.messages[SEED_IDS.root]).toBeUndefined();

    store.getState().openSession(SEED_IDS.root);
    await until(() => !!client.state.getState().loaded[SEED_IDS.root]);
    expect(store.getState().messages[SEED_IDS.root]).toEqual(hostStore.getState().messages[SEED_IDS.root]);
  });

  it('client send → host runs the CLI → streamed answer converges via appends', async () => {
    const { store, peer } = await connectClient();
    store.getState().openSession(SEED_IDS.scale);
    await settle();

    const id = store.getState().sendMessage(SEED_IDS.scale, '왜 하필 루트야?');
    expect(id).toBeTruthy();
    // 낙관적 표시
    expect(store.getState().messages[SEED_IDS.scale]!.at(-1)!.id).toBe(id);

    await until(() => hostStore.getState().messages[SEED_IDS.scale]!.some((m) => m.id === id));
    await idle(hostStore);
    await settle();
    expect(store.getState().messages[SEED_IDS.scale]).toEqual(hostStore.getState().messages[SEED_IDS.scale]);
    expect(store.getState().streaming).toEqual({});
    expect(peer.state.received.some((m) => m.type === 'sync.append')).toBe(true);
    // 질문한 쪽 PC 스토어의 실제 답변
    expect(hostStore.getState().messages[SEED_IDS.scale]!.at(-1)!.status).toBe('done');
  });

  it('host-side activity is pushed only for sessions the peer has loaded', async () => {
    const { store, peer } = await connectClient();
    store.getState().openSession(SEED_IDS.root);
    await settle();
    peer.state.received.length = 0;

    hostStore.getState().sendMessage(SEED_IDS.cos, '코사인?');
    await idle(hostStore);
    await settle();
    const touched = peer.state.received.filter(
      (m) => (m.type === 'sync.message' && 'message' in m && m.message.sessionId === SEED_IDS.cos) || (m.type === 'sync.append' && m.sessionId === SEED_IDS.cos),
    );
    expect(touched).toEqual([]);
    // 세션 메타(updatedAt 등)와 스트리밍 상태는 받는다
    expect(peer.state.received.some((m) => m.type === 'sync.session')).toBe(true);
    expect(store.getState().messages[SEED_IDS.cos]).toBeUndefined();

    store.getState().openSession(SEED_IDS.cos);
    await until(() => store.getState().messages[SEED_IDS.cos]?.length === hostStore.getState().messages[SEED_IDS.cos]!.length);
    expect(store.getState().messages[SEED_IDS.cos]).toEqual(hostStore.getState().messages[SEED_IDS.cos]);
  });

  it('branch created on the client streams back to that client', async () => {
    const { store } = await connectClient();
    store.getState().openSession(SEED_IDS.root);
    await settle();
    const parentMsg = hostStore.getState().messages[SEED_IDS.root]![1]!;
    const at = parentMsg.content.indexOf('가중합');
    const anchor = { messageId: parentMsg.id, text: '가중합', startOffset: at, endOffset: at + 3 };

    const id = store.getState().createBranch(SEED_IDS.root, anchor, 'detail') as ID;
    expect(id).toBeTruthy();
    expect(store.getState().messages[id]![0]!.content).toBe(branchQuestion('detail', '가중합'));

    await until(() => !!hostStore.getState().sessions[id]);
    await idle(hostStore);
    await settle();
    expect(hostStore.getState().sessions[id]!.parentId).toBe(SEED_IDS.root);
    expect(store.getState().messages[id]).toEqual(hostStore.getState().messages[id]);
    expect(store.getState().messages[id]!.length).toBe(2);
  });

  it('new root from the client keeps the PC view and receives pushes', async () => {
    const { store } = await connectClient();
    const before = hostStore.getState().view.activeSessionId;
    const id = store.getState().newRootSession() as ID;
    expect(store.getState().view.activeSessionId).toBe(id);
    await until(() => !!hostStore.getState().sessions[id]);
    expect(hostStore.getState().view.activeSessionId).toBe(before);

    store.getState().sendMessage(id, '안녕');
    await until(() => (hostStore.getState().messages[id]?.length ?? 0) === 2);
    await idle(hostStore);
    await settle();
    expect(store.getState().messages[id]).toEqual(hostStore.getState().messages[id]);
  });

  it('rejects a second send while streaming (busy) and rolls back', async () => {
    mockControl.firstTokenDelay = 200;
    const { store, client } = await connectClient();
    store.getState().openSession(SEED_IDS.scale);
    await settle();
    store.getState().sendMessage(SEED_IDS.scale, '첫 질문');
    await until(() => !!store.getState().streaming[SEED_IDS.scale]);

    // 클라이언트도 스트리밍 중이면 로컬에서 거절
    expect(store.getState().sendMessage(SEED_IDS.scale, '둘째')).toBe(false);

    // 같은 피어가 다른 세션에서 동시에 두 번째 스트림 → 호스트가 busy
    store.getState().openSession(SEED_IDS.cos);
    await until(() => !!client.state.getState().loaded[SEED_IDS.cos]);
    const n = store.getState().messages[SEED_IDS.cos]!.length;
    const second = store.getState().sendMessage(SEED_IDS.cos, '동시 질문');
    expect(second).toBeTruthy();
    await until(() => client.state.getState().lastFailure?.code === 'busy');
    expect(store.getState().messages[SEED_IDS.cos]!.length).toBe(n);
    expect(hostStore.getState().messages[SEED_IDS.cos]!.some((m) => m.id === second)).toBe(false);
    await idle(hostStore);
  });

  it('remote delete is forbidden unless the PC allows it', async () => {
    const { store, client } = await connectClient();
    store.getState().openSession(SEED_IDS.scale);
    await settle();
    store.getState().deleteSession(SEED_IDS.scale);
    await until(() => client.state.getState().lastFailure?.code === 'forbidden');
    expect(hostStore.getState().sessions[SEED_IDS.scale]).toBeTruthy();

    allowDelete = true;
    store.getState().deleteSession(SEED_IDS.scale);
    await until(() => !store.getState().sessions[SEED_IDS.scale]);
    expect(hostStore.getState().sessions[SEED_IDS.scale]).toBeUndefined();
    // 활성 세션은 남아 있는 부모로
    expect(store.getState().view.activeSessionId).toBe(SEED_IDS.root);
  });

  it('host validates ops: bad anchor, id conflict, unknown session, not-ready, rate limit', async () => {
    const out: SyncServerMsg[] = [];
    const raw = createSyncHost({ store: hostStore, hostName: () => 'pc', send: (_p, m) => out.push(m), throttleMs: 0 });
    const result = (reqId: string) => out.find((m) => m.type === 'act.result' && m.reqId === reqId) as Extract<SyncServerMsg, { type: 'act.result' }> | undefined;

    raw.receive('x', { type: 'act', reqId: 'early', op: { kind: 'stop', sessionId: SEED_IDS.root } });
    expect(result('early')?.error).toBe('not-ready');

    raw.receive('x', { type: 'sync.hello' });
    const parentMsg = hostStore.getState().messages[SEED_IDS.root]![1]!;
    raw.receive('x', {
      type: 'act',
      reqId: 'anchor',
      op: { kind: 'branch', id: 's-new', parentId: SEED_IDS.root, anchor: { messageId: parentMsg.id, text: 'zzz', startOffset: 5, endOffset: parentMsg.content.length + 10 }, branch: 'what', messageId: 'm-new' },
    });
    expect(result('anchor')?.error).toBe('invalid');
    raw.receive('x', { type: 'act', reqId: 'dup', op: { kind: 'newRoot', id: SEED_IDS.cos } });
    expect(result('dup')?.error).toBe('conflict');
    raw.receive('x', { type: 'act', reqId: 'nf', op: { kind: 'rename', sessionId: 's-nope', title: 'x' } });
    expect(result('nf')?.error).toBe('not-found');

    for (let i = 0; i < SYNC_LIMITS.actCount + 2; i++) {
      raw.receive('x', { type: 'act', reqId: `r${i}`, op: { kind: 'rename', sessionId: SEED_IDS.root, title: `t${i}` } });
    }
    expect(out.some((m) => m.type === 'act.result' && m.error === 'rate-limit')).toBe(true);
    raw.dispose();
  });

  it('actions fail immediately when offline, and a failed send rolls back', async () => {
    const { store, client, peer } = await connectClient();
    store.getState().openSession(SEED_IDS.scale);
    await settle();
    const n = store.getState().messages[SEED_IDS.scale]!.length;

    peer.state.connected = false; // 소켓이 막 끊긴 상태 (onDisconnect 전)
    expect(store.getState().sendMessage(SEED_IDS.scale, '질문')).toBe(false);
    expect(store.getState().messages[SEED_IDS.scale]!.length).toBe(n);
    expect(client.state.getState().lastFailure?.code).toBe('offline');
    expect(store.getState().newRootSession()).toBe(false);
    expect(Object.keys(store.getState().sessions).length).toBe(Object.keys(hostStore.getState().sessions).length);
  });

  it('unanswered act times out, rolls back and resyncs', async () => {
    const { store, client, peer } = await connectClient('p1', { timeoutMs: 80 });
    peer.state.dropActs = true;
    const title = store.getState().sessions[SEED_IDS.root]!.title;
    store.getState().renameSession(SEED_IDS.root, '새 제목');
    expect(store.getState().sessions[SEED_IDS.root]!.title).toBe('새 제목');
    await until(() => client.state.getState().lastFailure?.code === 'timeout');
    expect(store.getState().sessions[SEED_IDS.root]!.title).toBe(title);
    expect(peer.state.sent.filter((m) => m.type === 'sync.hello').length).toBe(2);
  });

  it('disconnect → offline → automatic reconnect → snapshot; visible sessions reload', async () => {
    const { store, client, peer } = await connectClient();
    store.getState().openSession(SEED_IDS.root);
    await until(() => !!client.state.getState().loaded[SEED_IDS.root]);

    peer.disconnect();
    expect(client.state.getState().status).toBe('offline');
    expect(client.state.getState().loaded).toEqual({});
    hostStore.getState().renameSession(SEED_IDS.root, '오프라인 중 변경');

    peer.connect();
    await until(() => client.state.getState().status === 'online');
    await until(() => !!client.state.getState().loaded[SEED_IDS.root]);
    expect(store.getState().sessions[SEED_IDS.root]!.title).toBe('오프라인 중 변경');
    expect(store.getState().messages[SEED_IDS.root]).toEqual(hostStore.getState().messages[SEED_IDS.root]);
  });

  it('active branch deleted on the PC while offline → focus moves to its parent after reconnect', async () => {
    const { store, client, peer } = await connectClient();
    const parent = hostStore.getState().sessions[SEED_IDS.scale]!.parentId;
    expect(parent).toBeTruthy();
    store.getState().openSession(SEED_IDS.scale);
    await settle();

    peer.disconnect();
    hostStore.getState().deleteSession(SEED_IDS.scale);
    peer.connect();
    await until(() => client.state.getState().status === 'online');
    expect(store.getState().sessions[SEED_IDS.scale]).toBeUndefined();
    expect(store.getState().view.activeSessionId).toBe(parent);
  });

  it('sync.reset makes clients start over from hello', async () => {
    const { store, client, peer } = await connectClient();
    store.getState().openSession(SEED_IDS.root);
    await until(() => !!client.state.getState().loaded[SEED_IDS.root]);
    const hellos = () => peer.state.sent.filter((m) => m.type === 'sync.hello').length;
    expect(hellos()).toBe(1);

    host.reset();
    await until(() => hellos() === 2 && !!client.state.getState().loaded[SEED_IDS.root]);
    expect(client.state.getState().status).toBe('online');
  });

  it('peerGone stops pushes to that peer; other peers keep receiving', async () => {
    const a = await connectClient('a');
    const b = await connectClient('b');
    a.store.getState().openSession(SEED_IDS.root);
    b.store.getState().openSession(SEED_IDS.root);
    await settle();

    host.peerGone('a');
    a.peer.state.received.length = 0;
    hostStore.getState().renameSession(SEED_IDS.root, '변경');
    await until(() => b.store.getState().sessions[SEED_IDS.root]!.title === '변경');
    expect(a.peer.state.received).toEqual([]);
  });

  it('append with a mismatched offset triggers a reload of that session', async () => {
    const { store, client, peer } = await connectClient();
    store.getState().openSession(SEED_IDS.root);
    await until(() => !!client.state.getState().loaded[SEED_IDS.root]);
    const msg = store.getState().messages[SEED_IDS.root]![1]!;
    const before = peer.state.sent.filter((m) => m.type === 'sync.messages').length;
    for (const l of peer.state.listeners) l({ type: 'sync.append', sessionId: SEED_IDS.root, messageId: msg.id, offset: msg.content.length + 5, text: 'x' });
    expect(peer.state.sent.filter((m) => m.type === 'sync.messages').length).toBe(before + 1);
    await settle();
    expect(store.getState().messages[SEED_IDS.root]![1]!.content).toBe(msg.content);
  });

  it('summary request/attach run on the host and the draft syncs', async () => {
    const { store } = await connectClient();
    store.getState().openSession(SEED_IDS.scale);
    await settle();
    await store.getState().requestSummary(SEED_IDS.scale);
    await until(() => store.getState().summaryDrafts[SEED_IDS.scale]?.status === 'ready');
    store.getState().attachSummary(SEED_IDS.scale);
    await until(() => !!store.getState().sessions[SEED_IDS.scale]!.summary);
    expect(hostStore.getState().sessions[SEED_IDS.scale]!.summary).toBe(store.getState().sessions[SEED_IDS.scale]!.summary);
    expect(store.getState().summaryDrafts[SEED_IDS.scale]).toBeUndefined();
  });

  it('stop() restores the local store actions', async () => {
    const { store, client } = await connectClient();
    const remoteSend = store.getState().sendMessage;
    client.stop();
    expect(store.getState().sendMessage).not.toBe(remoteSend);
    expect(client.state.getState().status).toBe('unpaired');
  });
});
