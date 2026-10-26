import type { Attachment, ProviderId, ToolActivity } from '../model';
import type { Availability, ChatTurn, ProviderError } from '../provider';
import type { SttModelId, SttState, SttStatus } from '../stt';

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
  /** 이미지 생성 도구 허용 (Codex만, 일반 대화 요청일 때). 만든 이미지는 chat.image로 온다 (ADR-041) */
  imageGen?: boolean;
  /** 웹 검색·페이지 읽기 도구 허용 (일반 대화일 때, ADR-070). 도구 사용은 chat.tool로 온다 */
  webSearch?: boolean;
}

export type BridgeClientMsg =
  | { type: 'status.get'; reqId: string; refresh?: boolean }
  | ChatStartMsg
  | { type: 'chat.abort'; reqId: string }
  /** 음성 입력 상태 (PC 설정을 원격 기기도 따른다, ADR-045) */
  | { type: 'stt.status.get'; reqId: string }
  /** 녹음 전사. audio = 16kHz mono PCM16 WAV의 base64 */
  | { type: 'stt.transcribe'; reqId: string; audio: string }
  /** PC 음성 설정 전체 상태 (원격 설정 화면, ADR-046) */
  | { type: 'stt.state.get'; reqId: string }
  /** PC 음성 설정 바꾸기 (원격 설정 화면, ADR-046). 응답은 바뀐 뒤의 stt.state */
  | SttManageMsg;

/** 켜기·끄기·모델 고르기·받기(시작만, 진행은 stt.state.get으로)·받기 취소·지우기 */
export type SttManageOp = 'enable' | 'disable' | 'select' | 'download' | 'cancel' | 'remove';
export const STT_MANAGE_OPS: readonly SttManageOp[] = ['enable', 'disable', 'select', 'download', 'cancel', 'remove'];
/** model이 필요한 동작 */
export const STT_MANAGE_MODEL_OPS: readonly SttManageOp[] = ['select', 'download', 'remove'];

export interface SttManageMsg {
  type: 'stt.manage';
  reqId: string;
  op: SttManageOp;
  model?: SttModelId;
}

export type BridgeServerMsg =
  | { type: 'status'; reqId: string; providers: BridgeStatus }
  | { type: 'chat.delta'; reqId: string; text: string }
  | { type: 'chat.image'; reqId: string; attachment: Attachment }
  | { type: 'chat.tool'; reqId: string; tool: ToolActivity }
  | { type: 'chat.done'; reqId: string; stopReason?: string }
  | { type: 'chat.error'; reqId: string; error: ProviderError }
  | { type: 'stt.status'; reqId: string; stt: SttStatus }
  | { type: 'stt.state'; reqId: string; state: SttState }
  | { type: 'stt.result'; reqId: string; text: string }
  | { type: 'stt.error'; reqId: string; error: string };

export function isCliProviderId(id: string): id is CliProviderId {
  return (CLI_PROVIDER_IDS as string[]).includes(id);
}
