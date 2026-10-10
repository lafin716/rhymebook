import type { ProviderId } from '../model';
import { PROVIDER_LABELS, providerError, type Availability, type LLMProvider, type StreamEvent } from '../provider';
import type { BridgeClient, BridgeTransport } from './client';
import { CLI_PROVIDER_IDS, type BridgeClientMsg, type BridgeServerMsg, type BridgeStatus, type CliProviderId } from './protocol';
import { isRelayUrl, RELAY_CLOSE_OFFLINE } from './relay';
import {
  generateKeyPair,
  keyId,
  parseWireFrame,
  publicKeyOf as publicKeyFromSecret,
  signTranscript,
  startClientHandshake,
  type AuthReason,
  type AuthRequest,
  type AuthResponse,
  type PairingOffer,
  type SecureChannel,
} from './secure';

/**
 * 원격 bridge 클라이언트 (웹/모바일 → 헤드리스 bridge, Tailscale/LAN 직접 연결).
 * 페어링 정보(기기 비밀키 포함)는 통째로 SecretStore에 둔다.
 */
export interface RemotePairing {
  url: string;
  bridgeKey: string;
  bridgeId: string;
  bridgeName: string;
  deviceId: string;
  /** 기기 Ed25519 비밀키 (비밀 값) */
  deviceSecret: string;
  pairedAt: number;
  /** qr = 링크로 bridge 키를 확인함, code = 코드 입력(최초 연결 시 신뢰) */
  trust: 'qr' | 'code';
  /** 직접 연결이 안 되면 쓸 relay 주소 (wss://relay/c/<bridgeId>) */
  relayUrl?: string;
}

export const REMOTE_PAIRING_SECRET = 'pairing:remote-bridge';

/** 브라우저 WebSocket과 같은 모양 (Node 22+ 전역 WebSocket도 해당) */
export interface WebSocketLike {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: ((ev: never) => void) | null;
  /** 핸들러는 (ev: { data: unknown }) 형태로 단다. 브라우저 MessageEvent와 호환되도록 never로 둔다 */
  onmessage: ((ev: never) => void) | null;
  onclose: ((ev: never) => void) | null;
  onerror: ((ev: never) => void) | null;
}
export type WebSocketFactory = (url: string) => WebSocketLike;

export type RemoteErrorCode = 'unreachable' | 'timeout' | 'denied' | 'key-mismatch' | 'protocol' | 'unpaired';

export class RemoteBridgeError extends Error {
  constructor(
    readonly code: RemoteErrorCode,
    message: string,
    readonly reason?: AuthReason,
  ) {
    super(message);
    this.name = 'RemoteBridgeError';
  }
}

const DENIED: Record<AuthReason, string> = {
  'bad-token': '코드가 틀렸거나 이미 사용되었습니다. bridge 화면의 코드를 다시 확인하세요.',
  expired: '페어링 코드가 만료되었습니다. bridge에서 다시 --pair로 새 코드를 만드세요.',
  'unknown-device': 'bridge에서 이 기기의 페어링이 해제되었습니다. 다시 페어링하세요.',
  'bad-signature': '기기 인증에 실패했습니다. 다시 페어링하세요.',
  protocol: 'bridge와 통신 형식이 맞지 않습니다. 앱과 bridge를 최신 버전으로 맞추세요.',
};

function dataText(data: unknown): string {
  if (typeof data === 'string') return data;
  if (data instanceof ArrayBuffer) return new TextDecoder().decode(data);
  if (ArrayBuffer.isView(data)) return new TextDecoder().decode(data as Uint8Array);
  return String(data);
}

interface SecureSession {
  ws: WebSocketLike;
  channel: SecureChannel;
  welcome: Extract<AuthResponse, { type: 'welcome' }>;
  bridgeKey: string;
  rttMs: number;
  url: string;
}

/** 연결 → 핸드셰이크 → 인증 요청 → welcome까지. 이후 메시지는 onMessage로 넘긴다 */
function openSession(opts: {
  url: string;
  wsFactory: WebSocketFactory;
  expectedKey?: string;
  timeoutMs: number;
  auth: (transcript: Uint8Array) => AuthRequest;
  onMessage?: (msg: BridgeServerMsg) => void;
  onClose?: () => void;
}): Promise<SecureSession> {
  return new Promise((resolve, reject) => {
    let ws: WebSocketLike;
    try {
      ws = opts.wsFactory(opts.url);
    } catch {
      reject(new RemoteBridgeError('unreachable', `주소를 열 수 없습니다: ${opts.url}`));
      return;
    }
    const hs = startClientHandshake();
    let channel: SecureChannel | null = null;
    let bridgeKey = '';
    let sentAt = 0;
    let rttMs = 0;
    let settled = false;
    let established = false;
    let open = false;
    const fail = (err: RemoteBridgeError) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        ws.close();
      } catch {
        // 무시
      }
      reject(err);
    };
    const timer = setTimeout(
      () => fail(new RemoteBridgeError('timeout', `${opts.url} 에서 응답이 없습니다. bridge 실행 여부와 네트워크(같은 Wi‑Fi·Tailscale)를 확인하세요.`)),
      opts.timeoutMs,
    );

    ws.onopen = () => {
      open = true;
      sentAt = Date.now();
      ws.send(JSON.stringify(hs.hello));
    };
    ws.onerror = () => {
      if (!settled) fail(new RemoteBridgeError('unreachable', `${opts.url} 에 연결할 수 없습니다. bridge 실행 여부와 네트워크를 확인하세요.`));
    };
    ws.onclose = (ev: { code?: number }) => {
      if (!settled) {
        fail(
          new RemoteBridgeError(
            'unreachable',
            ev?.code === RELAY_CLOSE_OFFLINE
              ? 'relay에 bridge가 연결되어 있지 않습니다. bridge PC에서 --relay 옵션으로 실행 중인지 확인하세요.'
              : open
                ? 'bridge가 연결을 닫았습니다.'
                : `${opts.url} 에 연결할 수 없습니다. bridge 실행 여부와 네트워크를 확인하세요.`,
          ),
        );
        return;
      }
      // 인증 실패로 닫힌 소켓은 세션이 아니었으므로 알리지 않는다
      if (established) opts.onClose?.();
    };
    ws.onmessage = (ev: { data: unknown }) => {
      const frame = parseWireFrame(dataText(ev.data));
      if (!frame) {
        fail(new RemoteBridgeError('protocol', DENIED.protocol));
        return;
      }
      if (!channel) {
        const r = hs.finish(frame, opts.expectedKey);
        if (!r.ok) {
          fail(new RemoteBridgeError(opts.expectedKey && frame.t === 'challenge' && frame.key !== opts.expectedKey ? 'key-mismatch' : 'protocol', r.reason));
          return;
        }
        rttMs = Date.now() - sentAt;
        channel = r.channel;
        bridgeKey = r.bridgeKey;
        ws.send(channel.seal(opts.auth(r.transcript)));
        return;
      }
      let msg: unknown;
      try {
        msg = channel.open(frame);
      } catch {
        if (!settled) fail(new RemoteBridgeError('protocol', DENIED.protocol));
        else ws.close();
        return;
      }
      if (!settled) {
        const res = msg as AuthResponse;
        if (res?.type === 'welcome') {
          settled = true;
          established = true;
          clearTimeout(timer);
          resolve({ ws, channel, welcome: res, bridgeKey, rttMs, url: opts.url });
        } else {
          const reason: AuthReason = res?.type === 'denied' && res.reason in DENIED ? res.reason : 'protocol';
          fail(new RemoteBridgeError('denied', DENIED[reason], reason));
        }
        return;
      }
      opts.onMessage?.(msg as BridgeServerMsg);
    };
  });
}

/** 직접 주소가 닿지 않을 때 relay를 시도하는 동안 기다리는 시간 */
const DIRECT_TIMEOUT_WITH_RELAY_MS = 3_000;

/**
 * 주소 후보를 차례로 시도한다 (직접 → relay).
 * 닿지 않음·시간 초과만 다음 후보로 넘어가고, 거부·키 불일치는 바로 실패한다.
 */
async function openFirst(
  urls: string[],
  timeoutMs: number,
  open: (url: string, timeoutMs: number) => Promise<SecureSession>,
): Promise<SecureSession> {
  let last: unknown;
  for (let i = 0; i < urls.length; i++) {
    const more = i < urls.length - 1;
    try {
      return await open(urls[i]!, more ? Math.min(timeoutMs, DIRECT_TIMEOUT_WITH_RELAY_MS) : timeoutMs);
    } catch (e) {
      last = e;
      if (!(e instanceof RemoteBridgeError) || (e.code !== 'unreachable' && e.code !== 'timeout')) throw e;
    }
  }
  throw last;
}

/** 페어링 링크/코드로 bridge에 기기를 등록한다 */
export async function pairWithBridge(opts: {
  offer: PairingOffer;
  deviceName: string;
  wsFactory: WebSocketFactory;
  timeoutMs?: number;
}): Promise<RemotePairing> {
  const device = generateKeyPair();
  const { offer } = opts;
  const urls = offer.relay && offer.relay !== offer.url ? [offer.url, offer.relay] : [offer.url];
  const s = await openFirst(urls, opts.timeoutMs ?? 10_000, (url, timeoutMs) =>
    openSession({
      url,
      wsFactory: opts.wsFactory,
      timeoutMs,
      ...(offer.bridgeKey ? { expectedKey: offer.bridgeKey } : {}),
      auth: (transcript) => ({
        type: 'pair',
        token: offer.token.replace(/\s+/g, ''),
        device: device.publicKey,
        name: opts.deviceName.slice(0, 60),
        sig: signTranscript(device.secretKey, transcript),
      }),
    }),
  );
  s.ws.close();
  return {
    url: offer.url,
    bridgeKey: s.bridgeKey,
    bridgeId: s.welcome.bridgeId,
    bridgeName: s.welcome.name,
    deviceId: keyId(device.publicKey, 'dev_'),
    deviceSecret: device.secretKey,
    pairedAt: Date.now(),
    trust: offer.bridgeKey ? 'qr' : 'code',
    ...(urls[1] ? { relayUrl: urls[1] } : {}),
  };
}

export interface RemoteLinkInfo {
  bridgeName: string;
  latencyMs: number;
  /** "LAN 직접 연결" · "Tailscale 직접 연결" · "Relay 경유" */
  route: string;
}

/** 페어링된 bridge로의 지연 연결. BridgeTransport로 쓰인다 */
export interface RemoteBridgeLink extends BridgeTransport {
  /** 연결되어 있지 않으면 연결한다. 실패하면 RemoteBridgeError */
  ensure(): Promise<RemoteLinkInfo>;
  /** 연결을 닫는다 (페어링 해제·변경 시) */
  reset(): void;
}

export function createRemoteBridgeLink(opts: {
  getPairing: () => Promise<RemotePairing | null>;
  wsFactory: WebSocketFactory;
  connectTimeoutMs?: number;
}): RemoteBridgeLink {
  const listeners = new Set<(m: BridgeServerMsg) => void>();
  const disconnectListeners = new Set<() => void>();
  let session: SecureSession | null = null;
  let connecting: Promise<SecureSession> | null = null;
  let pending: BridgeClientMsg[] = [];
  let generation = 0;
  /** 마지막으로 성공한 주소. 다음 연결은 이 주소부터 시도한다 */
  let lastUrl: string | null = null;

  const emitDisconnect = () => {
    for (const l of [...disconnectListeners]) l();
  };

  function connect(): Promise<SecureSession> {
    if (session) return Promise.resolve(session);
    if (connecting) return connecting;
    const gen = generation;
    connecting = (async () => {
      const p = await opts.getPairing();
      if (!p) throw new RemoteBridgeError('unpaired', '원격 Bridge가 페어링되어 있지 않습니다.');
      let urls = p.relayUrl && p.relayUrl !== p.url ? [p.url, p.relayUrl] : [p.url];
      if (lastUrl && urls.includes(lastUrl)) urls = [lastUrl, ...urls.filter((u) => u !== lastUrl)];
      const s: SecureSession = await openFirst(urls, opts.connectTimeoutMs ?? 8_000, (url, timeoutMs) =>
        openSession({
          url,
          wsFactory: opts.wsFactory,
          expectedKey: p.bridgeKey,
          timeoutMs,
          auth: (transcript) => ({ type: 'auth', device: publicKeyFromSecret(p.deviceSecret), sig: signTranscript(p.deviceSecret, transcript) }),
          onMessage: (m) => {
            for (const l of [...listeners]) l(m);
          },
          onClose: () => {
            if (session?.ws === s.ws) session = null;
            emitDisconnect();
          },
        }),
      );
      lastUrl = s.url;
      if (gen !== generation) {
        s.ws.close();
        throw new RemoteBridgeError('unreachable', '연결이 재설정되었습니다.');
      }
      session = s;
      return s;
    })().finally(() => {
      connecting = null;
    });
    return connecting;
  }

  function flush() {
    const s = session;
    if (!s) return;
    const out = pending;
    pending = [];
    for (const m of out) s.ws.send(s.channel.seal(m));
  }

  return {
    async ensure() {
      const s = await connect();
      return { bridgeName: s.welcome.name, latencyMs: s.rttMs, route: remoteRoute(s.url) };
    },
    reset() {
      generation++;
      lastUrl = null;
      const s = session;
      session = null;
      pending = [];
      s?.ws.close();
    },
    send(msg) {
      if (session && session.ws.readyState === 1) {
        session.ws.send(session.channel.seal(msg));
        return;
      }
      pending.push(msg);
      connect().then(flush, () => {
        pending = [];
        emitDisconnect();
      });
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    onDisconnect(listener) {
      disconnectListeners.add(listener);
      return () => disconnectListeners.delete(listener);
    },
  };
}

/** 100.64.0.0/10(Tailscale CGNAT) 또는 *.ts.net */
export function isTailscaleHost(host: string): boolean {
  if (/\.ts\.net$/i.test(host)) return true;
  const m = /^100\.(\d+)\.\d+\.\d+$/.exec(host);
  return !!m && Number(m[1]) >= 64 && Number(m[1]) <= 127;
}

export function remoteRoute(url: string): string {
  if (isRelayUrl(url)) return 'Relay 경유';
  try {
    return isTailscaleHost(new URL(url).hostname) ? 'Tailscale 직접 연결' : 'LAN 직접 연결';
  } catch {
    return '직접 연결';
  }
}

function unavailableFrom(err: unknown): Availability {
  if (err instanceof RemoteBridgeError) {
    if (err.code === 'unpaired' || (err.code === 'denied' && err.reason === 'unknown-device')) return { status: 'unpaired', detail: err.message };
    return { status: 'offline', detail: err.message };
  }
  return { status: 'offline', detail: err instanceof Error ? err.message : String(err) };
}

function pickReady(status: BridgeStatus): CliProviderId | undefined {
  return CLI_PROVIDER_IDS.find((id) => status[id].status === 'ready');
}

const CLI_ELSEWHERE = '웹·모바일에서는 이 기기에서 CLI를 직접 실행할 수 없습니다. 데스크톱 앱이나 원격 Bridge로 연결하세요.';

/**
 * 원격 bridge를 provider로 노출한다.
 * - remote-bridge: bridge PC에서 준비된 CLI(Claude 우선)로 대리 호출
 * - includeCli면 claude-cli/codex-cli도 원격 bridge 경유로 덮어쓴다 (웹/모바일)
 */
export function createRemoteBridgeProviders(opts: {
  link: RemoteBridgeLink;
  client: BridgeClient;
  getPairing: () => Promise<RemotePairing | null>;
  includeCli?: boolean;
}): Partial<Record<ProviderId, LLMProvider>> {
  const { link, client } = opts;

  async function connected(): Promise<{ info: RemoteLinkInfo; pairing: RemotePairing } | Availability> {
    const pairing = await opts.getPairing();
    if (!pairing) return { status: 'unpaired' };
    try {
      return { info: await link.ensure(), pairing };
    } catch (e) {
      return unavailableFrom(e);
    }
  }

  const out: Partial<Record<ProviderId, LLMProvider>> = {
    'remote-bridge': {
      id: 'remote-bridge',
      label: PROVIDER_LABELS['remote-bridge'],
      async available() {
        const c = await connected();
        if ('status' in c) return c;
        let status: BridgeStatus;
        try {
          status = await client.status(true);
        } catch (e) {
          return unavailableFrom(e);
        }
        const base = `${c.info.bridgeName} · ${c.info.route} · 지연 ${c.info.latencyMs}ms`;
        const ready = CLI_PROVIDER_IDS.filter((id) => status[id].status === 'ready');
        if (ready.length) return { status: 'ready', detail: `${base} · ${ready.map((id) => PROVIDER_LABELS[id]).join(', ')}` };
        const loggedOut = CLI_PROVIDER_IDS.find((id) => status[id].status === 'not-logged-in');
        if (loggedOut) return { status: 'not-logged-in', detail: `${base} · bridge PC에서 CLI 로그인이 필요합니다. ${status[loggedOut].detail ?? ''}`.trim() };
        return { status: 'not-installed', detail: `${base} · bridge PC에 Claude/Codex CLI가 없습니다.` };
      },
      async *stream(req): AsyncIterable<StreamEvent> {
        const c = await connected();
        if ('status' in c) {
          yield { type: 'error', error: providerError(c.status === 'unpaired' ? 'auth' : 'offline', c.detail ?? '원격 Bridge가 페어링되어 있지 않습니다.') };
          return;
        }
        let id: CliProviderId | undefined;
        try {
          id = pickReady(await client.status());
        } catch (e) {
          yield { type: 'error', error: providerError('offline', e instanceof Error ? e.message : String(e)) };
          return;
        }
        if (!id) {
          yield { type: 'error', error: providerError('cli', 'bridge PC에서 사용할 수 있는 CLI가 없습니다. 설치·로그인 상태를 확인하세요.') };
          return;
        }
        yield* client.stream(id, req);
      },
    },
  };

  if (opts.includeCli) {
    for (const id of CLI_PROVIDER_IDS) {
      out[id] = {
        id,
        label: PROVIDER_LABELS[id],
        async available() {
          const c = await connected();
          if ('status' in c) return c.status === 'unpaired' ? { status: 'not-installed', detail: CLI_ELSEWHERE } : c;
          try {
            const a = (await client.status(true))[id];
            return { ...a, detail: `원격 Bridge(${c.info.bridgeName}) 경유${a.detail ? ` · ${a.detail}` : ''}` };
          } catch (e) {
            return unavailableFrom(e);
          }
        },
        async *stream(req) {
          const c = await connected();
          if ('status' in c) {
            yield { type: 'error', error: providerError('offline', c.status === 'unpaired' ? CLI_ELSEWHERE : (c.detail ?? CLI_ELSEWHERE)) };
            return;
          }
          yield* client.stream(id, req);
        },
      };
    }
  }
  return out;
}
