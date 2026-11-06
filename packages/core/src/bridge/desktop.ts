import type {
  KnowledgeAddResult,
  KnowledgeBase,
  KnowledgeCreateOptions,
  KnowledgeEntry,
  KnowledgeFolderInspection,
  KnowledgeKind,
  KnowledgePreview,
  KnowledgeProgress,
} from '../knowledge';
import type {
  IndexIntegrityReport,
  KnowledgeDoc,
  KnowledgeIndexSettings,
  KnowledgeIndexState,
  KnowledgeSource,
  RetrievalRequest,
  RetrievalResult,
  SourceView,
} from '../rag/types';
import type { HostPolicy } from '../platform';
import type { SkillFolder } from '../skillFolder';
import type { SttModelId, SttState } from '../stt';
import type { DeviceVoiceLike } from '../tts';
import type { UpdateState } from '../update';
import type { BridgeClientMsg, BridgeServerMsg } from './protocol';
import type { SyncClientMsg, SyncServerMsg } from './sync';

/** 데스크톱(Electron) preload가 렌더러에 노출하는 API: window.branchDesktop */
export interface DesktopApi {
  platform: string;
  /** 로컬 OS 알림. 권한 요청은 사용자 동작에서만 한다 */
  notifications?: {
    supported(): Promise<boolean>;
    show(input: { sessionId: string; title: string; body: string }): Promise<boolean>;
    onClick(listener: (sessionId: string) => void): () => void;
  };
  /** 앱 언어를 main 프로세스(트레이·알림·CLI 오류 문구)에 알린다 (ADR-105) */
  setLocale?(locale: string): void;
  bridge: {
    send(msg: BridgeClientMsg): void;
    onMessage(listener: (msg: BridgeServerMsg) => void): () => void;
  };
  secrets: {
    /** true면 OS 보안 저장소(Keychain/DPAPI/libsecret)로 암호화해 저장 */
    persistent: boolean;
    get(name: string): Promise<string | null>;
    set(name: string, value: string): Promise<void>;
    delete(name: string): Promise<void>;
  };
  /** 이 PC를 원격 페어링 호스트로 열기 (ADR-025). 없으면 호스트 기능을 숨긴다 */
  host?: DesktopHostApi;
  /** 세션을 별도 창으로 열기 (ADR-036). 없으면 메뉴를 숨긴다 */
  windows?: DesktopWindowsApi;
  /** 스킬 폴더 (IMP-12, ADR-038). 없으면 폴더 기능을 숨긴다 */
  skills?: DesktopSkillsApi;
  /** 책 PDF (ADR-044). 없으면 웹 인쇄 대화상자로 대신한다 */
  pdf?: DesktopPdfApi;
  /** 음성 입력 관리 (ADR-045). 전사 자체는 bridge의 stt.transcribe로 한다. 없으면 설정 탭을 숨긴다 */
  stt?: DesktopSttApi;
  /** 학습별 지식베이스 (ADR-107). 없으면 지식베이스 버튼을 숨긴다 */
  knowledge?: DesktopKnowledgeApi;
  /** 앱 자동 업데이트 (ADR-118). 없으면 업데이트 알림·설정 항목을 숨긴다 */
  updater?: DesktopUpdaterApi;
}

/**
 * 앱 업데이트. 확인·다운로드·설치는 main 프로세스(electron-updater)가 하고 렌더러는 상태만 받는다.
 * 인자가 없는 호출뿐이다 (주소·파일 경로를 렌더러가 넘기지 않는다).
 */
export interface DesktopUpdaterApi {
  getState(): Promise<UpdateState>;
  /** 사용자가 누른 확인 */
  check(): Promise<UpdateState>;
  /** 사용자 동의 후 다운로드 (auto 모드). 이미 받는 중이면 무시 */
  download(): Promise<UpdateState>;
  /** 받은 업데이트를 설치하고 다시 실행한다. 렌더러는 미리 저장을 끝내 둔다 */
  install(): Promise<boolean>;
  /** 브라우저로 릴리스 페이지 열기 (manual 모드) */
  openRelease(): Promise<boolean>;
  onChange(listener: (state: UpdateState) => void): () => void;
}

/**
 * 지식베이스 폴더 `<userData>/knowledge/<id>/files/`.
 * main 프로세스가 id·경로·URL·크기를 다시 확인하고 그 폴더 밖에는 쓰지 않는다. 오류는 보여줄 문구로 throw.
 */
export interface DesktopKnowledgeApi {
  list(): Promise<KnowledgeBase[]>;
  /**
   * opts 생략 = 문서형 (ADR-127). 코드베이스는 kind:'codebase'와 linkedPath(로컬 폴더 연결) 또는
   * 만든 뒤 cloneGit(Git 저장소)로 채운다. 이전 버전 PC(원격)는 opts를 무시할 수 있다.
   */
  create(name: string, opts?: KnowledgeCreateOptions): Promise<KnowledgeBase>;
  rename(id: string, name: string): Promise<KnowledgeBase>;
  /** 지식베이스와 그 파일 전체를 지운다 */
  remove(id: string): Promise<void>;
  /**
   * 항목 목록 (경로순, 숨김 항목·.git 제외).
   * dir을 주면 그 폴더 바로 아래 항목만 ('' = 최상위). 없으면 files/ 아래 전체.
   * 이전 버전 PC(원격)는 dir을 무시하고 전체를 돌려줄 수 있다.
   */
  tree(id: string, dir?: string): Promise<KnowledgeEntry[]>;
  /** 끌어다 놓은 파일의 절대 경로 (Electron webUtils). 못 얻으면 '' */
  pathForFile(file: File): string;
  /** 디스크의 파일·폴더를 복사해 넣는다 (끌어다 놓기). dest는 files/ 기준 폴더 경로 */
  addPaths(id: string, paths: string[], dest?: string): Promise<KnowledgeAddResult>;
  /** 경로를 못 얻은 파일을 내용으로 넣는다 */
  addFiles(id: string, files: { name: string; data: Uint8Array }[], dest?: string): Promise<KnowledgeAddResult>;
  /** OS 파일 선택 창으로 고른 파일을 넣는다. 취소하면 added가 빈 배열 */
  pickFiles(id: string, dest?: string): Promise<KnowledgeAddResult>;
  /** 웹 페이지를 받아 본문을 마크다운으로 links/ 아래에 저장한다 */
  addLink(id: string, url: string): Promise<KnowledgeAddResult>;
  /** GitHub 저장소를 repos/<repo>/로 얕게 클론한다 (.git은 지운다) */
  cloneGit(id: string, url: string): Promise<KnowledgeAddResult>;
  /** 파일·폴더 하나를 지운다 */
  removeEntry(id: string, path: string): Promise<void>;
  preview(id: string, path: string): Promise<KnowledgePreview>;
  /** OS 파일 탐색기로 연다 (path 없으면 지식베이스 폴더) */
  open(id: string, path?: string): Promise<void>;
  /** 진행 중인 가져오기(추가·링크·클론)의 진행 상황. 해제 함수를 돌려준다 */
  onProgress?(listener: (p: KnowledgeProgress) => void): () => void;
  /** 진행 중인 가져오기를 취소한다 (해당 호출은 취소 문구로 reject) */
  cancel?(): Promise<void>;
  // ── 색인·검색 (ADR-113). 모두 optional: 없으면 기존 동작 ──
  /** 설명을 저장한다 (빈 문자열이면 지운다) */
  setDescription?(id: string, description: string): Promise<KnowledgeBase>;
  /** 지식베이스별 색인 상태 (ids 생략 시 전부) */
  indexStates?(ids?: string[]): Promise<KnowledgeIndexState[]>;
  /**
   * 색인을 큐에 넣고 즉시 돌아온다 (문서형·미분류만, 코드베이스는 거절 — ADR-127).
   * full = 전체 재생성, paths = 그 파일만 다시(부분), retryFailed = 실패한 문서만 다시.
   */
  reindex?(id: string, opts?: { full?: boolean; paths?: string[]; retryFailed?: boolean }): Promise<void>;
  /** 진행 중·대기 중인 색인을 취소한다 */
  cancelIndex?(id: string): Promise<void>;
  /** 색인된 문서 목록 (query가 있으면 경로·제목 부분 일치) */
  docs?(id: string, query?: string): Promise<KnowledgeDoc[]>;
  getIndexSettings?(id: string): Promise<KnowledgeIndexSettings>;
  /** 임베딩 모델이 바뀌면 stale로 표시하고 전체 재색인을 큐에 넣는다 */
  setIndexSettings?(id: string, s: KnowledgeIndexSettings): Promise<KnowledgeIndexState>;
  /** 출처 목록 (가져온 로컬 경로·URL·저장소) */
  sources?(id: string): Promise<KnowledgeSource[]>;
  /** 출처를 다시 받는다 (링크 재수집·저장소 재클론) */
  updateSource?(id: string, sourceId: string): Promise<KnowledgeAddResult>;
  /** 질문에 대한 근거 검색 (renderer는 질의 계획만 보낸다) */
  retrieve?(req: RetrievalRequest, requestId?: string): Promise<RetrievalResult>;
  /** 진행 중인 검색 취소 (requestId는 retrieve에 넘긴 값). 없는 id는 무시 */
  cancelRetrieve?(requestId: string): Promise<void>;
  /** 인용 한 건의 원문 주변 */
  source?(kbId: string, chunkId: string): Promise<SourceView>;
  /** 색인 상태 변화 구독. 해제 함수를 돌려준다 */
  onIndexState?(listener: (s: KnowledgeIndexState) => void): () => void;
  // ── 유형·코드베이스 (ADR-127~130). 모두 optional ──
  /**
   * 유형 지정·변경. → codebase: 진행 중 색인 취소, 기존 색인은 <kb>/backup/로 옮긴 뒤(복구 가능) 벡터 사용 중지.
   * → document: 백업이 있으면 되살리고 없으면 색인을 큐에 넣는다. 연결 폴더 코드베이스는 문서형으로 바꿀 수 없다.
   */
  setKind?(id: string, kind: KnowledgeKind): Promise<KnowledgeBase>;
  /** 코드베이스 제외 경로 저장 (gitignore 꼴, 최대 100개) */
  setExcludes?(id: string, excludes: string[]): Promise<KnowledgeBase>;
  /** OS 폴더 선택 창. 취소하면 null */
  pickFolder?(): Promise<string | null>;
  /** 등록 전 폴더 구조 미리보기 (읽기만 한다) */
  inspectFolder?(path: string): Promise<KnowledgeFolderInspection>;
  /** 색인 무결성 검사 (문서형) */
  verifyIndex?(id: string): Promise<IndexIntegrityReport>;
  /** 유형 변경으로 백업해 둔 색인을 되살린다 (없으면 false) */
  restoreIndexBackup?(id: string): Promise<boolean>;
}

/** PC의 로컬 whisper.cpp 설정·모델 관리. 원격 기기는 이 설정을 따르기만 한다 */
export interface DesktopSttApi {
  getState(): Promise<SttState>;
  setEnabled(enabled: boolean): Promise<SttState>;
  setModel(model: SttModelId): Promise<SttState>;
  /** 모델을 받는다(진행률은 onChange). 끝나거나 실패하면 상태를 돌려준다 */
  download(model: SttModelId): Promise<SttState>;
  cancelDownload(): Promise<SttState>;
  remove(model: SttModelId): Promise<SttState>;
  onChange(listener: (state: SttState) => void): () => void;
}

/**
 * 렌더러가 만든 책 HTML을 숨은 창에서 PDF로 인쇄한다 (ADR-044).
 * main은 차례의 `.toc-pg[data-for="<id>"]`에 해당 `id` 요소가 실린 쪽 번호를 채워 두 번째로 인쇄한다.
 */
export interface DesktopPdfApi {
  fromHtml(html: string): Promise<Uint8Array>;
}

/**
 * 스킬 폴더 `<userData>/skills/<name>/` (SKILL.md + 부수 파일).
 * main 프로세스가 이름·경로를 다시 확인하고 그 폴더 밖에는 쓰지 않는다.
 */
export interface DesktopSkillsApi {
  /** 스킬 폴더 루트의 절대 경로 (표시용) */
  root: string;
  /**
   * 폴더에 SKILL.md와 파일을 쓴다(SKILL.md의 모르는 frontmatter 키는 유지).
   * 지우는 파일은 removed(앱에서 사용자가 뺀 경로)뿐 — 앱이 모르는 파일은 둔다.
   * prevName이 다르면 이전 폴더를 새 이름으로 옮긴 뒤 쓴다.
   */
  write(folder: SkillFolder, opts?: { prevName?: string; removed?: string[] }): Promise<void>;
  remove(name: string): Promise<void>;
  /** 폴더가 없으면 folder로 만든 뒤 OS 파일 탐색기로 연다. 없으면 루트를 연다 */
  open(folder?: SkillFolder): Promise<void>;
  /** SKILL.md가 있는 모든 하위 폴더 (텍스트 부수 파일 포함, 숨김·바이너리·너무 큰 파일 제외) */
  readAll(): Promise<SkillFolder[]>;
}

/**
 * 세션 창 (ADR-036): 저장소를 갖지 않고 메인 창(동기화 엔진)을 로컬 SyncClient로 미러링한다.
 * main 프로세스가 `win-<id>` 피어로 엔진 창 SyncHost와 메시지를 중계한다.
 */
export interface DesktopWindowsApi {
  /** sessionId를 새 창으로 연다. 같은 세션 창이 이미 있어도 새로 연다 */
  openSession(sessionId: string): void;
  /** 이 창이 세션 창일 때만: 엔진 창과의 동기화 링크 */
  link?: {
    send(msg: SyncClientMsg): void;
    onMessage(cb: (msg: SyncServerMsg) => void): () => void;
  };
  /** 발표 청중 창 (외부 디스플레이가 있으면 그 화면에 전체 화면으로) */
  present?: {
    open(sessionId: string): void;
    send(msg: Record<string, unknown>): void;
    onMessage(cb: (msg: Record<string, unknown>) => void): () => void;
    close(): void;
  };
}

export interface HostDevice {
  id: string;
  name: string;
  pairedAt: number;
  lastSeenAt?: number;
  connected: boolean;
}

export interface HostPairingInfo {
  /** 6자리 1회용 코드 */
  code: string;
  expiresAt: number;
  /** 주소별 페어링 링크와 QR(SVG). 링크에는 1회용 토큰이 들어 있으므로 화면에만 쓴다 */
  links: { label: string; url: string; uri: string; qrSvg: string }[];
}

export interface HostState {
  /** 사용자가 켜 두었는지 (앱 시작 시 자동으로 다시 연다) */
  enabled: boolean;
  running: boolean;
  port: number | null;
  error?: string;
  /** 원격 기기에 보이는 PC 이름 */
  name: string;
  fingerprint: string;
  /** 주소 종류 (표시용 label은 언어에 따라 바뀐다, ADR-105) */
  addresses: { label: string; url: string; kind?: 'tailscale' | 'lan' | 'local' | 'relay' }[];
  devices: HostDevice[];
  relayUrl: string | null;
  relayState: 'off' | 'connecting' | 'ready' | 'offline';
  pairing: HostPairingInfo | null;
}

export interface DesktopHostApi {
  getState(): Promise<HostState>;
  setEnabled(enabled: boolean): Promise<HostState>;
  /** relay 주소 (wss://…). null이면 끔 */
  setRelay(url: string | null): Promise<HostState>;
  startPairing(): Promise<HostState>;
  cancelPairing(): Promise<HostState>;
  unpair(idOrAll: string): Promise<HostState>;
  /** 원격 요청에 적용할 에이전트·모델·노력치 */
  setPolicy(policy: HostPolicy): Promise<void>;
  onChange(listener: (state: HostState) => void): () => void;
  /** 웹·모바일 원격 동기화 (ADR-026). 없으면 지원 안 함 */
  sync?: {
    ready(on: boolean): void;
    send(peerId: string, msg: SyncServerMsg): void;
    onMessage(cb: (peerId: string, msg: SyncClientMsg) => void): () => void;
    onPeerGone?(cb: (peerId: string) => void): () => void;
  };
}

/** 모바일(Capacitor) 진입점이 주입하는 API: window.branchMobile (Phase 5, ADR-019) */
export interface MobileApi {
  platform: 'ios' | 'android';
  /** iOS Keychain / Android Keystore 기반 보안 저장소 */
  secrets: DesktopApi['secrets'];
  /** `branch://pair?…` 딥링크(카메라로 QR 스캔 등)를 받으면 호출 */
  onPairLink(listener: (uri: string) => void): () => void;
  /** 앱이 포그라운드(true)·백그라운드(false)로 바뀌면 호출 — 복귀 시 PC에 다시 연결한다 */
  onActiveChange?(listener: (active: boolean) => void): () => void;
  /** 앱 안에서 카메라로 QR을 스캔해 문자열을 돌려준다. 취소하면 null */
  scanQr?(): Promise<string | null>;
  /** 텍스트 파일을 만들어 OS 공유 시트로 넘긴다 (WebView는 <a download>를 지원하지 않음) */
  saveFile?(name: string, text: string, mime: string): Promise<void>;
  /** 바이너리(base64) 파일을 공유 시트로 넘긴다 — 생성 이미지 저장 */
  saveBase64File?(name: string, base64: string): Promise<void>;
  /** 기기 OS 음성(Android WebView에는 speechSynthesis가 없음, ADR-051) */
  speech?: MobileSpeech;
  /** 기기 OS 로컬 알림. 권한 요청은 사용자가 설정에서 누를 때만 한다. */
  notifications?: MobileNotifications;
}

export type LocalNotificationPermission = 'default' | 'denied' | 'granted';
export interface MobileNotifications {
  status(): Promise<LocalNotificationPermission>;
  requestPermission(): Promise<LocalNotificationPermission>;
  show(input: { sessionId: string; title: string; body: string; scope?: string }): Promise<boolean>;
  onClick(listener: (sessionId: string, scope?: string) => void): () => void;
  /** 응답 생성 중 백그라운드 실행 유지 (Android 포그라운드 서비스, iOS 백그라운드 작업). ADR-106 */
  setBackgroundWork?(active: boolean): Promise<void>;
}

export interface MobileSpeech {
  /** 기기 음성 목록. 순서가 speak의 voice 번호다 */
  voices(): Promise<DeviceVoiceLike[]>;
  /** 다 읽으면 true, 그 언어 음성이 기기에 없으면 false. 그 밖의 실패는 reject */
  speak(text: string, lang: string, voice?: number): Promise<boolean>;
  stop(): Promise<void>;
}
