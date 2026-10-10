import type { BridgeClientMsg, BridgeServerMsg } from './protocol';

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
