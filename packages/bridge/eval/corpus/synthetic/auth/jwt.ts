import { createHmac, timingSafeEqual } from 'node:crypto';

export interface TokenClaims {
  sub: string;
  role: 'admin' | 'member';
  exp: number;
}

const SECRET = process.env.JWT_SECRET ?? '';

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

/** 클레임을 HS256으로 서명해 토큰 문자열을 만든다 */
export function signToken(claims: TokenClaims): string {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify(claims));
  const sig = createHmac('sha256', SECRET).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
}

/**
 * 서명을 검증하고 만료 시각을 확인한다. 실패하면 null.
 * 서명 비교는 timingSafeEqual로 해서 길이·내용 차이로 시간을 재지 못하게 한다.
 */
export function verifyToken(token: string, now = Date.now() / 1000): TokenClaims | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, body, sig] = parts as [string, string, string];
  const expected = Buffer.from(createHmac('sha256', SECRET).update(`${header}.${body}`).digest('base64url'));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  const claims = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as TokenClaims;
  return claims.exp > now ? claims : null;
}
