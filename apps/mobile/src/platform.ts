import { SecureStorage } from '@aparajita/capacitor-secure-storage';
import { App } from '@capacitor/app';
import { CapacitorBarcodeScanner, CapacitorBarcodeScannerTypeHint } from '@capacitor/barcode-scanner';
import { Capacitor } from '@capacitor/core';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import type { MobileApi } from '@branch/core';

/**
 * Capacitor 네이티브 기능을 ui가 아는 MobileApi 형태로 감싼다 (ADR-019).
 * ui 패키지는 Capacitor에 의존하지 않는다 — 데스크톱 preload와 같은 주입 방식.
 */
const PAIR_PREFIX = 'branch://pair';

export function createMobileApi(): MobileApi | null {
  if (!Capacitor.isNativePlatform()) return null;
  const platform = Capacitor.getPlatform();
  if (platform !== 'ios' && platform !== 'android') return null;

  // iOS Keychain / Android Keystore(AES-GCM). 키 접두어로 다른 앱 데이터와 구분
  void SecureStorage.setKeyPrefix('branch.');

  const listeners = new Set<(uri: string) => void>();
  let pending: string | null = null;
  const emit = (url: string | undefined) => {
    if (!url?.startsWith(PAIR_PREFIX)) return;
    if (!listeners.size) {
      pending = url; // ui가 구독하기 전에 들어온 링크(콜드 스타트)
      return;
    }
    for (const l of [...listeners]) l(url);
  };
  void App.addListener('appUrlOpen', (e) => emit(e.url));
  void App.getLaunchUrl().then((r) => emit(r?.url));

  return {
    platform,
    secrets: {
      persistent: true,
      get: (name) => SecureStorage.getItem(name),
      set: (name, value) => SecureStorage.setItem(name, value),
      delete: (name) => SecureStorage.removeItem(name),
    },
    onPairLink(listener) {
      listeners.add(listener);
      if (pending) {
        const url = pending;
        pending = null;
        queueMicrotask(() => listener(url));
      }
      return () => listeners.delete(listener);
    },
    async scanQr() {
      try {
        const r = await CapacitorBarcodeScanner.scanBarcode({
          hint: CapacitorBarcodeScannerTypeHint.QR_CODE,
          scanInstructions: 'PC 화면의 페어링 QR을 비춰 주세요',
          scanButton: false,
        });
        return r.ScanResult?.trim() || null;
      } catch (e) {
        // 사용자가 스캔 화면을 닫으면 플러그인이 reject한다 → 취소로 처리
        if (/cancel/i.test(e instanceof Error ? e.message : String(e))) return null;
        throw e;
      }
    },
    async saveFile(name, text) {
      // 앱 캐시에 쓰고 공유 시트로 넘긴다 (파일 앱 저장·메일·Anki 등)
      const { uri } = await Filesystem.writeFile({ path: name, data: text, directory: Directory.Cache, encoding: Encoding.UTF8 });
      await shareFile(name, uri);
    },
    async saveBase64File(name, base64) {
      // encoding을 빼면 data를 base64로 보고 바이너리로 쓴다 (사진 앱 저장은 공유 시트에서)
      const { uri } = await Filesystem.writeFile({ path: name, data: base64, directory: Directory.Cache });
      await shareFile(name, uri);
    },
  };
}

async function shareFile(name: string, uri: string): Promise<void> {
  try {
    await Share.share({ title: name, files: [uri] });
  } catch (e) {
    if (!/cancel/i.test(e instanceof Error ? e.message : String(e))) throw e;
  }
}
