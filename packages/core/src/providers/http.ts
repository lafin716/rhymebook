import { t } from '../i18n';
import type { ProviderErrorCode } from '../model';
import { providerError, type ProviderError } from '../provider';

/** fetch 주입 지점 (테스트/플랫폼 교체용) */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export function defaultFetch(): FetchLike {
  return (input, init) => globalThis.fetch(input, init);
}

export function statusToCode(status: number): ProviderErrorCode {
  if (status === 401 || status === 403) return 'auth';
  if (status === 429 || status === 529) return 'rate-limit';
  if (status >= 500) return 'network';
  return 'unknown';
}

/** 오류 종류별 안내 (호출 시점에 언어를 고른다) */
const CODE_MESSAGE: Record<ProviderErrorCode, string> = {
  get auth() { return t('errors.http.auth'); },
  get 'rate-limit'() { return t('errors.http.rate-limit'); },
  get network() { return t('errors.http.network'); },
  get offline() { return t('errors.http.offline'); },
  get cli() { return t('errors.http.cli'); },
  get aborted() { return t('errors.aborted'); },
  get unknown() { return t('errors.http.unknown'); },
};

/** HTTP 오류 응답을 ProviderError로. 본문의 error.message를 덧붙이되 키 같은 비밀은 응답에 없으므로 안전 */
export async function httpError(res: Response): Promise<ProviderError> {
  const code = statusToCode(res.status);
  let detail = '';
  try {
    const body = (await res.json()) as { error?: { message?: string } | string };
    const msg = typeof body.error === 'string' ? body.error : body.error?.message;
    if (msg) detail = ` (${res.status}: ${msg.slice(0, 200)})`;
  } catch {
    detail = ` (HTTP ${res.status})`;
  }
  return providerError(code, CODE_MESSAGE[code] + detail);
}

/** fetch 단계의 예외를 ProviderError로 */
export function thrownError(e: unknown): ProviderError {
  if (isAbort(e)) return providerError('aborted', CODE_MESSAGE.aborted);
  if (e instanceof TypeError) return providerError('offline', `${CODE_MESSAGE.offline} (${e.message})`);
  return providerError('unknown', e instanceof Error ? e.message : String(e));
}

export function isAbort(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { name?: string }).name === 'AbortError';
}

export function trimBase(url: string): string {
  return url.replace(/\/+$/, '');
}

/** 화면 표시용 마스킹: 앞 4자 + … + 뒤 4자 */
export function maskSecret(secret: string): string {
  const s = secret.trim();
  if (s.length <= 10) return '••••';
  return `${s.slice(0, 4)}…${s.slice(-4)}`;
}
