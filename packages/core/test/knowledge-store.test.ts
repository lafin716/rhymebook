import { beforeEach, describe, expect, it } from 'vitest';
import { createSeed, emptyView, SEED_IDS } from '../src/seed';
import { createAppStore, type AppStore } from '../src/store';
import { ProviderRegistry, type StreamRequest } from '../src/provider';
import { mockControl } from '../src/providers/mock';
import { memoryRepository } from '../src/repo';
import { KNOWLEDGE_SKILL_ID, defaultSkills, skillsToSeed } from '../src/skills';

const KB = 'kbabc123def';

const idle = (store: AppStore) =>
  new Promise<void>((resolve) => {
    const check = () => (Object.keys(store.getState().streaming).length === 0 ? resolve() : setTimeout(check, 5));
    setTimeout(check, 5);
  });

/** 요청을 기록하는 provider 하나짜리 저장소 */
function makeStore(seen: StreamRequest[]) {
  const registry = new ProviderRegistry();
  registry.register({
    id: 'mock',
    label: 'M',
    available: async () => ({ status: 'ready' }),
    async *stream(req) {
      seen.push(req);
      yield { type: 'delta', text: '답' };
      yield { type: 'done' };
    },
  });
  const store: AppStore = createAppStore({
    registry,
    repo: memoryRepository(),
    initial: { ...createSeed(0), view: emptyView(SEED_IDS.root) },
  });
  return store;
}

describe('setSessionKnowledge', () => {
  beforeEach(() => {
    mockControl.firstTokenDelay = 0;
    mockControl.speed = 0;
  });

  it('루트 세션에만 지식베이스를 붙이고, 가지는 루트의 것을 쓴다', () => {
    const store = makeStore([]);
    const child = store.getState().newSubSession(SEED_IDS.root, undefined, { focus: false }) as string;
    expect(child).not.toBe(false);

    // 가지에서 연결해도 루트에 저장된다
    store.getState().setSessionKnowledge(child, KB);
    expect(store.getState().sessions[SEED_IDS.root]!.knowledgeId).toBe(KB);
    expect(store.getState().sessions[child]!.knowledgeId).toBeUndefined();
    expect(store.getState().sessions[child]!.rootId).toBe(SEED_IDS.root);

    store.getState().setSessionKnowledge(child, null);
    expect(store.getState().sessions[SEED_IDS.root]!.knowledgeId).toBeUndefined();
  });

  it('형식이 맞지 않는 id는 무시하고, 해제하면 키를 지운다', () => {
    const store = makeStore([]);
    store.getState().setSessionKnowledge(SEED_IDS.root, KB);
    store.getState().setSessionKnowledge(SEED_IDS.root, '../etc');
    expect(store.getState().sessions[SEED_IDS.root]!.knowledgeId).toBe(KB);
    store.getState().setSessionKnowledge(SEED_IDS.root, null);
    expect('knowledgeId' in store.getState().sessions[SEED_IDS.root]!).toBe(false);
    store.getState().setSessionKnowledge('nope', KB);
    expect(store.getState().sessions['nope']).toBeUndefined();
  });

  it('일반 대화 요청에 루트의 knowledgeId를 싣고, 가지에서도 같은 값을 싣는다', async () => {
    const seen: StreamRequest[] = [];
    const store = makeStore(seen);
    store.getState().setSessionProvider(SEED_IDS.root, 'mock');
    store.getState().setSessionKnowledge(SEED_IDS.root, KB);
    const child = store.getState().newSubSession(SEED_IDS.root, undefined, { focus: false }) as string;
    store.getState().setSessionProvider(child, 'mock');

    store.getState().sendMessage(SEED_IDS.root, '질문 하나');
    await idle(store);
    store.getState().sendMessage(child, '가지 질문');
    await idle(store);

    // 제목 생성 같은 내부 요청은 빼고 일반 대화 요청만 본다
    const chats = seen.filter((r) => !r.purpose || r.purpose === 'chat');
    expect(chats).toHaveLength(2);
    expect(chats[0]!.knowledgeId).toBe(KB);
    expect(chats[1]!.knowledgeId).toBe(KB);
    expect(seen.filter((r) => r.purpose && r.purpose !== 'chat').every((r) => r.knowledgeId === undefined)).toBe(true);
  });

  it('지식베이스가 없으면 요청에 knowledgeId를 싣지 않는다', async () => {
    const seen: StreamRequest[] = [];
    const store = makeStore(seen);
    store.getState().setSessionProvider(SEED_IDS.root, 'mock');
    store.getState().sendMessage(SEED_IDS.root, '질문');
    await idle(store);
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((r) => r.knowledgeId === undefined)).toBe(true);
  });
});

describe('지식베이스 기본 스킬', () => {
  it('기본 스킬 목록에 지식베이스 탐색이 있고 기존 사용자에게도 한 번 시드된다', () => {
    const def = defaultSkills(0).find((s) => s.id === KNOWLEDGE_SKILL_ID);
    expect(def).toMatchObject({ name: 'knowledge', title: '지식베이스 탐색', builtin: true });
    expect(def!.prompt).toContain('Glob');

    // 이미 예전 기본 스킬을 시드한 사용자: 지식베이스 스킬만 새로 들어간다
    const old = ['skill-curriculum', 'skill-book', 'skill-quiz', 'skill-speak', 'skill-reorganize', 'skill-schedule'];
    const { add, seeded } = skillsToSeed(defaultSkills(0).filter((s) => s.id !== KNOWLEDGE_SKILL_ID), old);
    expect(add.map((s) => s.id)).toEqual([KNOWLEDGE_SKILL_ID]);
    expect(seeded).toContain(KNOWLEDGE_SKILL_ID);
    // 한 번 지운 뒤에는 다시 넣지 않는다
    expect(skillsToSeed([], seeded).add.some((s) => s.id === KNOWLEDGE_SKILL_ID)).toBe(false);
  });
});
