export type ID = string;

export type Role = 'user' | 'assistant';

export interface Anchor {
  /** 부모 세션의 assistant 메시지 id */
  messageId: ID;
  /** 사용자가 본(렌더 기준) 선택 텍스트 */
  text: string;
  /** 메시지 content(markdown 원문) 기준 시작 offset */
  startOffset: number;
  /** 메시지 content 기준 끝 offset (exclusive) */
  endOffset: number;
}

export interface Session {
  id: ID;
  parentId: ID | null;
  rootId: ID;
  title: string;
  anchor?: Anchor;
  summary?: string;
  providerId?: ProviderId;
  /** 채팅에서 고른 모델·노력치 (연결 기본값 덮어쓰기, ADR-023) */
  modelPref?: ModelPref;
  createdAt: number;
  updatedAt: number;
}

/** 세션별 모델·노력치. 고른 provider에서만 적용된다 */
export interface ModelPref {
  providerId: ProviderId;
  model?: string;
  effort?: string;
}

export type MessageStatus = 'streaming' | 'done' | 'error' | 'stopped';

export interface Message {
  id: ID;
  sessionId: ID;
  role: Role;
  content: string;
  createdAt: number;
  status?: MessageStatus;
  error?: { code: ProviderErrorCode; message: string };
  /** 이 응답을 생성한 provider */
  providerId?: ProviderId;
}

export type ProviderId =
  | 'mock'
  | 'claude-cli'
  | 'codex-cli'
  | 'anthropic-api'
  | 'openai-api'
  | 'remote-bridge';

export type ProviderErrorCode =
  | 'auth'
  | 'rate-limit'
  | 'network'
  | 'offline'
  | 'cli'
  | 'aborted'
  | 'unknown';

export type BranchKind = 'what' | 'detail' | 'custom';

export type ViewMode = 'single' | 'split' | 'mindmap';

export interface PopupWindow {
  id: ID;
  sessionId: ID;
  x: number;
  y: number;
  w: number;
  h: number;
  z: number;
}

export interface ViewState {
  mode: ViewMode;
  /** 단일 보기/모바일에서 메인으로 보이는 세션 */
  activeSessionId: ID | null;
  /** 분할 보기 패널 (최대 3) */
  splitSessionIds: ID[];
  splitSizes?: number[];
  /** 분할 패널 중 포커스(모바일 탭에서 선택된 탭) */
  focusedSplitIndex: number;
  /** 데스크톱 팝업 레이어 */
  popups: PopupWindow[];
  /** 모바일 바텀시트 스택 (마지막이 최상단) */
  sheetSessionIds: ID[];
}

export type Overlay = 'none' | 'search' | 'settings' | 'notes';

export type ThemePref = 'system' | 'light' | 'dark';

export interface Settings {
  theme: ThemePref;
  defaultProviderId: ProviderId;
  fallbackOrder: ProviderId[];
  /** 맥락 상속 시 포함할 부모 최근 메시지 수 */
  contextWindow: number;
  /** 데스크톱에서 앵커 클릭 시 열 위치 */
  anchorOpenTarget: 'popup' | 'split';
}

export type ConnectionStatus =
  | 'ready'
  | 'not-installed'
  | 'not-logged-in'
  | 'no-key'
  | 'offline'
  | 'unpaired'
  | 'checking';

export interface ConnectionState {
  providerId: ProviderId;
  status: ConnectionStatus;
  /** CLI 버전, 마스킹된 키, 원격 주소 등 */
  detail?: string;
  enabled: boolean;
  /** 사용할 모델 (비우면 provider 기본 모델) */
  model?: string;
  /** CLI 노력치 기본값 (비우면 CLI 기본) */
  effort?: string;
}

export type SummaryDraft =
  | { status: 'generating'; text: string }
  | { status: 'ready'; text: string }
  | { status: 'error'; text: string; message: string };

export const MAX_SPLIT = 3;
