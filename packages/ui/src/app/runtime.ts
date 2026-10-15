import {
  createBridgeClient,
  createBridgeProviders,
  createRemoteBridgeLink,
  createRemoteBridgeProviders,
  memorySecretStore,
  REMOTE_PAIRING_SECRET,
  type RemotePairing,
  type BridgeClient,
  type BridgeTransport,
  type DesktopApi,
  type MobileApi,
  type LLMProvider,
  type ProviderId,
  type SecretStore,
} from '@branch/core';
import { create } from 'zustand';

declare global {
  interface Window {
    /** 데스크톱(Electron) preload가 주입한다 */
    branchDesktop?: DesktopApi;
    /** 모바일(Capacitor) 진입점이 주입한다 */
    branchMobile?: MobileApi;
  }
}

/**
 * 플랫폼 런타임.
 * - 웹: 비밀 값(API 키)은 탭 메모리에만 둔다. 새로고침하면 사라진다(설정에 경고 표시).
 * - 데스크톱: 비밀 값은 OS 보안 저장소(safeStorage)에, CLI provider는 내장 bridge(IPC)로.
 * - 모바일: 비밀 값은 Keychain/Keystore에. CLI는 쓰지 않고 PC와 원격 페어링한다.
 * - 데모 모드: 개발 서버의 데모 시나리오가 켜져 있으면 모든 provider가 Mock으로 동작한다.
 */
export const desktop: DesktopApi | undefined = typeof window !== 'undefined' ? window.branchDesktop : undefined;
export const mobile: MobileApi | undefined = typeof window !== 'undefined' ? window.branchMobile : undefined;

/**
 * 세션 창이면 처음 연 세션 id (ADR-036). main 프로세스가 `?window=session&session=<id>`로 연다.
 * 동기화 링크가 있는 데스크톱 창에서만 유효하다.
 */
export const sessionWindowId: string | null = (() => {
  if (!desktop?.windows?.link || typeof window === 'undefined') return null;
  const q = new URLSearchParams(window.location.search);
  return q.get('window') === 'session' ? q.get('session') : null;
})();

function platformSecretStore(api: DesktopApi['secrets']): SecretStore {
  return {
    kind: api.persistent ? 'os' : 'memory',
    get: (name) => api.get(name),
    set: (name, value) => api.set(name, value),
    delete: (name) => api.delete(name),
  };
}

const platformSecrets = desktop?.secrets ?? mobile?.secrets;
export const secrets: SecretStore = platformSecrets ? platformSecretStore(platformSecrets) : memorySecretStore();

function ipcTransport(api: DesktopApi): BridgeTransport {
  return {
    send: (msg) => api.bridge.send(msg),
    subscribe: (listener) => api.bridge.onMessage(listener),
  };
}

/* ── 원격 Bridge (Phase 4, ADR-018) ─────────────────────── */

/** 페어링 기록(기기 비밀키 포함)은 보안 저장소에 JSON 한 덩어리로 둔다. 웹은 탭 메모리 */
export async function loadRemotePairing(): Promise<RemotePairing | null> {
  const raw = await secrets.get(REMOTE_PAIRING_SECRET);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as RemotePairing;
  } catch {
    return null;
  }
}

export const remoteLink = createRemoteBridgeLink({
  getPairing: loadRemotePairing,
  wsFactory: (url) => new WebSocket(url),
});

export async function saveRemotePairing(p: RemotePairing | null): Promise<void> {
  remoteLink.reset();
  if (p) await secrets.set(REMOTE_PAIRING_SECRET, JSON.stringify(p));
  else await secrets.delete(REMOTE_PAIRING_SECRET);
}

/**
 * 플랫폼이 제공하는 provider (ADR-025).
 * - 데스크톱: 내장 bridge의 Claude/Codex CLI + 원격 Bridge(다른 PC에 연결)
 * - 웹/모바일: 원격 Bridge만. CLI는 '사용 불가'이며 PC의 CLI는 원격 Bridge 하나로만 쓴다
 *   (에이전트·모델·노력치는 PC 설정이 정한다)
 */
const remoteClient = createBridgeClient(remoteLink, { offlineMessage: '원격 Bridge와 연결이 끊어졌습니다.' });
const localClient = desktop
  ? createBridgeClient(ipcTransport(desktop), { offlineMessage: '내장 bridge에 연결할 수 없습니다. 앱을 재시작하세요.' })
  : null;

export const platformProviders: Partial<Record<ProviderId, LLMProvider>> = {
  ...createRemoteBridgeProviders({ link: remoteLink, client: remoteClient, getPairing: loadRemotePairing }),
  ...(localClient ? createBridgeProviders(localClient) : {}),
};

/**
 * 음성 전사를 맡길 bridge (ADR-045). 데스크톱(세션 창 포함)은 내장 bridge, 웹·모바일은 페어링된 PC.
 * 켜짐·모델은 PC 설정을 따른다.
 */
export const sttClient: { client: BridgeClient; remote: boolean } = localClient
  ? { client: localClient, remote: false }
  : { client: remoteClient, remote: true };

const hasScenarioHash = () => /scenario=[\w-]+/.test(window.location.hash);

interface RuntimeState {
  demo: boolean;
  setDemo(demo: boolean): void;
}

export const useRuntime = create<RuntimeState>((set) => ({
  demo: import.meta.env.DEV && hasScenarioHash(),
  setDemo: (demo) => set({ demo }),
}));

export const isDemo = () => useRuntime.getState().demo;

/** 개발용: 로컬 모의 SSE 서버 등으로 API 엔드포인트를 바꾼다 */
export const baseUrls = {
  'anthropic-api': (import.meta.env.VITE_ANTHROPIC_BASE_URL as string | undefined) || undefined,
  'openai-api': (import.meta.env.VITE_OPENAI_BASE_URL as string | undefined) || undefined,
};
