/**
 * 색인기 워커 스레드 경계: 메인(브리지 서버) ↔ 워커(인덱싱·검색 실행) RPC.
 *
 * - 메인 → 워커: { id, method, args } 요청, 워커 → 메인: { id, result | error } 응답
 * - 워커 → 메인: { event: 'state', state } 상태 방송, { event: 'log', msg }
 * - 워커가 OpenAI 키가 필요하면 { id, method: 'getKey' } 로 메인에 물어본다 (키는 워커에 저장하지 않음)
 * - 워커가 죽으면 대기 중 요청을 실패시키고 한 번만 재시작 후 resume()을 호출한다.
 */
import { Worker, parentPort, workerData, type ResourceLimits } from 'node:worker_threads';
import type { KnowledgeIndexState, RetrievalResult } from '@branch/core';
import { parseRetrievalRequest } from './validate';
import {
  createKnowledgeIndexer,
  type IndexMode,
  type KnowledgeIndexer,
  type KnowledgeIndexerOptions,
  type ReindexOptions,
} from './indexer';

export interface WorkerData {
  root: string;
  pdfjsPath?: string;
  treeSitterDir?: string;
}

export interface WorkerRequest {
  id: number;
  method: string;
  args: unknown[];
}

export interface SerializedError {
  name: string;
  message: string;
  code?: string;
}

export interface WorkerResponse {
  id: number;
  result?: unknown;
  error?: SerializedError;
}

export type WorkerEvent = { event: 'state'; state: KnowledgeIndexState } | { event: 'log'; msg: string };

/** 워커 쪽 포트 (parentPort 또는 테스트용 MessagePort) */
export interface PortLike {
  postMessage(value: unknown): void;
  on(event: string, listener: (...args: unknown[]) => void): unknown;
  close?(): void;
}

/** 메인 쪽 워커 핸들 (node Worker 또는 테스트 대역) */
export interface WorkerLike {
  postMessage(value: unknown): void;
  on(event: string, listener: (...args: unknown[]) => void): unknown;
  terminate(): unknown;
}

export const DEFAULT_WORKER_RESOURCE_LIMITS: ResourceLimits = { maxOldGenerationSizeMb: 1024 };

function serializeError(e: unknown): SerializedError {
  const code = (e as { code?: unknown } | null)?.code;
  return {
    name: e instanceof Error ? e.name : 'Error',
    message: e instanceof Error ? e.message : String(e),
    ...(typeof code === 'string' ? { code } : {}),
  };
}

function deserializeError(s: SerializedError): Error {
  const err = new Error(s.message);
  err.name = s.name;
  if (s.code) Object.assign(err, { code: s.code });
  return err;
}

function isRequest(m: unknown): m is WorkerRequest {
  return typeof m === 'object' && m !== null && 'method' in m && 'id' in m;
}

function isResponse(m: unknown): m is WorkerResponse {
  return typeof m === 'object' && m !== null && 'id' in m && !('method' in m);
}

function isEvent(m: unknown): m is WorkerEvent {
  return typeof m === 'object' && m !== null && 'event' in m;
}

/**
 * 워커 스레드 본체. parentPort와 workerData를 기본으로 쓰며,
 * 테스트에서는 MessageChannel 포트와 데이터를 직접 넘긴다.
 */
export function runIndexerWorker(port: PortLike | null = parentPort, data: WorkerData = workerData as WorkerData): void {
  if (!port) throw new Error('runIndexerWorker must run inside a worker thread');
  const out = port;

  let seq = 0;
  const waiting = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

  // 워커 → 메인 요청 (키 조회 전용)
  const askMain = (method: string, args: unknown[]): Promise<unknown> =>
    new Promise((resolve, reject) => {
      const id = ++seq;
      waiting.set(id, { resolve, reject });
      out.postMessage({ id, method, args } satisfies WorkerRequest);
    });

  const indexerOpts: KnowledgeIndexerOptions = {
    root: data.root,
    pdfjsPath: data.pdfjsPath,
    treeSitterDir: data.treeSitterDir,
    getOpenAIKey: async () => (await askMain('getKey', [])) as string | undefined,
    log: (msg) => out.postMessage({ event: 'log', msg } satisfies WorkerEvent),
  };
  const indexer: KnowledgeIndexer = createKnowledgeIndexer(indexerOpts);
  indexer.onState((state) => out.postMessage({ event: 'state', state } satisfies WorkerEvent));

  const controllers = new Map<number, AbortController>();

  async function dispatch(req: WorkerRequest): Promise<unknown> {
    const [a0, a1] = req.args;
    switch (req.method) {
      case 'states':
        return indexer.states(a0 as string[] | undefined);
      case 'enqueue':
        return indexer.enqueue(a0 as string, a1 as IndexMode | undefined);
      case 'cancel':
        return indexer.cancel(a0 as string);
      case 'docs':
        return indexer.docs(a0 as string);
      case 'settingsChanged':
        return indexer.settingsChanged(a0 as string);
      case 'markStale':
        return indexer.markStale(a0 as string);
      case 'retrieve': {
        const ac = new AbortController();
        controllers.set(req.id, ac);
        try {
          const result: RetrievalResult = await indexer.retrieve(parseRetrievalRequest(a0), ac.signal);
          return result;
        } finally {
          controllers.delete(req.id);
        }
      }
      case 'abort':
        controllers.get(a0 as number)?.abort();
        return undefined;
      case 'source':
        return indexer.source(a0 as string, a1 as string);
      case 'drop':
        return indexer.drop(a0 as string);
      case 'reindex':
        return indexer.reindex(a0 as string, a1 as ReindexOptions | undefined);
      case 'verify':
        return indexer.verify(a0 as string);
      case 'release':
        return indexer.release(a0 as string);
      case 'resume':
        return indexer.resume();
      case 'close':
        await indexer.close();
        return undefined;
      default:
        throw new Error(`unknown method: ${req.method}`);
    }
  }

  async function handle(req: WorkerRequest): Promise<void> {
    try {
      const result = await dispatch(req);
      out.postMessage({ id: req.id, result } satisfies WorkerResponse);
    } catch (e) {
      out.postMessage({ id: req.id, error: serializeError(e) } satisfies WorkerResponse);
    }
    if (req.method === 'close') out.close?.();
  }

  out.on('message', (m: unknown) => {
    if (isRequest(m)) {
      void handle(m);
      return;
    }
    if (isResponse(m)) {
      const w = waiting.get(m.id);
      if (!w) return;
      waiting.delete(m.id);
      if (m.error) w.reject(deserializeError(m.error));
      else w.resolve(m.result);
    }
  });
}

export interface IndexerWorkerOptions {
  /** 컴파일된 워커 스크립트 경로 (runIndexerWorker를 호출하는 모듈) */
  workerPath: string;
  root: string;
  pdfjsPath?: string;
  treeSitterDir?: string;
  getOpenAIKey: KnowledgeIndexerOptions['getOpenAIKey'];
  log?: (msg: string) => void;
  resourceLimits?: ResourceLimits;
  /** 테스트용 워커 생성기 (기본: node:worker_threads Worker) */
  spawnWorker?: (workerPath: string, data: WorkerData, limits: ResourceLimits) => WorkerLike;
}

function defaultSpawn(workerPath: string, data: WorkerData, limits: ResourceLimits): WorkerLike {
  const w = new Worker(workerPath, { workerData: data, resourceLimits: limits });
  return {
    postMessage: (v) => w.postMessage(v),
    on: (ev, fn) => w.on(ev, fn),
    terminate: () => w.terminate(),
  };
}

/**
 * 워커 기반 KnowledgeIndexer. 호출은 모두 RPC로 전달된다.
 * 워커가 죽으면 대기 요청을 실패시키고, 한 번 재시작 후 resume()을 보낸다.
 */
export function startIndexerWorker(opts: IndexerWorkerOptions): KnowledgeIndexer {
  const spawn = opts.spawnWorker ?? defaultSpawn;
  const limits = opts.resourceLimits ?? DEFAULT_WORKER_RESOURCE_LIMITS;
  const data: WorkerData = { root: opts.root, pdfjsPath: opts.pdfjsPath, treeSitterDir: opts.treeSitterDir };
  const log = (msg: string) => opts.log?.(msg);

  let worker: WorkerLike | null = null;
  let restarts = 0;
  let closing = false;
  let dead = false;
  let seq = 0;
  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  const listeners = new Set<(s: KnowledgeIndexState) => void>();

  const rejectAll = (err: Error) => {
    for (const p of pending.values()) p.reject(err);
    pending.clear();
  };

  function onMessage(w: WorkerLike, m: unknown): void {
    if (w !== worker) return;
    if (isEvent(m)) {
      if (m.event === 'state') for (const l of listeners) l(m.state);
      else if (m.event === 'log') log(m.msg);
      return;
    }
    if (isRequest(m) && m.method === 'getKey') {
      // 워커가 키를 요청: 응답만 하고 값은 로그하지 않는다
      Promise.resolve()
        .then(() => opts.getOpenAIKey())
        .then(
          (key) => w.postMessage({ id: m.id, result: key ?? undefined } satisfies WorkerResponse),
          (e: unknown) => w.postMessage({ id: m.id, error: serializeError(e) } satisfies WorkerResponse),
        );
      return;
    }
    if (isResponse(m)) {
      const p = pending.get(m.id);
      if (!p) return;
      pending.delete(m.id);
      if (m.error) p.reject(deserializeError(m.error));
      else p.resolve(m.result);
    }
  }

  function onDown(w: WorkerLike, err: Error): void {
    if (w !== worker) return;
    worker = null;
    rejectAll(err);
    if (closing) return;
    if (restarts < 1) {
      restarts++;
      log(`index worker stopped, restarting once: ${err.message}`);
      start();
      void call('resume', []).catch((e: unknown) => log(`index worker resume failed: ${String(e)}`));
    } else {
      dead = true;
      log(`index worker stopped again, giving up: ${err.message}`);
    }
  }

  function start(): void {
    const w = spawn(opts.workerPath, data, limits);
    worker = w;
    w.on('message', (m: unknown) => onMessage(w, m));
    w.on('error', (e: unknown) => onDown(w, e instanceof Error ? e : new Error(String(e))));
    w.on('exit', (code: unknown) => onDown(w, new Error(`index worker exited (${String(code)})`)));
  }

  function call<T>(method: string, args: unknown[], signal?: AbortSignal): Promise<T> {
    const w = worker;
    if (closing) return Promise.reject(new Error('index worker closed'));
    if (dead || !w) return Promise.reject(new Error('index worker unavailable'));
    if (signal?.aborted) return Promise.reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
    const id = ++seq;
    return new Promise<T>((resolve, reject) => {
      const settle = () => {
        signal?.removeEventListener('abort', onAbort);
      };
      const onAbort = () => {
        // 워커 쪽 retrieve를 중단시킨다. 응답은 그대로 기다린다
        const abortId = ++seq;
        w.postMessage({ id: abortId, method: 'abort', args: [id] } satisfies WorkerRequest);
      };
      pending.set(id, {
        resolve: (v) => {
          settle();
          resolve(v as T);
        },
        reject: (e) => {
          settle();
          reject(e);
        },
      });
      signal?.addEventListener('abort', onAbort, { once: true });
      w.postMessage({ id, method, args } satisfies WorkerRequest);
    });
  }

  start();

  return {
    states: (kbIds) => call('states', [kbIds]),
    enqueue: (kbId, mode) => call<void>('enqueue', [kbId, mode]),
    cancel: (kbId) => call<void>('cancel', [kbId]),
    docs: (kbId) => call('docs', [kbId]),
    settingsChanged: (kbId) => call<void>('settingsChanged', [kbId]),
    markStale: (kbId) => call<void>('markStale', [kbId]),
    retrieve: (req, signal) => call<RetrievalResult>('retrieve', [req], signal),
    source: (kbId, chunkId) => call('source', [kbId, chunkId]),
    drop: (kbId) => call<void>('drop', [kbId]),
    reindex: (kbId, o) => call<void>('reindex', [kbId, o]),
    verify: (kbId) => call('verify', [kbId]),
    release: (kbId) => call<void>('release', [kbId]),
    resume: () => call<void>('resume', []),
    onState(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    async close() {
      if (closing) return;
      closing = true;
      const w = worker;
      if (w) {
        await new Promise<void>((resolve) => {
          const id = ++seq;
          pending.set(id, { resolve: () => resolve(), reject: () => resolve() });
          w.postMessage({ id, method: 'close', args: [] } satisfies WorkerRequest);
        });
      }
      worker = null;
      rejectAll(new Error('index worker closed'));
      listeners.clear();
      if (w) await w.terminate();
    },
  };
}
