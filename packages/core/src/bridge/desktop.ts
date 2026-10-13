import type { HostPolicy } from '../platform';
import type { SkillFolder } from '../skillFolder';
import type { BridgeClientMsg, BridgeServerMsg } from './protocol';
import type { SyncClientMsg, SyncServerMsg } from './sync';

/** 데스크톱(Electron) preload가 렌더러에 노출하는 API: window.branchDesktop */
export interface DesktopApi {
  platform: string;
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
  addresses: { label: string; url: string }[];
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
  /** 앱 안에서 카메라로 QR을 스캔해 문자열을 돌려준다. 취소하면 null */
  scanQr?(): Promise<string | null>;
  /** 텍스트 파일을 만들어 OS 공유 시트로 넘긴다 (WebView는 <a download>를 지원하지 않음) */
  saveFile?(name: string, text: string, mime: string): Promise<void>;
}
