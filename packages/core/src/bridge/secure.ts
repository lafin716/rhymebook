import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import { ed25519, x25519 } from '@noble/curves/ed25519.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { concatBytes, randomBytes, utf8ToBytes } from '@noble/hashes/utils.js';

/**
 * 원격 bridge 연결의 보안 계층 (03-PROVIDERS 페어링, ADR-018).
 * - 신원: bridge·기기 각각 Ed25519 키쌍
 * - 연결마다 X25519 임시 키 합의 → HKDF-SHA256 → 방향별 XChaCha20-Poly1305 키
 * - bridge는 임시 키 교환 기록(transcript)에 신원 키로 서명, 기기도 같은 기록에 서명해 인증한다
 * WebCrypto 대신 순수 JS(@noble)를 쓴다: http(LAN/Tailscale)로 열린 웹 앱에는 crypto.subtle이 없다.
 */
export const BRIDGE_PROTOCOL = 'branch-bridge/1';

/* ── 인코딩 ───────────────────────────────────────────── */

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

export function toB64u(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]!;
    const b = bytes[i + 1];
    const c = bytes[i + 2];
    out += B64[a >> 2]! + B64[((a & 3) << 4) | ((b ?? 0) >> 4)]!;
    if (b !== undefined) out += B64[((b & 15) << 2) | ((c ?? 0) >> 6)]!;
    if (c !== undefined) out += B64[c & 63]!;
  }
  return out;
}

export function fromB64u(text: string): Uint8Array {
  const clean = text.replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let bits = 0;
  let acc = 0;
  let j = 0;
  for (const ch of clean) {
    const v = B64.indexOf(ch);
    if (v < 0) throw new Error('잘못된 base64url 문자열');
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[j++] = (acc >> bits) & 255;
    }
  }
  return out.subarray(0, j);
}

const textDecoder = new TextDecoder();

/* ── 신원 키 ──────────────────────────────────────────── */

export interface KeyPair {
  /** base64url Ed25519 비밀키 (비밀 값: SecretStore/0600 파일에만) */
  secretKey: string;
  /** base64url Ed25519 공개키 */
  publicKey: string;
}

export function generateKeyPair(): KeyPair {
  const { secretKey, publicKey } = ed25519.keygen();
  return { secretKey: toB64u(secretKey), publicKey: toB64u(publicKey) };
}

export function publicKeyOf(secretKey: string): string {
  return toB64u(ed25519.getPublicKey(fromB64u(secretKey)));
}

/** 공개키 → 짧은 id (bridgeId, deviceId) */
export function keyId(publicKey: string, prefix = ''): string {
  return prefix + toB64u(sha256(fromB64u(publicKey)).subarray(0, 9));
}

/** 사람이 눈으로 대조할 지문: "ab12-cd34-ef56" */
export function keyFingerprint(publicKey: string): string {
  const h = sha256(fromB64u(publicKey));
  const hex = Array.from(h.subarray(0, 6), (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 4)}-${hex.slice(4, 8)}-${hex.slice(8, 12)}`;
}

export function signTranscript(secretKey: string, transcript: Uint8Array): string {
  return toB64u(ed25519.sign(transcript, fromB64u(secretKey)));
}

export function verifyTranscript(publicKey: string, transcript: Uint8Array, sig: string): boolean {
  try {
    return ed25519.verify(fromB64u(sig), transcript, fromB64u(publicKey));
  } catch {
    return false;
  }
}

/* ── 페어링 제안 (QR/링크) ─────────────────────────────── */

export interface PairingOffer {
  /** ws://host:port */
  url: string;
  /** bridge 공개키. 코드만 입력한 경우엔 없음(최초 연결 시 신뢰, 지문 표시) */
  bridgeKey?: string;
  /** 1회용 토큰(QR) 또는 6자리 코드 */
  token: string;
  /** 직접 연결이 안 될 때 쓸 relay 주소 (wss://relay/c/<bridgeId>) */
  relay?: string;
}

export type QrPairingOffer = PairingOffer & { bridgeKey: string };

export function pairingUri(offer: QrPairingOffer): string {
  const q = new URLSearchParams({ u: offer.url, b: offer.bridgeKey, t: offer.token });
  if (offer.relay) q.set('r', offer.relay);
  return `branch://pair?${q.toString()}`;
}

/** 주소에 스킴·포트가 없으면 채운다: "100.1.2.3" → "ws://100.1.2.3:7777" */
export function normalizeBridgeUrl(input: string, defaultPort = 7777): string | null {
  let s = input.trim();
  if (!s) return null;
  if (!/^wss?:\/\//i.test(s)) s = `ws://${s.replace(/^https?:\/\//i, '')}`;
  try {
    const u = new URL(s);
    if (!u.hostname) return null;
    // relay 주소처럼 경로가 있으면 표준 포트(80/443)를 그대로 쓴다
    if (!u.port && (u.pathname === '/' || u.pathname === '')) u.port = String(defaultPort);
    return `${u.protocol}//${u.host}${u.pathname === '/' ? '' : u.pathname}`;
  } catch {
    return null;
  }
}

/** branch://pair 링크(또는 그 쿼리를 담은 아무 URL) 해석 */
export function parsePairingUri(text: string): QrPairingOffer | null {
  const s = text.trim();
  const i = s.indexOf('?');
  if (!/^branch:\/\/pair/i.test(s) || i < 0) return null;
  const q = new URLSearchParams(s.slice(i + 1));
  const url = normalizeBridgeUrl(q.get('u') ?? '');
  const bridgeKey = q.get('b') ?? '';
  const token = q.get('t') ?? '';
  if (!url || !bridgeKey || !token) return null;
  try {
    if (fromB64u(bridgeKey).length !== 32) return null;
  } catch {
    return null;
  }
  const r = q.get('r');
  const relay = r ? normalizeBridgeUrl(r) : null;
  return relay && relay !== url ? { url, bridgeKey, token, relay } : { url, bridgeKey, token };
}

/* ── 핸드셰이크 ───────────────────────────────────────── */

/** 평문 핸드셰이크 프레임 + 암호 프레임 */
export type WireFrame =
  | { t: 'hello'; v: 1; eph: string }
  | { t: 'challenge'; v: 1; key: string; eph: string; sig: string }
  | { t: 'e'; n: string; c: string };

/** 암호 채널 안에서 오가는 인증 메시지 */
export type AuthRequest =
  | { type: 'pair'; token: string; device: string; name: string; sig: string }
  | { type: 'auth'; device: string; sig: string };

export type AuthReason = 'unknown-device' | 'bad-token' | 'expired' | 'bad-signature' | 'protocol';

export type AuthResponse =
  | { type: 'welcome'; bridgeId: string; name: string; deviceId: string }
  | { type: 'denied'; reason: AuthReason };

function transcriptOf(clientEph: Uint8Array, bridgeEph: Uint8Array, bridgeKey: Uint8Array): Uint8Array {
  return sha256(concatBytes(utf8ToBytes(BRIDGE_PROTOCOL), clientEph, bridgeEph, bridgeKey));
}

/** 방향별 키로 seal/open. 평문에 순번을 넣어 같은 연결 안의 재전송·순서 바꿈을 거부한다 */
export class SecureChannel {
  private sendSeq = 0;
  private recvSeq = 0;
  constructor(
    private readonly sendKey: Uint8Array,
    private readonly recvKey: Uint8Array,
  ) {}

  seal(msg: unknown): string {
    const nonce = randomBytes(24);
    const plain = utf8ToBytes(JSON.stringify({ s: this.sendSeq++, m: msg }));
    const frame: WireFrame = { t: 'e', n: toB64u(nonce), c: toB64u(xchacha20poly1305(this.sendKey, nonce).encrypt(plain)) };
    return JSON.stringify(frame);
  }

  /** 복호화 실패·순번 오류면 throw */
  open(frame: WireFrame): unknown {
    if (frame.t !== 'e') throw new Error('암호화되지 않은 프레임');
    const plain = xchacha20poly1305(this.recvKey, fromB64u(frame.n)).decrypt(fromB64u(frame.c));
    const body = JSON.parse(textDecoder.decode(plain)) as { s: number; m: unknown };
    if (body.s !== this.recvSeq) throw new Error('프레임 순서 오류');
    this.recvSeq++;
    return body.m;
  }
}

function deriveChannel(secret: Uint8Array, peerEph: Uint8Array, transcript: Uint8Array, side: 'client' | 'bridge'): SecureChannel {
  const shared = x25519.getSharedSecret(secret, peerEph);
  const okm = hkdf(sha256, shared, transcript, utf8ToBytes(`${BRIDGE_PROTOCOL} keys`), 64);
  const c2b = okm.subarray(0, 32);
  const b2c = okm.subarray(32, 64);
  return side === 'client' ? new SecureChannel(c2b, b2c) : new SecureChannel(b2c, c2b);
}

export function parseWireFrame(data: string): WireFrame | null {
  try {
    const f = JSON.parse(data) as WireFrame;
    if (f && typeof f === 'object' && (f.t === 'hello' || f.t === 'challenge' || f.t === 'e')) return f;
  } catch {
    // 무시
  }
  return null;
}

export interface ClientHandshake {
  hello: Extract<WireFrame, { t: 'hello' }>;
  /**
   * challenge 검증 후 채널 생성.
   * expectedKey가 있으면(QR 페어링·기존 페어링) bridge 공개키가 일치해야 한다.
   */
  finish(
    challenge: WireFrame,
    expectedKey?: string,
  ): { ok: true; channel: SecureChannel; transcript: Uint8Array; bridgeKey: string } | { ok: false; reason: string };
}

export function startClientHandshake(): ClientHandshake {
  const eph = x25519.keygen();
  return {
    hello: { t: 'hello', v: 1, eph: toB64u(eph.publicKey) },
    finish(challenge, expectedKey) {
      if (challenge.t !== 'challenge' || challenge.v !== 1) return { ok: false, reason: '지원하지 않는 bridge 버전입니다.' };
      if (expectedKey && challenge.key !== expectedKey) {
        return { ok: false, reason: 'bridge 키가 페어링한 값과 다릅니다. 다른 기기이거나 중간자 공격일 수 있습니다.' };
      }
      try {
        const bridgeEph = fromB64u(challenge.eph);
        const transcript = transcriptOf(eph.publicKey, bridgeEph, fromB64u(challenge.key));
        if (!verifyTranscript(challenge.key, transcript, challenge.sig)) return { ok: false, reason: 'bridge 서명이 올바르지 않습니다.' };
        return { ok: true, channel: deriveChannel(eph.secretKey, bridgeEph, transcript, 'client'), transcript, bridgeKey: challenge.key };
      } catch {
        return { ok: false, reason: 'bridge 응답을 해석할 수 없습니다.' };
      }
    },
  };
}

/** bridge 쪽: hello에 응답하고 채널을 만든다. 형식이 틀리면 null */
export function answerHello(
  hello: WireFrame,
  identity: KeyPair,
): { challenge: Extract<WireFrame, { t: 'challenge' }>; channel: SecureChannel; transcript: Uint8Array } | null {
  if (hello.t !== 'hello' || hello.v !== 1) return null;
  try {
    const clientEph = fromB64u(hello.eph);
    if (clientEph.length !== 32) return null;
    const eph = x25519.keygen();
    const transcript = transcriptOf(clientEph, eph.publicKey, fromB64u(identity.publicKey));
    return {
      challenge: { t: 'challenge', v: 1, key: identity.publicKey, eph: toB64u(eph.publicKey), sig: signTranscript(identity.secretKey, transcript) },
      channel: deriveChannel(eph.secretKey, clientEph, transcript, 'bridge'),
      transcript,
    };
  } catch {
    return null;
  }
}

/** 상수 시간 문자열 비교 (토큰·코드) */
export function safeEqual(a: string, b: string): boolean {
  const x = utf8ToBytes(a);
  const y = utf8ToBytes(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

export function randomToken(bytes = 16): string {
  return toB64u(randomBytes(bytes));
}

/** 6자리 숫자 코드 (편향 없는 난수) */
export function randomCode(): string {
  while (true) {
    const b = randomBytes(4);
    const n = ((b[0]! << 24) | (b[1]! << 16) | (b[2]! << 8) | b[3]!) >>> 0;
    if (n < 4_294_000_000) return String(n % 1_000_000).padStart(6, '0');
  }
}
