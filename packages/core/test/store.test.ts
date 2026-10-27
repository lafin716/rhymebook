import { beforeEach, describe, expect, it } from 'vitest';
import { createSeed, emptyView, SEED_IDS } from '../src/seed';
import { createAppStore, nextFallback, type AppStore } from '../src/store';
import { createDemoRegistry } from '../src/providers/demo';
import { mockControl } from '../src/providers/mock';
import { ProviderRegistry, providerError } from '../src/provider';
import { memoryRepository } from '../src/repo';
import { buildSystemPrompt } from '../src/context';

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

  it('creates a free sub-session (no anchor) from a typed question', async () => {
    const store = makeStore();
    expect(store.getState().createSubSession(SEED_IDS.root, '   ')).toBe(false);
    expect(store.getState().createSubSession('nope', 'q')).toBe(false);
    const id = store.getState().createSubSession(SEED_IDS.root, '행렬식은 왜 넓이야?\n자세히') as string;
    await idle(store);
    const s = store.getState();
    expect(s.sessions[id]!.parentId).toBe(SEED_IDS.root);
    expect(s.sessions[id]!.anchor).toBeUndefined();
    expect(s.sessions[id]!.title).toBe('행렬식은 왜 넓이야?');
    const msgs = s.messages[id]!;
    expect(msgs[0]!.content).toBe('행렬식은 왜 넓이야?\n자세히');
    expect(msgs[1]!.status).toBe('done');
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

  it('split view holds at most 4 panels and collapses to single', () => {
    const store = makeStore();
    const { openSession } = store.getState();
    openSession(SEED_IDS.qkv, 'split');
    openSession(SEED_IDS.dot, 'split');
    openSession(SEED_IDS.cos, 'split');
    openSession(SEED_IDS.scale, 'split');
    let v = store.getState().view;
    expect(v.mode).toBe('split');
    expect(v.splitSessionIds).toEqual([SEED_IDS.root, SEED_IDS.qkv, SEED_IDS.dot, SEED_IDS.scale]);
    store.getState().closeSplit(0);
    store.getState().closeSplit(0);
    store.getState().closeSplit(0);
    v = store.getState().view;
    expect(v.mode).toBe('single');
    expect(v.activeSessionId).toBe(SEED_IDS.scale);
    expect(v.splitLayout).toBeUndefined();
  });

  it('drops sessions from the sidebar into left/right/top/bottom splits', () => {
    const store = makeStore();
    const { dropToSplit } = store.getState();
    // 단일 보기에서 오른쪽에 놓으면 좌우 분할
    expect(dropToSplit(SEED_IDS.qkv, null, 'right')).toBe(true);
    let v = store.getState().view;
    expect(v.mode).toBe('split');
    expect(v.splitLayout).toMatchObject({ kind: 'group', dir: 'row' });
    expect(v.splitSessionIds).toEqual([SEED_IDS.root, SEED_IDS.qkv]);
    expect(v.activeSessionId).toBe(SEED_IDS.qkv);
    // qkv 아래에 놓으면 오른쪽 칸이 상하로 나뉜다
    dropToSplit(SEED_IDS.dot, SEED_IDS.qkv, 'bottom');
    v = store.getState().view;
    expect(v.splitSessionIds).toEqual([SEED_IDS.root, SEED_IDS.qkv, SEED_IDS.dot]);
    expect(v.splitLayout).toMatchObject({
      dir: 'row',
      children: [{ kind: 'leaf', sessionId: SEED_IDS.root }, { kind: 'group', dir: 'col' }],
    });
    // 가운데는 그 패널 교체
    dropToSplit(SEED_IDS.cos, SEED_IDS.root, 'center');
    expect(store.getState().view.splitSessionIds).toEqual([SEED_IDS.cos, SEED_IDS.qkv, SEED_IDS.dot]);
    // 이미 있는 세션을 다른 가장자리에 놓으면 옮긴다
    dropToSplit(SEED_IDS.dot, SEED_IDS.cos, 'top');
    v = store.getState().view;
    expect(v.splitSessionIds).toEqual([SEED_IDS.dot, SEED_IDS.cos, SEED_IDS.qkv]);
    dropToSplit(SEED_IDS.root, SEED_IDS.qkv, 'left');
    // 가득 차면 새 칸은 거절, 교체는 허용
    expect(dropToSplit(SEED_IDS.scale, SEED_IDS.qkv, 'right')).toBe(false);
    expect(dropToSplit(SEED_IDS.scale, SEED_IDS.qkv, 'center')).toBe(true);
    expect(store.getState().view.splitSessionIds).toHaveLength(4);
    // 비율 저장
    store.getState().setSplitGroupSizes([], [20, 30, 50]);
    expect((store.getState().view.splitLayout as { sizes?: number[] }).sizes).toEqual([20, 30, 50]);
    store.getState().setSplitGroupSizes([0], [40, 60]);
    const first = (store.getState().view.splitLayout as { children: { sizes?: number[] }[] }).children[0]!;
    expect(first.sizes).toEqual([40, 60]);
  });

  it('swaps split panels, separator sides and flips group direction keeping focus', () => {
    const store = makeStore();
    const { dropToSplit } = store.getState();
    dropToSplit(SEED_IDS.qkv, null, 'right');
    dropToSplit(SEED_IDS.dot, SEED_IDS.qkv, 'bottom');
    // root | (qkv / dot), 포커스 dot
    let v = store.getState().view;
    expect(v.splitSessionIds[v.focusedSplitIndex]).toBe(SEED_IDS.dot);
    store.getState().swapSplit(SEED_IDS.root, SEED_IDS.dot);
    v = store.getState().view;
    expect(v.splitSessionIds).toEqual([SEED_IDS.dot, SEED_IDS.qkv, SEED_IDS.root]);
    expect(v.splitSessionIds[v.focusedSplitIndex]).toBe(SEED_IDS.dot);
    // 경계선 양쪽 바꾸기: dot | (qkv / root) → (qkv / root) | dot
    store.getState().swapSplitChildren([], 0, 1);
    v = store.getState().view;
    expect(v.splitSessionIds).toEqual([SEED_IDS.qkv, SEED_IDS.root, SEED_IDS.dot]);
    expect(v.splitLayout).toMatchObject({ dir: 'row', children: [{ dir: 'col' }, { sessionId: SEED_IDS.dot }] });
    expect(v.splitSessionIds[v.focusedSplitIndex]).toBe(SEED_IDS.dot);
    // 방향 전환: 안쪽 상하 → 좌우 (바깥 좌우 그룹과 합쳐짐)
    store.getState().flipSplitGroup([0]);
    v = store.getState().view;
    expect(v.splitLayout).toMatchObject({
      dir: 'row',
      children: [{ sessionId: SEED_IDS.qkv }, { sessionId: SEED_IDS.root }, { sessionId: SEED_IDS.dot }],
    });
    store.getState().flipSplitGroup([]);
    v = store.getState().view;
    expect(v.splitLayout).toMatchObject({ dir: 'col' });
    expect(v.splitSessionIds[v.focusedSplitIndex]).toBe(SEED_IDS.dot);
  });

  it('closing the mindmap returns to split when panels remain', () => {
    const store = makeStore();
    store.getState().dropToSplit(SEED_IDS.qkv, null, 'right');
    store.getState().setMode('mindmap');
    expect(store.getState().view.splitSessionIds).toHaveLength(2);
    store.getState().closeMindmap();
    expect(store.getState().view.mode).toBe('split');
    store.getState().closeSplit(1);
    store.getState().setMode('mindmap');
    store.getState().closeMindmap();
    expect(store.getState().view.mode).toBe('single');
  });

  it('closes the other split panels and shows only the chosen one', () => {
    const store = makeStore();
    store.getState().dropToSplit(SEED_IDS.qkv, null, 'right');
    store.getState().dropToSplit(SEED_IDS.dot, SEED_IDS.qkv, 'bottom');
    expect(store.getState().view.splitSessionIds).toHaveLength(3);
    store.getState().closeOtherSplits(SEED_IDS.qkv);
    const v = store.getState().view;
    expect(v.mode).toBe('single');
    expect(v.activeSessionId).toBe(SEED_IDS.qkv);
    expect(v.splitLayout).toBeUndefined();
  });

  it('sends attachments and a skill with the question', async () => {
    const store = makeStore();
    const id = store.getState().newRootSession() as string;
    const skill = { id: 'sk1', name: 'curriculum', title: '커리큘럼 생성', prompt: '단계별로' };
    const attachments = [{ id: 'a1', kind: 'text' as const, name: 'notes.txt', mime: 'text/plain', size: 5, data: 'hello' }];
    expect(store.getState().sendMessage(id, '', undefined, { attachments, skill })).toBeTruthy();
    const user = store.getState().messages[id]![0]!;
    expect(user.attachments).toEqual(attachments);
    expect(user.skill).toEqual(skill);
    await idle(store);
    expect(store.getState().sendMessage(id, '   ')).toBe(false);
  });

  it('page: a markdown document session that branches like an answer (ADR-072)', async () => {
    const store = makeStore();
    const id = store.getState().newPage() as string;
    const st = store.getState();
    expect(st.sessions[id]).toMatchObject({ kind: 'page', title: '새 페이지', parentId: null, rootId: id });
    expect(st.view.activeSessionId).toBe(id);
    const doc = st.messages[id]![0]!;
    expect(doc).toMatchObject({ role: 'assistant', content: '', status: 'done' });
    // 대화 동작은 페이지에서 막힌다
    expect(st.sendMessage(id, '질문')).toBe(false);
    expect(st.retry(id)).toBe(false);
    expect(st.reorganizeSession(id)).toBe(false);
    expect(store.getState().updatePage(id, '# 메모\n\n어텐션은 가중합이다.')).toBe(true);
    expect(store.getState().updatePage(id, '# 메모\n\n어텐션은 가중합이다.')).toBe(false);
    expect(store.getState().updatePage(SEED_IDS.root, 'x')).toBe(false);
    const content = store.getState().messages[id]![0]!.content;
    const start = content.indexOf('가중합');
    const branch = store.getState().createBranch(id, { messageId: doc.id, text: '가중합', startOffset: start, endOffset: start + 3 }, 'what') as string;
    expect(branch).toBeTruthy();
    expect(store.getState().sessions[branch]!.kind).toBeUndefined();
    const sys = buildSystemPrompt({ sessions: store.getState().sessions, messages: store.getState().messages, sessionId: branch });
    expect(sys).toContain('### 부모 문서');
    expect(sys).toContain('어텐션은 가중합이다.');
    expect(sys).not.toContain('### 부모 대화');
    expect(sys).toContain('[가중합]');
    // 본문을 고쳐 앵커 위치가 밀려도 문맥 발췌는 같은 글을 가리킨다
    store.getState().updatePage(id, '# 메모\n\n앞에 문장을 더 썼다. 어텐션은 가중합이다.');
    const moved = buildSystemPrompt({ sessions: store.getState().sessions, messages: store.getState().messages, sessionId: branch });
    expect(moved).toContain('[가중합]');
    await idle(store);
    // 질문을 페이지로 옮기거나 id를 겹쳐 만들 수 없다
    expect(store.getState().newPage(id)).toBe(false);
    expect(store.getState().newPage(undefined, { docId: doc.id })).toBe(false);
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

  describe('deleteTurn', () => {
    const anchorIn = (store: AppStore, messageId: string, text: string) => {
      const msg = store.getState().messages[SEED_IDS.root]!.find((m) => m.id === messageId)!;
      const start = msg.content.indexOf(text);
      return { messageId, text, startOffset: start, endOffset: start + text.length };
    };

    it('removes the question and its answer, keeping order for later saves', () => {
      const saved: [string, number][] = [];
      const deleted: string[] = [];
      const store = createAppStore({
        registry: createDemoRegistry(() => store.getState().connections),
        initial: { ...createSeed(0), view: emptyView(SEED_IDS.root) },
        repo: {
          ...memoryRepository(),
          saveMessage: (m, i) => saved.push([m.id, i]),
          deleteMessage: (id) => deleted.push(id),
        },
      });
      const before = store.getState().messages[SEED_IDS.root]!.map((m) => m.id);
      expect(store.getState().deleteTurn(SEED_IDS.root, before[2]!)).toBe(true);
      const after = store.getState().messages[SEED_IDS.root]!.map((m) => m.id);
      expect(after).toEqual([before[0], before[1], ...before.slice(4)]);
      expect(deleted).toEqual([before[2], before[3]]);
      // 뒤쪽 메시지는 새 위치로 다시 저장
      expect(saved).toEqual(after.slice(2).map((id, i) => [id, i + 2]));
    });

    it('refuses the first question', () => {
      const store = makeStore();
      const first = store.getState().messages[SEED_IDS.root]![0]!.id;
      expect(store.getState().deleteTurn(SEED_IDS.root, first)).toBe(false);
      expect(store.getState().messages[SEED_IDS.root]![0]!.id).toBe(first);
      // 첫 질문의 답변에 달린 가지도 그대로
      expect(store.getState().sessions[SEED_IDS.qkv]).toBeTruthy();
    });

    it('deletes branches and annotations anchored on the removed answer', async () => {
      const store = makeStore();
      const [, , q2, a2] = store.getState().messages[SEED_IDS.root]!;
      const text = a2!.content.slice(0, 4);
      const branch = store.getState().createBranch(SEED_IDS.root, anchorIn(store, a2!.id, text), 'what') as string;
      await idle(store);
      const anno = store.getState().addAnnotation(SEED_IDS.root, anchorIn(store, a2!.id, text), { highlight: 'yellow' });
      expect(store.getState().deleteTurn(SEED_IDS.root, q2!.id)).toBe(true);
      const s = store.getState();
      expect(s.sessions[branch]).toBeUndefined();
      expect(s.annotations[anno]).toBeUndefined();
      expect(s.sessions[SEED_IDS.qkv]).toBeTruthy();
    });

    it('refuses while the session is streaming', async () => {
      const store = makeStore();
      mockControl.firstTokenDelay = 50;
      store.getState().sendMessage(SEED_IDS.root, '새 질문');
      const q2 = store.getState().messages[SEED_IDS.root]![2]!.id;
      expect(store.getState().deleteTurn(SEED_IDS.root, q2)).toBe(false);
      await idle(store);
      expect(store.getState().deleteTurn(SEED_IDS.root, q2)).toBe(true);
    });
  });

  describe('splitTurn', () => {
    const anchorIn = (store: AppStore, messageId: string, text: string) => {
      const msg = store.getState().messages[SEED_IDS.root]!.find((m) => m.id === messageId)!;
      const start = msg.content.indexOf(text);
      return { messageId, text, startOffset: start, endOffset: start + text.length };
    };

    it('moves the turn with its branches and annotations into a new sub-session', async () => {
      const saved: [string, string, number][] = [];
      const deleted: string[] = [];
      const store = createAppStore({
        registry: createDemoRegistry(() => store.getState().connections),
        initial: { ...createSeed(0), view: emptyView(SEED_IDS.root) },
        repo: {
          ...memoryRepository(),
          saveMessage: (m, i) => saved.push([m.id, m.sessionId, i]),
          deleteMessage: (id) => deleted.push(id),
        },
      });
      const before = store.getState().messages[SEED_IDS.root]!;
      const [, , q2, a2] = before;
      const text = a2!.content.slice(0, 4);
      const branch = store.getState().createBranch(SEED_IDS.root, anchorIn(store, a2!.id, text), 'what') as string;
      await idle(store);
      const anno = store.getState().addAnnotation(SEED_IDS.root, anchorIn(store, a2!.id, text), { highlight: 'yellow' });
      saved.length = 0;

      const id = store.getState().splitTurn(SEED_IDS.root, q2!.id, 's-split');
      expect(id).toBe('s-split');
      const s = store.getState();
      expect(s.sessions['s-split']).toMatchObject({ parentId: SEED_IDS.root, rootId: SEED_IDS.root, createdAt: q2!.createdAt - 1 });
      expect(s.sessions['s-split']!.anchor).toBeUndefined();
      expect(s.messages['s-split']!.map((m) => [m.id, m.sessionId])).toEqual([
        [q2!.id, 's-split'],
        [a2!.id, 's-split'],
      ]);
      expect(s.messages[SEED_IDS.root]!.map((m) => m.id)).toEqual([before[0]!.id, before[1]!.id, ...before.slice(4).map((m) => m.id)]);
      expect(s.sessions[branch]!.parentId).toBe('s-split');
      expect(s.annotations[anno]!.sessionId).toBe('s-split');
      // 첫 질문 답변의 가지는 그대로
      expect(s.sessions[SEED_IDS.qkv]!.parentId).toBe(SEED_IDS.root);
      // 메시지는 지우지 않고 새 세션으로 다시 저장, 부모 뒤쪽은 새 위치로
      expect(deleted).toEqual([]);
      expect(saved.slice(0, 2)).toEqual([
        [q2!.id, 's-split', 0],
        [a2!.id, 's-split', 1],
      ]);
      expect(saved.slice(2)).toEqual(s.messages[SEED_IDS.root]!.slice(2).map((m, i) => [m.id, SEED_IDS.root, i + 2]));
    });

    it('refuses the first question, taken ids and streaming sessions', async () => {
      const store = makeStore();
      const [q1, , q2] = store.getState().messages[SEED_IDS.root]!;
      expect(store.getState().splitTurn(SEED_IDS.root, q1!.id)).toBe(false);
      expect(store.getState().splitTurn(SEED_IDS.root, q2!.id, SEED_IDS.qkv)).toBe(false);
      mockControl.firstTokenDelay = 50;
      store.getState().sendMessage(SEED_IDS.root, '새 질문');
      expect(store.getState().splitTurn(SEED_IDS.root, q2!.id)).toBe(false);
      await idle(store);
      expect(store.getState().splitTurn(SEED_IDS.root, q2!.id)).toBeTruthy();
    });

    it('scopes the new sub-session context to the parent before the question', () => {
      const store = makeStore();
      const [q1, a1, q2] = store.getState().messages[SEED_IDS.root]!;
      const id = store.getState().splitTurn(SEED_IDS.root, q2!.id) as string;
      const s = store.getState();
      const prompt = buildSystemPrompt({ sessions: s.sessions, messages: s.messages, sessionId: id });
      expect(prompt).toContain(q1!.content.slice(0, 20));
      expect(prompt).toContain(a1!.content.slice(0, 20));
      expect(prompt).not.toContain(s.messages[SEED_IDS.root]![2]!.content.slice(0, 40));
    });
  });
});

describe('turn move · sibling split · reorganize', () => {
  beforeEach(() => {
    mockControl.firstTokenDelay = 0;
    mockControl.speed = 0;
    mockControl.failNext = false;
  });
  const anchorIn = (store: AppStore, sessionId: string, messageId: string, text: string) => {
    const msg = store.getState().messages[sessionId]!.find((m) => m.id === messageId)!;
    const start = msg.content.indexOf(text);
    return { messageId, text, startOffset: start, endOffset: start + text.length };
  };

  it('moveTurn appends the turn to another study and carries branches with their rootId', async () => {
    const store = makeStore();
    const [, , q2, a2] = store.getState().messages[SEED_IDS.root]!;
    const branch = store.getState().createBranch(SEED_IDS.root, anchorIn(store, SEED_IDS.root, a2!.id, a2!.content.slice(0, 4)), 'what') as string;
    await idle(store);
    const ba = store.getState().messages[branch]![1]!;
    const deep = store.getState().createBranch(branch, anchorIn(store, branch, ba.id, ba.content.slice(0, 3)), 'what') as string;
    await idle(store);
    const lastBp = store.getState().messages[SEED_IDS.backprop]!.at(-1)!;

    // 자기 자신·옮겨질 가지 안으로는 못 옮긴다
    expect(store.getState().moveTurn(SEED_IDS.root, q2!.id, SEED_IDS.root)).toBe(false);
    expect(store.getState().moveTurn(SEED_IDS.root, q2!.id, deep)).toBe(false);
    expect(store.getState().moveTurn(SEED_IDS.root, q2!.id, 'nope')).toBe(false);

    expect(store.getState().moveTurn(SEED_IDS.root, q2!.id, SEED_IDS.backprop)).toBe(true);
    const s = store.getState();
    const bp = s.messages[SEED_IDS.backprop]!;
    expect(bp.slice(-2).map((m) => m.id)).toEqual([q2!.id, a2!.id]);
    expect(bp.at(-2)!.createdAt).toBeGreaterThan(lastBp.createdAt);
    expect(bp.at(-2)!.sessionId).toBe(SEED_IDS.backprop);
    expect(s.messages[SEED_IDS.root]!.some((m) => m.id === q2!.id)).toBe(false);
    expect(s.sessions[branch]).toMatchObject({ parentId: SEED_IDS.backprop, rootId: SEED_IDS.backprop });
    expect(s.sessions[deep]).toMatchObject({ parentId: branch, rootId: SEED_IDS.backprop });
  });

  it('moveTurn refuses the first question and streaming sessions', async () => {
    const store = makeStore();
    const [q1, , q2] = store.getState().messages[SEED_IDS.root]!;
    expect(store.getState().moveTurn(SEED_IDS.root, q1!.id, SEED_IDS.backprop)).toBe(false);
    mockControl.firstTokenDelay = 50;
    store.getState().sendMessage(SEED_IDS.backprop, '새 질문');
    expect(store.getState().moveTurn(SEED_IDS.root, q2!.id, SEED_IDS.backprop)).toBe(false);
    await idle(store);
    expect(store.getState().moveTurn(SEED_IDS.root, q2!.id, SEED_IDS.backprop)).toBe(true);
  });

  it('sibling split puts the turn next to the session and titles it with AI', async () => {
    const store = makeStore();
    // 하위 세션에서: 같은 부모 아래
    store.getState().sendMessage(SEED_IDS.qkv, '그럼 Value는 왜 따로 있어?');
    await idle(store);
    const q = store.getState().messages[SEED_IDS.qkv]![2]!;
    const id = store.getState().splitTurn(SEED_IDS.qkv, q.id, 's-sib', { sibling: true }) as string;
    expect(id).toBe('s-sib');
    const qkv = store.getState().sessions[SEED_IDS.qkv]!;
    expect(store.getState().sessions[id]).toMatchObject({ parentId: SEED_IDS.root, rootId: SEED_IDS.root, createdAt: qkv.createdAt + 1 });
    expect(store.getState().sessions[id]!.anchor).toBeUndefined();
    expect(store.getState().messages[id]!.map((m) => m.id)[0]).toBe(q.id);
    await new Promise((r) => setTimeout(r, 30));
    expect(store.getState().sessions[id]!.title).not.toBe('그럼 Value는 왜 따로 있어?');

    // 루트에서: 새 루트
    const [, , q2] = store.getState().messages[SEED_IDS.root]!;
    const root = store.getState().splitTurn(SEED_IDS.root, q2!.id, 's-root2', { sibling: true }) as string;
    expect(store.getState().sessions[root]).toMatchObject({ parentId: null, rootId: 's-root2' });
  });

  it('reorganizeSession condenses the session into one Q&A and turns anchored branches into footnotes', async () => {
    const deleted: string[] = [];
    const store = createAppStore({
      registry: createDemoRegistry(() => store.getState().connections),
      initial: { ...createSeed(0), view: emptyView(SEED_IDS.root) },
      repo: { ...memoryRepository(), deleteMessage: (id) => deleted.push(id) },
    });
    const before = store.getState().messages[SEED_IDS.root]!;
    expect(store.getState().reorganizeSession(SEED_IDS.root)).toBe(true);
    // 스트리밍 중에는 임시 질문·답변이 뒤에 붙는다
    expect(store.getState().messages[SEED_IDS.root]!.length).toBe(before.length + 2);
    expect(store.getState().reorganizeSession(SEED_IDS.root)).toBe(false);
    await idle(store);
    const s = store.getState();
    const after = s.messages[SEED_IDS.root]!;
    expect(after).toHaveLength(2);
    expect(after.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(after[0]!.createdAt).toBe(before[0]!.createdAt);
    expect(after[1]).toMatchObject({ status: 'done' });
    expect(after[1]!.content.length).toBeGreaterThan(0);
    expect(deleted.sort()).toEqual(before.map((m) => m.id).sort());
    for (const id of [SEED_IDS.qkv, SEED_IDS.softmax, SEED_IDS.scale]) expect(s.sessions[id]!.anchor).toBeUndefined();
    // 손주는 그대로
    expect(s.sessions[SEED_IDS.dot]!.anchor).toBeTruthy();
  });

  it('reorganizeSession keeps the session as is when the answer fails', async () => {
    const store = makeStore();
    const before = store.getState().messages[SEED_IDS.root]!;
    mockControl.failNext = true;
    expect(store.getState().reorganizeSession(SEED_IDS.root)).toBe(true);
    await idle(store);
    expect(store.getState().messages[SEED_IDS.root]).toEqual(before);
    expect(store.getState().sessions[SEED_IDS.qkv]!.anchor).toBeTruthy();
  });

  it('reorganizeSession refuses empty sessions', () => {
    const store = makeStore();
    const id = store.getState().newRootSession() as string;
    expect(store.getState().reorganizeSession(id)).toBe(false);
    expect(store.getState().reorganizeSession('nope')).toBe(false);
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
