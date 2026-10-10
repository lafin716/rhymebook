import type { ConnectionState, ProviderId } from '../model';
import {
  PROVIDER_LABELS,
  ProviderRegistry,
  providerError,
  type Availability,
  type LLMProvider,
  type StreamEvent,
} from '../provider';
import { secretName, type SecretStore } from '../secrets';
import { createAnthropicProvider } from './anthropic';
import { connectionAvailability } from './demo';
import type { FetchLike } from './http';
import { availabilityMessage, createMockProvider } from './mock';
import { createOpenAIProvider } from './openai';

export const ALL_PROVIDER_IDS: ProviderId[] = [
  'mock',
  'claude-cli',
  'codex-cli',
  'anthropic-api',
  'openai-api',
  'remote-bridge',
];

/** 아직 이 플랫폼에서 쓸 수 없는 provider (CLI는 데스크톱/원격 Bridge 필요) */
export function createUnavailableProvider(id: ProviderId, availability: Availability): LLMProvider {
  return {
    id,
    label: PROVIDER_LABELS[id],
    async available() {
      return availability;
    },
    async *stream(): AsyncIterable<StreamEvent> {
      const code = availability.status === 'no-key' ? 'auth' : availability.status === 'offline' ? 'offline' : 'cli';
      yield { type: 'error', error: providerError(code, availability.detail ?? availabilityMessage(availability)) };
    },
  };
}

/** 연결 카드의 '사용' 토글이 꺼져 있으면 호출을 offline 오류로 막는다 */
export function gateEnabled(p: LLMProvider, isEnabled: () => boolean): LLMProvider {
  return {
    id: p.id,
    label: p.label,
    // 가용성은 그대로 보고하고(카드 상태 표시), 실제 호출만 막는다
    available: () => p.available(),
    async *stream(req) {
      if (!isEnabled()) {
        yield { type: 'error', error: providerError('offline', `${p.label} 연결이 비활성화되어 있습니다.`) };
        return;
      }
      yield* p.stream(req);
    },
  };
}

/** 호출 시점에 데모(Mock) / 실제 provider를 고른다 */
export function routeProvider(real: LLMProvider, demo: LLMProvider, isDemo: () => boolean): LLMProvider {
  return {
    id: real.id,
    label: real.label,
    available: () => (isDemo() ? demo.available() : real.available()),
    stream: (req) => (isDemo() ? demo.stream(req) : real.stream(req)),
  };
}

export interface RuntimeRegistryOptions {
  secrets: SecretStore;
  getConnections: () => Record<ProviderId, ConnectionState>;
  /** true면 모든 provider를 Mock으로 (데모 시나리오) */
  isDemo?: () => boolean;
  /** 개발/테스트용 API 엔드포인트 교체 (로컬 모의 서버 등) */
  baseUrls?: Partial<Record<'anthropic-api' | 'openai-api', string>>;
  fetch?: FetchLike;
  /** 플랫폼이 제공하는 provider로 덮어쓰기 (Electron의 CLI, 원격 Bridge 등) */
  overrides?: Partial<Record<ProviderId, LLMProvider>>;
}

const CLI_ELSEWHERE = '웹·모바일에서는 이 기기에서 CLI를 직접 실행할 수 없습니다. 데스크톱 앱이나 원격 Bridge로 연결하세요.';

/**
 * 실제 provider 레지스트리.
 * - Anthropic/OpenAI: BYOK 실호출(키는 SecretStore)
 * - CLI/원격 Bridge: 플랫폼 overrides가 없으면 '사용 불가' 스텁
 * - mock: 데모 모드. isDemo()가 true면 모든 id가 Mock(목업 연결 상태 반영)으로 동작
 */
export function createRuntimeRegistry(opts: RuntimeRegistryOptions): ProviderRegistry {
  const isDemo = opts.isDemo ?? (() => false);
  const conn = (id: ProviderId) => opts.getConnections()[id];
  const enabled = (id: ProviderId) => conn(id)?.enabled !== false;
  const keyOf = (id: ProviderId) => () => opts.secrets.get(secretName.apiKey(id));
  const modelOf = (id: ProviderId) => () => conn(id)?.model || undefined;

  const real: Record<ProviderId, LLMProvider> = {
    mock: createMockProvider({ id: 'mock', label: PROVIDER_LABELS.mock }),
    'anthropic-api': createAnthropicProvider({
      getKey: keyOf('anthropic-api'),
      getModel: modelOf('anthropic-api'),
      baseUrl: opts.baseUrls?.['anthropic-api'],
      fetch: opts.fetch,
    }),
    'openai-api': createOpenAIProvider({
      getKey: keyOf('openai-api'),
      getModel: modelOf('openai-api'),
      baseUrl: opts.baseUrls?.['openai-api'],
      fetch: opts.fetch,
    }),
    'claude-cli': createUnavailableProvider('claude-cli', { status: 'not-installed', detail: CLI_ELSEWHERE }),
    'codex-cli': createUnavailableProvider('codex-cli', { status: 'not-installed', detail: CLI_ELSEWHERE }),
    'remote-bridge': createUnavailableProvider('remote-bridge', { status: 'unpaired' }),
    ...opts.overrides,
  };

  const registry = new ProviderRegistry();
  for (const id of ALL_PROVIDER_IDS) {
    const demo = createMockProvider({
      id,
      label: PROVIDER_LABELS[id],
      availability: () => connectionAvailability(conn(id)),
    });
    registry.register(routeProvider(gateEnabled(real[id], () => enabled(id)), demo, isDemo));
  }
  return registry;
}
