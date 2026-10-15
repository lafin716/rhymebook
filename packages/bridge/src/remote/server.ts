import os from 'node:os';
import {
  answerHello,
  applyHostPolicy,
  relayClientUrl,
  isTailscaleHost,
  isAttachmentList,
  isValidEffort,
  isValidModelName,
  pairingUri,
  REMOTE_MAX_PAYLOAD,
  parseWireFrame,
  randomCode,
  randomToken,
  safeEqual,
  verifyTranscript,
  validateSyncClientMsg,
  isSttAudio,
  isSyncClientType,
  SYNC_LIMITS,
  type AuthReason,
  type AuthRequest,
  type AuthResponse,
  type Attachment,
  type BridgeClientMsg,
  type ChatTurn,
  type HostPolicy,
  type SecureChannel,
  type SyncClientMsg,
  type SyncServerMsg,
} from '@branch/core';
import { WebSocketServer, type WebSocket } from 'ws';
import type { BridgeServer } from '../server';
import type { BridgeStore, PairedDevice } from './store';

/**
 * 헤드리스 bridge의 WebSocket 서버 (03-PROVIDERS 페어링, ADR-018).
 * 평문 ws 위에서 핸드셰이크 후 모든 메시지를 E2E 암호화한다.
 */
export interface RemoteServerOptions {
  bridge: BridgeServer;
  store: BridgeStore;
  host?: string;
  port?: number;
  /** 핸드셰이크·인증 제한 시간 */
  authTimeoutMs?: number;
  /** 진단 로그. 토큰·코드·키·프롬프트는 넘기지 않는다 */
  log?: (msg: string) => void;
  /** 원격 요청에 적용할 PC 정책 (데스크톱 호스트). 없으면 원격이 보낸 값을 그대로 쓴다 */
  policy?: () => HostPolicy | null;
  /** 기기 연결·해제 시 (상태 화면 갱신용) */
  onPresence?: () => void;
  /** 동기화 핸들러 (웹·모바일 원격 전용). 없으면 sync 메시지에 sync.error 응답 (ADR-026) */
  sync?: {
    receive(peerId: string, deviceId: string, msg: SyncClientMsg): void;
    peerGone?(peerId: string): void;
  };
}

export interface PairingSession {
  token: string;
  code: string;
  expiresAt: number;
}

export interface BridgeAddress {
  url: string;
  label: 'Tailscale' | 'LAN' | '로컬' | 'Relay';
}

/**
 * 원격 기기와의 텍스트 연결 하나. 직접 ws 연결과 relay 가상 채널이 같은 형태로 들어온다.
 */
export interface PeerSocket {
  send(text: string): void;
  close(code?: number, reason?: string): void;
  isOpen(): boolean;
  onMessage(cb: (text: string) => void): void;
  onClose(cb: () => void): void;
}

export interface RemoteServer {
  listen(): Promise<{ port: number }>;
  /** 이미 열린 연결(예: relay 채널)을 받아 핸드셰이크부터 처리한다 */
  accept(peer: PeerSocket, remote: string): void;
  /** 접속 안내에 relay 주소를 넣는다 (null이면 제거) */
  setRelay(relayBase: string | null): void;
  /** 새 1회용 페어링 토큰·코드 (이전 것은 폐기) */
  startPairing(ttlMs?: number): PairingSession;
  cancelPairing(): void;
  pairingActive(): boolean;
  /** 접속 가능한 주소 (Tailscale 우선) */
  addresses(): BridgeAddress[];
  pairingUris(session: PairingSession): { address: BridgeAddress; uri: string }[];
  onPaired(listener: (device: PairedDevice) => void): () => void;
  /** 기기 해제 + 연결 중이면 끊기 */
  unpair(idOrAll: string): Promise<PairedDevice[]>;
  connectedDevices(): string[];
  /** 동기화 메시지 전송: peerId | '*'. '*'는 sync.hello를 보낸 피어에게만 */
  syncSend(peerId: string | '*', msg: SyncServerMsg): void;
  close(): Promise<void>;
}

const MAX_CODE_ATTEMPTS = 5;

/** 인증된 기기라도 형식이 틀린 메시지는 버린다 (CLI 인자로 이어지는 값 검증) */
export function validateClientMsg(raw: unknown): BridgeClientMsg | null {
  if (!raw || typeof raw !== 'object') return null;
  const m = raw as Record<string, unknown>;
  const reqId = m.reqId;
  if (typeof reqId !== 'string' || !/^[\w-]{1,64}$/.test(reqId)) return null;
  if (m.type === 'status.get') return { type: 'status.get', reqId, ...(m.refresh === true ? { refresh: true } : {}) };
  if (m.type === 'chat.abort') return { type: 'chat.abort', reqId };
  if (m.type === 'stt.status.get') return { type: 'stt.status.get', reqId };
  if (m.type === 'stt.transcribe') return isSttAudio(m.audio) ? { type: 'stt.transcribe', reqId, audio: m.audio } : null;
  if (m.type !== 'chat.start') return null;
  if (m.providerId !== 'claude-cli' && m.providerId !== 'codex-cli') return null;
  if (typeof m.system !== 'string' || !Array.isArray(m.messages)) return null;
  if (m.model !== undefined && (typeof m.model !== 'string' || !isValidModelName(m.model))) return null;
  if (m.effort !== undefined && (typeof m.effort !== 'string' || !isValidEffort(m.providerId, m.effort))) return null;
  const messages: ChatTurn[] = [];
  for (const t of m.messages as unknown[]) {
    const turn = t as Record<string, unknown>;
    if (!turn || (turn.role !== 'user' && turn.role !== 'assistant') || typeof turn.content !== 'string') return null;
    if (turn.attachments !== undefined && !isAttachmentList(turn.attachments)) return null;
    messages.push({
      role: turn.role,
      content: turn.content,
      ...(turn.attachments && (turn.attachments as Attachment[]).length ? { attachments: turn.attachments as Attachment[] } : {}),
    });
  }
  return {
    type: 'chat.start',
    reqId,
    providerId: m.providerId,
    system: m.system,
    messages,
    ...(typeof m.model === 'string' ? { model: m.model } : {}),
    ...(typeof m.effort === 'string' ? { effort: m.effort } : {}),
    ...(m.imageGen === true ? { imageGen: true } : {}),
  };
}

export function listAddresses(port: number, host = '0.0.0.0'): BridgeAddress[] {
  if (host !== '0.0.0.0' && host !== '::') {
    return [{ url: `ws://${host.includes(':') ? `[${host}]` : host}:${port}`, label: isTailscaleHost(host) ? 'Tailscale' : host.startsWith('127.') ? '로컬' : 'LAN' }];
  }
  const out: BridgeAddress[] = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list ?? []) {
      if (a.family !== 'IPv4' || a.internal) continue;
      out.push({ url: `ws://${a.address}:${port}`, label: isTailscaleHost(a.address) ? 'Tailscale' : 'LAN' });
    }
  }
  out.sort((a, b) => (a.label === b.label ? 0 : a.label === 'Tailscale' ? -1 : 1));
  out.push({ url: `ws://127.0.0.1:${port}`, label: '로컬' });
  return out;
}

export function createRemoteServer(opts: RemoteServerOptions): RemoteServer {
  const { bridge, store } = opts;
  const log = opts.log ?? (() => {});
  const host = opts.host ?? '0.0.0.0';
  let port = opts.port ?? 7777;
  const authTimeoutMs = opts.authTimeoutMs ?? 10_000;
  let wss: WebSocketServer | null = null;
  let pairing: (PairingSession & { attempts: number }) | null = null;
  const pairedListeners = new Set<(d: PairedDevice) => void>();
  /** deviceId → 연결된 소켓 */
  const live = new Map<string, Set<PeerSocket>>();
  let relayBase: string | null = null;

  /** peerId → { deviceId, ws, synced }. peerId는 소켓 단위로 고유 */
  const peers = new Map<string, { deviceId: string; ws: PeerSocket; channel: SecureChannel; synced: boolean }>();
  let peerCount = 0;

  function deny(ws: PeerSocket, channel: SecureChannel, reason: AuthReason) {
    const res: AuthResponse = { type: 'denied', reason };
    try {
      ws.send(channel.seal(res));
    } catch {
      // 무시
    }
    setTimeout(() => ws.close(4001, reason), 50);
  }

  async function authenticate(req: AuthRequest, transcript: Uint8Array): Promise<PairedDevice | AuthReason> {
    if (!req || typeof req !== 'object' || typeof req.device !== 'string' || typeof req.sig !== 'string') return 'protocol';
    if (!verifyTranscript(req.device, transcript, req.sig)) return 'bad-signature';
    if (req.type === 'auth') return store.findByKey(req.device) ?? 'unknown-device';
    if (req.type !== 'pair' || typeof req.token !== 'string') return 'protocol';
    if (!pairing) return 'expired';
    if (Date.now() > pairing.expiresAt) {
      pairing = null;
      return 'expired';
    }
    const ok = safeEqual(req.token, pairing.token) || (req.token.length === 6 && safeEqual(req.token, pairing.code));
    if (!ok) {
      // 6자리 코드는 추측 가능하므로 시도 횟수를 제한한다
      if (++pairing.attempts >= MAX_CODE_ATTEMPTS) {
        log('pairing cancelled: too many wrong codes');
        pairing = null;
      }
      return 'bad-token';
    }
    pairing = null; // 1회용
    const name = typeof req.name === 'string' && req.name.trim() ? req.name.trim().slice(0, 60) : '이름 없는 기기';
    const device = await store.add({ publicKey: req.device, name });
    log(`paired device ${device.id}`);
    for (const l of [...pairedListeners]) l(device);
    return device;
  }

  /** 직접 ws 연결 → PeerSocket (바이너리 거부, ping으로 죽은 연결 정리) */
  function fromWebSocket(ws: WebSocket): PeerSocket {
    let alive = true;
    ws.on('pong', () => (alive = true));
    const ping = setInterval(() => {
      if (!alive) {
        ws.terminate();
        return;
      }
      alive = false;
      ws.ping();
    }, 30_000);
    ws.on('close', () => clearInterval(ping));
    ws.on('error', () => {});
    return {
      send: (text) => ws.send(text),
      close: (code, reason) => ws.close(code, reason),
      isOpen: () => ws.readyState === ws.OPEN,
      onMessage: (cb) =>
        ws.on('message', (data, isBinary) => {
          if (isBinary) return void ws.close(1003, 'text only');
          cb(data.toString());
        }),
      onClose: (cb) => ws.on('close', cb),
    };
  }

  function handle(ws: PeerSocket, remote: string) {
    let channel: SecureChannel | null = null;
    let transcript: Uint8Array | null = null;
    let device: PairedDevice | null = null;
    let conn: ReturnType<BridgeServer['connect']> | null = null;
    let authing = false;
    let peerId: string | null = null;
    const authTimer = setTimeout(() => {
      if (!device) ws.close(4000, 'auth timeout');
    }, authTimeoutMs);

    ws.onMessage((data) => {
      const frame = parseWireFrame(data);
      if (!frame) return void ws.close(1002, 'bad frame');

      if (!channel) {
        const ans = answerHello(frame, store.identity);
        if (!ans) return void ws.close(1002, 'bad hello');
        channel = ans.channel;
        transcript = ans.transcript;
        ws.send(JSON.stringify(ans.challenge));
        return;
      }

      let msg: unknown;
      try {
        msg = channel.open(frame);
      } catch {
        return void ws.close(1002, 'bad frame');
      }

      if (!device) {
        if (authing) return;
        authing = true;
        const ch = channel;
        void authenticate(msg as AuthRequest, transcript!).then((r) => {
          if (typeof r === 'string') {
            log(`auth denied (${r}) from ${remote}`);
            deny(ws, ch, r);
            return;
          }
          device = r;
          clearTimeout(authTimer);
          store.touch(r.id);
          const set = live.get(r.id) ?? new Set();
          set.add(ws);
          live.set(r.id, set);
          const res: AuthResponse = { type: 'welcome', bridgeId: store.bridgeId, name: store.name, deviceId: r.id };
          ws.send(ch.seal(res));
          conn = bridge.connect((m) => {
            if (ws.isOpen()) ws.send(ch.seal(m));
          });
          log(`device ${r.id} connected from ${remote}`);
          opts.onPresence?.();
        });
        return;
      }

      // Check if message is sync type BEFORE regular validation
      if (isSyncClientType((msg as Record<string, unknown>).type)) {
        if (!opts.sync) {
          // Headless bridge doesn't support sync
          if (ws.isOpen()) {
            const errMsg: SyncServerMsg = { type: 'sync.error', error: 'unsupported' };
            ws.send(channel.seal(errMsg));
          }
          return;
        }

        // Register peer on first sync message
        if (!peerId) {
          peerId = `peer-${++peerCount}`;
          peers.set(peerId, { deviceId: device.id, ws, channel, synced: false });
        }

        const validSync = validateSyncClientMsg(msg);
        if (!validSync) {
          log(`invalid sync message from ${device.id}`);
          // act는 클라이언트가 결과를 기다리므로 reqId가 읽히면 실패로 응답한다
          const reqId = (msg as Record<string, unknown>).reqId;
          if (typeof reqId === 'string' && reqId.length <= SYNC_LIMITS.id && ws.isOpen()) {
            const res: SyncServerMsg = { type: 'act.result', reqId, ok: false, error: 'invalid' };
            ws.send(channel.seal(res));
          }
          return;
        }

        // Track sync.hello for broadcast filtering
        if (validSync.type === 'sync.hello') {
          const peer = peers.get(peerId);
          if (peer) peer.synced = true;
        }

        store.touch(device.id);
        opts.sync.receive(peerId, device.id, validSync);
        return;
      }

      const valid = validateClientMsg(msg);
      if (!valid) {
        log(`invalid message from ${device.id}`);
        return;
      }
      store.touch(device.id);
      conn?.receive(applyHostPolicy(valid, opts.policy?.()));
    });

    ws.onClose(() => {
      clearTimeout(authTimer);
      conn?.close();
      if (peerId) {
        peers.delete(peerId);
        opts.sync?.peerGone?.(peerId);
      }
      if (device) {
        live.get(device.id)?.delete(ws);
        if (!live.get(device.id)?.size) live.delete(device.id);
        log(`device ${device.id} disconnected`);
        opts.onPresence?.();
      }
    });
  }

  function addresses(): BridgeAddress[] {
    const direct = wss ? listAddresses(port, host) : [];
    if (!relayBase) return direct;
    // relay는 NAT 밖에서도 닿는 경로라 직접 주소 다음, 로컬 앞에 둔다
    const relay: BridgeAddress = { url: relayClientUrl(relayBase, store.bridgeId), label: 'Relay' };
    const local = direct.filter((a) => a.label === '로컬');
    return [...direct.filter((a) => a.label !== '로컬'), relay, ...local];
  }

  return {
    listen() {
      return new Promise((resolve, reject) => {
        const server = new WebSocketServer({ host, port, maxPayload: REMOTE_MAX_PAYLOAD });
        server.once('error', reject);
        server.once('listening', () => {
          server.off('error', reject);
          server.on('error', (e) => log(`server error: ${e.message}`));
          const addr = server.address();
          if (addr && typeof addr === 'object') port = addr.port;
          wss = server;
          resolve({ port });
        });
        server.on('connection', (ws, req) => handle(fromWebSocket(ws), req.socket.remoteAddress ?? '?'));
      });
    },
    accept: (peer, remote) => handle(peer, remote),
    setRelay(base) {
      relayBase = base;
    },
    startPairing(ttlMs = 5 * 60_000) {
      pairing = { token: randomToken(), code: randomCode(), expiresAt: Date.now() + ttlMs, attempts: 0 };
      return { token: pairing.token, code: pairing.code, expiresAt: pairing.expiresAt };
    },
    cancelPairing() {
      pairing = null;
    },
    pairingActive: () => !!pairing && Date.now() <= pairing.expiresAt,
    addresses,
    pairingUris(session) {
      const list = addresses();
      const relay = list.find((a) => a.label === 'Relay')?.url;
      return list.map((address) => ({
        address,
        uri: pairingUri({
          url: address.url,
          bridgeKey: store.identity.publicKey,
          token: session.token,
          ...(relay && relay !== address.url ? { relay } : {}),
        }),
      }));
    },
    onPaired(listener) {
      pairedListeners.add(listener);
      return () => pairedListeners.delete(listener);
    },
    async unpair(idOrAll) {
      const removed = await store.remove(idOrAll);
      for (const d of removed) {
        for (const peer of live.get(d.id) ?? []) peer.close(4003, 'unpaired');
        live.delete(d.id);
      }
      return removed;
    },
    connectedDevices: () => [...live.keys()],
    syncSend(peerId: string | '*', msg: SyncServerMsg) {
      if (peerId === '*') {
        // Broadcast to all peers that have sent sync.hello
        for (const [, peer] of peers) {
          if (peer.synced) {
            try {
              if (peer.ws.isOpen()) {
                peer.ws.send(peer.channel.seal(msg));
              }
            } catch {
              // Ignore send errors
            }
          }
        }
      } else {
        // Send to specific peer
        const peer = peers.get(peerId);
        if (peer) {
          try {
            if (peer.ws.isOpen()) {
              peer.ws.send(peer.channel.seal(msg));
            }
          } catch {
            // Ignore send errors
          }
        }
      }
    },
    close() {
      return new Promise((resolve) => {
        bridge.shutdown();
        for (const set of live.values()) for (const peer of set) peer.close(1001, 'shutdown');
        if (!wss) return resolve();
        for (const ws of wss.clients) ws.terminate();
        wss.close(() => resolve());
        wss = null;
      });
    },
  };
}
