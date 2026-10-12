import 'fake-indexeddb/auto';
import {
  createAppStore,
  createDemoRegistry,
  createSeed,
  emptyView,
  mockControl,
  restoreData,
  SEED_IDS,
  toStoredData,
  type AppStore,
} from '@branch/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { BranchDB, createDexieRepository, type DexieRepository } from '../src/persist/db';
import { hydrate } from '../src/persist/hydrate';

let n = 0;
const freshRepo = () => createDexieRepository(new BranchDB(`test-${++n}`));

const idle = (store: AppStore) =>
  new Promise<void>((resolve) => {
    const check = () => (Object.keys(store.getState().streaming).length === 0 ? resolve() : setTimeout(check, 5));
    setTimeout(check, 5);
  });

/** 시드 데이터가 저장된 DB (첫 실행은 비어 있으므로 테스트용으로 직접 채운다) */
async function seededRepo() {
  const repo = freshRepo();
  const { data } = await hydrate(repo);
  await repo.replaceAll(toStoredData({ ...data, ...createSeed(), view: emptyView(SEED_IDS.root) }));
  return repo;
}

async function boot(repo: DexieRepository) {
  const { data } = await hydrate(repo);
  const store: AppStore = createAppStore({
    registry: createDemoRegistry(() => store.getState().connections),
    repo,
    initial: data,
  });
  return store;
}

/** "새로고침": 같은 DB로 스토어를 새로 만든다 */
async function reload(repo: DexieRepository) {
  await repo.flush();
  return boot(repo);
}

describe('Dexie persistence', () => {
  beforeEach(() => {
    mockControl.firstTokenDelay = 0;
    mockControl.speed = 0;
    mockControl.failNext = false;
  });

  it('starts with no example sessions on first run', async () => {
    const repo = freshRepo();
    const { data } = await hydrate(repo);
    expect(data.sessions).toEqual({});
    expect(data.view.activeSessionId).toBeNull();
    const raw = await repo.loadAll();
    expect(raw?.sessions).toEqual([]);
  });

  it('keeps settings across reloads even with no sessions', async () => {
    const repo = freshRepo();
    const a = await boot(repo);
    a.getState().updateSettings({ setupDone: true, theme: 'dark' });
    const b = await reload(repo);
    expect(b.getState().sessions).toEqual({});
    expect(b.getState().settings).toMatchObject({ setupDone: true, theme: 'dark' });
  });

  it('keeps the tree, anchors, summaries and view state after reload', async () => {
    const repo = await seededRepo();
    const a = await boot(repo);
    const parentMsg = a.getState().messages[SEED_IDS.root]![1]!;
    const start = parentMsg.content.indexOf('가중합');
    const branch = a.getState().createBranch(
      SEED_IDS.root,
      { messageId: parentMsg.id, text: '가중합', startOffset: start, endOffset: start + 3 },
      'what',
    );
    if (!branch) throw new Error('branch not created');
    await idle(a);
    a.getState().attachSummary(branch, '가중합은 중요도만큼 섞은 평균이다.');
    a.getState().openSession(SEED_IDS.cos, 'split');
    a.getState().openSession(branch, 'popup');
    a.getState().updateSettings({ contextWindow: 4, theme: 'dark' });
    a.getState().setConnection('openai-api', { enabled: false, model: 'gpt-x', detail: 'sk-…abcd', status: 'ready' });

    const b = await reload(repo);
    const sa = a.getState();
    const sb = b.getState();
    expect(sb.sessions).toEqual(sa.sessions);
    expect(sb.messages).toEqual(sa.messages);
    expect(sb.sessions[branch]!.anchor).toEqual(sa.sessions[branch]!.anchor);
    expect(sb.sessions[branch]!.summary).toBe('가중합은 중요도만큼 섞은 평균이다.');
    expect(sb.view).toEqual(sa.view);
    expect(sb.settings).toEqual(sa.settings);
    expect(sb.connections['openai-api']).toMatchObject({ enabled: false, model: 'gpt-x', status: 'checking' });
    expect(sb.connections['openai-api']!.detail).toBeUndefined();
  });

  it('deletes a session subtree with its messages', async () => {
    const repo = await seededRepo();
    const a = await boot(repo);
    a.getState().deleteSession(SEED_IDS.qkv);
    const b = await reload(repo);
    expect(b.getState().sessions[SEED_IDS.qkv]).toBeUndefined();
    expect(b.getState().sessions[SEED_IDS.cos]).toBeUndefined();
    const raw = await repo.loadAll();
    expect(raw!.messages.some((m) => m.sessionId === SEED_IDS.cos)).toBe(false);
  });

  it('keeps message order across retry and stores the replacement', async () => {
    const repo = await seededRepo();
    const a = await boot(repo);
    a.getState().setSessionProvider(SEED_IDS.scale, 'mock');
    mockControl.failNext = true;
    a.getState().sendMessage(SEED_IDS.scale, '왜 루트야?');
    await idle(a);
    expect(a.getState().messages[SEED_IDS.scale]!.at(-1)!.status).toBe('error');
    a.getState().retry(SEED_IDS.scale);
    await idle(a);
    const b = await reload(repo);
    const list = b.getState().messages[SEED_IDS.scale]!;
    expect(list).toEqual(a.getState().messages[SEED_IDS.scale]);
    expect(list.at(-1)!.status).toBe('done');
    expect(list.at(-2)!.content).toBe('왜 루트야?');
  });

  it('restores an interrupted stream as stopped with its partial text', async () => {
    const repo = await seededRepo();
    const a = await boot(repo);
    const last = a.getState().messages[SEED_IDS.root]!.at(-1)!;
    repo.saveMessage({ ...last, id: 'm-cut', content: '부분 응답', status: 'streaming' }, 99);
    const b = await reload(repo);
    const cut = b.getState().messages[SEED_IDS.root]!.at(-1)!;
    expect(cut).toMatchObject({ id: 'm-cut', status: 'stopped', content: '부분 응답' });
  });

  it('replaceAll swaps the whole dataset', async () => {
    const repo = await seededRepo();
    await boot(repo);
    const other = { ...createSeed(0), view: emptyView(SEED_IDS.scale) };
    const data = restoreData(toStoredData({ ...other, settings: (await hydrate(repo)).data.settings, connections: (await hydrate(repo)).data.connections }));
    delete data.sessions[SEED_IDS.cos];
    await repo.replaceAll(toStoredData(data));
    const b = await reload(repo);
    expect(b.getState().sessions[SEED_IDS.cos]).toBeUndefined();
    expect(b.getState().view.activeSessionId).toBe(SEED_IDS.scale);
  });
});
