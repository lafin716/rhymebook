import { DRIVE_SCOPE } from '@branch/core';
import { t } from '../i18n';

/**
 * 구글 드라이브 연결 (공식 Google Identity Services 토큰 클라이언트).
 * `VITE_GOOGLE_CLIENT_ID`가 없으면 모의 드라이브로 동작한다 (B-01).
 * 액세스 토큰은 탭 메모리(SecretStore)에만 두며 약 1시간 뒤 만료된다 → 다시 연결.
 */
export const googleClientId = (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined) || undefined;

interface TokenResponse {
  access_token?: string;
  error?: string;
  error_description?: string;
}

interface GoogleOAuth2 {
  initTokenClient(config: { client_id: string; scope: string; callback(r: TokenResponse): void; error_callback?(e: { type: string }): void }): {
    requestAccessToken(o?: { prompt?: string }): void;
  };
  revoke(token: string, done?: () => void): void;
}

declare global {
  interface Window {
    google?: { accounts?: { oauth2?: GoogleOAuth2 } };
  }
}

let loading: Promise<GoogleOAuth2> | null = null;

function loadGis(): Promise<GoogleOAuth2> {
  loading ??= new Promise((resolve, reject) => {
    const done = () => (window.google?.accounts?.oauth2 ? resolve(window.google.accounts.oauth2) : reject(new Error(t('backup.google.loadFailed'))));
    if (window.google?.accounts?.oauth2) return done();
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = done;
    s.onerror = () => {
      loading = null;
      reject(new Error(t('backup.google.loadFailedNetwork')));
    };
    document.head.appendChild(s);
  });
  return loading;
}

/** 사용자 동의 팝업 → 액세스 토큰 */
export async function requestDriveToken(clientId: string): Promise<string> {
  const oauth2 = await loadGis();
  return new Promise((resolve, reject) => {
    const client = oauth2.initTokenClient({
      client_id: clientId,
      scope: DRIVE_SCOPE,
      callback: (r) => (r.access_token ? resolve(r.access_token) : reject(new Error(r.error_description || t('backup.google.cancelled')))),
      error_callback: () => reject(new Error(t('backup.google.cancelled'))),
    });
    client.requestAccessToken();
  });
}

export async function revokeDriveToken(token: string): Promise<void> {
  if (!window.google?.accounts?.oauth2) return;
  await new Promise<void>((resolve) => window.google!.accounts!.oauth2!.revoke(token, resolve));
}
