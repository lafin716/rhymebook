import type { ConnectionState, ProviderId } from '../model';
import { PROVIDER_LABELS, ProviderRegistry, type Availability } from '../provider';
import { createMockProvider } from './mock';

const ALL: ProviderId[] = ['mock', 'claude-cli', 'codex-cli', 'anthropic-api', 'openai-api', 'remote-bridge'];

export function connectionAvailability(c: ConnectionState | undefined): Availability {
  if (!c || c.status === 'checking') return { status: 'offline' };
  if (c.status === 'ready') return c.enabled ? { status: 'ready' } : { status: 'offline', detail: '비활성화됨' };
  return { status: c.status };
}

/**
 * 프로토타입용 레지스트리: 모든 provider id를 MockProvider로 등록하고,
 * 가용성은 (목업) 연결 상태를 따른다. 실제 provider는 Phase 1부터 교체 등록한다.
 */
export function createDemoRegistry(getConnections: () => Record<ProviderId, ConnectionState>): ProviderRegistry {
  const registry = new ProviderRegistry();
  for (const id of ALL) {
    registry.register(
      createMockProvider({
        id,
        label: PROVIDER_LABELS[id],
        availability: () => connectionAvailability(getConnections()[id]),
      }),
    );
  }
  return registry;
}
