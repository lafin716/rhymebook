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
  /** 사용자 메시지 첨부 (사진·파일·붙여넣은 긴 텍스트, IMP-09) */
  attachments?: Attachment[];
  /** 사용자 메시지에 적용한 스킬 (보낸 시점 사본) */
  skill?: SkillRef;
}

/**
 * 메시지 첨부 (ADR-033).
 * - image: base64 (UI가 긴 변 1600px 이하로 줄여 넣는다)
 * - pdf: base64
 * - text: 텍스트 파일·붙여넣은 긴 텍스트. data는 UTF-8 원문
 */
export type AttachmentKind = 'image' | 'pdf' | 'text';

export interface Attachment {
  id: ID;
  kind: AttachmentKind;
  name: string;
  mime: string;
  /** 원본 바이트 수 (text는 UTF-8 길이) */
  size: number;
  data: string;
  /** 클립보드에서 붙여넣은 긴 텍스트 */
  pasted?: boolean;
}

/** 스킬 (IMP-09, ADR-034): 슬래시 명령이나 + 메뉴로 골라 이번 질문에 지시를 더한다 */
export interface Skill {
  id: ID;
  /** 슬래시 명령 이름 (`/name`) */
  name: string;
  title: string;
  description: string;
  /** 모델에 줄 지시 */
  prompt: string;
  /** 스킬 폴더의 부수 파일 (references/·scripts/·assets/ 등 텍스트, IMP-12) */
  files?: SkillFile[];
  /** 이 스킬 전용 provider·모델·노력치. 없으면 세션 설정을 따른다 (IMP-12) */
  options?: SkillOptions;
  /** 앱이 기본 제공하는 예시 스킬 */
  builtin?: boolean;
  createdAt: number;
  updatedAt: number;
}

/** 스킬 부수 파일. path는 스킬 폴더 기준 상대 경로(`references/guide.md`) */
export interface SkillFile {
  path: string;
  content: string;
}

/** 스킬 전용 실행 설정. 모델·노력치를 비우면 그 provider 연결의 기본값 */
export interface SkillOptions {
  providerId: ProviderId;
  model?: string;
  effort?: string;
}

/** 메시지에 남기는 스킬 사본: 스킬을 고치거나 지워도 그 질문의 맥락은 유지된다 */
export type SkillRef = Pick<Skill, 'id' | 'name' | 'title' | 'prompt' | 'files' | 'options'>;

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

/** 분할 방향: row = 좌우, col = 상하 */
export type SplitDir = 'row' | 'col';

/** 분할 배치 트리 (IMP-09, ADR-035). 잎은 세션, 그룹은 한 방향으로 나눈 칸들 */
export type SplitNode =
  | { kind: 'leaf'; sessionId: ID }
  | { kind: 'group'; dir: SplitDir; children: SplitNode[]; sizes?: number[] };

/** 분할 패널에 놓을 위치: 대상 패널의 가장자리 또는 가운데(교체) */
export type DropEdge = 'left' | 'right' | 'top' | 'bottom' | 'center';

export interface ViewState {
  mode: ViewMode;
  /** 단일 보기/모바일에서 메인으로 보이는 세션 */
  activeSessionId: ID | null;
  /** 분할 보기 패널 (최대 MAX_SPLIT). splitLayout 잎 순서와 같다 */
  splitSessionIds: ID[];
  /** @deprecated 이전 버전의 좌우 분할 비율. splitLayout을 쓴다 */
  splitSizes?: number[];
  /** 분할 배치 (좌우·상하). 없으면 splitSessionIds를 좌우로 나란히 둔다 */
  splitLayout?: SplitNode;
  /** 분할 패널 중 포커스(모바일 탭에서 선택된 탭) */
  focusedSplitIndex: number;
  /** 데스크톱 팝업 레이어 */
  popups: PopupWindow[];
  /** 모바일 바텀시트 스택 (마지막이 최상단) */
  sheetSessionIds: ID[];
}

export type Overlay = 'none' | 'search' | 'settings' | 'notes' | 'skills' | 'vault';

export type ThemePref = 'system' | 'light' | 'dark';

export interface Settings {
  theme: ThemePref;
  defaultProviderId: ProviderId;
  fallbackOrder: ProviderId[];
  /** 맥락 상속 시 포함할 부모 최근 메시지 수 */
  contextWindow: number;
  /** 데스크톱에서 앵커 클릭 시 열 위치 */
  anchorOpenTarget: 'popup' | 'split';
  /** 첫 실행 연결 안내를 마쳤거나 건너뛰었는지 */
  setupDone?: boolean;
  /** 데스크톱 원격 페어링: 원격 요청을 처리할 이 PC의 CLI (auto면 준비된 CLI, ADR-025) */
  hostAgent?: 'auto' | 'claude-cli' | 'codex-cli';
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

/** 서식·메모 추천 색상 팔레트 (실제 색은 UI 테마 변수) */
export const MARK_COLORS = ['yellow', 'green', 'blue', 'purple', 'red', 'orange'] as const;
export type MarkPreset = (typeof MARK_COLORS)[number];
/** 추천 색상 이름 또는 사용자 지정 색 `#rrggbb` (소문자) */
export type MarkColor = MarkPreset | `#${string}`;

const HEX_COLOR = /^#[0-9a-f]{6}$/;

/** 저장 가능한 색인지: 추천 색상 이름 또는 소문자 `#rrggbb` */
export function isMarkColor(v: unknown): v is MarkColor {
  return typeof v === 'string' && ((MARK_COLORS as readonly string[]).includes(v) || HEX_COLOR.test(v));
}

/** 입력한 색을 저장 형식으로 맞춘다 (`#ABC`·`abcdef` → `#aabbcc`). 해석할 수 없으면 null */
export function normalizeMarkColor(input: string): MarkColor | null {
  const v = input.trim().toLowerCase();
  if ((MARK_COLORS as readonly string[]).includes(v)) return v as MarkPreset;
  const hex = v.startsWith('#') ? v.slice(1) : v;
  if (/^[0-9a-f]{3}$/.test(hex)) return `#${[...hex].map((c) => c + c).join('')}`;
  if (/^[0-9a-f]{6}$/.test(hex)) return `#${hex}`;
  return null;
}

export const MARK_FONTS = ['serif', 'mono'] as const;
export type MarkFont = (typeof MARK_FONTS)[number];

/** 서식 필드 (모두 선택; 없음 = 해당 서식 없음) */
export interface AnnotationStyle {
  highlight?: MarkColor;
  underline?: MarkColor;
  textColor?: MarkColor;
  font?: MarkFont;
  bold?: boolean;
  italic?: boolean;
}

/**
 * 드래그 메뉴로 만든 메시지 텍스트 범위의 서식·메모 (IMP-07, ADR-029).
 * anchor는 가지와 같은 원문 offset 규칙을 따른다. 서식과 note가 모두 비면 삭제한다.
 */
export interface Annotation extends AnnotationStyle {
  id: ID;
  /** anchor.messageId가 속한 세션 */
  sessionId: ID;
  anchor: Anchor;
  note?: string;
  createdAt: number;
  updatedAt: number;
}

/** updateAnnotation 패치: 서식 키에 null을 주면 해당 서식을 지운다 */
export type AnnotationPatch = {
  [K in keyof AnnotationStyle]?: AnnotationStyle[K] | null;
} & { note?: string | null };

export const MAX_NOTE_LENGTH = 4000;

/**
 * 보관함 (IMP-23): 텍스트, 이미지, 음성, 페이지를 저장하고 조직화한다.
 */

/** 보관함 음성 항목의 언어 */
export type VaultAudioLang = 'vi' | 'en' | 'ko';

/** 보관함 항목 콘텐츠 */
export type VaultItemContent =
  | { type: 'text'; text: string }
  | { type: 'image'; attachment: Attachment }
  | { type: 'audio'; text: string; lang: VaultAudioLang };

/** 보관함 페이지 블록 */
export type VaultPageBlock =
  | { id: ID; itemId: ID }
  | { id: ID; text: string };

/** 보관함 노드: 폴더, 항목, 또는 페이지 */
export interface VaultFolder {
  id: ID;
  kind: 'folder';
  parentId: ID | null;
  name: string;
  createdAt: number;
  updatedAt: number;
}

export interface VaultItem {
  id: ID;
  kind: 'item';
  parentId: ID | null;
  name: string;
  item: VaultItemContent;
  /** 원본 출처 (선택사항) */
  source?: { sessionId: ID; messageId: ID };
  createdAt: number;
  updatedAt: number;
}

export interface VaultPage {
  id: ID;
  kind: 'page';
  parentId: ID | null;
  name: string;
  blocks: VaultPageBlock[];
  createdAt: number;
  updatedAt: number;
}

export type VaultNode = VaultFolder | VaultItem | VaultPage;

export const MAX_SPLIT = 4;
