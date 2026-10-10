import { describe, expect, it } from 'vitest';
import {
  answerHello,
  fromB64u,
  generateKeyPair,
  isTailscaleHost,
  keyFingerprint,
  normalizeBridgeUrl,
  pairingUri,
  parsePairingUri,
  parseWireFrame,
  randomCode,
  remoteRoute,
  safeEqual,
  signTranscript,
  startClientHandshake,
  toB64u,
  verifyTranscript,
} from '../src';

describe('base64url', () => {
  it('왕복 변환', () => {
    for (let n = 0; n < 40; n++) {
      const bytes = Uint8Array.from({ length: n }, (_, i) => (i * 37 + n) & 255);
      expect(Array.from(fromB64u(toB64u(bytes)))).toEqual(Array.from(bytes));
    }
  });
});

describe('핸드셰이크', () => {
  const bridge = generateKeyPair();

  function connect(expectedKey?: string) {
    const hs = startClientHandshake();
    const ans = answerHello(parseWireFrame(JSON.stringify(hs.hello))!, bridge)!;
    const fin = hs.finish(parseWireFrame(JSON.stringify(ans.challenge))!, expectedKey);
    return { ans, fin };
  }

  it('양쪽이 같은 transcript와 방향별 키를 얻는다', () => {
    const { ans, fin } = connect(bridge.publicKey);
    expect(fin.ok).toBe(true);
    if (!fin.ok) return;
    expect(toB64u(fin.transcript)).toBe(toB64u(ans.transcript));
    const f1 = fin.channel.seal({ hi: '안녕' });
    expect(ans.channel.open(parseWireFrame(f1)!)).toEqual({ hi: '안녕' });
    const f2 = ans.channel.seal({ type: 'welcome' });
    expect(fin.channel.open(parseWireFrame(f2)!)).toEqual({ type: 'welcome' });
  });

  it('예상한 bridge 키와 다르면 거부한다 (중간자)', () => {
    const { fin } = connect(generateKeyPair().publicKey);
    expect(fin.ok).toBe(false);
  });

  it('서명이 위조된 challenge는 거부한다', () => {
    const hs = startClientHandshake();
    const ans = answerHello(hs.hello, bridge)!;
    const forged = { ...ans.challenge, eph: answerHello(startClientHandshake().hello, bridge)!.challenge.eph };
    expect(hs.finish(forged).ok).toBe(false);
  });

  it('변조·재전송·자기 반사 프레임을 거부한다', () => {
    const { ans, fin } = connect();
    if (!fin.ok) throw new Error('handshake');
    const frame = parseWireFrame(fin.channel.seal({ n: 1 }))!;
    if (frame.t !== 'e') throw new Error('frame');
    const tampered = { ...frame, c: toB64u(fromB64u(frame.c).map((b, i) => (i === 3 ? b ^ 1 : b))) };
    expect(() => ans.channel.open(tampered)).toThrow();
    expect(ans.channel.open(frame)).toEqual({ n: 1 });
    expect(() => ans.channel.open(frame)).toThrow(); // 재전송
    expect(() => fin.channel.open(parseWireFrame(fin.channel.seal({ x: 1 }))!)).toThrow(); // 반사
  });

  it('기기 서명은 같은 transcript에서만 유효하다', () => {
    const device = generateKeyPair();
    const a = connect();
    const b = connect();
    if (!a.fin.ok || !b.fin.ok) throw new Error('handshake');
    const sig = signTranscript(device.secretKey, a.fin.transcript);
    expect(verifyTranscript(device.publicKey, a.ans.transcript, sig)).toBe(true);
    expect(verifyTranscript(device.publicKey, b.ans.transcript, sig)).toBe(false);
  });
});

describe('페어링 링크', () => {
  it('생성한 링크를 다시 해석한다', () => {
    const key = generateKeyPair().publicKey;
    const uri = pairingUri({ url: 'ws://100.64.0.7:7777', bridgeKey: key, token: 'tok_abc' });
    expect(uri.startsWith('branch://pair?')).toBe(true);
    expect(parsePairingUri(uri)).toEqual({ url: 'ws://100.64.0.7:7777', bridgeKey: key, token: 'tok_abc' });
    expect(parsePairingUri('branch://pair?u=ws://x:1&b=short&t=1')).toBeNull();
    expect(parsePairingUri('https://example.com')).toBeNull();
  });

  it('주소를 정규화한다', () => {
    expect(normalizeBridgeUrl('192.168.0.12')).toBe('ws://192.168.0.12:7777');
    expect(normalizeBridgeUrl('http://my-pc.tail1234.ts.net:8000')).toBe('ws://my-pc.tail1234.ts.net:8000');
    expect(normalizeBridgeUrl('wss://bridge.example.com')).toBe('wss://bridge.example.com:7777');
    expect(normalizeBridgeUrl('  ')).toBeNull();
  });

  it('Tailscale 주소를 구분한다', () => {
    expect(isTailscaleHost('100.64.0.7')).toBe(true);
    expect(isTailscaleHost('my-pc.tail1234.ts.net')).toBe(true);
    expect(isTailscaleHost('100.20.1.1')).toBe(false);
    expect(isTailscaleHost('192.168.0.12')).toBe(false);
    expect(remoteRoute('ws://192.168.0.12:7777')).toBe('LAN 직접 연결');
  });

  it('코드·지문·비교 유틸', () => {
    for (let i = 0; i < 50; i++) expect(randomCode()).toMatch(/^\d{6}$/);
    expect(keyFingerprint(generateKeyPair().publicKey)).toMatch(/^[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}$/);
    expect(safeEqual('123456', '123456')).toBe(true);
    expect(safeEqual('123456', '123457')).toBe(false);
    expect(safeEqual('12345', '123456')).toBe(false);
  });
});
