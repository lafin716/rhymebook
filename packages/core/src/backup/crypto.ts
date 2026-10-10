/**
 * 선택형 패스프레이즈 암호화 (WebCrypto: PBKDF2-SHA256 → AES-GCM 256).
 * 브라우저·Node 20+·Electron·Capacitor WebView 모두 globalThis.crypto.subtle을 제공한다.
 * 암호는 어디에도 저장하지 않는다.
 */
export interface EncryptedPayload {
  alg: 'AES-GCM';
  kdf: 'PBKDF2-SHA256';
  iterations: number;
  salt: string;
  iv: string;
  data: string;
}

export const PBKDF2_ITERATIONS = 310_000;

const enc = new TextEncoder();
const dec = new TextDecoder();

export function bytesToBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(b64.replace(/\s+/g, '')), (c) => c.charCodeAt(0));
}

export function utf8ToBase64(text: string): string {
  return bytesToBase64(enc.encode(text));
}

export function base64ToUtf8(b64: string): string {
  return dec.decode(base64ToBytes(b64));
}

async function deriveKey(passphrase: string, salt: Uint8Array<ArrayBuffer>, iterations: number) {
  const base = await crypto.subtle.importKey('raw', enc.encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function encryptText(plain: string, passphrase: string, iterations = PBKDF2_ITERATIONS): Promise<EncryptedPayload> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt, iterations);
  const data = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(plain)));
  return { alg: 'AES-GCM', kdf: 'PBKDF2-SHA256', iterations, salt: bytesToBase64(salt), iv: bytesToBase64(iv), data: bytesToBase64(data) };
}

/** 암호가 틀리면 AES-GCM 인증 실패로 throw */
export async function decryptText(p: EncryptedPayload, passphrase: string): Promise<string> {
  if (p.alg !== 'AES-GCM' || p.kdf !== 'PBKDF2-SHA256' || !(p.iterations > 0)) throw new Error('unsupported');
  const key = await deriveKey(passphrase, base64ToBytes(p.salt), p.iterations);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: base64ToBytes(p.iv) }, key, base64ToBytes(p.data));
  return dec.decode(plain);
}
