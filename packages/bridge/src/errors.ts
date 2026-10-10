import { providerError, type ProviderError } from '@branch/core';

/** 오류 문구에서 비밀처럼 보이는 값과 제어 문자를 지우고 짧게 자른다 */
export function sanitize(raw: string, max = 240): string {
  const clean = raw
    // eslint-disable-next-line no-control-regex
    .replace(/\u001b\[[0-9;]*[A-Za-z]/g, '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b-\u001f]/g, '')
    .replace(/\b(sk|pk|rk)-[A-Za-z0-9_-]{8,}/g, '[redacted]')
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]')
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[email]')
    .replace(/\s+/g, ' ')
    .trim();
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}

export interface CliErrorContext {
  /** 표시용 이름 (Claude CLI / Codex CLI) */
  label: string;
  /** 로그인 명령 안내 */
  loginHint: string;
}

/** CLI가 낸 오류 문구를 provider 오류 코드로 분류한다 */
export function classifyCliError(raw: string, ctx: CliErrorContext): ProviderError {
  const text = raw.trim();
  if (/not logged in|please (run )?\/?login|log ?in again|unauthori[sz]ed|\b401\b|invalid (api )?key|credential|authenticat|token (has )?expired|oauth/i.test(text)) {
    return providerError('auth', `${ctx.label}에 로그인되어 있지 않습니다. 터미널에서 \`${ctx.loginHint}\`을(를) 실행하세요.`);
  }
  if (/\b429\b|rate.?limit|usage limit|quota|too many requests|limit reached|overloaded|\b529\b/i.test(text)) {
    return providerError('rate-limit', `${ctx.label} 사용 한도에 도달했습니다. 잠시 후 다시 시도하세요.${text ? ` (${sanitize(text, 160)})` : ''}`);
  }
  if (/ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|network|fetch failed|getaddrinfo|socket hang up|stream disconnected/i.test(text)) {
    return providerError('network', `${ctx.label}가 네트워크에 연결하지 못했습니다.${text ? ` (${sanitize(text, 160)})` : ''}`);
  }
  return providerError('cli', `${ctx.label} 실행 오류${text ? `: ${sanitize(text)}` : '가 발생했습니다.'}`);
}
