import { mkdtemp, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createBridgeClient,
  createRemoteBridgeLink,
  createRemoteBridgeProviders,
  generateKeyPair,
  pairWithBridge,
  RemoteBridgeError,
  type RemotePairing,
  type StreamEvent,
  type WebSocketFactory,
} from '@branch/core';
import { createBridgeServer, createRemoteServer, openBridgeStore, validateClientMsg, type BridgeStore, type RemoteServer } from '../src';

const dir = path.dirname(fileURLToPath(import.meta.url));
const wsFactory: WebSocketFactory = (url) => new WebSocket(url);

let home: string;
let store: BridgeStore;
let server: RemoteServer;
let url: string;

beforeEach(async () => {
  home = await mkdtemp(path.join(os.tmpdir(), 'branch-bridge-test-'));
  store = await openBridgeStore({ dir: home, name: '테스트 PC' });
  const bridge = createBridgeServer({
    cliEnv: {
      env: { ...process.env, FAKE_MODE: 'ok' },
      bin: { 'claude-cli': path.join(dir, 'fixtures/fake-claude.mjs'), 'codex-cli': path.join(dir, 'fixtures/fake-codex.mjs') },
    },
  });
  server = createRemoteServer({ bridge, store, host: '127.0.0.1', port: 0 });
  const { port } = await server.listen();
  url = `ws://127.0.0.1:${port}`;
});

afterEach(async () => {
  await server.close();
  await rm(home, { recursive: true, force: true });
});

async function collect(it: AsyncIterable<StreamEvent>): Promise<StreamEvent[]> {
  const out: StreamEvent[] = [];
  for await (const ev of it) out.push(ev);
  return out;
}

async function pairByQr(): Promise<RemotePairing> {
  const session = server.startPairing();
  return pairWithBridge({ offer: { url, bridgeKey: store.identity.publicKey, token: session.token }, deviceName: '내 폰', wsFactory });
}

function remote(pairing: RemotePairing | null, includeCli = true) {
  const getPairing = () => Promise.resolve(pairing);
  const link = createRemoteBridgeLink({ getPairing, wsFactory });
  const client = createBridgeClient(link);
  return { link, providers: createRemoteBridgeProviders({ link, client, getPairing, includeCli }) };
}

const req = { system: '튜터', messages: [{ role: 'user' as const, content: '질문' }] };

describe('원격 bridge — 페어링', () => {
  it('QR 링크로 페어링하고 기기 키는 bridge 저장소(0600)에 공개키만 남는다', async () => {
    const p = await pairByQr();
    expect(p.trust).toBe('qr');
    expect(p.bridgeName).toBe('테스트 PC');
    expect(p.bridgeId).toBe(store.bridgeId);
    expect(store.devices()).toHaveLength(1);
    expect(store.devices()[0]!.id).toBe(p.deviceId);
    expect(JSON.stringify(store.devices())).not.toContain(p.deviceSecret);
    expect((await stat(path.join(home, 'devices.json'))).mode & 0o777).toBe(0o600);
    expect((await stat(path.join(home, 'identity.json'))).mode & 0o777).toBe(0o600);
  });

  it('주소 + 6자리 코드로 페어링 (TOFU)', async () => {
    const session = server.startPairing();
    const p = await pairWithBridge({ offer: { url, token: session.code }, deviceName: '태블릿', wsFactory });
    expect(p.trust).toBe('code');
    expect(p.bridgeKey).toBe(store.identity.publicKey);
  });

  it('페어링 토큰은 1회용', async () => {
    const session = server.startPairing();
    await pairWithBridge({ offer: { url, token: session.code }, deviceName: 'a', wsFactory });
    await expect(pairWithBridge({ offer: { url, token: session.code }, deviceName: 'b', wsFactory })).rejects.toMatchObject({
      code: 'denied',
      reason: 'expired',
    });
  });

  it('틀린 코드는 거부되고 5회 틀리면 페어링이 취소된다', async () => {
    const session = server.startPairing();
    const wrong = session.code === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i++) {
      await expect(pairWithBridge({ offer: { url, token: wrong }, deviceName: 'x', wsFactory })).rejects.toMatchObject({ reason: 'bad-token' });
    }
    expect(server.pairingActive()).toBe(false);
    await expect(pairWithBridge({ offer: { url, token: session.code }, deviceName: 'x', wsFactory })).rejects.toMatchObject({ reason: 'expired' });
  });

  it('만료된 코드는 거부', async () => {
    const session = server.startPairing(-1);
    await expect(pairWithBridge({ offer: { url, token: session.code }, deviceName: 'x', wsFactory })).rejects.toMatchObject({ reason: 'expired' });
  });

  it('QR의 bridge 키와 실제 키가 다르면 접속하지 않는다 (중간자 차단)', async () => {
    const session = server.startPairing();
    const err = await pairWithBridge({
      offer: { url, bridgeKey: generateKeyPair().publicKey, token: session.token },
      deviceName: 'x',
      wsFactory,
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RemoteBridgeError);
    expect((err as RemoteBridgeError).code).toBe('key-mismatch');
    expect(server.pairingActive()).toBe(true);
  });

  it('주소가 닿지 않으면 unreachable', async () => {
    const err = await pairWithBridge({ offer: { url: 'ws://127.0.0.1:1', token: '123456' }, deviceName: 'x', wsFactory }).catch((e: unknown) => e);
    expect((err as RemoteBridgeError).code).toBe('unreachable');
  });
});

describe('원격 bridge — provider', () => {
  it('페어링된 기기로 상태 조회와 스트리밍 (remote-bridge, claude-cli 경유)', async () => {
    const { link, providers } = remote(await pairByQr());
    const a = await providers['remote-bridge']!.available();
    expect(a.status).toBe('ready');
    expect(a.detail).toMatch(/^테스트 PC · LAN 직접 연결 · 지연 \d+ms · Claude CLI, Codex CLI$/);

    const evs = await collect(providers['remote-bridge']!.stream(req));
    expect(evs.map((e) => (e.type === 'delta' ? e.text : '')).join('')).toBe('안녕하세요');
    expect(evs.at(-1)?.type).toBe('done');

    const cli = await providers['claude-cli']!.available();
    expect(cli.status).toBe('ready');
    expect(cli.detail).toContain('원격 Bridge(테스트 PC) 경유');
    expect(server.connectedDevices()).toHaveLength(1);
    link.reset();
  });

  it('페어링이 없으면 unpaired, CLI는 웹 안내', async () => {
    const { providers } = remote(null);
    expect((await providers['remote-bridge']!.available()).status).toBe('unpaired');
    expect((await providers['claude-cli']!.available()).status).toBe('not-installed');
  });

  it('bridge에서 해제된 기기는 연결이 끊기고 다시 접속할 수 없다', async () => {
    const pairing = await pairByQr();
    const { link, providers } = remote(pairing);
    expect((await providers['remote-bridge']!.available()).status).toBe('ready');
    const closed = new Promise<void>((resolve) => link.onDisconnect!(resolve));
    await server.unpair(pairing.deviceId);
    await closed;
    const a = await providers['remote-bridge']!.available();
    expect(a.status).toBe('unpaired');
    expect(a.detail).toContain('페어링');
  });

  it('bridge가 꺼져 있으면 offline', async () => {
    const pairing = await pairByQr();
    await server.close();
    const { providers } = remote(pairing);
    expect((await providers['remote-bridge']!.available()).status).toBe('offline');
    const evs = await collect(providers['remote-bridge']!.stream(req));
    expect(evs[0]).toMatchObject({ type: 'error', error: { code: 'offline' } });
  });
});

describe('validateClientMsg', () => {
  it('형식이 맞는 메시지만 통과시키고 CLI 옵션처럼 보이는 모델명은 거부', () => {
    const base = { type: 'chat.start', reqId: 'r1', providerId: 'claude-cli', system: '', messages: [{ role: 'user', content: 'hi' }] };
    expect(validateClientMsg(base)).toEqual(base);
    expect(validateClientMsg({ ...base, model: 'claude-sonnet-4-5' })).not.toBeNull();
    expect(validateClientMsg({ ...base, model: '--dangerously-skip-permissions' })).toBeNull();
    expect(validateClientMsg({ ...base, providerId: 'shell' })).toBeNull();
    expect(validateClientMsg({ ...base, messages: [{ role: 'system', content: 'x' }] })).toBeNull();
    expect(validateClientMsg({ ...base, extra: 1 })).toEqual(base);
    expect(validateClientMsg({ ...base, effort: 'high' })).toEqual({ ...base, effort: 'high' });
    expect(validateClientMsg({ ...base, effort: 'ultra' })).toBeNull();
    expect(validateClientMsg({ ...base, providerId: 'codex-cli', effort: 'ultra' })).not.toBeNull();
    expect(validateClientMsg({ ...base, effort: '--x' })).toBeNull();
    expect(validateClientMsg({ type: 'status.get', reqId: 'a b' })).toBeNull();
    expect(validateClientMsg({ type: 'chat.abort', reqId: 'r1' })).toEqual({ type: 'chat.abort', reqId: 'r1' });
  });
});
