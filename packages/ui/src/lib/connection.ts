import { PROVIDER_LABELS, type ConnectionState, type ConnectionStatus, type ProviderId } from '@branch/core';

export type Tone = 'neutral' | 'ok' | 'warn' | 'danger';

export const STATUS_LABEL: Record<ConnectionStatus, string> = {
  ready: '연결됨',
  'not-installed': '미설치',
  'not-logged-in': '로그인 필요',
  'no-key': '키 없음',
  offline: '오프라인',
  unpaired: '페어링 안 됨',
  checking: '확인 중…',
};

export function statusTone(c: ConnectionState | undefined): Tone {
  if (!c) return 'neutral';
  if (c.status === 'ready') return c.enabled ? 'ok' : 'neutral';
  if (c.status === 'offline') return 'danger';
  if (c.status === 'checking') return 'neutral';
  return 'warn';
}

/** 이 provider로 지금 요청을 보낼 수 있는가 */
export function isUsable(c: ConnectionState | undefined): boolean {
  return !!c && c.enabled && c.status === 'ready';
}

export function providerLabel(id: ProviderId): string {
  return PROVIDER_LABELS[id];
}

/** 연결 종류 (설정 화면 그룹/아이콘) */
export function providerKind(id: ProviderId): 'cli' | 'api' | 'bridge' | 'demo' {
  if (id === 'claude-cli' || id === 'codex-cli') return 'cli';
  if (id === 'anthropic-api' || id === 'openai-api') return 'api';
  if (id === 'remote-bridge') return 'bridge';
  return 'demo';
}

export const PROVIDER_ORDER: ProviderId[] = ['anthropic-api', 'openai-api', 'claude-cli', 'codex-cli', 'remote-bridge', 'mock'];
