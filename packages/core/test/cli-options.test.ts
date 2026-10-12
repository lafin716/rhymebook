import { beforeEach, describe, expect, it } from 'vitest';
import { effortsFor, isValidModelName, resolveModelOptions } from '../src/cli-options';
import { connectionPrefs, restoreData, toStoredData } from '../src/persist';
import { ProviderRegistry, type LLMProvider, type StreamRequest } from '../src/provider';
import { createSeed, DEFAULT_SETTINGS, emptyView, initialConnections, SEED_IDS } from '../src/seed';
import { createAppStore, type AppStore } from '../src/store';

describe('resolveModelOptions', () => {
  it('세션 덮어쓰기 → 연결 기본값 순서, 노력치는 CLI에만', () => {
    const conn = { model: 'sonnet', effort: 'medium' };
    expect(resolveModelOptions('claude-cli', undefined, conn)).toEqual({ model: 'sonnet', effort: 'medium' });
    expect(resolveModelOptions('claude-cli', { providerId: 'claude-cli', effort: 'max' }, conn)).toEqual({ model: 'sonnet', effort: 'max' });
    expect(resolveModelOptions('claude-cli', { providerId: 'claude-cli', model: 'opus' }, undefined)).toEqual({ model: 'opus' });
    expect(resolveModelOptions('anthropic-api', undefined, { model: 'm', effort: 'high' })).toEqual({ model: 'm' });
  });

  it('다른 provider용 덮어쓰기와 모델이 지원하지 않는 노력치는 무시', () => {
    expect(resolveModelOptions('codex-cli', { providerId: 'claude-cli', model: 'opus' }, {})).toEqual({});
    expect(resolveModelOptions('codex-cli', { providerId: 'codex-cli', model: 'gpt-6-luna', effort: 'ultra' }, {})).toEqual({ model: 'gpt-6-luna' });
    expect(resolveModelOptions('claude-cli', undefined, { effort: 'ultra' })).toEqual({});
  });

  it('모델 이름 검증과 모델별 노력치', () => {
    expect(isValidModelName('claude-opus-5-5')).toBe(true);
    expect(isValidModelName('opus[1m]')).toBe(true);
    expect(isValidModelName('-m')).toBe(false);
    expect(isValidModelName('a b')).toBe(false);
    expect(isValidModelName('a"b')).toBe(false);
    expect(effortsFor('codex-cli', 'gpt-6-sol')).toContain('ultra');
    expect(effortsFor('codex-cli', 'gpt-6-luna')).not.toContain('ultra');
    expect(effortsFor('codex-cli', 'my-custom')).toContain('ultra');
  });
});

describe('세션별 모델·노력치', () => {
  let seen: StreamRequest[];
  let store: AppStore;
  const fake = (id: 'claude-cli' | 'codex-cli'): LLMProvider => ({
    id,
    label: id,
    available: async () => ({ status: 'ready' }),
    async *stream(req) {
      seen.push(req);
      yield { type: 'delta', text: 'ok' };
      yield { type: 'done' };
    },
  });
  const idle = () =>
    new Promise<void>((resolve) => {
      const check = () => (Object.keys(store.getState().streaming).length ? setTimeout(check, 5) : resolve());
      setTimeout(check, 5);
    });

  beforeEach(() => {
    seen = [];
    const connections = initialConnections();
    connections['claude-cli'] = { ...connections['claude-cli'], status: 'ready', enabled: true, model: 'sonnet', effort: 'medium' };
    store = createAppStore({
      registry: new ProviderRegistry().register(fake('claude-cli')).register(fake('codex-cli')),
      initial: {
        ...createSeed(0),
        view: emptyView(SEED_IDS.root),
        settings: { ...DEFAULT_SETTINGS, defaultProviderId: 'claude-cli' },
        connections,
      },
    });
  });

  it('기본값으로 보내고, 채팅에서 바꾸면 그 값으로 보낸다', async () => {
    const s = store.getState();
    s.sendMessage(SEED_IDS.root, '하나');
    await idle();
    expect(seen.at(-1)).toMatchObject({ model: 'sonnet', effort: 'medium' });

    s.setSessionModel(SEED_IDS.root, { model: 'opus' });
    s.setSessionModel(SEED_IDS.root, { effort: 'max' });
    expect(store.getState().sessions[SEED_IDS.root]!.modelPref).toEqual({ providerId: 'claude-cli', model: 'opus', effort: 'max' });
    s.sendMessage(SEED_IDS.root, '둘');
    await idle();
    expect(seen.at(-1)).toMatchObject({ model: 'opus', effort: 'max' });

    s.setSessionModel(SEED_IDS.root, { model: undefined, effort: undefined });
    expect(store.getState().sessions[SEED_IDS.root]!.modelPref).toBeUndefined();
  });

  it('가지는 부모의 선택을 물려받고, provider를 바꾸면 덮어쓰기를 버린다', async () => {
    const s = store.getState();
    s.setSessionModel(SEED_IDS.root, { model: 'haiku', effort: 'low' });
    const parentMsg = store.getState().messages[SEED_IDS.root]![1]!;
    const id = s.createBranch(SEED_IDS.root, { messageId: parentMsg.id, text: '가중합', startOffset: 0, endOffset: 3 }, 'what') as string;
    await idle();
    expect(store.getState().sessions[id]!.modelPref).toEqual({ providerId: 'claude-cli', model: 'haiku', effort: 'low' });
    expect(seen.at(-1)).toMatchObject({ model: 'haiku', effort: 'low' });

    s.setSessionProvider(id, 'codex-cli');
    expect(store.getState().sessions[id]!.modelPref).toBeUndefined();
    s.setSessionProvider(SEED_IDS.root, 'claude-cli');
    expect(store.getState().sessions[SEED_IDS.root]!.modelPref).toBeDefined();
  });

  it('모델을 바꿔 지원하지 않게 된 노력치는 버린다', () => {
    const s = store.getState();
    s.setSessionProvider(SEED_IDS.root, 'codex-cli');
    s.setSessionModel(SEED_IDS.root, { effort: 'ultra' });
    s.setSessionModel(SEED_IDS.root, { model: 'gpt-6-luna' });
    expect(store.getState().sessions[SEED_IDS.root]!.modelPref).toEqual({ providerId: 'codex-cli', model: 'gpt-6-luna' });
  });
});

describe('연결 기본값 영속화', () => {
  it('노력치를 저장하고 복원한다', () => {
    const connections = initialConnections();
    connections['codex-cli'] = { ...connections['codex-cli'], model: 'gpt-6-sol', effort: 'xhigh' };
    expect(connectionPrefs(Object.values(connections)).find((c) => c.providerId === 'codex-cli')).toEqual({
      providerId: 'codex-cli',
      enabled: connections['codex-cli'].enabled,
      model: 'gpt-6-sol',
      effort: 'xhigh',
    });
    const back = restoreData(toStoredData({ ...createSeed(0), view: emptyView(), settings: DEFAULT_SETTINGS, connections }));
    expect(back.connections['codex-cli']).toMatchObject({ model: 'gpt-6-sol', effort: 'xhigh' });
  });
});
