import { t } from '../i18n';
import { caps } from '../app/capabilities';
import { PROVIDER_LABELS, type ConnectionState, type ConnectionStatus, type ProviderId } from '@branch/core';

export type Tone = 'neutral' | 'ok' | 'warn' | 'danger';

/** 렌더 시점에 번역되는 getter (STATUS_LABEL[status] 형태 그대로 쓴다) */
export const STATUS_LABEL: Record<ConnectionStatus, string> = {
  get ready() { return t('app.connection.status.ready'); },
  get 'not-installed'() { return t('app.connection.status.notInstalled'); },
  get 'not-logged-in'() { return t('app.connection.status.notLoggedIn'); },
  get 'no-key'() { return t('app.connection.status.noKey'); },
  get offline() { return t('app.connection.status.offline'); },
  get unpaired() { return t('app.connection.status.unpaired'); },
  get checking() { return t('app.connection.status.checking'); },
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

/** 이 플랫폼에서 고를 수 있는 provider (ADR-025: 웹·모바일에는 CLI 없음) */
export const PROVIDER_ORDER: readonly ProviderId[] = caps.providers;
