import { randomBytes } from 'node:crypto';

export interface SessionRecord {
  userId: string;
  createdAt: number;
  lastSeenAt: number;
}

const store = new Map<string, SessionRecord>();
const IDLE_MS = 30 * 60 * 1000;

/**
 * 로그인 뒤 세션 ID를 만들어 HttpOnly 쿠키로 내려준다.
 * SameSite=Lax로 다른 사이트에서 오는 요청에 쿠키가 실리지 않게 해 CSRF를 줄인다.
 */
export function createSession(userId: string, now = Date.now()): { sid: string; setCookie: string } {
  const sid = randomBytes(32).toString('base64url');
  store.set(sid, { userId, createdAt: now, lastSeenAt: now });
  const setCookie = `sid=${sid}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${IDLE_MS / 1000}`;
  return { sid, setCookie };
}

/** 세션을 찾고, 30분 이상 쓰지 않았으면 지운다 */
export function touchSession(sid: string, now = Date.now()): SessionRecord | undefined {
  const rec = store.get(sid);
  if (!rec) return undefined;
  if (now - rec.lastSeenAt > IDLE_MS) {
    store.delete(sid);
    return undefined;
  }
  rec.lastSeenAt = now;
  return rec;
}
