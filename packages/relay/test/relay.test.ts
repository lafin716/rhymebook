import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import {
  createBridgeClient,
  createRemoteBridgeLink,
  createRemoteBridgeProviders,
  generateKeyPair,
  keyId,
  pairWithBridge,
  parsePairingUri,
  relayBridgeUrl,
  relayClientUrl,
  relayRegisterTranscript,
  RemoteBridgeError,
  signTranscript,
  type RemotePairing,
  type StreamEvent,
  type WebSocketFactory,
} from '@branch/core';
import {
  createBridgeServer,
  createRelayConnector,
  createRemoteServer,
  openBridgeStore,
  type BridgeStore,
  type RelayConnector,
  type RemoteServer,
} from '@branch/bridge';
import { createRelayServer, type RelayServer } from '../src';

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../bridge/test/fixtures');
const wsFactory: WebSocketFactory = (url) => new globalThis.WebSocket(url);

let home: string;
let store: BridgeStore;
let relay: RelayServer;
let relayBase: string;
let server: RemoteServer;
let connector: RelayConnector;
const transcript: string[] = [];

beforeEach(async () => {
  transcript.length = 0;
  relay = createRelayServer({ host: '127.0.0.1', port: 0, log: (m) => transcript.push(m) });
  relayBase = `ws://127.0.0.1:${(await relay.listen()).port}`;
  home = await mkdtemp(path.join(os.tmpdir(), 'branch-relay-test-'));
  store = await openBridgeStore({ dir: home, name: 'NAT 뒤 PC' });
  const bridge = createBridgeServer({
    cliEnv: {
      env: { ...process.env, FAKE_MODE: 'ok' },
      bin: { 'claude-cli': path.join(fixtures, 'fake-claude.mjs'), 'codex-cli': path.join(fixtures, 'fake-codex.mjs') },
    },
  });
  // listen()을 호출하지 않는다 = 들어오는 포트가 없는 NAT 뒤 bridge
  server = createRemoteServer({ bridge, store });
  server.setRelay(relayBase);
  connector = createRelayConnector({ url: relayBase, store, accept: server.accept });
  expect(await connector.ready(5_000)).toBe(true);
});

afterEach(async () => {
  connector.close();
  await server.close();
  await relay.close();
  await rm(home, { recursive: true, force: true });
});

async function collect(it: AsyncIterable<StreamEvent>): Promise<StreamEvent[]> {
  const out: StreamEvent[] = [];
  for await (const ev of it) out.push(ev);
  return out;
}

function remote(pairing: RemotePairing) {
  const getPairing = () => Promise.resolve(pairing);
  const link = createRemoteBridgeLink({ getPairing, wsFactory });
  return { link, providers: createRemoteBridgeProviders({ link, client: createBridgeClient(link), getPairing, includeCli: true }) };
}

const req = { system: '튜터', messages: [{ role: 'user' as const, content: '질문' }] };

describe('relay — NAT 뒤 bridge 접속', () => {
  it('relay 전용 bridge의 페어링 링크에는 relay 주소만 있고, 링크로 페어링 후 스트리밍된다', async () => {
    const session = server.startPairing();
    const uris = server.pairingUris(session);
    expect(uris.map((u) => u.address.label)).toEqual(['Relay']);
    const offer = parsePairingUri(uris[0]!.uri)!;
    expect(offer.url).toBe(relayClientUrl(relayBase, store.bridgeId));

    const pairing = await pairWithBridge({ offer, deviceName: '외부 폰', wsFactory });
    expect(pairing.bridgeId).toBe(store.bridgeId);
    expect(pairing.trust).toBe('qr');

    const { link, providers } = remote(pairing);
    const a = await providers['remote-bridge']!.available();
    expect(a.status).toBe('ready');
    expect(a.detail).toMatch(/^NAT 뒤 PC · Relay 경유 · 지연 \d+ms · Claude CLI, Codex CLI$/);
    const evs = await collect(providers['claude-cli']!.stream(req));
    expect(evs.map((e) => (e.type === 'delta' ? e.text : '')).join('')).toBe('안녕하세요');
    expect(server.connectedDevices()).toEqual([pairing.deviceId]);
    link.reset();
  });

  it('코드 입력(TOFU)도 relay 주소로 동작한다', async () => {
    const session = server.startPairing();
    const p = await pairWithBridge({ offer: { url: relayClientUrl(relayBase, store.bridgeId), token: session.code }, deviceName: '태블릿', wsFactory });
    expect(p.bridgeKey).toBe(store.identity.publicKey);
  });

  it('직접 주소가 막혀 있으면 relay로 넘어간다', async () => {
    const session = server.startPairing();
    const p = await pairWithBridge({
      offer: { url: 'ws://127.0.0.1:1', relay: relayClientUrl(relayBase, store.bridgeId), bridgeKey: store.identity.publicKey, token: session.token },
      deviceName: '노트북',
      wsFactory,
    });
    expect(p.url).toBe('ws://127.0.0.1:1');
    expect(p.relayUrl).toBe(relayClientUrl(relayBase, store.bridgeId));
    const { link, providers } = remote(p);
    expect((await providers['remote-bridge']!.available()).detail).toContain('Relay 경유');
    link.reset();
  });

  it('relay는 페어링 토큰·평문을 보지 못한다 (중계 프레임은 암호문)', async () => {
    const seen: string[] = [];
    // relay가 넘겨주는 프레임을 bridge 쪽에서 엿보는 가짜 bridge 대신, 클라이언트 프레임을 직접 관찰
    const session = server.startPairing();
    const tapped: WebSocketFactory = (url) => {
      const ws = new globalThis.WebSocket(url);
      const send = ws.send.bind(ws);
      ws.send = (d: string) => {
        seen.push(String(d));
        send(d);
      };
      return ws;
    };
    await pairWithBridge({ offer: { url: relayClientUrl(relayBase, store.bridgeId), bridgeKey: store.identity.publicKey, token: session.token }, deviceName: '비밀 이름', wsFactory: tapped });
    const all = seen.join('\n');
    expect(seen.length).toBeGreaterThan(1);
    expect(all).not.toContain(session.token);
    expect(all).not.toContain('비밀 이름');
    expect(transcript.join('\n')).not.toContain(session.token);
  });

  it('bridge가 relay에 없으면 4404로 닫히고 오프라인 안내가 나온다', async () => {
    connector.close();
    await waitFor(() => relay.bridges().length === 0);
    const err = await pairWithBridge({ offer: { url: relayClientUrl(relayBase, store.bridgeId), token: '123456' }, deviceName: 'x', wsFactory }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RemoteBridgeError);
    expect((err as RemoteBridgeError).code).toBe('unreachable');
    expect((err as Error).message).toContain('--relay');
  });

  it('relay가 끊긴 뒤 페어링된 기기는 offline → 대체 provider 대상이 된다', async () => {
    const session = server.startPairing();
    const pairing = await pairWithBridge({ offer: { url: relayClientUrl(relayBase, store.bridgeId), token: session.code }, deviceName: 'x', wsFactory });
    connector.close();
    await waitFor(() => relay.bridges().length === 0);
    const { providers } = remote(pairing);
    expect((await providers['remote-bridge']!.available()).status).toBe('offline');
    const evs = await collect(providers['remote-bridge']!.stream(req));
    expect(evs[0]).toMatchObject({ type: 'error', error: { code: 'offline' } });
  });
});

describe('relay — bridge 등록', () => {
  async function register(bridgeId: string, sign: (nonce: string) => { key: string; sig: string }): Promise<number | 'ready'> {
    const ws = new WebSocket(relayBridgeUrl(relayBase, bridgeId));
    return new Promise((resolve) => {
      ws.on('message', (d) => {
        const f = JSON.parse(d.toString()) as { t: string; nonce?: string };
        if (f.t === 'challenge') ws.send(JSON.stringify({ t: 'register', ...sign(f.nonce!) }));
        if (f.t === 'ready') {
          resolve('ready');
          ws.close();
        }
      });
      ws.on('close', (code) => resolve(code));
    });
  }

  it('남의 bridgeId로는 등록할 수 없다 (키 해시 불일치)', async () => {
    const other = generateKeyPair();
    const r = await register(store.bridgeId, (nonce) => ({ key: other.publicKey, sig: signTranscript(other.secretKey, relayRegisterTranscript(nonce, store.bridgeId)) }));
    expect(r).toBe(4001);
    expect(relay.bridges()).toEqual([store.bridgeId]);
  });

  it('공개키만 알고 서명을 못 하면 거부', async () => {
    const other = generateKeyPair();
    const r = await register(store.bridgeId, (nonce) => ({ key: store.identity.publicKey, sig: signTranscript(other.secretKey, relayRegisterTranscript(nonce, store.bridgeId)) }));
    expect(r).toBe(4001);
  });

  it('올바른 키는 등록되고, 잘못된 경로는 업그레이드 거부', async () => {
    const k = generateKeyPair();
    const id = keyId(k.publicKey, 'brg_');
    expect(await register(id, (nonce) => ({ key: k.publicKey, sig: signTranscript(k.secretKey, relayRegisterTranscript(nonce, id)) }))).toBe('ready');
    const bad = await new Promise<string>((resolve) => {
      const ws = new WebSocket(`${relayBase}/x/../etc`);
      ws.on('error', (e) => resolve(e.message));
      ws.on('open', () => resolve('open'));
    });
    expect(bad).toContain('404');
    const health = (await (await fetch(`${relayBase.replace('ws:', 'http:')}/health`)).json()) as { ok: boolean };
    expect(health.ok).toBe(true);
  });
});

async function waitFor(cond: () => boolean, ms = 3_000) {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error('timeout');
    await new Promise((r) => setTimeout(r, 20));
  }
}
