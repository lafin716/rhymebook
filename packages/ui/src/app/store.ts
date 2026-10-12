import {
  createAppStore,
  createRuntimeRegistry,
  defaultConnections,
  emptyView,
  gatedRepository,
  initialConnections,
  RUNTIME_SETTINGS,
  type AppState,
} from '@branch/core';
import { useStore } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import { BranchDB, createDexieRepository } from '../persist/db';
import { hydrate } from '../persist/hydrate';
import { caps, remoteMode, sanitizeSettings } from './capabilities';
import { baseUrls, isDemo, platformProviders, secrets } from './runtime';

/** IndexedDB 저장소. 데모 모드와 불러오기 실패 시에는 쓰지 않는다 */
export const db = new BranchDB();
export const persistence = createDexieRepository(db);
let persistEnabled = false;

/**
 * 앱 전역 스토어 (플랫폼 무관 core 스토어를 UI에 연결).
 * provider는 실제 레지스트리(Anthropic/OpenAI BYOK)이며, 데모 모드에서는 Mock으로 라우팅된다.
 * 초기값은 빈 데이터이고, 실제 모드에서는 시작 시 `loadPersisted()`로 저장된 데이터로 교체한다.
 */
export const appStore = createAppStore({
  registry: createRuntimeRegistry({
    secrets,
    getConnections: () => appStore.getState().connections,
    isDemo,
    baseUrls,
    overrides: platformProviders,
  }),
  repo: gatedRepository(persistence, () => persistEnabled && !isDemo()),
  // 웹·모바일은 이 기기에 저장하지 않는다. 데이터는 PC에 있고 SyncClient가 미러링한다 (ADR-026)
  remote: remoteMode,
  initial: {
    sessions: {},
    messages: {},
    view: emptyView(),
    settings: { ...RUNTIME_SETTINGS, ...sanitizeSettings(RUNTIME_SETTINGS) },
    connections: isDemo() ? defaultConnections() : initialConnections(),
  },
  viewport: () => ({ width: window.innerWidth, height: window.innerHeight }),
});

/** 저장된 데이터를 스토어에 싣고 연결 상태를 다시 감지한다 (실제 모드 시작·데모 종료 시) */
export async function loadPersisted() {
  persistEnabled = false;
  const { data, persisted } = await hydrate(persistence);
  if (isDemo()) return;
  persistEnabled = persisted;
  appStore.getState().load(data);
  applyPlatformSettings();
  void appStore.getState().refreshConnections();
}

/** 저장·복원된 설정을 이 플랫폼의 provider로 맞춘다 (백업 복원 후에도 호출) */
export function applyPlatformSettings() {
  const patch = sanitizeSettings(appStore.getState().settings);
  if (patch) appStore.getState().updateSettings(patch);
  // 모델을 고를 수 없는 플랫폼에서는 저장·복원된 모델 지정을 지우고 기본 모델을 쓴다
  if (!caps.modelChoice) {
    const st = appStore.getState();
    for (const id of ['anthropic-api', 'openai-api', 'claude-cli', 'codex-cli'] as const) {
      const c = st.connections[id];
      if (c.model || c.effort) st.setConnection(id, { model: undefined, effort: undefined });
    }
  }
}

export { caps, remoteMode };

/** 스토어 구독 훅. 객체/배열을 새로 만드는 selector는 useAppShallow를 쓴다 */
export function useApp<T>(selector: (s: AppState) => T): T {
  return useStore(appStore, selector);
}

export function useAppShallow<T>(selector: (s: AppState) => T): T {
  return useStore(appStore, useShallow(selector));
}

/** 액션 접근 (리렌더 없음) */
export const actions = () => appStore.getState();
