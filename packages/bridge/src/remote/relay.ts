import {
  parseRelayFrame,
  relayBridgeUrl,
  relayRegisterTranscript,
  signTranscript,
  type BridgeToRelay,
  type RelayToBridge,
} from '@branch/core';
import WebSocket from 'ws';
import type { PeerSocket } from './server';
import type { BridgeStore } from './store';

/**
 * relay 커넥터 (ADR-020). bridge가 relay에 아웃바운드로 접속해 등록하고,
 * relay가 열어 주는 채널마다 가상 PeerSocket을 만들어 원격 서버에 넘긴다.
 * relay는 핸드셰이크 공개값과 암호문만 중계하므로 여기서도 평문은 오가지 않는다.
 */
export interface RelayConnectorOptions {
  /** relay 기본 주소 (ws:// 또는 wss://) */
  url: string;
  store: BridgeStore;
  accept: (peer: PeerSocket, remote: string) => void;
  log?: (msg: string) => void;
  /** 등록 상태 변화 */
  onState?: (state: 'connecting' | 'ready' | 'offline') => void;
  /** 재접속 대기 상한 */
  maxBackoffMs?: number;
}

export interface RelayConnector {
  /** 첫 등록 완료(또는 실패)까지 기다린다 */
  ready(timeoutMs?: number): Promise<boolean>;
  state(): 'connecting' | 'ready' | 'offline';
  close(): void;
}

interface Channel {
  open: boolean;
  onMessage: ((text: string) => void)[];
  onClose: (() => void)[];
}

export function createRelayConnector(opts: RelayConnectorOptions): RelayConnector {
  const log = opts.log ?? (() => {});
  const maxBackoff = opts.maxBackoffMs ?? 30_000;
  const target = relayBridgeUrl(opts.url, opts.store.bridgeId);
  let ws: WebSocket | null = null;
  let current: 'connecting' | 'ready' | 'offline' = 'connecting';
  let stopped = false;
  let backoff = 1_000;
  let retry: ReturnType<typeof setTimeout> | null = null;
  const channels = new Map<number, Channel>();
  const waiters = new Set<(ok: boolean) => void>();

  function setState(s: typeof current) {
    if (s === current) return;
    current = s;
    opts.onState?.(s);
    if (s !== 'connecting') for (const w of [...waiters]) w(s === 'ready');
  }

  function closeChannel(ch: number) {
    const c = channels.get(ch);
    if (!c) return;
    channels.delete(ch);
    c.open = false;
    for (const cb of c.onClose) cb();
  }

  function send(frame: BridgeToRelay) {
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(frame));
  }

  function openChannel(ch: number) {
    const c: Channel = { open: true, onMessage: [], onClose: [] };
    channels.set(ch, c);
    const peer: PeerSocket = {
      send: (text) => {
        if (c.open) send({ t: 'data', ch, d: text });
      },
      close: (code) => {
        if (!c.open) return;
        send({ t: 'close', ch, ...(code ? { code } : {}) });
        // relay에 닫힘을 알린 뒤 곧바로 정리한다 (deny 등 마지막 프레임은 이미 전송됨)
        closeChannel(ch);
      },
      isOpen: () => c.open,
      onMessage: (cb) => void c.onMessage.push(cb),
      onClose: (cb) => void c.onClose.push(cb),
    };
    opts.accept(peer, `relay#${ch}`);
  }

  function connect() {
    if (stopped) return;
    setState(current === 'ready' ? 'connecting' : current);
    const sock = new WebSocket(target, { maxPayload: 4 * 1024 * 1024 });
    ws = sock;
    sock.on('message', (data, isBinary) => {
      if (isBinary) return;
      const f = parseRelayFrame<RelayToBridge>(data.toString());
      if (!f) return;
      switch (f.t) {
        case 'challenge':
          send({
            t: 'register',
            key: opts.store.identity.publicKey,
            sig: signTranscript(opts.store.identity.secretKey, relayRegisterTranscript(f.nonce, opts.store.bridgeId)),
          });
          return;
        case 'ready':
          backoff = 1_000;
          log('relay registered');
          setState('ready');
          return;
        case 'open':
          if (typeof f.ch === 'number' && !channels.has(f.ch)) openChannel(f.ch);
          return;
        case 'data': {
          const c = channels.get(f.ch);
          if (c && typeof f.d === 'string') for (const cb of c.onMessage) cb(f.d);
          return;
        }
        case 'close':
          closeChannel(f.ch);
          return;
      }
    });
    sock.on('close', (code) => {
      if (ws === sock) ws = null;
      for (const ch of [...channels.keys()]) closeChannel(ch);
      if (stopped) return;
      log(`relay disconnected (${code}), retry in ${backoff}ms`);
      setState('offline');
      retry = setTimeout(connect, backoff);
      backoff = Math.min(backoff * 2, maxBackoff);
    });
    sock.on('error', (e) => log(`relay error: ${e.message}`));
  }

  connect();

  return {
    ready(timeoutMs = 10_000) {
      if (current === 'ready') return Promise.resolve(true);
      return new Promise((resolve) => {
        const done = (ok: boolean) => {
          clearTimeout(timer);
          waiters.delete(done);
          resolve(ok);
        };
        const timer = setTimeout(() => done(false), timeoutMs);
        waiters.add(done);
      });
    },
    state: () => current,
    close() {
      stopped = true;
      if (retry) clearTimeout(retry);
      for (const ch of [...channels.keys()]) closeChannel(ch);
      ws?.close(1000);
      ws = null;
    },
  };
}
