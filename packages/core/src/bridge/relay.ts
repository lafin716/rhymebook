import { sha256 } from '@noble/hashes/sha2.js';
import { concatBytes, utf8ToBytes } from '@noble/hashes/utils.js';

/**
 * relay 중계 프로토콜 (03-PROVIDERS Relay, ADR-020).
 * - bridge는 relay에 아웃바운드로 `/b/<bridgeId>` 제어 소켓을 연다 (NAT 통과).
 * - 클라이언트는 `/c/<bridgeId>`로 접속하고, relay는 그 소켓의 텍스트 프레임을 채널 번호를 붙여 bridge 제어 소켓으로 그대로 넘긴다.
 * - 클라이언트↔bridge 사이에는 직접 연결과 똑같은 핸드셰이크·E2E 암호 프레임이 흐른다. relay는 임시 공개키와 암호문만 본다.
 * - bridge 등록은 relay가 준 nonce에 bridge 신원 키로 서명해 증명한다 (bridgeId = 공개키 해시이므로 등록 토큰이 필요 없다).
 */
export const RELAY_PROTOCOL = 'branch-relay/1';

/** relay → bridge */
export type RelayToBridge =
  | { t: 'challenge'; nonce: string }
  | { t: 'ready' }
  | { t: 'open'; ch: number }
  | { t: 'data'; ch: number; d: string }
  | { t: 'close'; ch: number };

/** bridge → relay */
export type BridgeToRelay =
  | { t: 'register'; key: string; sig: string }
  | { t: 'data'; ch: number; d: string }
  | { t: 'close'; ch: number; code?: number };

/** relay에 bridge가 없을 때 클라이언트 소켓을 닫는 코드 */
export const RELAY_CLOSE_OFFLINE = 4404;

const BRIDGE_ID_RE = /^brg_[A-Za-z0-9_-]{8,32}$/;

export function isBridgeId(id: string): boolean {
  return BRIDGE_ID_RE.test(id);
}

/** 등록 서명 대상: 프로토콜 · nonce · bridgeId */
export function relayRegisterTranscript(nonce: string, bridgeId: string): Uint8Array {
  return sha256(concatBytes(utf8ToBytes(RELAY_PROTOCOL), utf8ToBytes(nonce), utf8ToBytes(bridgeId)));
}

function base(relay: string): string {
  return relay.trim().replace(/\/+$/, '');
}

/** 클라이언트가 접속할 주소: wss://relay.example.com/c/brg_… */
export function relayClientUrl(relay: string, bridgeId: string): string {
  return `${base(relay)}/c/${bridgeId}`;
}

/** bridge가 아웃바운드로 접속할 주소 */
export function relayBridgeUrl(relay: string, bridgeId: string): string {
  return `${base(relay)}/b/${bridgeId}`;
}

/** relay 클라이언트 주소인지 (경로가 /c/<bridgeId>) */
export function isRelayUrl(url: string): boolean {
  try {
    return /\/c\/brg_[A-Za-z0-9_-]+$/.test(new URL(url).pathname);
  } catch {
    return false;
  }
}

/** 텍스트 프레임 파싱 (형식이 틀리면 null) */
export function parseRelayFrame<T extends { t: string }>(data: string): T | null {
  try {
    const f = JSON.parse(data) as T;
    return f && typeof f === 'object' && typeof f.t === 'string' ? f : null;
  } catch {
    return null;
  }
}
