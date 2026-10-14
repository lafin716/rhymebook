import { newId } from '../id';
import type { ProviderId } from '../model';
import { PROVIDER_LABELS, providerError, type Availability, type LLMProvider, type StreamEvent, type StreamRequest } from '../provider';
import type { BridgeClientMsg, BridgeServerMsg, BridgeStatus, CliProviderId } from './protocol';
import { CLI_PROVIDER_IDS } from './protocol';

/** 메시지 전송로. Electron IPC, WebSocket 모두 이 모양으로 감싼다 */
export interface BridgeTransport {
  /** 연결이 끊겨 있으면 throw */
  send(msg: BridgeClientMsg): void;
  subscribe(listener: (msg: BridgeServerMsg) => void): () => void;
  /** 연결이 끊기면 호출 (진행 중 요청을 offline 오류로 끝낸다) */
  onDisconnect?(listener: () => void): () => void;
}

export interface BridgeClientOptions {
  /** 상태 응답 대기 시간 */
  statusTimeoutMs?: number;
  /** 상태 결과 재사용 시간 (두 CLI 카드가 동시에 묻는 경우 한 번만 감지) */
  statusCacheMs?: number;
  /** 연결이 없을 때 보여줄 문구 */
  offlineMessage?: string;
}

export interface BridgeClient {
  status(refresh?: boolean): Promise<BridgeStatus>;
  stream(providerId: CliProviderId, req: StreamRequest): AsyncIterable<StreamEvent>;
}

const ABORTED = '사용자가 중지했습니다.';

export function createBridgeClient(transport: BridgeTransport, opts: BridgeClientOptions = {}): BridgeClient {
  // bridge의 CLI 확인(명령당 최대 40초, 병렬)보다 길어야 느린 PC에서 "연결 안 됨"으로 오판하지 않는다
  const statusTimeoutMs = opts.statusTimeoutMs ?? 50_000;
  const statusCacheMs = opts.statusCacheMs ?? 3_000;
  const offline = opts.offlineMessage ?? 'Bridge에 연결할 수 없습니다.';
  let inflight: Promise<BridgeStatus> | null = null;
  let cached: { at: number; value: BridgeStatus } | null = null;

  function fetchStatus(refresh: boolean): Promise<BridgeStatus> {
    return new Promise((resolve, reject) => {
      const reqId = newId('st');
      const done = (fn: () => void) => {
        clearTimeout(timer);
        unsub();
        offDisconnect?.();
        fn();
      };
      const timer = setTimeout(() => done(() => reject(new Error('CLI 상태 확인 시간이 초과되었습니다.'))), statusTimeoutMs);
      const unsub = transport.subscribe((m) => {
        if (m.type === 'status' && m.reqId === reqId) done(() => resolve(m.providers));
      });
      const offDisconnect = transport.onDisconnect?.(() => done(() => reject(new Error(offline))));
      try {
        transport.send({ type: 'status.get', reqId, ...(refresh ? { refresh } : {}) });
      } catch {
        done(() => reject(new Error(offline)));
      }
    });
  }

  return {
    status(refresh = false) {
      if (!refresh && cached && Date.now() - cached.at < statusCacheMs) return Promise.resolve(cached.value);
      if (inflight) return inflight;
      inflight = fetchStatus(refresh)
        .then((value) => {
          cached = { at: Date.now(), value };
          return value;
        })
        .finally(() => {
          inflight = null;
        });
      return inflight;
    },

    async *stream(providerId, req) {
      const reqId = newId('rq');
      const queue: StreamEvent[] = [];
      let wake: (() => void) | null = null;
      let ended = false;
      const push = (ev: StreamEvent) => {
        queue.push(ev);
        wake?.();
        wake = null;
      };
      const unsub = transport.subscribe((m) => {
        if (m.type === 'status' || m.reqId !== reqId) return;
        if (m.type === 'chat.delta') push({ type: 'delta', text: m.text });
        else if (m.type === 'chat.done') push({ type: 'done', ...(m.stopReason ? { stopReason: m.stopReason } : {}) });
        else push({ type: 'error', error: m.error });
      });
      const offDisconnect = transport.onDisconnect?.(() => push({ type: 'error', error: providerError('offline', offline) }));
      const onAbort = () => {
        try {
          transport.send({ type: 'chat.abort', reqId });
        } catch {
          // 연결이 이미 끊겼다면 bridge가 스스로 정리한다
        }
        push({ type: 'error', error: providerError('aborted', ABORTED) });
      };

      try {
        if (req.signal?.aborted) {
          push({ type: 'error', error: providerError('aborted', ABORTED) });
        } else {
          req.signal?.addEventListener('abort', onAbort, { once: true });
          try {
            transport.send({
              type: 'chat.start',
              reqId,
              providerId,
              system: req.system,
              messages: req.messages,
              ...(req.model ? { model: req.model } : {}),
              ...(req.effort ? { effort: req.effort } : {}),
            });
          } catch {
            push({ type: 'error', error: providerError('offline', offline) });
          }
        }
        while (true) {
          if (!queue.length) await new Promise<void>((r) => (wake = r));
          const ev = queue.shift()!;
          yield ev;
          if (ev.type !== 'delta') {
            ended = true;
            return;
          }
        }
      } finally {
        req.signal?.removeEventListener('abort', onAbort);
        unsub();
        offDisconnect?.();
        // 소비자가 중간에 그만두면 CLI 프로세스도 멈춘다
        if (!ended) {
          try {
            transport.send({ type: 'chat.abort', reqId });
          } catch {
            // 무시
          }
        }
      }
    },
  };
}

/** Bridge 클라이언트를 CLI provider로 노출한다 (레지스트리 overrides 용) */
export function createBridgeProviders(
  client: BridgeClient,
  label: (id: CliProviderId) => string = (id) => PROVIDER_LABELS[id],
): Partial<Record<ProviderId, LLMProvider>> {
  const out: Partial<Record<ProviderId, LLMProvider>> = {};
  for (const id of CLI_PROVIDER_IDS) {
    out[id] = {
      id,
      label: label(id),
      async available(): Promise<Availability> {
        try {
          return (await client.status(true))[id];
        } catch (e) {
          return { status: 'offline', detail: e instanceof Error ? e.message : String(e) };
        }
      },
      stream: (req) => client.stream(id, req),
    };
  }
  return out;
}
