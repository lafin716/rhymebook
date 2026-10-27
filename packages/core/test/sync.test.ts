import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createAppStore, type AppStore } from '../src/store';
import { createSyncHost, type SyncHost } from '../src/sync/host';
import { createSyncClient, type SyncClient } from '../src/sync/client';
import type { SyncLink } from '../src/bridge/remote';
import { createDemoRegistry } from '../src/providers/demo';
import { mockControl } from '../src/providers/mock';
import { createSeed, emptyView, SEED_IDS } from '../src/seed';
import { branchQuestion } from '../src/context';
import type { ID, Skill } from '../src/model';
import { defaultSkills } from '../src/skills';
import { collectStudy, STUDY_LIMITS } from '../src/study';
import type { SyncClientMsg, SyncServerMsg } from '../src/bridge/sync';
import { SYNC_LIMITS, validateSyncClientMsg, isSyncServerMsg, opFeature } from '../src/bridge/sync';
import { createVaultFolder, createVaultItem, createVaultPage, VAULT_LIMITS } from '../src/vault';

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
    expect(validateSyncClientMsg({ type: 'sync.skills', reqId: 'r1', extra: 1 })).toEqual({ type: 'sync.skills', reqId: 'r1' });
    expect(validateSyncClientMsg({ type: 'sync.skills' })).toBe(null);
    expect(isSyncServerMsg({ type: 'sync.skills', reqId: 'r1', skills: [], first: true, done: true })).toBe(true);
    expect(isSyncServerMsg({ type: 'sync.skills', skills: [], first: true, done: true })).toBe(false);
    expect(isSyncServerMsg({ type: 'sync.skills', reqId: 'r1', skills: [{ id: 'k1', name: 'Bad Name' }], first: true, done: true })).toBe(false);
    expect(isSyncServerMsg({ type: 'sync.skills', reqId: 'r1', skills: {}, first: true, done: true })).toBe(false);
  });
});

/** 호스트 1 + 피어 N 을 잇는 메모리 링크. 메시지는 비동기(매크로태스크)로 순서대로 전달된다 */
function createNet(host: () => SyncHost) {
  const peers = new Map<string, { connected: boolean; listeners: Set<(m: SyncServerMsg) => void>; gone: Set<() => void>; received: SyncServerMsg[]; sent: SyncClientMsg[]; dropActs: boolean; resets: number }>();

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
      const p = { connected: true, listeners: new Set<(m: SyncServerMsg) => void>(), gone: new Set<() => void>(), received: [] as SyncServerMsg[], sent: [] as SyncClientMsg[], dropActs: false, resets: 0 };
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
        reset() {
          p.resets++;
          // 실제 링크처럼 버린 연결의 끊김을 바로 알린다
          for (const cb of [...p.gone]) cb();
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
  let hostSkills: Skill[];
  const clients: SyncClient[] = [];

  const connectClient = async (peerId = 'p1', opts: { timeoutMs?: number; autoReconnect?: boolean } = {}) => {
    const store = makeClientStore();
    const peer = net.peer(peerId);
    const client = createSyncClient({
      store,
      link: peer.link,
      isPaired: async () => true,
      timeoutMs: opts.timeoutMs ?? 1000,
      backoff: { base: 20, max: 40 },
      ...(opts.autoReconnect === undefined ? {} : { autoReconnect: opts.autoReconnect }),
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
    hostSkills = defaultSkills(1);
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
      skills: async () => hostSkills,
    });
  });

  afterEach(() => {
    for (const c of clients.splice(0)) c.stop();
    host.dispose();
  });

  it('pullSkills: the client receives the PC skill list, paged by size', async () => {
    const { client } = await connectClient();
    expect((await client.pullSkills()).map((s) => s.name)).toEqual(['curriculum', 'book', 'quiz', 'speak', 'reorganize']);
    // 1MB 페이지 예산을 넘는 목록은 여러 페이지로 나눠 받아도 모두 모인다
    const big = (i: number): Skill => ({
      id: `k${i}`,
      name: `big-${i}`,
      title: `큰 스킬 ${i}`,
      description: '',
      prompt: 'p'.repeat(20000),
      files: [{ path: 'references/a.md', content: 'x'.repeat(40000) }, { path: 'references/b.md', content: 'y'.repeat(40000) }],
      createdAt: 1,
      updatedAt: 1,
    });
    hostSkills = Array.from({ length: 12 }, (_, i) => big(i));
    const list = await client.pullSkills();
    expect(list).toHaveLength(12);
    expect(list[11]!.files![1]!.content).toHaveLength(40000);
    // 개수 제한(100)을 넘는 PC 목록도 페이지를 나눠 모두 받는다
    hostSkills = Array.from({ length: 150 }, (_, i) => ({ ...big(i), prompt: 'p', files: [] }));
    expect(await client.pullSkills()).toHaveLength(150);
  });

  it('pullSkills ignores pages answering an older (timed-out) request', async () => {
    const { client, peer } = await connectClient();
    const pending = client.pullSkills();
    // 이전 요청의 남은 페이지가 늦게 도착해도 지금 요청의 결과가 되지 않는다
    for (const l of peer.state.listeners) l({ type: 'sync.skills', reqId: 'stale', skills: [], first: false, done: true });
    expect((await pending).map((s) => s.name)).toEqual(['curriculum', 'book', 'quiz', 'speak', 'reorganize']);
  });

  it('pullSkills fails when offline', async () => {
    const { client, peer } = await connectClient('p1', { autoReconnect: false });
    peer.disconnect();
    await until(() => client.state.getState().status === 'offline');
    await expect(client.pullSkills()).rejects.toThrow();
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

  it('free sub-session created on the client streams back (no anchor)', async () => {
    const { store } = await connectClient();
    store.getState().openSession(SEED_IDS.root);
    await settle();
    const id = store.getState().createSubSession(SEED_IDS.root, '고유값은 어디에 쓰여?') as ID;
    expect(id).toBeTruthy();
    expect(store.getState().sessions[id]!.anchor).toBeUndefined();
    expect(store.getState().messages[id]![0]!.content).toBe('고유값은 어디에 쓰여?');

    await until(() => !!hostStore.getState().sessions[id]);
    await idle(hostStore);
    await settle();
    const hs = hostStore.getState().sessions[id]!;
    expect(hs.parentId).toBe(SEED_IDS.root);
    expect(hs.anchor).toBeUndefined();
    expect(store.getState().messages[id]).toEqual(hostStore.getState().messages[id]);
    expect(store.getState().messages[id]!.length).toBe(2);
  });

  it('subsession op validation: empty question and unknown keys are rejected', () => {
    const op = { kind: 'subsession', id: 's-a', parentId: SEED_IDS.root, question: 'q', messageId: 'm-a' };
    expect(validateSyncClientMsg({ type: 'act', reqId: 'r', op })).toBeTruthy();
    expect(validateSyncClientMsg({ type: 'act', reqId: 'r', op: { ...op, question: '  ' } })).toBeNull();
    expect(validateSyncClientMsg({ type: 'act', reqId: 'r', op: { ...op, extra: 1 } })).toBeNull();
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

  it('remote page: create and edit converge on the PC; chat ops on a page are refused', async () => {
    const { store, client } = await connectClient();
    const id = store.getState().newPage() as ID;
    expect(store.getState().sessions[id]?.kind).toBe('page');
    await until(() => !!hostStore.getState().sessions[id]);
    expect(hostStore.getState().sessions[id]?.title).toBe('새 페이지');
    expect(store.getState().updatePage(id, '# 제목\n\n본문')).toBe(true);
    await until(() => hostStore.getState().messages[id]?.[0]?.content === '# 제목\n\n본문');
    await settle();
    expect(store.getState().messages[id]).toEqual(hostStore.getState().messages[id]);
    expect(store.getState().sendMessage(id, '질문')).toBe(false);
    expect(client.state.getState().lastFailure).toBeUndefined();
  });

  it('validates page.new / page.edit shapes', () => {
    const ok = (op: object) => !!validateSyncClientMsg({ type: 'act', reqId: 'r1', op });
    expect(ok({ kind: 'page.new', id: 's1', docId: 'm1' })).toBe(true);
    expect(ok({ kind: 'page.new', id: 's1', docId: 's1' })).toBe(false);
    expect(ok({ kind: 'page.new', id: 's1' })).toBe(false);
    expect(ok({ kind: 'page.new', id: 's1', docId: 'm1', extra: 1 })).toBe(false);
    expect(ok({ kind: 'page.edit', sessionId: 's1', content: '' })).toBe(true);
    expect(ok({ kind: 'page.edit', sessionId: 's1', content: 'x'.repeat(SYNC_LIMITS.text + 1) })).toBe(false);
    expect(ok({ kind: 'page.edit', sessionId: '../x', content: 'a' })).toBe(false);
  });

  it('validates subpage ops: page.new parentId and session.child', () => {
    const ok = (op: object) => !!validateSyncClientMsg({ type: 'act', reqId: 'r1', op });
    expect(ok({ kind: 'page.new', id: 's1', docId: 'm1', parentId: 's0' })).toBe(true);
    expect(ok({ kind: 'page.new', id: 's1', docId: 'm1', parentId: 's1' })).toBe(false);
    expect(ok({ kind: 'page.new', id: 's1', docId: 'm1', parentId: '../x' })).toBe(false);
    expect(ok({ kind: 'session.child', id: 's1', parentId: 's0' })).toBe(true);
    expect(ok({ kind: 'session.child', id: 's1', parentId: 's1' })).toBe(false);
    expect(ok({ kind: 'session.child', id: 's1' })).toBe(false);
    expect(ok({ kind: 'session.child', id: 's1', parentId: 's0', extra: 1 })).toBe(false);
    expect(opFeature({ kind: 'session.child', id: 's1', parentId: 's0' })).toBe('subpage');
    expect(opFeature({ kind: 'page.new', id: 's1', docId: 'm1', parentId: 's0' })).toBe('subpage');
    expect(opFeature({ kind: 'page.new', id: 's1', docId: 'm1' })).toBe('page');
  });

  it('remote subpages: child page, sub-session and parent link rename converge on the PC', async () => {
    const { store } = await connectClient();
    const parent = store.getState().newPage() as ID;
    await until(() => !!hostStore.getState().sessions[parent]);
    const child = store.getState().newPage(undefined, { parentId: parent, focus: false }) as ID;
    expect(child).toBeTruthy();
    expect(store.getState().sessions[child]).toMatchObject({ parentId: parent, rootId: store.getState().sessions[parent]!.rootId, kind: 'page' });
    await until(() => !!hostStore.getState().sessions[child]);
    expect(hostStore.getState().sessions[child]?.parentId).toBe(parent);

    const sub = store.getState().newSubSession(SEED_IDS.root, undefined, { focus: true }) as ID;
    expect(sub).toBeTruthy();
    expect(store.getState().view.activeSessionId).toBe(sub);
    await until(() => !!hostStore.getState().sessions[sub]);
    expect(hostStore.getState().sessions[sub]).toMatchObject({ parentId: SEED_IDS.root, title: '새 학습' });

    // 부모 페이지 본문의 링크를 이름 바꾸면 클라이언트·PC 양쪽 링크 글자가 바뀐다
    store.getState().updatePage(parent, `[옛 이름](#page:${child})`);
    store.getState().renameSession(child, '새 이름');
    expect(store.getState().messages[parent]?.[0]?.content).toBe(`[새 이름](#page:${child})`);
    await until(() => hostStore.getState().messages[parent]?.[0]?.content === `[새 이름](#page:${child})`);
  });

  it('subpage ops roll back when the PC does not answer', async () => {
    const { store, peer } = await connectClient('p1', { timeoutMs: 80 });
    peer.state.dropActs = true;
    const sub = store.getState().newSubSession(SEED_IDS.root, undefined, { focus: false }) as ID;
    const page = store.getState().newPage(undefined, { parentId: SEED_IDS.root, focus: false }) as ID;
    expect(store.getState().sessions[sub]).toBeDefined();
    expect(store.getState().sessions[page]).toBeDefined();
    await until(() => !store.getState().sessions[sub] && !store.getState().sessions[page]);
    expect(store.getState().newSubSession('s-missing-parent' as ID)).toBe(false);
  });

  it('subpage ops are refused as outdated on a PC without the subpage feature', async () => {
    const { store, client, peer } = await connectClient();
    const snap = peer.state.received.find((m) => m.type === 'sync.snapshot') as Extract<SyncServerMsg, { type: 'sync.snapshot' }>;
    for (const l of peer.state.listeners) l({ ...snap, features: ['subsession', 'vault', 'split', 'turns', 'websearch', 'page'] } as SyncServerMsg);
    const sent = peer.state.sent.length;
    const before = Object.keys(store.getState().sessions).length;
    expect(store.getState().newSubSession(SEED_IDS.root, undefined, { focus: false })).toBe(false);
    expect(store.getState().newPage(undefined, { parentId: SEED_IDS.root, focus: false })).toBe(false);
    expect(client.state.getState().lastFailure?.code).toBe('outdated');
    expect(Object.keys(store.getState().sessions).length).toBe(before);
    expect(peer.state.sent.length).toBe(sent);
  });

  it('host validates subpage ops: missing parent, bad ids, conflict', async () => {
    const out: SyncServerMsg[] = [];
    const raw = createSyncHost({ store: hostStore, hostName: () => 'pc', send: (_p, m) => out.push(m), throttleMs: 0 });
    const result = (reqId: string) => out.find((m) => m.type === 'act.result' && m.reqId === reqId) as Extract<SyncServerMsg, { type: 'act.result' }> | undefined;
    raw.receive('x', { type: 'sync.hello' });
    raw.receive('x', { type: 'act', reqId: 'c-nf', op: { kind: 'session.child', id: 's-c1', parentId: 's-nope' } });
    expect(result('c-nf')?.error).toBe('not-found');
    raw.receive('x', { type: 'act', reqId: 'c-self', op: { kind: 'session.child', id: 's-c2', parentId: 's-c2' } });
    expect(result('c-self')?.error).toBe('invalid');
    raw.receive('x', { type: 'act', reqId: 'p-nf', op: { kind: 'page.new', id: 's-c3', docId: 'm-c3', parentId: 's-nope' } });
    expect(result('p-nf')?.error).toBe('not-found');
    raw.receive('x', { type: 'act', reqId: 'c-dup', op: { kind: 'session.child', id: SEED_IDS.cos, parentId: SEED_IDS.root } });
    expect(result('c-dup')?.error).toBe('conflict');
    raw.receive('x', { type: 'act', reqId: 'c-ok', op: { kind: 'session.child', id: 's-c4', parentId: SEED_IDS.root } });
    expect(result('c-ok')?.ok).toBe(true);
    expect(hostStore.getState().sessions['s-c4']?.parentId).toBe(SEED_IDS.root);
    raw.dispose();
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

  it('remote question delete follows the PC delete setting and never deletes the first question', async () => {
    const { store, client } = await connectClient();
    store.getState().openSession(SEED_IDS.root);
    await until(() => !!client.state.getState().loaded[SEED_IDS.root]);
    const [q1, , q2] = store.getState().messages[SEED_IDS.root]!;
    expect(store.getState().deleteTurn(SEED_IDS.root, q1!.id)).toBe(false);

    expect(store.getState().deleteTurn(SEED_IDS.root, q2!.id)).toBe(true);
    await until(() => client.state.getState().lastFailure?.code === 'forbidden');
    expect(hostStore.getState().messages[SEED_IDS.root]!.some((m) => m.id === q2!.id)).toBe(true);

    allowDelete = true;
    store.getState().deleteTurn(SEED_IDS.root, q2!.id);
    await until(() => !store.getState().messages[SEED_IDS.root]!.some((m) => m.id === q2!.id));
    expect(hostStore.getState().messages[SEED_IDS.root]!.some((m) => m.id === q2!.id)).toBe(false);
  });

  it('remote question split moves the turn into a new sub-session on the PC; never the first question', async () => {
    const { store, client } = await connectClient();
    store.getState().openSession(SEED_IDS.root);
    await until(() => !!client.state.getState().loaded[SEED_IDS.root]);
    const [q1, , q2] = store.getState().messages[SEED_IDS.root]!;
    expect(store.getState().splitTurn(SEED_IDS.root, q1!.id)).toBe(false);

    // 삭제 권한 없이도 분리할 수 있다 (메시지를 지우지 않는다)
    const id = store.getState().splitTurn(SEED_IDS.root, q2!.id);
    expect(id).toBeTruthy();
    await until(() => !!hostStore.getState().sessions[id as string]);
    const child = hostStore.getState().sessions[id as string]!;
    expect(child.parentId).toBe(SEED_IDS.root);
    expect(child.anchor).toBeUndefined();
    expect(hostStore.getState().messages[id as string]![0]!.id).toBe(q2!.id);
    expect(hostStore.getState().messages[SEED_IDS.root]!.some((m) => m.id === q2!.id)).toBe(false);
    // 클라이언트도 새 세션과 옮겨진 메시지를 받는다
    await until(() => store.getState().messages[id as string]?.[0]?.id === q2!.id);
    expect(store.getState().messages[SEED_IDS.root]!.some((m) => m.id === q2!.id)).toBe(false);
    expect(client.state.getState().lastFailure).toBeUndefined();
  });

  it('remote sibling split, move and reorganize run on the PC', async () => {
    const { store, client } = await connectClient();
    store.getState().openSession(SEED_IDS.root);
    await until(() => !!client.state.getState().loaded[SEED_IDS.root]);
    const [, , q2, , q3] = store.getState().messages[SEED_IDS.root]!;

    // 같은 레벨로 분리: 루트면 새 루트
    const id = store.getState().splitTurn(SEED_IDS.root, q2!.id, undefined, { sibling: true }) as string;
    expect(id).toBeTruthy();
    await until(() => !!hostStore.getState().sessions[id]);
    expect(hostStore.getState().sessions[id]).toMatchObject({ parentId: null, rootId: id });
    await until(() => store.getState().messages[id]?.[0]?.id === q2!.id);

    // 다른 세션으로 옮기기 (삭제 권한 불필요)
    expect(store.getState().moveTurn(SEED_IDS.root, q3!.id, SEED_IDS.root)).toBe(false);
    expect(store.getState().moveTurn(SEED_IDS.root, q3!.id, SEED_IDS.backprop)).toBe(true);
    await until(() => hostStore.getState().messages[SEED_IDS.backprop]!.some((m) => m.id === q3!.id));
    await until(() => !store.getState().messages[SEED_IDS.root]!.some((m) => m.id === q3!.id));

    // 재정리는 원본 메시지를 지우므로 삭제 권한이 있어야 한다
    expect(store.getState().reorganizeSession(SEED_IDS.root)).toBe(true);
    await until(() => client.state.getState().lastFailure?.code === 'forbidden');
    allowDelete = true;
    expect(store.getState().reorganizeSession(SEED_IDS.root)).toBe(true);
    await until(() => hostStore.getState().messages[SEED_IDS.root]!.length === 2 && !hostStore.getState().streaming[SEED_IDS.root]);
    await until(() => store.getState().messages[SEED_IDS.root]!.length === 2 && !store.getState().streaming[SEED_IDS.root]);
    expect(hostStore.getState().sessions[SEED_IDS.qkv]!.anchor).toBeUndefined();
    await until(() => !store.getState().sessions[SEED_IDS.qkv]!.anchor);
  });

  it('validates turn.splitOut / turn.move / session.reorganize shapes', () => {
    const act = (op: unknown) => validateSyncClientMsg({ type: 'act', reqId: 'r', op });
    expect(act({ kind: 'turn.splitOut', sessionId: 's1', questionId: 'm1', id: 's2' })).toBeTruthy();
    expect(act({ kind: 'turn.splitOut', sessionId: 's1', questionId: 'm1', id: 's2', x: 1 })).toBeNull();
    expect(act({ kind: 'turn.move', sessionId: 's1', questionId: 'm1', targetId: 's2' })).toBeTruthy();
    expect(act({ kind: 'turn.move', sessionId: 's1', questionId: 'm1' })).toBeNull();
    expect(act({ kind: 'session.reorganize', sessionId: 's1' })).toBeTruthy();
    expect(act({ kind: 'session.reorganize', sessionId: 's1', skill: { id: 1 } })).toBeNull();
  });

  it('study.import: a remote client brings a study into the PC; overwriting needs the delete permission', async () => {
    const bundle = JSON.parse(JSON.stringify(collectStudy(hostStore.getState(), SEED_IDS.root)!)) as NonNullable<ReturnType<typeof collectStudy>>;
    const ids = bundle.sessions.map((s) => s.id);
    hostStore.getState().deleteSession(SEED_IDS.root);
    expect(ids.some((id) => hostStore.getState().sessions[id])).toBe(false);

    const { store, client } = await connectClient();
    // 새 학습 추가는 삭제 권한 없이도 된다
    await client.importStudy(bundle);
    await until(() => ids.every((id) => !!store.getState().sessions[id]));
    expect(ids.every((id) => !!hostStore.getState().sessions[id])).toBe(true);
    expect(hostStore.getState().messages[SEED_IDS.root]).toEqual(bundle.messages.filter((m) => m.sessionId === SEED_IDS.root));
    // 실패 토스트로 새지 않는다
    expect(client.state.getState().lastFailure).toBeUndefined();

    // 이미 있는 세션을 덮어쓰려면 삭제 권한이 필요하다
    const newer = JSON.parse(JSON.stringify(bundle)) as typeof bundle;
    newer.sessions[0]!.updatedAt = Date.now() + 60_000;
    newer.sessions[0]!.title = '다른 기기에서 고친 제목';
    await expect(client.importStudy(newer)).rejects.toThrow('forbidden');
    expect(hostStore.getState().sessions[SEED_IDS.root]!.title).not.toBe('다른 기기에서 고친 제목');
    allowDelete = true;
    await client.importStudy(newer);
    await until(() => store.getState().sessions[SEED_IDS.root]?.title === '다른 기기에서 고친 제목');
    expect(hostStore.getState().sessions[SEED_IDS.root]!.title).toBe('다른 기기에서 고친 제목');
  });

  it('study.import: validators reject malformed or oversized bundles', async () => {
    const bundle = collectStudy(hostStore.getState(), SEED_IDS.root)!;
    const act = (op: Record<string, unknown>) => validateSyncClientMsg({ type: 'act', reqId: 'r', op });
    expect(act({ kind: 'study.import', bundle })).toBeTruthy();
    expect(act({ kind: 'study.import', bundle, extra: 1 })).toBe(null);
    expect(act({ kind: 'study.import', bundle: { ...bundle, app: 'x' } })).toBe(null);
    expect(act({ kind: 'study.import', bundle: { ...bundle, rootId: 's-nope' } })).toBe(null);
    const huge = { ...bundle, messages: bundle.messages.map((m, i) => (i === 0 ? { ...m, content: 'x'.repeat(STUDY_LIMITS.remoteChars) } : m)) };
    expect(act({ kind: 'study.import', bundle: huge })).toBe(null);
    // 같은 id를 다른 학습이 쓰고 있으면 conflict
    const { client } = await connectClient();
    const clash = JSON.parse(JSON.stringify(bundle)) as typeof bundle;
    clash.rootId = 's-other-root';
    clash.sessions[0] = { ...clash.sessions[0]!, id: 's-other-root' };
    for (const s of clash.sessions) {
      s.rootId = 's-other-root';
      if (s.parentId === SEED_IDS.root) s.parentId = 's-other-root';
    }
    for (const m of clash.messages) if (m.sessionId === SEED_IDS.root) m.sessionId = 's-other-root';
    await expect(client.importStudy(clash)).rejects.toThrow('conflict');
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
    // page.edit은 페이지 세션에만
    raw.receive('x', { type: 'act', reqId: 'pg', op: { kind: 'page.edit', sessionId: SEED_IDS.root, content: 'x' } });
    expect(result('pg')?.error).toBe('invalid');
    raw.receive('x', { type: 'act', reqId: 'pgdup', op: { kind: 'page.new', id: 's-page', docId: SEED_IDS.cos } });
    expect(result('pgdup')?.error).toBe('conflict');

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

  it('autoReconnect: false → stays offline until reconnect() is called', async () => {
    const { store, client, peer } = await connectClient('p1', { autoReconnect: false });
    peer.disconnect();
    expect(client.state.getState().status).toBe('offline');
    peer.connect();
    await new Promise((r) => setTimeout(r, 120));
    expect(client.state.getState().status).toBe('offline');

    client.reconnect();
    await until(() => client.state.getState().status === 'online');
    expect(store.getState().sessions[SEED_IDS.root]).toBeTruthy();
  });

  it('resume(): offline → reconnects once without autoReconnect', async () => {
    const { client, peer } = await connectClient('p1', { autoReconnect: false });
    peer.disconnect();
    peer.connect();
    client.resume();
    expect(client.state.getState().status).toBe('connecting');
    await until(() => client.state.getState().status === 'online');
    expect(client.state.getState().resumeFailedAt).toBeUndefined();
  });

  it('resume(): the single retry fails → offline with resumeFailedAt, no further attempts', async () => {
    const { client, peer } = await connectClient('p1', { autoReconnect: false });
    peer.disconnect();
    client.resume();
    await until(() => client.state.getState().status === 'offline');
    expect(client.state.getState().resumeFailedAt).toBeTypeOf('number');
    const hellos = peer.state.sent.filter((m) => m.type === 'sync.hello').length;
    peer.connect();
    await new Promise((r) => setTimeout(r, 120));
    expect(client.state.getState().status).toBe('offline');
    expect(peer.state.sent.filter((m) => m.type === 'sync.hello').length).toBe(hellos);
  });

  it('resume() while online: a disconnect within the grace period reconnects once', async () => {
    const { client, peer } = await connectClient('p1', { autoReconnect: false });
    client.resume();
    expect(client.state.getState().status).toBe('online');
    peer.disconnect();
    expect(client.state.getState().status).toBe('connecting');
    peer.connect();
    await until(() => client.state.getState().status === 'online');
    // 유예는 한 번만 — 다음 끊김은 offline에 머문다
    peer.disconnect();
    expect(client.state.getState().status).toBe('offline');
    expect(client.state.getState().resumeFailedAt).toBeUndefined();
  });

  it('resume({ fresh }) while online: resets the link and resyncs', async () => {
    const { client, peer } = await connectClient('p1', { autoReconnect: false });
    const hellos = peer.state.sent.filter((m) => m.type === 'sync.hello').length;
    client.resume({ fresh: true });
    expect(peer.state.resets).toBe(1);
    await until(() => peer.state.sent.filter((m) => m.type === 'sync.hello').length === hellos + 1);
    await until(() => client.state.getState().status === 'online');
    await new Promise((r) => setTimeout(r, 30));
    expect(client.state.getState().status).toBe('online');
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

  it('session.agent: the remote picks the PC CLI, model and effort for a session', async () => {
    const { store } = await connectClient();
    store.getState().setSessionProvider(SEED_IDS.root, 'codex-cli');
    await until(() => hostStore.getState().sessions[SEED_IDS.root]!.providerId === 'codex-cli');
    store.getState().setSessionModel(SEED_IDS.root, { model: 'gpt-6-luna', effort: 'ultra' });
    await until(() => hostStore.getState().sessions[SEED_IDS.root]!.modelPref?.model === 'gpt-6-luna');
    // luna는 ultra를 지원하지 않아 PC 스토어가 버린다
    expect(hostStore.getState().sessions[SEED_IDS.root]!.modelPref).toEqual({ providerId: 'codex-cli', model: 'gpt-6-luna' });
    await until(() => store.getState().sessions[SEED_IDS.root]!.modelPref?.model === 'gpt-6-luna');
    // 다른 CLI로 바꾸면 모델 덮어쓰기는 버린다, null은 PC 기본값
    store.getState().setSessionProvider(SEED_IDS.root, 'claude-cli');
    await until(() => hostStore.getState().sessions[SEED_IDS.root]!.providerId === 'claude-cli');
    expect(hostStore.getState().sessions[SEED_IDS.root]!.modelPref).toBeUndefined();
    store.getState().setSessionProvider(SEED_IDS.root, undefined);
    await until(() => hostStore.getState().sessions[SEED_IDS.root]!.providerId === undefined);
    // API provider는 원격에서 고를 수 없다
    store.getState().setSessionProvider(SEED_IDS.root, 'anthropic-api');
    await settle();
    expect(hostStore.getState().sessions[SEED_IDS.root]!.providerId).toBeUndefined();
  });

  it('session.agent validation rejects unknown providers and bad model names', () => {
    const op = (o: Record<string, unknown>) => validateSyncClientMsg({ type: 'act', reqId: 'r', op: { kind: 'session.agent', sessionId: 's1', ...o } });
    expect(op({ providerId: 'claude-cli', model: 'opus', effort: 'high' })).not.toBeNull();
    expect(op({ providerId: null, model: null, effort: null })).not.toBeNull();
    expect(op({})).toBeNull();
    expect(op({ providerId: 'anthropic-api' })).toBeNull();
    expect(op({ model: '--dangerous' })).toBeNull();
    expect(op({ effort: 'HIGH; rm' })).toBeNull();
    expect(op({ model: 'opus', extra: 1 })).toBeNull();
  });

  it('stop() restores the local store actions', async () => {
    const { store, client } = await connectClient();
    const remoteSend = store.getState().sendMessage;
    client.stop();
    expect(store.getState().sendMessage).not.toBe(remoteSend);
    expect(client.state.getState().status).toBe('unpaired');
  });

  it('annotation add on client syncs to host via annot.set', async () => {
    const { store, peer } = await connectClient();
    const msg = hostStore.getState().messages[SEED_IDS.root]![1]!;
    const anchor = { messageId: msg.id, text: 'test', startOffset: 0, endOffset: 4 };
    const id = store.getState().addAnnotation(SEED_IDS.root, anchor, { highlight: 'yellow', note: 'note1' }) as ID;
    expect(id).toBeTruthy();
    expect(store.getState().annotations[id]!.note).toBe('note1');
    await until(() => !!hostStore.getState().annotations[id]);
    expect(hostStore.getState().annotations[id]).toEqual(store.getState().annotations[id]);
    expect(peer.state.sent.some((m) => m.type === 'act' && 'op' in m && m.op.kind === 'annot.set')).toBe(true);
  });

  it('annotation update via putAnnotation keeps createdAt', async () => {
    await connectClient();
    const msg = hostStore.getState().messages[SEED_IDS.root]![1]!;
    const anchor = { messageId: msg.id, text: 'test', startOffset: 0, endOffset: 4 };
    const createdAt = Date.now() - 5000;
    const id = 'a-upsert-test';
    // 호스트에 annotation을 직접 저장 (오래된 createdAt)
    hostStore.getState().putAnnotation({
      id,
      sessionId: SEED_IDS.root,
      anchor,
      highlight: 'yellow',
      createdAt,
      updatedAt: createdAt,
    });
    // 같은 id로 업데이트 (putAnnotation은 createdAt을 유지해야 함)
    const before = hostStore.getState().annotations[id]!.createdAt;
    const newUpdatedAt = Date.now();
    hostStore.getState().putAnnotation({
      id,
      sessionId: SEED_IDS.root,
      anchor,
      highlight: 'yellow',
      underline: 'blue',
      createdAt,
      updatedAt: newUpdatedAt,
    });
    const after = hostStore.getState().annotations[id]!.createdAt;
    expect(after).toBe(before);
  });

  it('annotation delete on client propagates to host', async () => {
    const { store, peer } = await connectClient();
    const msg = hostStore.getState().messages[SEED_IDS.root]![1]!;
    const anchor = { messageId: msg.id, text: 'test', startOffset: 0, endOffset: 4 };
    const id = store.getState().addAnnotation(SEED_IDS.root, anchor, { highlight: 'yellow' }) as ID;
    await until(() => !!hostStore.getState().annotations[id]);
    peer.state.sent.length = 0;

    store.getState().deleteAnnotations([id]);
    expect(store.getState().annotations[id]).toBeUndefined();
    await until(() => !hostStore.getState().annotations[id]);
    expect(peer.state.sent.some((m) => m.type === 'act' && 'op' in m && m.op.kind === 'annot.delete')).toBe(true);
  });

  it('annotation ops roll back when offline or rejected by the host', async () => {
    const { store, client, peer } = await connectClient();
    const msg = hostStore.getState().messages[SEED_IDS.root]!.find((m) => m.role === 'assistant')!;
    const anchor = { messageId: msg.id, text: 'test', startOffset: 0, endOffset: 4 };
    const id = store.getState().addAnnotation(SEED_IDS.root, anchor, { highlight: 'yellow' }) as ID;
    await until(() => !!hostStore.getState().annotations[id]);

    peer.state.connected = false;
    expect(store.getState().addAnnotation(SEED_IDS.root, anchor, { bold: true })).toBe('');
    store.getState().updateAnnotation(id, { highlight: 'red' });
    store.getState().deleteAnnotations([id]);
    expect(client.state.getState().lastFailure?.code).toBe('offline');
    expect(Object.keys(store.getState().annotations)).toEqual([id]);
    expect(store.getState().annotations[id]!.highlight).toBe('yellow');

    // 범위를 벗어난 offset은 호스트가 거부 → 낙관적 추가가 되돌려진다
    peer.state.connected = true;
    const bad = { ...anchor, endOffset: msg.content.length + 10 };
    const badId = store.getState().addAnnotation(SEED_IDS.root, bad, { bold: true }) as ID;
    expect(store.getState().annotations[badId]).toBeTruthy();
    await until(() => !store.getState().annotations[badId]);
    expect(hostStore.getState().annotations[badId]).toBeUndefined();
  });

  it('snapshot marks drafts as loaded-empty and pushes their first turn (ADR-074)', async () => {
    const draft = hostStore.getState().newRootSession('s-draft', { focus: false }) as ID;
    const { store, peer } = await connectClient();
    const snap = peer.state.received.find((m) => m.type === 'sync.snapshot');
    expect(snap && 'drafts' in snap && snap.drafts).toEqual([draft]);
    // 원격에서도 초안은 빈 대화로 보여 목록에서 숨는다
    expect(store.getState().messages[draft]).toEqual([]);

    // PC에서 첫 질문을 보내면 원격에도 밀려온다
    hostStore.getState().sendMessage(draft, '안녕');
    await until(() => !!store.getState().messages[draft]?.some((m) => m.role === 'user'));
  });

  it('snapshot contains annotations', async () => {
    const msg = hostStore.getState().messages[SEED_IDS.root]![1]!;
    const anchor = { messageId: msg.id, text: 'test', startOffset: 0, endOffset: 4 };
    hostStore.getState().addAnnotation(SEED_IDS.root, anchor, { highlight: 'blue' }, 'a-snap-1');
    hostStore.getState().addAnnotation(SEED_IDS.root, anchor, { highlight: 'green' }, 'a-snap-2');

    const { store, peer } = await connectClient();
    const receivedSnapshot = peer.state.received.find((m) => m.type === 'sync.snapshot');
    expect(receivedSnapshot).toBeTruthy();
    if (receivedSnapshot && 'annotations' in receivedSnapshot) {
      expect(receivedSnapshot.annotations).toContainEqual(hostStore.getState().annotations['a-snap-1']!);
      expect(receivedSnapshot.annotations).toContainEqual(hostStore.getState().annotations['a-snap-2']!);
    }
    expect(store.getState().annotations['a-snap-1']).toEqual(hostStore.getState().annotations['a-snap-1']!);
    expect(store.getState().annotations['a-snap-2']).toEqual(hostStore.getState().annotations['a-snap-2']!);
  });

  it('session delete cascades to remove annotations', async () => {
    const { store } = await connectClient();
    store.getState().openSession(SEED_IDS.scale);
    await settle();
    const msg = hostStore.getState().messages[SEED_IDS.scale]!.find((m) => m.role === 'assistant')!;
    const anchor = { messageId: msg.id, text: 'test', startOffset: 0, endOffset: 4 };
    const id = store.getState().addAnnotation(SEED_IDS.scale, anchor, { highlight: 'yellow' }) as ID;
    await until(() => !!hostStore.getState().annotations[id]);

    hostStore.getState().deleteSession(SEED_IDS.scale);
    await settle();
    expect(store.getState().annotations[id]).toBeUndefined();
  });

  it('vault: snapshot is followed by paged sync.vault; client edits round-trip and folder delete cascades', async () => {
    const t = Date.now();
    hostStore.getState().putVaultNode(createVaultFolder('vf1', null, '단어', t));
    hostStore.getState().putVaultNode(createVaultItem('vi1', 'vf1', '인사', { type: 'text', text: 'xin chào' }, undefined, t));

    const { store, peer } = await connectClient();
    await until(() => !!store.getState().vault.vi1);
    const snap = peer.state.received.find((m) => m.type === 'sync.snapshot');
    expect(snap && 'vault' in snap).toBe(false);
    expect(peer.state.received.some((m) => m.type === 'sync.vault' && 'nodes' in m && m.first && m.done)).toBe(true);

    // 클라이언트에서 페이지 만들기 → 호스트에 반영
    store.getState().putVaultNode(createVaultPage('vp1', 'vf1', '정리', t));
    await until(() => !!hostStore.getState().vault.vp1);

    // 호스트에서 바뀐 노드는 클라이언트로 밀려온다
    hostStore.getState().putVaultNode(createVaultItem('vi2', null, '새 항목', { type: 'audio', text: 'cảm ơn', lang: 'vi' }, undefined, t));
    await until(() => !!store.getState().vault.vi2);

    // 폴더를 지우면 안의 노드도 함께 지워진다
    store.getState().deleteVaultNodes(['vf1']);
    expect(Object.keys(store.getState().vault)).toEqual(['vi2']);
    await until(() => Object.keys(hostStore.getState().vault).length === 1);
    expect(hostStore.getState().vault.vi2).toBeTruthy();
  });

  it('host features: new ops are blocked or explained as outdated on an older PC', async () => {
    const { store, client, peer } = await connectClient();
    const snap = peer.state.received.find((m) => m.type === 'sync.snapshot');
    expect(snap && 'features' in snap && snap.features).toEqual(['subsession', 'vault', 'split', 'turns', 'websearch', 'page', 'subpage']);
    const inject = (m: SyncServerMsg) => {
      for (const l of peer.state.listeners) l(m);
    };
    const t = Date.now();

    // 기능 목록에 없는 기능은 보내지 않고 바로 'outdated'
    inject({ ...snap!, features: ['subsession'] } as SyncServerMsg);
    const sent = peer.state.sent.length;
    store.getState().putVaultNode(createVaultFolder('vf-x', null, '새', t));
    expect(client.state.getState().lastFailure?.code).toBe('outdated');
    expect(store.getState().vault['vf-x']).toBeUndefined();
    expect(peer.state.sent.length).toBe(sent);
    // 웹 검색 토글도 옛 호스트에는 보내지 않는다 (ADR-070)
    const sid = Object.keys(store.getState().sessions)[0]!;
    store.getState().setSessionWebSearch(sid, false);
    expect(client.state.getState().lastFailure?.code).toBe('outdated');
    expect(store.getState().sessions[sid]!.webSearch).toBeUndefined();
    expect(peer.state.sent.length).toBe(sent);

    // 목록을 보내지 않는 옛 호스트: 보내 보고, 모른다('invalid')고 하면 'outdated'
    const { features: _drop, ...old } = snap as Extract<SyncServerMsg, { type: 'sync.snapshot' }>;
    inject(old as SyncServerMsg);
    peer.state.dropActs = true;
    store.getState().putVaultNode(createVaultFolder('vf-y', null, '새', t));
    const act = peer.state.sent.at(-1);
    expect(act?.type).toBe('act');
    inject({ type: 'act.result', reqId: (act as Extract<SyncClientMsg, { type: 'act' }>).reqId, ok: false, error: 'invalid' });
    expect(client.state.getState().lastFailure?.code).toBe('outdated');
    expect(store.getState().vault['vf-y']).toBeUndefined();
  });

  it('vault ops are validated by the host and roll back when rejected', async () => {
    const { store } = await connectClient();
    const t = Date.now();
    // 없는 폴더 안에 넣기 → not-found → 되돌림
    store.getState().putVaultNode(createVaultFolder('vf-orphan', 'missing', '고아', t));
    expect(store.getState().vault['vf-orphan']).toBeTruthy();
    await until(() => !store.getState().vault['vf-orphan']);

    // 폴더를 자기 하위로 옮기기 → invalid
    hostStore.getState().putVaultNode(createVaultFolder('va', null, 'A', t));
    hostStore.getState().putVaultNode(createVaultFolder('vb', 'va', 'B', t));
    await until(() => !!store.getState().vault.vb);
    store.getState().putVaultNode({ ...store.getState().vault.va!, parentId: 'vb' });
    await until(() => store.getState().vault.va!.parentId === null);
    expect(hostStore.getState().vault.va!.parentId).toBeNull();

    // 형식 검증: 알 수 없는 필드·빈 이름·너무 긴 글은 거부
    const ok = createVaultItem('vx', null, '글', { type: 'text', text: 'a' }, undefined, t);
    expect(validateSyncClientMsg({ type: 'act', reqId: 'r1', op: { kind: 'vault.put', node: ok } })).toBeTruthy();
    for (const node of [{ ...ok, extra: 1 }, { ...ok, name: ' ' }, { ...ok, item: { type: 'text', text: 'a'.repeat(VAULT_LIMITS.text + 1) } }]) {
      expect(validateSyncClientMsg({ type: 'act', reqId: 'r1', op: { kind: 'vault.put', node } })).toBeNull();
    }
    expect(validateSyncClientMsg({ type: 'act', reqId: 'r1', op: { kind: 'vault.delete', ids: [] } })).toBeNull();
  });

  it('new annotations made on the PC are pushed to peers', async () => {
    const { store } = await connectClient();
    const msg = hostStore.getState().messages[SEED_IDS.root]!.find((m) => m.role === 'assistant')!;
    const anchor = { messageId: msg.id, text: 'test', startOffset: 0, endOffset: 4 };
    const id = hostStore.getState().addAnnotation(SEED_IDS.root, anchor, { highlight: 'blue' }) as ID;
    await until(() => !!store.getState().annotations[id]);
  });
});
