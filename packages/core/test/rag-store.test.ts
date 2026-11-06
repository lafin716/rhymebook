import { beforeEach, describe, expect, it } from 'vitest';
import { createSeed, emptyView, SEED_IDS } from '../src/seed';
import { createAppStore, effectiveKnowledgeIds, knowledgeInherited, sanitizeKnowledgeIds, type AppStore } from '../src/store';
import { ProviderRegistry, type StreamRequest } from '../src/provider';
import { mockControl } from '../src/providers/mock';
import { memoryRepository } from '../src/repo';
import { DEFAULT_RAG_SETTINGS, type RetrievalRequest, type RetrievalResult, type RetrievalService, type Evidence } from '../src/rag';
import type { Session } from '../src/model';

const KB = 'kbabc123def';
const KB2 = 'kbxyz789ghi';

const idle = (store: AppStore) =>
  new Promise<void>((resolve) => {
    const check = () => (Object.keys(store.getState().streaming).length === 0 ? resolve() : setTimeout(check, 5));
    setTimeout(check, 5);
  });

const evidence: Evidence = {
  n: 1,
  kbId: KB,
  kbName: 'KB',
  chunkId: 'c1',
  docId: 'd1',
  path: 'net.md',
  title: 'Net',
  kind: 'markdown',
  headingPath: ['IPAM'],
  text: 'CIDR 블록을 나눈다',
  score: 0.8,
};

/** 질의 확장 요청(purpose 'search')은 searches에, 나머지는 seen에 모은다 */
function makeStore(seen: StreamRequest[], retriever?: RetrievalService, search?: { searches?: StreamRequest[]; reply?: string | Error }) {
  const registry = new ProviderRegistry();
  registry.register({
    id: 'mock',
    label: 'M',
    available: async () => ({ status: 'ready' }),
    async *stream(req) {
      if (req.purpose === 'search') {
        search?.searches?.push(req);
        const reply = search?.reply ?? '';
        if (reply instanceof Error) {
          yield { type: 'error', error: { code: 'network', message: reply.message, retryable: false } };
          return;
        }
        yield { type: 'delta', text: reply };
        yield { type: 'done' };
        return;
      }
      seen.push(req);
      yield { type: 'delta', text: '답' };
      yield { type: 'done' };
    },
  });
  return createAppStore({
    registry,
    repo: memoryRepository(),
    retriever,
    initial: { ...createSeed(0), view: emptyView(SEED_IDS.root) },
  });
}

const okRetriever = (calls: RetrievalRequest[]): RetrievalService => ({
  async retrieve(req): Promise<RetrievalResult> {
    calls.push(req);
    return { plan: req.plan, evidence: [evidence], skipped: [], tookMs: 1 };
  },
  async source() {
    throw new Error('unused');
  },
});

const failRetriever: RetrievalService = {
  async retrieve() {
    throw new Error('index broken');
  },
  async source() {
    throw new Error('unused');
  },
};

beforeEach(() => {
  mockControl.firstTokenDelay = 0;
  mockControl.speed = 0;
});

describe('effectiveKnowledgeIds / knowledgeInherited', () => {
  const mk = (over: Partial<Session>): Session =>
    ({ id: 'x', rootId: 'r', parentId: null, knowledgeId: undefined, knowledgeIds: undefined, ...over } as unknown as Session);

  it('루트의 목록을 가지가 물려받고, 가지가 덮어쓰면 그것을 쓴다', () => {
    const sessions = {
      r: mk({ id: 'r', rootId: 'r', knowledgeIds: [KB] }),
      c: mk({ id: 'c', rootId: 'r', parentId: 'r' }),
      g: mk({ id: 'g', rootId: 'r', parentId: 'c', knowledgeIds: [KB2] }),
    };
    expect(effectiveKnowledgeIds(sessions, 'c')).toEqual([KB]);
    expect(knowledgeInherited(sessions, 'c')).toBe(true);
    expect(effectiveKnowledgeIds(sessions, 'g')).toEqual([KB2]);
    expect(knowledgeInherited(sessions, 'g')).toBe(false);
  });

  it('[]는 끔이고 자식도 끈다', () => {
    const sessions = {
      r: mk({ id: 'r', rootId: 'r', knowledgeIds: [KB] }),
      c: mk({ id: 'c', rootId: 'r', parentId: 'r', knowledgeIds: [] }),
      d: mk({ id: 'd', rootId: 'r', parentId: 'c' }),
    };
    expect(effectiveKnowledgeIds(sessions, 'c')).toEqual([]);
    expect(effectiveKnowledgeIds(sessions, 'd')).toEqual([]);
  });

  it('루트에 목록이 없으면 예전 knowledgeId 하나를 쓴다', () => {
    const sessions = {
      r: mk({ id: 'r', rootId: 'r', knowledgeId: KB }),
      c: mk({ id: 'c', rootId: 'r', parentId: 'r' }),
    };
    expect(effectiveKnowledgeIds(sessions, 'c')).toEqual([KB]);
  });

  it('형식이 틀린 id는 버리고 중복은 한 번만 남긴다', () => {
    expect(sanitizeKnowledgeIds(['bad id', KB, KB, 'kb'])).toEqual([KB]);
    expect(effectiveKnowledgeIds({}, 'missing')).toEqual([]);
  });

  it('부모 고리(순환)가 있어도 멈춘다', () => {
    const sessions = {
      a: mk({ id: 'a', rootId: 'a', parentId: 'b' }),
      b: mk({ id: 'b', rootId: 'a', parentId: 'a' }),
    };
    expect(effectiveKnowledgeIds(sessions, 'a')).toEqual([]);
  });
});

describe('setSessionKnowledgeIds', () => {
  it('루트에 목록을 쓰고 예전 knowledgeId도 첫 번째 값으로 맞춘다', () => {
    const store = makeStore([]);
    store.getState().setSessionKnowledgeIds(SEED_IDS.root, [KB, KB2]);
    const root = store.getState().sessions[SEED_IDS.root]!;
    expect(root.knowledgeIds).toEqual([KB, KB2]);
    expect(root.knowledgeId).toBe(KB);
    store.getState().setSessionKnowledgeIds(SEED_IDS.root, null);
    expect(store.getState().sessions[SEED_IDS.root]!.knowledgeIds).toBeUndefined();
    expect(store.getState().sessions[SEED_IDS.root]!.knowledgeId).toBeUndefined();
  });

  it('가지에만 목록을 쓰면 루트는 바뀌지 않는다', () => {
    const store = makeStore([]);
    const child = store.getState().newSubSession(SEED_IDS.root, undefined, { focus: false }) as string;
    store.getState().setSessionKnowledgeIds(SEED_IDS.root, [KB]);
    store.getState().setSessionKnowledgeIds(child, [KB2]);
    expect(store.getState().sessions[child]!.knowledgeIds).toEqual([KB2]);
    expect(store.getState().sessions[SEED_IDS.root]!.knowledgeIds).toEqual([KB]);
    expect(effectiveKnowledgeIds(store.getState().sessions, child)).toEqual([KB2]);
  });

  it('setSessionKnowledge(예전 API)도 목록을 함께 맞춘다', () => {
    const store = makeStore([]);
    store.getState().setSessionKnowledge(SEED_IDS.root, KB);
    expect(store.getState().sessions[SEED_IDS.root]!.knowledgeIds).toEqual([KB]);
    store.getState().setSessionKnowledge(SEED_IDS.root, null);
    expect(store.getState().sessions[SEED_IDS.root]!.knowledgeIds).toBeUndefined();
  });
});

describe('runAssistant with retriever', () => {
  it('지식베이스가 있으면 근거를 시스템 프롬프트에 넣고 인용을 메시지에 남긴다', async () => {
    const seen: StreamRequest[] = [];
    const calls: RetrievalRequest[] = [];
    const store = makeStore(seen, okRetriever(calls));
    store.getState().setSessionKnowledgeIds(SEED_IDS.root, [KB]);
    store.getState().sendMessage(SEED_IDS.root, 'CIDR은 뭐야?');
    await idle(store);

    expect(calls).toHaveLength(1);
    expect(calls[0]!.kbIds).toEqual([KB]);
    expect(seen[0]!.system).toContain('<documents>');
    expect(seen[0]!.system).toContain('CIDR 블록을 나눈다');
    const msgs = store.getState().messages[SEED_IDS.root]!;
    const asst = msgs.filter((m) => m.role === 'assistant').at(-1)!;
    expect(asst.citations?.[0]?.chunkId).toBe('c1');
    expect(asst.ragQuery).toBeTruthy();
  });

  it('검색이 실패하면 RAG 블록 없이 답한다', async () => {
    const seen: StreamRequest[] = [];
    const store = makeStore(seen, failRetriever);
    store.getState().setSessionKnowledgeIds(SEED_IDS.root, [KB]);
    store.getState().sendMessage(SEED_IDS.root, 'CIDR은 뭐야?');
    await idle(store);
    expect(seen).toHaveLength(1);
    expect(seen[0]!.system).not.toContain('<documents>');
    const asst = store.getState().messages[SEED_IDS.root]!.filter((m) => m.role === 'assistant').at(-1)!;
    expect(asst.citations).toBeUndefined();
  });

  it('지식베이스가 없으면 검색을 부르지 않는다', async () => {
    const seen: StreamRequest[] = [];
    const calls: RetrievalRequest[] = [];
    const store = makeStore(seen, okRetriever(calls));
    store.getState().sendMessage(SEED_IDS.root, '안녕');
    await idle(store);
    expect(calls).toHaveLength(0);
    expect(seen[0]!.system).not.toContain('<documents>');
  });

  it('가지는 루트의 지식베이스로 검색한다', async () => {
    const seen: StreamRequest[] = [];
    const calls: RetrievalRequest[] = [];
    const store = makeStore(seen, okRetriever(calls));
    store.getState().setSessionKnowledgeIds(SEED_IDS.root, [KB]);
    const child = store.getState().newSubSession(SEED_IDS.root, undefined, { focus: false }) as string;
    store.getState().sendMessage(child, '더 자세히');
    await idle(store);
    expect(calls[0]?.kbIds).toEqual([KB]);
  });

  it('지식베이스 설정을 끄면 검색하지 않는다', async () => {
    const seen: StreamRequest[] = [];
    const calls: RetrievalRequest[] = [];
    const store = makeStore(seen, okRetriever(calls));
    store.getState().setSessionKnowledgeIds(SEED_IDS.root, [KB]);
    store.getState().sendMessage(SEED_IDS.root, '질문');
    await idle(store);
    expect(calls).toHaveLength(1);
    store.getState().setSessionKnowledgeIds(SEED_IDS.root, []);
    store.getState().sendMessage(SEED_IDS.root, '질문 두번째');
    await idle(store);
    expect(calls).toHaveLength(1);
  });

  it('검색기가 있어도 bridge 파일 도구용 knowledgeId(적용되는 첫 KB)를 계속 넘긴다', async () => {
    const seen: StreamRequest[] = [];
    const store = makeStore(seen, failRetriever);
    const chatFor = (q: string) =>
      seen.find((r) => r.purpose !== 'title' && r.purpose !== 'summary' && r.messages.at(-1)?.content === q);
    store.getState().setSessionKnowledgeIds(SEED_IDS.root, [KB, KB2]);
    store.getState().sendMessage(SEED_IDS.root, '질문');
    await idle(store);
    expect(seen[0]!.knowledgeId).toBe(KB);

    // 가지가 덮어쓰면 가지의 첫 KB, 끄면([]) 넘기지 않는다
    const child = store.getState().newSubSession(SEED_IDS.root, undefined, { focus: false }) as string;
    store.getState().setSessionKnowledgeIds(child, [KB2]);
    store.getState().sendMessage(child, '가지 질문');
    await idle(store);
    expect(chatFor('가지 질문')?.knowledgeId).toBe(KB2);
    store.getState().setSessionKnowledgeIds(child, []);
    store.getState().sendMessage(child, '끈 뒤 질문');
    await idle(store);
    expect(chatFor('끈 뒤 질문')).toBeDefined();
    expect(chatFor('끈 뒤 질문')!.knowledgeId).toBeUndefined();
  });

  it('한국어 질문은 모델로 영어 검색어를 받아 검색 계획에 더한다 (ADR-119)', async () => {
    const seen: StreamRequest[] = [];
    const calls: RetrievalRequest[] = [];
    const searches: StreamRequest[] = [];
    const store = makeStore(seen, okRetriever(calls), { searches, reply: '- ShouldContainerBeRestarted\n2. `syncReplicaSet()`\n설명 문장' });
    store.getState().setSessionKnowledgeIds(SEED_IDS.root, [KB]);
    store.getState().sendMessage(SEED_IDS.root, '파드가 죽으면 다시 살리는 코드 찾아줘');
    await idle(store);

    expect(searches).toHaveLength(1);
    expect(searches[0]!.knowledgeId).toBeUndefined();
    expect(searches[0]!.webSearch).toBeUndefined();
    const plan = calls[0]!.plan;
    expect(plan.rewritten).toContain('ShouldContainerBeRestarted');
    expect(plan.rewritten).toContain('syncReplicaSet');
    expect(plan.keywordQuery).toEqual(expect.arrayContaining(['shouldcontainerberestarted', 'syncreplicaset']));
    expect(seen[0]!.system).toContain('<documents>');
  });

  it('영어 질문이나 설정을 끈 경우는 확장하지 않는다', async () => {
    const searches: StreamRequest[] = [];
    const store = makeStore([], okRetriever([]), { searches, reply: 'x_term' });
    store.getState().setSessionKnowledgeIds(SEED_IDS.root, [KB]);
    store.getState().sendMessage(SEED_IDS.root, 'where is syncReplicaSet?');
    await idle(store);
    expect(searches).toHaveLength(0);

    store.getState().updateSettings({ rag: { ...DEFAULT_RAG_SETTINGS, ...store.getState().settings.rag, expandQuery: false } });
    store.getState().sendMessage(SEED_IDS.root, '재시작 코드 찾아줘');
    await idle(store);
    expect(searches).toHaveLength(0);
  });

  it('확장이 실패해도 원래 계획으로 검색하고 답한다', async () => {
    const seen: StreamRequest[] = [];
    const calls: RetrievalRequest[] = [];
    const store = makeStore(seen, okRetriever(calls), { reply: new Error('boom') });
    store.getState().setSessionKnowledgeIds(SEED_IDS.root, [KB]);
    store.getState().sendMessage(SEED_IDS.root, '재시작 코드 찾아줘');
    await idle(store);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.plan.rewritten).not.toContain('boom');
    expect(seen[0]!.system).toContain('<documents>');
  });

  it('지식베이스가 없으면 knowledgeId를 넘기지 않는다', async () => {
    const seen: StreamRequest[] = [];
    const store = makeStore(seen);
    store.getState().sendMessage(SEED_IDS.root, '안녕');
    await idle(store);
    expect(seen[0]!.knowledgeId).toBeUndefined();
  });
});

describe('createBranch and knowledge', () => {
  it('가지를 만들어도 지식베이스 목록은 복사되지 않는다', () => {
    const store = makeStore([]);
    store.getState().setSessionKnowledgeIds(SEED_IDS.root, [KB]);
    const child = store.getState().newSubSession(SEED_IDS.root, undefined, { focus: false }) as string;
    expect(store.getState().sessions[child]!.knowledgeIds).toBeUndefined();
    expect(store.getState().sessions[child]!.knowledgeId).toBeUndefined();
  });
});
