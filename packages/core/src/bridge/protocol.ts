import type { ProviderId } from '../model';
import type { Availability, ChatTurn, ProviderError } from '../provider';

/**
 * Bridge 프로토콜 (JSON 메시지). Electron IPC(내장)와 WebSocket(헤드리스/원격)이 같은 메시지를 쓴다.
 * 히스토리는 앱이 소유하고 bridge는 요청마다 CLI를 무상태로 실행한다 (03-PROVIDERS).
 */
export type CliProviderId = Extract<ProviderId, 'claude-cli' | 'codex-cli'>;
export const CLI_PROVIDER_IDS: CliProviderId[] = ['claude-cli', 'codex-cli'];

/**
 * 원격 WebSocket 프레임 한도 (bridge·relay 공통). 첨부(메시지당 원본 6MB)가 base64 + E2E 암호화를 거쳐도
 * 들어가도록 16MB (ADR-033)
 */
export const REMOTE_MAX_PAYLOAD = 16 * 1024 * 1024;

export type BridgeStatus =Record<CliProviderId, Availability>;

export interface ChatStartMsg {
  type: 'chat.start';
  reqId: string;
  providerId: CliProviderId;
  system: string;
  messages: ChatTurn[];
  model?: string;
  /** CLI 노력치 (bridge가 다시 검증) */
  effort?: string;
}

export type BridgeClientMsg =
  | { type: 'status.get'; reqId: string; refresh?: boolean }
  | ChatStartMsg
  | { type: 'chat.abort'; reqId: string };

export type BridgeServerMsg =
  | { type: 'status'; reqId: string; providers: BridgeStatus }
  | { type: 'chat.delta'; reqId: string; text: string }
  | { type: 'chat.done'; reqId: string; stopReason?: string }
  | { type: 'chat.error'; reqId: string; error: ProviderError };

export function isCliProviderId(id: string): id is CliProviderId {
  return (CLI_PROVIDER_IDS as string[]).includes(id);
}
