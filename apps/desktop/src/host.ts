import { readFile, writeFile, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  createBridgeServer,
  createRelayConnector,
  createRemoteServer,
  openBridgeStore,
  type BridgeStore,
  type PairingSession,
  type RelayConnector,
  type RemoteServer,
} from '@branch/bridge';
import { keyFingerprint, type HostPolicy, type HostState, type SyncClientMsg, type SyncServerMsg } from '@branch/core';
import QRCode from 'qrcode';

/**
 * 원격 페어링 호스트 (ADR-025). 이 PC를 휴대폰·웹이 페어링해 쓰는 bridge로 연다.
 * - 신원 키·기기 목록은 userData/bridge-host (0600), 설정은 host.json
 * - 원격 요청의 에이전트·모델·노력치는 PC 설정(정책)으로 덮어쓴다
 * - 토큰·코드·키는 로그로 남기지 않는다
 */
interface HostConfig {
  enabled: boolean;
  port?: number;
  relayUrl?: string | null;
}

const DEFAULT_PORT = 7777;
const PORT_TRIES = 10;

export interface HostService {
  state(): Promise<HostState>;
  setEnabled(enabled: boolean): Promise<HostState>;
  setRelay(url: string | null): Promise<HostState>;
  startPairing(): Promise<HostState>;
  cancelPairing(): Promise<HostState>;
  unpair(idOrAll: string): Promise<HostState>;
  setPolicy(policy: HostPolicy): void;
  /** 동기화 메시지 전송 */
  syncSend?(peerId: string, msg: SyncServerMsg): void;
  /** 모든 동기화 클라이언트에게 브로드캐스트 */
  broadcastSync?(msg: SyncServerMsg): void;
  /** 설정이 켜져 있으면 연다 (앱 시작 시) */
  restore(): Promise<void>;
  shutdown(): Promise<void>;
}

export function createHostService(opts: {
  dir: string;
  emit: (state: HostState) => void;
  log?: (msg: string) => void;
  sync?: {
    receive(peerId: string, deviceId: string, msg: SyncClientMsg): void;
    peerGone?(peerId: string): void;
  };
}): HostService {
  const log = opts.log ?? (() => {});
  const configFile = path.join(opts.dir, 'host.json');
  let config: HostConfig = { enabled: false };
  let storeP: Promise<BridgeStore> | null = null;
  let server: RemoteServer | null = null;
  let relay: RelayConnector | null = null;
  let relayState: HostState['relayState'] = 'off';
  let port: number | null = null;
  let error: string | undefined;
  let pairing: { session: PairingSession; links: { label: string; url: string; uri: string; qrSvg: string }[] } | null = null;
  let expiryTimer: NodeJS.Timeout | null = null;
  let policy: HostPolicy | null = null;
  let offPaired: (() => void) | null = null;

  const hostName = os.hostname().replace(/\.local$/, '');
  const store = () => (storeP ??= openBridgeStore({ dir: path.join(opts.dir, 'bridge-host'), name: hostName }));

  async function loadConfig() {
    try {
      const raw = JSON.parse(await readFile(configFile, 'utf8')) as Partial<HostConfig>;
      config = {
        enabled: raw.enabled === true,
        ...(typeof raw.port === 'number' ? { port: raw.port } : {}),
        relayUrl: typeof raw.relayUrl === 'string' ? raw.relayUrl : null,
      };
    } catch {
      config = { enabled: false };
    }
  }

  async function saveConfig() {
    await mkdir(opts.dir, { recursive: true });
    await writeFile(configFile, JSON.stringify(config, null, 2), { mode: 0o600 });
  }

  async function state(): Promise<HostState> {
    const s = await store();
    const live = new Set(server?.connectedDevices() ?? []);
    const active = pairing && pairing.session.expiresAt > Date.now() && server?.pairingActive() ? pairing : null;
    return {
      enabled: config.enabled,
      running: !!server,
      port,
      ...(error ? { error } : {}),
      name: s.name,
      fingerprint: keyFingerprint(s.identity.publicKey),
      addresses: (server?.addresses() ?? []).map((a) => ({ label: a.label, url: a.url })),
      devices: s.devices().map((d) => ({ id: d.id, name: d.name, pairedAt: d.pairedAt, lastSeenAt: d.lastSeenAt, connected: live.has(d.id) })),
      relayUrl: config.relayUrl ?? null,
      relayState,
      pairing: active ? { code: active.session.code, expiresAt: active.session.expiresAt, links: active.links } : null,
    };
  }

  const emit = () => void state().then(opts.emit, () => {});

  /** 저장된 포트 → 7777~7787 → 임의 포트 순으로 연다. listen 실패한 서버는 버린다 */
  async function open(s: BridgeStore): Promise<{ srv: RemoteServer; port: number }> {
    const first = config.port ?? DEFAULT_PORT;
    const range = Array.from({ length: PORT_TRIES + 1 }, (_, i) => DEFAULT_PORT + i);
    const candidates = [first, ...range.filter((p) => p !== first), 0];
    let last: unknown;
    for (const p of candidates) {
      const srv = createRemoteServer({
        bridge: createBridgeServer({ log }),
        store: s,
        port: p,
        log,
        policy: () => policy,
        onPresence: emit,
        sync: opts.sync,
      });
      try {
        return { srv, port: (await srv.listen()).port };
      } catch (e) {
        last = e;
        await srv.close().catch(() => {});
        if ((e as NodeJS.ErrnoException).code !== 'EADDRINUSE') break;
      }
    }
    throw last instanceof Error ? last : new Error(String(last));
  }

  function startRelay(s: BridgeStore) {
    relay?.close();
    relay = null;
    server?.setRelay(config.relayUrl ?? null);
    if (!server || !config.relayUrl) {
      relayState = 'off';
      return;
    }
    relayState = 'connecting';
    relay = createRelayConnector({
      url: config.relayUrl,
      store: s,
      accept: server.accept,
      log,
      onState: (st) => {
        relayState = st;
        emit();
      },
    });
  }

  let starting: Promise<void> | null = null;
  function start(): Promise<void> {
    if (server) return Promise.resolve();
    return (starting ??= doStart().finally(() => (starting = null)));
  }

  async function doStart() {
    const s = await store();
    let srv: RemoteServer;
    try {
      ({ srv, port } = await open(s));
    } catch (e) {
      error = `포트를 열지 못했어요: ${e instanceof Error ? e.message : String(e)}`;
      port = null;
      return;
    }
    error = undefined;
    server = srv;
    offPaired = srv.onPaired(() => {
      clearPairing();
      emit();
    });
    if (config.port !== port) {
      config.port = port;
      await saveConfig();
    }
    startRelay(s);
    log(`host listening on ${port}`);
  }

  function clearPairing() {
    pairing = null;
    if (expiryTimer) clearTimeout(expiryTimer);
    expiryTimer = null;
  }

  async function stop() {
    clearPairing();
    relay?.close();
    relay = null;
    relayState = 'off';
    offPaired?.();
    offPaired = null;
    const srv = server;
    server = null;
    port = null;
    await srv?.close();
  }

  return {
    state,
    async setEnabled(enabled) {
      config.enabled = enabled;
      await saveConfig();
      if (enabled) await start();
      else {
        error = undefined;
        await stop();
      }
      return state();
    },
    async setRelay(url) {
      const next = url?.trim() || null;
      if (next && !/^wss?:\/\/[^\s]+$/i.test(next)) {
        error = 'relay 주소는 ws:// 또는 wss:// 로 시작해야 해요.';
        return state();
      }
      error = undefined;
      config.relayUrl = next;
      await saveConfig();
      if (server) startRelay(await store());
      return state();
    },
    async startPairing() {
      if (!server) await start();
      const srv = server;
      if (!srv) return state();
      const session = srv.startPairing();
      // 휴대폰에서는 이 PC의 127.0.0.1에 닿을 수 없으므로 로컬 주소는 QR에서 뺀다
      const uris = srv.pairingUris(session).filter((u) => u.address.label !== '로컬');
      const links = await Promise.all(
        uris.map(async ({ address, uri }) => ({
          label: address.label,
          url: address.url,
          uri,
          qrSvg: await QRCode.toString(uri, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' }),
        })),
      );
      clearPairing();
      pairing = { session, links };
      expiryTimer = setTimeout(() => {
        clearPairing();
        emit();
      }, Math.max(0, session.expiresAt - Date.now()) + 50);
      return state();
    },
    async cancelPairing() {
      server?.cancelPairing();
      clearPairing();
      return state();
    },
    async unpair(idOrAll) {
      if (server) await server.unpair(idOrAll);
      else await (await store()).remove(idOrAll);
      return state();
    },
    setPolicy(p) {
      policy = p;
    },
    syncSend(peerId: string, msg: SyncServerMsg) {
      server?.syncSend(peerId, msg);
    },
    broadcastSync(msg: SyncServerMsg) {
      server?.syncSend('*', msg);
    },
    async restore() {
      await loadConfig();
      if (config.enabled) {
        await start();
        emit();
      }
    },
    shutdown: stop,
  };
}
