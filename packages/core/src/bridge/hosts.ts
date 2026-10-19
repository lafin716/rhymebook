import type { RemotePairing } from './remote';

/**
 * 저장해 둔 원격 PC 목록 (웹·모바일, ADR-063).
 * 지금 쓰는 페어링은 REMOTE_PAIRING_SECRET 하나이고, 전환할 수 있는 PC들은 이 목록에 둔다.
 * 기기 비밀키가 들어 있으므로 목록도 통째로 SecretStore에 둔다. PC는 bridgeId로 구분한다.
 */
export const REMOTE_HOSTS_SECRET = 'pairing:remote-hosts';

function isPairing(v: unknown): v is RemotePairing {
  if (!v || typeof v !== 'object') return false;
  const p = v as Record<string, unknown>;
  return typeof p.url === 'string' && typeof p.bridgeId === 'string' && typeof p.bridgeKey === 'string' && typeof p.deviceSecret === 'string';
}

/** 저장 값을 읽는다. 깨졌거나 모양이 다른 항목은 버린다 */
export function parseHostList(raw: string | null | undefined): RemotePairing[] {
  if (!raw) return [];
  try {
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) ? v.filter(isPairing) : [];
  } catch {
    return [];
  }
}

/** 같은 PC(bridgeId)를 다시 페어링하면 그 자리를 바꾸고, 새 PC는 맨 뒤에 붙인다 */
export function upsertHost(list: readonly RemotePairing[], p: RemotePairing): RemotePairing[] {
  const i = list.findIndex((h) => h.bridgeId === p.bridgeId);
  if (i < 0) return [...list, p];
  return list.map((h, j) => (j === i ? p : h));
}

export function removeHost(list: readonly RemotePairing[], bridgeId: string): RemotePairing[] {
  return list.filter((h) => h.bridgeId !== bridgeId);
}

/** 목록 기능 전에 페어링한 PC(활성 페어링만 있음)도 목록에 넣는다 */
export function withActiveHost(list: readonly RemotePairing[], active: RemotePairing | null): RemotePairing[] {
  if (!active || list.some((h) => h.bridgeId === active.bridgeId)) return [...list];
  return [active, ...list];
}
