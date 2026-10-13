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
  type BridgeClientMsg,
  type SyncClientMsg,
  type SyncServerMsg,
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

  it('첨부는 형식이 맞을 때만 넘기고 틀리면 메시지를 거부', () => {
    const img = { id: 'a1', kind: 'image', name: 'x.png', mime: 'image/png', size: 3, data: 'AAAA' };
    const msg = (attachments: unknown) => ({ type: 'chat.start', reqId: 'r1', providerId: 'claude-cli', system: '', messages: [{ role: 'user', content: 'hi', attachments }] });
    expect(validateClientMsg(msg([img]))).toEqual(msg([img]));
    expect(validateClientMsg(msg([{ ...img, mime: 'text/html' }]))).toBeNull();
    expect(validateClientMsg(msg('nope'))).toBeNull();
  });
});

describe('원격 bridge — PC 정책 (데스크톱 호스트)', () => {
  it('원격이 보낸 모델·노력치 대신 PC가 정한 값으로 CLI를 실행한다', async () => {
    const echoHome = await mkdtemp(path.join(os.tmpdir(), 'branch-bridge-test-'));
    const echoStore = await openBridgeStore({ dir: echoHome, name: '정책 PC' });
    const bridge = createBridgeServer({
      cliEnv: {
        env: { ...process.env, FAKE_MODE: 'echo' },
        bin: { 'claude-cli': path.join(dir, 'fixtures/fake-claude.mjs'), 'codex-cli': path.join(dir, 'fixtures/fake-codex.mjs') },
      },
    });
    const host = createRemoteServer({
      bridge,
      store: echoStore,
      host: '127.0.0.1',
      port: 0,
      policy: () => ({ agent: 'claude-cli', options: { 'claude-cli': { model: 'sonnet', effort: 'high' } } }),
    });
    try {
      const { port } = await host.listen();
      const session = host.startPairing();
      const pairing = await pairWithBridge({
        offer: { url: `ws://127.0.0.1:${port}`, bridgeKey: echoStore.identity.publicKey, token: session.token },
        deviceName: '폰',
        wsFactory,
      });
      const getPairing = () => Promise.resolve(pairing);
      const link = createRemoteBridgeLink({ getPairing, wsFactory });
      const client = createBridgeClient(link);
      const evs = await collect(client.stream('claude-cli', { ...req, model: 'haiku', effort: 'max' }));
      const text = evs.map((e) => (e.type === 'delta' ? e.text : '')).join('');
      const { args } = JSON.parse(text) as { args: string[] };
      expect(args.join(' ')).toContain('--model sonnet');
      expect(args.join(' ')).toContain('--effort high');
      expect(args).not.toContain('haiku');
      link.reset();
    } finally {
      await host.close();
      await rm(echoHome, { recursive: true, force: true });
    }
  });
});

describe('원격 bridge — 동기화 라우팅 (ADR-026)', () => {
  type Got = { peerId: string; deviceId: string; msg: SyncClientMsg };

  /** sync 옵션 여부를 고른 별도 호스트 + 페어링된 기기 n대의 링크 */
  async function syncHost(withSync: boolean, devices: number) {
    const h = await mkdtemp(path.join(os.tmpdir(), 'branch-bridge-test-sync-'));
    const s = await openBridgeStore({ dir: h, name: '동기화 PC' });
    const received: Got[] = [];
    const gone: string[] = [];
    const host = createRemoteServer({
      bridge: createBridgeServer({ cliEnv: { env: process.env, bin: { 'claude-cli': 'claude-missing', 'codex-cli': 'codex-missing' } } }),
      store: s,
      host: '127.0.0.1',
      port: 0,
      sync: withSync
        ? { receive: (peerId, deviceId, msg) => received.push({ peerId, deviceId, msg }), peerGone: (p) => gone.push(p) }
        : undefined,
    });
    const { port } = await host.listen();
    const peers: { pairing: RemotePairing; link: ReturnType<typeof createRemoteBridgeLink>; inbox: SyncServerMsg[] }[] = [];
    for (let i = 0; i < devices; i++) {
      const session = host.startPairing();
      const pairing = await pairWithBridge({
        offer: { url: `ws://127.0.0.1:${port}`, bridgeKey: s.identity.publicKey, token: session.token },
        deviceName: `폰${i}`,
        wsFactory,
      });
      const link = createRemoteBridgeLink({ getPairing: () => Promise.resolve(pairing), wsFactory });
      const inbox: SyncServerMsg[] = [];
      link.subscribe((m) => inbox.push(m as unknown as SyncServerMsg));
      await link.ensure();
      peers.push({ pairing, link, inbox });
    }
    const cleanup = async () => {
      for (const p of peers) p.link.reset();
      await host.close();
      await rm(h, { recursive: true, force: true });
    };
    return { host, received, gone, peers, cleanup };
  }

  const sendSync = (link: ReturnType<typeof createRemoteBridgeLink>, msg: unknown) => link.send(msg as BridgeClientMsg);

  async function until(cond: () => boolean, ms = 2_000) {
    const end = Date.now() + ms;
    while (!cond()) {
      if (Date.now() > end) throw new Error('timeout');
      await new Promise((r) => setTimeout(r, 10));
    }
  }

  const reset: SyncServerMsg = { type: 'sync.reset' };

  it('sync 옵션이 없으면 sync 메시지에 sync.error(unsupported)로 응답한다', async () => {
    const t = await syncHost(false, 1);
    try {
      sendSync(t.peers[0]!.link, { type: 'sync.hello' });
      await until(() => t.peers[0]!.inbox.length > 0);
      expect(t.peers[0]!.inbox[0]).toEqual({ type: 'sync.error', error: 'unsupported' });
    } finally {
      await t.cleanup();
    }
  });

  it('두 기기의 sync.hello는 소켓마다 다른 peerId와 해당 deviceId로 receive에 도착한다', async () => {
    const t = await syncHost(true, 2);
    try {
      sendSync(t.peers[0]!.link, { type: 'sync.hello' });
      sendSync(t.peers[1]!.link, { type: 'sync.hello' });
      await until(() => t.received.length === 2);
      const [a, b] = t.received;
      expect(a!.msg).toEqual({ type: 'sync.hello' });
      expect(a!.peerId).not.toBe(b!.peerId);
      expect(new Set([a!.deviceId, b!.deviceId])).toEqual(new Set([t.peers[0]!.pairing.deviceId, t.peers[1]!.pairing.deviceId]));
    } finally {
      await t.cleanup();
    }
  });

  it("syncSend(peerId)는 그 기기에만, syncSend('*')는 hello를 보낸 기기에만 간다", async () => {
    const t = await syncHost(true, 2);
    try {
      const [p0, p1] = t.peers;
      sendSync(p0!.link, { type: 'sync.hello' });
      await until(() => t.received.length === 1);
      // p1은 hello 없이 sync.messages만 보낸다 → 피어 등록은 되지만 브로드캐스트 대상은 아님
      sendSync(p1!.link, { type: 'sync.messages', sessionId: 's1' });
      await until(() => t.received.length === 2);
      const peer0 = t.received[0]!.peerId;
      const peer1 = t.received[1]!.peerId;

      t.host.syncSend(peer1, { type: 'sync.draft', sessionId: 's1', draft: null });
      await until(() => p1!.inbox.length === 1);
      t.host.syncSend('*', reset);
      await until(() => p0!.inbox.length === 1);
      await new Promise((r) => setTimeout(r, 100));
      expect(p0!.inbox).toEqual([reset]);
      expect(p1!.inbox).toEqual([{ type: 'sync.draft', sessionId: 's1', draft: null }]);
      expect(peer0).not.toBe(peer1);
    } finally {
      await t.cleanup();
    }
  });

  it('형식이 틀린 act는 receive에 닿지 않고 act.result(invalid)로 응답한다', async () => {
    const t = await syncHost(true, 1);
    try {
      const p = t.peers[0]!;
      sendSync(p.link, { type: 'act', reqId: 'r1', op: { kind: 'send', sessionId: '../x', text: 'q', messageId: 'm1' } });
      sendSync(p.link, { type: 'act', reqId: 'r2', op: { kind: 'rm-rf' } });
      sendSync(p.link, { type: 'act', reqId: 'r3', op: { kind: 'send', sessionId: 's1', text: '질문', messageId: 'm1' } });
      await until(() => t.received.length === 1 && p.inbox.length === 2);
      expect(t.received[0]!.msg).toEqual({ type: 'act', reqId: 'r3', op: { kind: 'send', sessionId: 's1', text: '질문', messageId: 'm1' } });
      expect(p.inbox).toEqual([
        { type: 'act.result', reqId: 'r1', ok: false, error: 'invalid' },
        { type: 'act.result', reqId: 'r2', ok: false, error: 'invalid' },
      ]);
    } finally {
      await t.cleanup();
    }
  });

  it('연결이 끊기거나 기기를 해제하면 peerGone이 불리고 이후 전송 대상에서 빠진다', async () => {
    const t = await syncHost(true, 2);
    try {
      const [p0, p1] = t.peers;
      sendSync(p0!.link, { type: 'sync.hello' });
      sendSync(p1!.link, { type: 'sync.hello' });
      await until(() => t.received.length === 2);
      const byDevice = new Map(t.received.map((r) => [r.deviceId, r.peerId]));
      const peer0 = byDevice.get(p0!.pairing.deviceId)!;
      const peer1 = byDevice.get(p1!.pairing.deviceId)!;

      p0!.link.reset();
      await until(() => t.gone.length === 1);
      expect(t.gone).toEqual([peer0]);

      await t.host.unpair(p1!.pairing.deviceId);
      await until(() => t.gone.length === 2);
      expect(t.gone).toEqual([peer0, peer1]);
      // 끊긴 피어로 보내도 예외 없이 무시
      expect(() => t.host.syncSend(peer1, reset)).not.toThrow();
      expect(() => t.host.syncSend('*', reset)).not.toThrow();
    } finally {
      await t.cleanup();
    }
  });
});
