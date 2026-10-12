import { beforeEach, describe, expect, it } from 'vitest';
import { createSeed, emptyView, SEED_IDS } from '../src/seed';
import { createAppStore, nextFallback, type AppStore } from '../src/store';
import { createDemoRegistry } from '../src/providers/demo';
import { mockControl } from '../src/providers/mock';
import { ProviderRegistry, providerError } from '../src/provider';

const idle = (store: AppStore) =>
  new Promise<void>((resolve) => {
    const check = () => (Object.keys(store.getState().streaming).length === 0 ? resolve() : setTimeout(check, 5));
    setTimeout(check, 5);
  });

function makeStore() {
  const store: AppStore = createAppStore({
    registry: createDemoRegistry(() => store.getState().connections),
    initial: { ...createSeed(0), view: emptyView(SEED_IDS.root) },
  });
  return store;
}

describe('app store', () => {
  beforeEach(() => {
    mockControl.firstTokenDelay = 0;
    mockControl.speed = 0;
    mockControl.failNext = false;
  });

  it('creates a branch with an automatic first question and streamed answer', async () => {
    const store = makeStore();
    const parentMsg = store.getState().messages[SEED_IDS.root]![1]!;
    const id = store.getState().createBranch(
      SEED_IDS.root,
      { messageId: parentMsg.id, text: '가중합', startOffset: parentMsg.content.indexOf('가중합'), endOffset: parentMsg.content.indexOf('가중합') + 3 },
      'what',
    ) as string;
    await idle(store);
    const s = store.getState();
    expect(s.sessions[id]!.parentId).toBe(SEED_IDS.root);
    const msgs = s.messages[id]!;
    expect(msgs[0]!.content).toBe('"가중합"이(가) 뭐야?');
    expect(msgs[1]!.status).toBe('done');
    expect(msgs[1]!.content.length).toBeGreaterThan(10);
  });

  it('marks offline providers as error and retries with a fallback', async () => {
    const store = makeStore();
    store.getState().setConnection('mock', { status: 'offline' });
    store.getState().sendMessage(SEED_IDS.scale, '왜 하필 루트야?');
    await idle(store);
    const last = store.getState().messages[SEED_IDS.scale]!.at(-1)!;
    expect(last.status).toBe('error');
    expect(last.error?.code).toBe('offline');
    const fb = nextFallback(store.getState(), 'mock');
    expect(fb).toBe('anthropic-api');
    store.getState().retry(SEED_IDS.scale, fb!);
    await idle(store);
    const retried = store.getState().messages[SEED_IDS.scale]!.at(-1)!;
    expect(retried.status).toBe('done');
    expect(retried.providerId).toBe('anthropic-api');
  });

  it('generates and attaches a summary', async () => {
    const store = makeStore();
    await store.getState().requestSummary(SEED_IDS.scale);
    expect(store.getState().summaryDrafts[SEED_IDS.scale]?.status).toBe('ready');
    store.getState().attachSummary(SEED_IDS.scale);
    expect(store.getState().sessions[SEED_IDS.scale]!.summary).toBeTruthy();
    expect(store.getState().summaryDrafts[SEED_IDS.scale]).toBeUndefined();
  });

  it('split view holds at most 3 panels and collapses to single', () => {
    const store = makeStore();
    const { openSession } = store.getState();
    openSession(SEED_IDS.qkv, 'split');
    openSession(SEED_IDS.dot, 'split');
    openSession(SEED_IDS.cos, 'split');
    let v = store.getState().view;
    expect(v.mode).toBe('split');
    expect(v.splitSessionIds).toEqual([SEED_IDS.root, SEED_IDS.qkv, SEED_IDS.cos]);
    store.getState().closeSplit(0);
    store.getState().closeSplit(0);
    v = store.getState().view;
    expect(v.mode).toBe('single');
    expect(v.activeSessionId).toBe(SEED_IDS.cos);
  });

  it('popups stack and dock into split', () => {
    const store = makeStore();
    store.getState().openSession(SEED_IDS.qkv, 'popup');
    store.getState().openSession(SEED_IDS.dot, 'popup');
    const [a, b] = store.getState().view.popups;
    expect(b!.z).toBeGreaterThan(a!.z);
    store.getState().dockPopup(a!.id);
    const v = store.getState().view;
    expect(v.popups).toHaveLength(1);
    expect(v.splitSessionIds).toContain(SEED_IDS.qkv);
  });

  it('new root session gets an auto title after the first reply', async () => {
    const store = makeStore();
    const id = store.getState().newRootSession() as string;
    store.getState().sendMessage(id, '어텐션을 쉽게 알려줘');
    await idle(store);
    await new Promise((r) => setTimeout(r, 30));
    expect(store.getState().sessions[id]!.title).toBe('트랜스포머 어텐션');
  });

  it('deleting a session removes its subtree', () => {
    const store = makeStore();
    store.getState().openSession(SEED_IDS.cos, 'popup');
    store.getState().deleteSession(SEED_IDS.qkv);
    const s = store.getState();
    expect(s.sessions[SEED_IDS.dot]).toBeUndefined();
    expect(s.view.popups).toHaveLength(0);
  });
});

describe('store × 실제 provider 흐름', () => {
  it('refreshConnections는 available() 결과로 상태를 채우고 enabled를 보존한다', async () => {
    const registry = new ProviderRegistry();
    registry.register({ id: 'anthropic-api', label: 'A', available: async () => ({ status: 'no-key' }), async *stream() {} });
    registry.register({
      id: 'openai-api',
      label: 'O',
      available: async () => {
        throw new Error('boom');
      },
      async *stream() {},
    });
    const store = createAppStore({ registry, initial: { ...createSeed(0), view: emptyView(SEED_IDS.root) } });
    store.getState().setConnection('openai-api', { enabled: false });
    await store.getState().refreshConnections();
    const c = store.getState().connections;
    expect(c['anthropic-api'].status).toBe('no-key');
    expect(c['openai-api']).toMatchObject({ status: 'offline', detail: 'boom', enabled: false });
  });

  it('요약 재요청 시 이전 응답이 초안을 덮어쓰지 않고, 에러 시 부분 텍스트를 보존한다', async () => {
    let call = 0;
    const gates: (() => void)[] = [];
    const registry = new ProviderRegistry();
    registry.register({
      id: 'mock',
      label: 'M',
      available: async () => ({ status: 'ready' }),
      async *stream(req) {
        const n = ++call;
        await new Promise<void>((r) => gates.push(r));
        if (req.signal?.aborted) return;
        if (n === 1) yield { type: 'delta', text: '오래된 요약' };
        if (n === 2) {
          yield { type: 'delta', text: '새 요약 일부' };
          yield { type: 'error', error: providerError('network', '끊김') };
          return;
        }
        yield { type: 'done' };
      },
    });
    const store = createAppStore({ registry, initial: { ...createSeed(0), view: emptyView(SEED_IDS.root) } });
    const first = store.getState().requestSummary(SEED_IDS.scale);
    await new Promise((r) => setTimeout(r, 0));
    const second = store.getState().requestSummary(SEED_IDS.scale);
    await new Promise((r) => setTimeout(r, 0));
    gates[0]!();
    gates[1]!();
    await Promise.all([first, second]);
    const d = store.getState().summaryDrafts[SEED_IDS.scale]!;
    expect(d.status).toBe('error');
    expect(d.text).toBe('새 요약 일부');
    expect(d.text).not.toContain('오래된');
  });
});
