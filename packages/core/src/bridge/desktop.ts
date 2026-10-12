import type { HostPolicy } from '../platform';
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
