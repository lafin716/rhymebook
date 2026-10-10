import { randomBytes } from 'node:crypto';
import http from 'node:http';
import {
  isBridgeId,
  keyId,
  parseRelayFrame,
  RELAY_CLOSE_OFFLINE,
  relayRegisterTranscript,
  verifyTranscript,
  type BridgeToRelay,
  type RelayToBridge,
} from '@branch/core';
import WebSocket, { WebSocketServer } from 'ws';

/**
 * Branch relay (Phase 6, ADR-020).
 * NAT 뒤 bridge가 아웃바운드로 붙어 두는 중계 서버. 클라이언트 소켓의 텍스트 프레임을
 * 채널 번호만 붙여 그대로 넘긴다. 페이로드는 클라이언트↔bridge E2E 암호문이며 저장·기록하지 않는다.
 */
export interface RelayServerOptions {
  host?: string;
  port?: number;
  /** bridge 등록 / 클라이언트 첫 프레임 제한 시간 */
  registerTimeoutMs?: number;
  /** bridge 하나에 동시에 열 수 있는 클라이언트 채널 수 */
  maxChannelsPerBridge?: number;
  /** 연결 단위 로그. 페이로드·주소 외 식별자는 넘기지 않는다 */
  log?: (msg: string) => void;
}

export interface RelayServer {
  listen(): Promise<{ port: number }>;
  /** 등록된 bridge id 목록 */
  bridges(): string[];
  close(): Promise<void>;
}

export const RELAY_CLOSE_REPLACED = 4409;
export const RELAY_CLOSE_FULL = 4429;
const MAX_PAYLOAD = 4 * 1024 * 1024;

interface BridgeEntry {
  ws: WebSocket;
  nextCh: number;
  clients: Map<number, WebSocket>;
}

function sendFrame(ws: WebSocket, f: RelayToBridge) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(f));
}

/** 닫기 코드는 ws가 허용하는 범위로 제한 */
function safeCode(code: number | undefined): number {
  return code && ((code >= 4000 && code < 5000) || code === 1000) ? code : 1000;
}

export function createRelayServer(opts: RelayServerOptions = {}): RelayServer {
  const log = opts.log ?? (() => {});
  const host = opts.host ?? '0.0.0.0';
  let port = opts.port ?? 8787;
  const registerTimeoutMs = opts.registerTimeoutMs ?? 10_000;
  const maxChannels = opts.maxChannelsPerBridge ?? 64;
  const bridges = new Map<string, BridgeEntry>();
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_PAYLOAD });
  let server: http.Server | null = null;

  /** 죽은 연결 정리용 ping */
  const alive = new WeakMap<WebSocket, boolean>();
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (alive.get(ws) === false) {
        ws.terminate();
        continue;
      }
      alive.set(ws, false);
      ws.ping();
    }
  }, 30_000);
  heartbeat.unref();

  function track(ws: WebSocket) {
    alive.set(ws, true);
    ws.on('pong', () => alive.set(ws, true));
    ws.on('error', () => {});
  }

  function onBridge(ws: WebSocket, bridgeId: string) {
    track(ws);
    const nonce = randomBytes(24).toString('base64url');
    let entry: BridgeEntry | null = null;
    const timer = setTimeout(() => {
      if (!entry) ws.close(4000, 'register timeout');
    }, registerTimeoutMs);
    sendFrame(ws, { t: 'challenge', nonce });

    ws.on('message', (data, isBinary) => {
      if (isBinary) return void ws.close(1003, 'text only');
      const f = parseRelayFrame<BridgeToRelay>(data.toString());
      if (!f) return void ws.close(1002, 'bad frame');
      if (!entry) {
        if (
          f.t !== 'register' ||
          typeof f.key !== 'string' ||
          typeof f.sig !== 'string' ||
          !ownsBridgeId(f.key, bridgeId) ||
          !verifyTranscript(f.key, relayRegisterTranscript(nonce, bridgeId), f.sig)
        ) {
          log(`bridge register denied ${bridgeId}`);
          return void ws.close(4001, 'denied');
        }
        clearTimeout(timer);
        const old = bridges.get(bridgeId);
        if (old) {
          old.ws.close(RELAY_CLOSE_REPLACED, 'replaced');
          for (const c of old.clients.values()) c.close(1012, 'bridge restarted');
        }
        entry = { ws, nextCh: 1, clients: new Map() };
        bridges.set(bridgeId, entry);
        sendFrame(ws, { t: 'ready' });
        log(`bridge ${bridgeId} registered`);
        return;
      }
      if (f.t === 'data' && typeof f.d === 'string') {
        const c = entry.clients.get(f.ch);
        if (c?.readyState === WebSocket.OPEN) c.send(f.d);
      } else if (f.t === 'close') {
        const c = entry.clients.get(f.ch);
        entry.clients.delete(f.ch);
        c?.close(safeCode(f.code));
      }
    });

    ws.on('close', () => {
      clearTimeout(timer);
      if (!entry) return;
      if (bridges.get(bridgeId) === entry) bridges.delete(bridgeId);
      for (const c of entry.clients.values()) c.close(RELAY_CLOSE_OFFLINE, 'bridge offline');
      entry.clients.clear();
      log(`bridge ${bridgeId} left`);
    });
  }

  function onClient(ws: WebSocket, bridgeId: string) {
    track(ws);
    const entry = bridges.get(bridgeId);
    if (!entry) return void ws.close(RELAY_CLOSE_OFFLINE, 'bridge offline');
    if (entry.clients.size >= maxChannels) return void ws.close(RELAY_CLOSE_FULL, 'too many');
    const ch = entry.nextCh++;
    entry.clients.set(ch, ws);
    sendFrame(entry.ws, { t: 'open', ch });

    ws.on('message', (data, isBinary) => {
      if (isBinary) return void ws.close(1003, 'text only');
      if (entry.clients.get(ch) !== ws) return;
      sendFrame(entry.ws, { t: 'data', ch, d: data.toString() });
    });
    ws.on('close', () => {
      if (entry.clients.get(ch) !== ws) return;
      entry.clients.delete(ch);
      sendFrame(entry.ws, { t: 'close', ch });
    });
  }

  function route(pathname: string): { kind: 'b' | 'c'; id: string } | null {
    const m = /^\/(b|c)\/([^/]+)$/.exec(pathname.replace(/\/+$/, ''));
    if (!m || !isBridgeId(m[2]!)) return null;
    return { kind: m[1] as 'b' | 'c', id: m[2]! };
  }

  return {
    listen() {
      return new Promise((resolve, reject) => {
        const srv = http.createServer((req, res) => {
          if (req.url === '/health') {
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ ok: true, bridges: bridges.size }));
            return;
          }
          res.writeHead(404).end();
        });
        srv.on('upgrade', (req, socket, head) => {
          let r: ReturnType<typeof route>;
          try {
            r = route(new URL(req.url ?? '/', 'http://relay').pathname);
          } catch {
            r = null;
          }
          if (!r) {
            socket.end('HTTP/1.1 404 Not Found\r\n\r\n');
            return;
          }
          const target = r;
          wss.handleUpgrade(req, socket, head, (ws) => (target.kind === 'b' ? onBridge(ws, target.id) : onClient(ws, target.id)));
        });
        srv.once('error', reject);
        srv.listen(port, host, () => {
          srv.off('error', reject);
          srv.on('error', (e) => log(`server error: ${e.message}`));
          const addr = srv.address();
          if (addr && typeof addr === 'object') port = addr.port;
          server = srv;
          resolve({ port });
        });
      });
    },
    bridges: () => [...bridges.keys()],
    close() {
      clearInterval(heartbeat);
      return new Promise((resolve) => {
        for (const ws of wss.clients) ws.terminate();
        bridges.clear();
        if (!server) return resolve();
        server.close(() => resolve());
        server.closeAllConnections();
        server = null;
      });
    },
  };
}

/** bridgeId는 공개키 해시이므로 키만 맞으면 등록 토큰 없이 소유를 증명할 수 있다 */
function ownsBridgeId(key: string, bridgeId: string): boolean {
  try {
    return keyId(key, 'brg_') === bridgeId;
  } catch {
    return false;
  }
}
