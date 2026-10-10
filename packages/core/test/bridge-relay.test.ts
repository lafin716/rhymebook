import { describe, expect, it } from 'vitest';
import {
  generateKeyPair,
  isBridgeId,
  isRelayUrl,
  keyId,
  normalizeBridgeUrl,
  pairingUri,
  parsePairingUri,
  parseRelayFrame,
  relayBridgeUrl,
  relayClientUrl,
  relayRegisterTranscript,
  remoteRoute,
  signTranscript,
  verifyTranscript,
} from '../src';

const id = keyId(generateKeyPair().publicKey, 'brg_');

describe('relay 주소', () => {
  it('bridge/클라이언트 경로를 만들고 relay 주소를 구분한다', () => {
    expect(isBridgeId(id)).toBe(true);
    expect(isBridgeId('brg_../x')).toBe(false);
    expect(relayClientUrl('wss://relay.example.com/', id)).toBe(`wss://relay.example.com/c/${id}`);
    expect(relayBridgeUrl('wss://relay.example.com', id)).toBe(`wss://relay.example.com/b/${id}`);
    expect(isRelayUrl(relayClientUrl('wss://relay.example.com', id))).toBe(true);
    expect(isRelayUrl('ws://100.64.0.1:7777')).toBe(false);
    expect(remoteRoute(relayClientUrl('wss://relay.example.com', id))).toBe('Relay 경유');
    expect(remoteRoute('ws://100.64.0.1:7777')).toBe('Tailscale 직접 연결');
  });

  it('경로가 있는 주소에는 기본 포트를 붙이지 않는다', () => {
    expect(normalizeBridgeUrl(`wss://relay.example.com/c/${id}`)).toBe(`wss://relay.example.com/c/${id}`);
    expect(normalizeBridgeUrl('wss://bridge.example.com')).toBe('wss://bridge.example.com:7777');
  });

  it('페어링 링크에 relay 대체 주소(r)를 싣고 해석한다', () => {
    const k = generateKeyPair();
    const relay = relayClientUrl('wss://relay.example.com', keyId(k.publicKey, 'brg_'));
    const offer = parsePairingUri(pairingUri({ url: 'ws://192.168.0.2:7777', relay, bridgeKey: k.publicKey, token: 'tok' }))!;
    expect(offer).toMatchObject({ url: 'ws://192.168.0.2:7777', relay, bridgeKey: k.publicKey, token: 'tok' });
    const same = parsePairingUri(pairingUri({ url: relay, relay, bridgeKey: k.publicKey, token: 'tok' }))!;
    expect(same.relay).toBeUndefined();
  });

  it('등록 서명은 nonce·bridgeId에 묶인다', () => {
    const k = generateKeyPair();
    const bid = keyId(k.publicKey, 'brg_');
    const sig = signTranscript(k.secretKey, relayRegisterTranscript('n1', bid));
    expect(verifyTranscript(k.publicKey, relayRegisterTranscript('n1', bid), sig)).toBe(true);
    expect(verifyTranscript(k.publicKey, relayRegisterTranscript('n2', bid), sig)).toBe(false);
    expect(verifyTranscript(k.publicKey, relayRegisterTranscript('n1', id), sig)).toBe(false);
  });

  it('형식이 틀린 relay 프레임은 버린다', () => {
    expect(parseRelayFrame('{"t":"open","ch":1}')).toEqual({ t: 'open', ch: 1 });
    expect(parseRelayFrame('not json')).toBeNull();
    expect(parseRelayFrame('[1]')).toBeNull();
  });
});
