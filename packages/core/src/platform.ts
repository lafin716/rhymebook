import type { BridgeClientMsg, CliProviderId } from './bridge/protocol';
import { isValidEffort, isValidModelName } from './cli-options';
import type { ProviderId } from './model';

/**
 * 플랫폼별 연결 능력 (ADR-025).
 * - 데스크톱(PC): 이 기기의 공식 CLI 직접 실행 + API 키 + 원격 페어링 열기(호스트) + 다른 PC에 연결
 * - 웹·모바일: API 키 + 내 PC에 원격 페어링 연결만. CLI 직접 실행과 모델·노력치 선택은 막는다
 *   (원격 요청의 모델·노력치는 PC가 정한다)
 */
export type PlatformKind = 'desktop' | 'web' | 'mobile';

export interface PlatformCaps {
  kind: PlatformKind;
  /** 이 기기에서 공식 CLI를 직접 실행 */
  localCli: boolean;
  /** 이 기기를 원격 페어링 호스트로 열 수 있음 */
  hostPairing: boolean;
  /** 모델·노력치를 이 기기에서 고를 수 있음 */
  modelChoice: boolean;
  /** 이 플랫폼에서 보여 줄 provider (권장 순서) */
  providers: ProviderId[];
}

// 'mock'(데모)은 개발용 시나리오 전용이라 사용자가 고르는 목록에 넣지 않는다
const DESKTOP_PROVIDERS: ProviderId[] = ['claude-cli', 'codex-cli', 'anthropic-api', 'openai-api', 'remote-bridge'];
const REMOTE_PROVIDERS: ProviderId[] = ['remote-bridge', 'anthropic-api', 'openai-api'];

export function platformCaps(kind: PlatformKind, opts: { hostPairing?: boolean } = {}): PlatformCaps {
  if (kind === 'desktop') {
    return { kind, localCli: true, hostPairing: opts.hostPairing ?? true, modelChoice: true, providers: DESKTOP_PROVIDERS };
  }
  return { kind, localCli: false, hostPairing: false, modelChoice: false, providers: REMOTE_PROVIDERS };
}

/** 목록을 플랫폼이 쓰는 provider로 거른다. 빠진 플랫폼 provider는 끝에 붙인다 (저장된 대체 순서 정리용) */
export function orderForPlatform(order: readonly ProviderId[], caps: PlatformCaps): ProviderId[] {
  const kept = order.filter((id) => caps.providers.includes(id));
  return [...kept, ...caps.providers.filter((id) => !kept.includes(id))];
}

/* ── 원격 페어링 호스트 정책 ─────────────────────────────── */

/** 원격 기기 요청을 처리할 에이전트. auto면 준비된 CLI(Claude 우선) */
export type HostAgent = 'auto' | CliProviderId;

export interface HostPolicy {
  agent: HostAgent;
  /** PC 설정의 CLI별 기본 모델·노력치 */
  options: Partial<Record<CliProviderId, { model?: string; effort?: string }>>;
}

/**
 * 원격 기기가 보낸 요청에 PC의 정책을 적용한다.
 * 에이전트는 PC가 고른 것으로 바꾸고, 모델·노력치는 원격 값을 버리고 PC 기본값으로 덮어쓴다.
 * 정책이 없으면(헤드리스 bridge) 그대로 둔다.
 */
export function applyHostPolicy(msg: BridgeClientMsg, policy: HostPolicy | null | undefined): BridgeClientMsg {
  if (!policy || msg.type !== 'chat.start') return msg;
  const providerId = policy.agent === 'auto' ? msg.providerId : policy.agent;
  const opt = policy.options[providerId] ?? {};
  const model = opt.model && isValidModelName(opt.model) ? opt.model : undefined;
  const effort = opt.effort && isValidEffort(providerId, opt.effort, model) ? opt.effort : undefined;
  const { model: _m, effort: _e, ...rest } = msg;
  return { ...rest, providerId, ...(model ? { model } : {}), ...(effort ? { effort } : {}) };
}

export function isHostPolicy(v: unknown): v is HostPolicy {
  if (!v || typeof v !== 'object') return false;
  const p = v as Record<string, unknown>;
  if (p.agent !== 'auto' && p.agent !== 'claude-cli' && p.agent !== 'codex-cli') return false;
  if (!p.options || typeof p.options !== 'object') return false;
  for (const [k, o] of Object.entries(p.options as Record<string, unknown>)) {
    if (k !== 'claude-cli' && k !== 'codex-cli') return false;
    if (!o || typeof o !== 'object') return false;
    const { model, effort } = o as Record<string, unknown>;
    if (model !== undefined && typeof model !== 'string') return false;
    if (effort !== undefined && typeof effort !== 'string') return false;
  }
  return true;
}
