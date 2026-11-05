/**
 * 지식베이스 색인 관리자 (인프로세스). 작업 큐(한 번에 하나), 취소, 이어하기, 상태 방송, 검색 진입점.
 * worker.ts가 이 객체를 worker_thread에서 감싸 RPC로 노출한다.
 */
import { existsSync, readdirSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { mkdir, rm, statfs } from 'node:fs/promises';
import path from 'node:path';
import {
  createHashEmbedder,
  createOpenAIEmbedder,
  DEFAULT_INDEX_SETTINGS,
  embeddingKey,
  t,
  type EmbeddingProvider,
  type KnowledgeDoc,
  type KnowledgeIndexSettings,
  type KnowledgeIndexState,
  type RetrievalRequest,
  type RetrievalResult,
  type SourceView,
} from '@branch/core';
import {
  ingestKnowledge,
  IndexFatalError,
  LIMITS,
  scanFiles,
  throwIfAborted,
  type IngestProgress,
  type IngestResult,
} from './ingestion';
import { createPdfExtractor } from './pdfText';
import { IndexRepository, type JobRow } from './sqliteRepository';
import { retrieveFrom, sourceFrom, type KbSearchTarget } from './searchEngine';

export const INDEX_FILE = 'index.sqlite';
export const NEXT_INDEX_FILE = 'index.next.sqlite';
/** 전체 재생성 교체 중에만 잠시 남는 이전 색인 (시작 시 복구한다) */
export const PREV_INDEX_FILE = 'index.prev.sqlite';
const SIDECARS = ['', '-wal', '-shm'] as const;
/** 디스크 여유 공간 하한 (min(이 값, 원본 크기 × 2)) */
export const MIN_FREE_BYTES = 200 * 1024 * 1024;
const PROGRESS_INTERVAL_MS = 150;
const KB_RE = /^kb[a-z0-9]{6,40}$/;

export type IndexMode = 'incremental' | 'full';

export interface KnowledgeIndexerOptions {
  /** 지식 루트: <root>/<kbId>/files, <root>/<kbId>/index.sqlite */
  root: string;
  /** OpenAI 임베딩 키 공급자 (로그·오류 문구·저장 금지) */
  getOpenAIKey: () => Promise<string | undefined> | string | undefined;
  /** pdfjs-dist legacy 빌드 경로 (생략 시 패키지 해석) */
  pdfjsPath?: string;
  /** OpenAI 호출용 fetch (테스트 주입) */
  fetch?: typeof globalThis.fetch;
  log?: (msg: string) => void;
  /** KB 설정에 맞는 임베딩 제공자 (테스트·확장용). 기본: core 내장 구현 */
  embedderFor?: (kbId: string, settings: KnowledgeIndexSettings) => EmbeddingProvider | Promise<EmbeddingProvider>;
  /** 임베딩 재시도 간격 (ms, 기본 500) */
  retryDelayMs?: number;
  now?: () => number;
  /** 디스크 여유 공간 조회 (테스트 주입). 바이트 단위 */
  freeBytes?: (dir: string) => Promise<number>;
}

export interface KnowledgeIndexer {
  /** KB별 색인 상태 (kbIds 생략 시 루트의 모든 KB) */
  states(kbIds?: string[]): Promise<KnowledgeIndexState[]>;
  /** 색인 작업 예약. mode 'full'은 전체 재생성 */
  enqueue(kbId: string, mode?: IndexMode): Promise<void>;
  /** 대기·진행 중 작업 취소 (기존 색인은 유지되어 검색된다) */
  cancel(kbId: string): Promise<void>;
  /** 색인 문서 목록 */
  docs(kbId: string): Promise<KnowledgeDoc[]>;
  /** 설정 변경 알림: 임베딩 모델이 다르면 stale 표시 */
  settingsChanged(kbId: string): Promise<void>;
  /** 검색 */
  retrieve(req: RetrievalRequest, signal?: AbortSignal): Promise<RetrievalResult>;
  /** 출처 보기 */
  source(kbId: string, chunkId: string): Promise<SourceView | undefined>;
  /** 색인 파일 삭제 (원본 files/는 건드리지 않음) */
  drop(kbId: string): Promise<void>;
  /** 끝나지 않은 작업 이어하기 (앱 재시작 시) */
  resume(): Promise<void>;
  /** 상태 변경 구독. 해제 함수를 돌려준다 */
  onState(listener: (s: KnowledgeIndexState) => void): () => void;
  /** 진행 중 작업 취소 후 열린 파일 닫기 */
  close(): Promise<void>;
}

interface KbRuntime {
  /** 다음 실행 모드 (undefined면 예약 없음) */
  mode?: IndexMode;
  controller?: AbortController;
  running: boolean;
}

interface SavedState {
  status?: KnowledgeIndexState['status'];
  sourceBytes?: number;
  indexedAt?: number;
  error?: string;
}

export function createKnowledgeIndexer(opts: KnowledgeIndexerOptions): KnowledgeIndexer {
  const now = opts.now ?? (() => Date.now());
  const log = opts.log ?? (() => undefined);
  const freeBytes = opts.freeBytes ?? defaultFreeBytes;
  const retryDelayMs = opts.retryDelayMs ?? 500;
  const pdfExtract = createPdfExtractor(opts.pdfjsPath);
  const repos = new Map<string, IndexRepository>();
  const states = new Map<string, KnowledgeIndexState>();
  const runtime = new Map<string, KbRuntime>();
  const providers = new Map<string, { key: string; provider: EmbeddingProvider }>();
  const listeners = new Set<(s: KnowledgeIndexState) => void>();
  const queue: string[] = [];
  /** 삭제된 KB. 이 안의 id는 색인 파일을 다시 만들지 않는다 */
  const dropped = new Set<string>();
  let pumping: Promise<void> | null = null;
  let closed = false;

  const kbDir = (kbId: string): string => {
    if (!KB_RE.test(kbId)) throw new Error(`invalid kb id: ${kbId}`);
    return path.join(opts.root, kbId);
  };
  const emit = (s: KnowledgeIndexState): void => {
    states.set(s.kbId, s);
    for (const l of listeners) l(s);
  };
  const rtOf = (kbId: string): KbRuntime => {
    let rt = runtime.get(kbId);
    if (!rt) {
      rt = { running: false };
      runtime.set(kbId, rt);
    }
    return rt;
  };

  function readSettings(kbId: string): KnowledgeIndexSettings {
    try {
      const raw = JSON.parse(readFileSync(path.join(kbDir(kbId), 'meta.json'), 'utf8')) as {
        settings?: { embedding?: { provider?: string; model?: string } };
      };
      const e = raw.settings?.embedding;
      if (e?.provider === 'openai') return { embedding: { provider: 'openai', model: e.model } };
      return DEFAULT_INDEX_SETTINGS;
    } catch {
      return DEFAULT_INDEX_SETTINGS;
    }
  }

  async function providerFor(kbId: string): Promise<EmbeddingProvider> {
    const settings = readSettings(kbId);
    const key = JSON.stringify(settings);
    const hit = providers.get(kbId);
    if (hit && hit.key === key) return hit.provider;
    let provider: EmbeddingProvider;
    if (opts.embedderFor) {
      provider = await opts.embedderFor(kbId, settings);
    } else if (settings.embedding.provider === 'openai') {
      const apiKey = await opts.getOpenAIKey();
      if (!apiKey) throw new IndexFatalError('key_missing', t('bridge.knowledge.index.keyMissing'));
      provider = createOpenAIEmbedder({
        getKey: async () => (await opts.getOpenAIKey()) ?? null,
        model: settings.embedding.model,
        fetch: opts.fetch,
      });
    } else {
      provider = createHashEmbedder();
    }
    providers.set(kbId, { key, provider });
    return provider;
  }

  /** 색인 파일을 연다. 없으면 만든다 (작업 기록을 남기기 위해 실행 시작 시 호출) */
  function ensureRepo(kbId: string): IndexRepository {
    const cached = repos.get(kbId);
    if (cached) return cached;
    if (dropped.has(kbId)) throw new Error(`knowledge base dropped: ${kbId}`);
    recoverSwap(kbDir(kbId));
    const repo = IndexRepository.open(path.join(kbDir(kbId), INDEX_FILE));
    repos.set(kbId, repo);
    return repo;
  }

  /** 색인 파일이 있을 때만 연다 (조회 전용) */
  function openRepo(kbId: string): IndexRepository | undefined {
    if (dropped.has(kbId)) return undefined;
    recoverSwap(kbDir(kbId));
    if (!existsSync(path.join(kbDir(kbId), INDEX_FILE))) return undefined;
    return ensureRepo(kbId);
  }

  function closeRepo(kbId: string): void {
    const r = repos.get(kbId);
    if (r) {
      r.close();
      repos.delete(kbId);
    }
  }

  function readSaved(repo: IndexRepository): SavedState {
    const raw = repo.getMeta('state');
    if (!raw) return {};
    try {
      return JSON.parse(raw) as SavedState;
    } catch {
      return {};
    }
  }

  function persistState(repo: IndexRepository, patch: SavedState): void {
    repo.setMeta('state', JSON.stringify({ ...readSaved(repo), ...patch }));
  }

  function stateFromRepo(kbId: string, repo: IndexRepository | undefined): KnowledgeIndexState {
    if (!repo) {
      return { kbId, status: 'empty', docCount: 0, chunkCount: 0, indexBytes: 0, sourceBytes: 0, failedDocs: 0 };
    }
    const st = repo.stats();
    const saved = readSaved(repo);
    return {
      kbId,
      status: saved.status ?? (st.docCount > 0 ? 'ready' : 'empty'),
      docCount: st.docCount,
      chunkCount: st.chunkCount,
      indexBytes: repo.fileBytes(),
      sourceBytes: saved.sourceBytes ?? 0,
      model: repo.getModel(),
      indexedAt: saved.indexedAt,
      error: saved.error,
      failedDocs: st.failedDocs,
    };
  }

  async function ensureDisk(kbId: string, sourceBytes: number): Promise<void> {
    const need = Math.min(MIN_FREE_BYTES, sourceBytes * 2);
    const free = await freeBytes(kbDir(kbId));
    if (free < need) throw new IndexFatalError('disk_full', t('bridge.knowledge.index.diskFull'));
  }

  async function removeIndexFiles(base: string): Promise<void> {
    for (const suffix of ['', '-wal', '-shm']) await rm(`${base}${suffix}`, { force: true });
  }

  async function runJob(kbId: string, mode: IndexMode, rt: KbRuntime): Promise<void> {
    const dir = kbDir(kbId);
    const filesDir = path.join(dir, 'files');
    const liveFile = path.join(dir, INDEX_FILE);
    const nextFile = path.join(dir, NEXT_INDEX_FILE);
    const controller = new AbortController();
    rt.controller = controller;
    rt.running = true;
    const jobId = `job_${kbId}_${now()}`;
    const startedAt = now();
    let effectiveMode: IndexMode = mode;
    let lastEmit = 0;
    const base = stateFromRepo(kbId, repos.get(kbId));
    emit({ ...base, status: 'indexing', progress: { kbId, phase: 'scan', done: 0, total: 0 }, error: undefined });

    // 작업 기록은 항상 live 파일에 남긴다 (전체 재생성 후 교체되어도 이어하기 신호가 보존되도록)
    const jobRow = (state: JobRow['state'], extra: Partial<JobRow> = {}): JobRow => ({
      id: jobId,
      kind: effectiveMode === 'full' ? 'reindex' : 'index',
      state,
      startedAt,
      updatedAt: now(),
      done: 0,
      total: 0,
      ...extra,
    });

    const onProgress = (p: IngestProgress): void => {
      const t0 = now();
      if (t0 - lastEmit < PROGRESS_INTERVAL_MS && p.done < p.total) return;
      lastEmit = t0;
      const live = states.get(kbId) ?? base;
      emit({ ...live, status: 'indexing', progress: { kbId, phase: p.phase, done: p.done, total: p.total, current: p.current } });
    };

    try {
      const provider = await providerFor(kbId);
      const modelKey = embeddingKey(provider.info);
      const live = ensureRepo(kbId);
      const liveModel = live.getModel();
      // 임베딩 모델이 바뀌면 벡터를 섞을 수 없으므로 전체 재생성
      if (liveModel && embeddingKey(liveModel) !== modelKey) effectiveMode = 'full';
      live.saveJob(jobRow('running'));

      const { files } = await scanFiles(filesDir);
      const sourceBytes = files.reduce((s, f) => s + f.size, 0);
      if (files.length > LIMITS.maxFiles) {
        throw new IndexFatalError('too_many_files', t('bridge.knowledge.index.tooManyFiles', { count: LIMITS.maxFiles }));
      }
      await ensureDisk(kbId, sourceBytes);
      throwIfAborted(controller.signal);

      let result: IngestResult;
      if (effectiveMode === 'full') {
        // 새 파일에 전부 쓰고 성공하면 교체한다. 실패·취소 시 기존 색인은 그대로 남는다.
        await removeIndexFiles(nextFile);
        const next = IndexRepository.open(nextFile);
        try {
          if (liveModel) next.importEmbeddingCache(liveFile, modelKey);
          result = await ingestKnowledge({
            kbId,
            filesDir,
            repo: next,
            provider,
            mode: 'full',
            pdfExtract,
            signal: controller.signal,
            onProgress,
            retryDelayMs,
            now,
          });
          next.setModel(provider.info);
          persistState(next, { status: 'ready', sourceBytes: result.sourceBytes, indexedAt: now() });
          next.checkpoint();
          throwIfAborted(controller.signal);
          next.close();
        } catch (err) {
          try {
            next.close();
          } catch {
            // 이미 닫힌 경우 무시
          }
          await removeIndexFiles(nextFile);
          throw err;
        }
        // 교체 직전: 기존 연결의 WAL을 본 파일에 합치고 닫는다 (동기 교체 중에는 다른 쓰기가 끼지 않는다)
        try {
          repos.get(kbId)?.checkpoint();
        } catch {
          // 체크포인트 실패는 닫기에서 다시 처리된다
        }
        closeRepo(kbId);
        if (dropped.has(kbId)) throw new Error(`knowledge base dropped: ${kbId}`);
        emit({ ...base, status: 'indexing', progress: { kbId, phase: 'swap', done: 0, total: 1 } });
        swapIndexFiles(dir);
      } else {
        result = await ingestKnowledge({
          kbId,
          filesDir,
          repo: live,
          provider,
          mode: 'incremental',
          pdfExtract,
          signal: controller.signal,
          onProgress,
          retryDelayMs,
          now,
        });
        live.setModel(provider.info);
        persistState(live, { status: 'ready', sourceBytes: result.sourceBytes, indexedAt: now() });
      }

      const target = ensureRepo(kbId);
      target.saveJob(jobRow('done', { done: result.indexed, total: result.scanned }));
      const finished = stateFromRepo(kbId, target);
      emit({ ...finished, status: 'ready', sourceBytes: result.sourceBytes, indexedAt: now(), progress: undefined, error: undefined });
      log(
        `[rag] ${kbId} ${effectiveMode} 색인 완료: 변경 ${result.indexed}, 유지 ${result.unchanged}, 실패 ${result.failed}, 청크 ${result.chunks}`,
      );
    } catch (err) {
      // 삭제된 KB는 아무것도 다시 만들거나 상태를 내보내지 않는다
      if (dropped.has(kbId)) {
        log(`[rag] ${kbId} 삭제되어 작업을 버림`);
        return;
      }
      const aborted = err instanceof Error && err.name === 'AbortError';
      const message = err instanceof Error ? err.message : String(err);
      let repo: IndexRepository | undefined;
      try {
        repo = ensureRepo(kbId);
      } catch {
        repo = undefined;
      }
      const cur = stateFromRepo(kbId, repo);
      if (aborted) {
        repo?.saveJob(jobRow('cancelled'));
        const status: KnowledgeIndexState['status'] = cur.docCount > 0 ? 'stale' : 'empty';
        if (repo) persistState(repo, { status });
        emit({ ...cur, status, progress: undefined });
      } else {
        repo?.saveJob(jobRow('failed', { error: message }));
        if (repo) persistState(repo, { status: 'error', error: message });
        emit({ ...cur, status: 'error', error: message, progress: undefined });
        log(`[rag] ${kbId} 색인 실패: ${message}`);
      }
    } finally {
      rt.running = false;
      rt.controller = undefined;
    }
  }

  async function pump(): Promise<void> {
    while (queue.length > 0 && !closed) {
      const kbId = queue.shift();
      if (!kbId) continue;
      const rt = rtOf(kbId);
      const mode = rt.mode;
      if (mode === undefined) continue;
      rt.mode = undefined;
      try {
        await runJob(kbId, mode, rt);
      } catch (err) {
        log(`[rag] ${kbId} 작업 중단: ${err instanceof Error ? err.message : String(err)}`);
      }
      // 실행 중 다시 예약된 경우 이어서 실행
      if (rt.mode !== undefined && !queue.includes(kbId)) queue.push(kbId);
    }
    pumping = null;
  }

  function schedule(): void {
    if (!pumping) pumping = pump();
  }

  const api: KnowledgeIndexer = {
    async states(kbIds) {
      const ids = kbIds ?? listKbIds(opts.root);
      const out: KnowledgeIndexState[] = [];
      for (const id of ids) {
        const live = states.get(id);
        if (live && (live.status === 'queued' || live.status === 'indexing')) {
          out.push(live);
          continue;
        }
        out.push(stateFromRepo(id, openRepo(id)));
      }
      return out;
    },

    async enqueue(kbId, mode = 'incremental') {
      if (closed) throw new Error('indexer closed');
      if (dropped.has(kbId)) throw new Error(`knowledge base dropped: ${kbId}`);
      kbDir(kbId);
      const rt = rtOf(kbId);
      rt.mode = rt.mode === 'full' || mode === 'full' ? 'full' : 'incremental';
      if (!rt.running && !queue.includes(kbId)) {
        queue.push(kbId);
        const cur = states.get(kbId) ?? stateFromRepo(kbId, openRepo(kbId));
        emit({ ...cur, status: 'queued', progress: undefined });
      }
      schedule();
    },

    async cancel(kbId) {
      const rt = runtime.get(kbId);
      if (!rt) return;
      rt.mode = undefined;
      const idx = queue.indexOf(kbId);
      if (idx >= 0) queue.splice(idx, 1);
      rt.controller?.abort();
      if (!rt.running) {
        const cur = stateFromRepo(kbId, openRepo(kbId));
        emit({ ...cur, status: cur.docCount > 0 ? 'stale' : 'empty', progress: undefined });
      }
    },

    async docs(kbId) {
      const repo = openRepo(kbId);
      if (!repo) return [];
      return repo.listDocs().map((d) => ({
        docId: d.docId,
        path: d.path,
        title: d.title,
        kind: d.kind,
        url: d.url,
        bytes: d.bytes,
        chunkCount: d.chunkCount,
        status: d.status,
        error: d.error,
        indexedAt: d.indexedAt,
      }));
    },

    async settingsChanged(kbId) {
      const repo = openRepo(kbId);
      if (!repo) return;
      const provider = await providerFor(kbId).catch(() => undefined);
      const model = repo.getModel();
      if (provider && model && embeddingKey(model) !== embeddingKey(provider.info)) {
        persistState(repo, { status: 'stale' });
        emit({ ...stateFromRepo(kbId, repo), status: 'stale' });
      }
    },

    async retrieve(req, signal) {
      const targets: KbSearchTarget[] = [];
      for (const kbId of req.kbIds) {
        const kbName = readKbName(opts.root, kbId) ?? kbId;
        try {
          const repo = openRepo(kbId);
          if (!repo) {
            targets.push({ kbId, kbName, skipReason: 'empty' });
            continue;
          }
          // 임베딩 제공자를 못 만들면(키 없음 등) 키워드 검색만 한다
          const provider = await providerFor(kbId).catch(() => undefined);
          targets.push({ kbId, kbName, repo, provider });
        } catch (err) {
          targets.push({ kbId, kbName, skipReason: err instanceof Error ? err.message : String(err) });
        }
      }
      return retrieveFrom(targets, req, { signal, now });
    },

    async source(kbId, chunkId) {
      const repo = openRepo(kbId);
      if (!repo) return undefined;
      return sourceFrom({ kbId, kbName: kbId, repo }, chunkId);
    },

    async drop(kbId) {
      // 먼저 표시해서 진행 중 작업이 파일을 다시 만들지 못하게 한다
      dropped.add(kbId);
      const rt = runtime.get(kbId);
      if (rt) {
        rt.mode = undefined;
        rt.controller?.abort();
      }
      const idx = queue.indexOf(kbId);
      if (idx >= 0) queue.splice(idx, 1);
      for (let i = 0; i < 600 && rt?.running; i++) await new Promise((r) => setTimeout(r, 50));
      closeRepo(kbId);
      providers.delete(kbId);
      const dir = kbDir(kbId);
      removeSet(path.join(dir, INDEX_FILE));
      removeSet(path.join(dir, NEXT_INDEX_FILE));
      removeSet(path.join(dir, PREV_INDEX_FILE));
      states.delete(kbId);
    },

    async resume() {
      for (const kbId of listKbIds(opts.root)) {
        if (dropped.has(kbId)) continue;
        try {
          const dir = kbDir(kbId);
          const repo = openRepo(kbId);
          const unfinished = repo?.unfinishedJobs() ?? [];
          // 전체 재생성 도중 멈췄다면 새 파일이 남아 있거나 reindex 작업이 끝나지 않은 상태다
          const fullPending = existsSync(path.join(dir, NEXT_INDEX_FILE)) || unfinished.some((j) => j.kind === 'reindex');
          if (!fullPending && unfinished.length === 0) continue;
          await api.enqueue(kbId, fullPending ? 'full' : 'incremental');
        } catch (err) {
          log(`[rag] ${kbId} 이어하기 건너뜀: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    },

    onState(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    async close() {
      closed = true;
      queue.length = 0;
      for (const rt of runtime.values()) rt.controller?.abort();
      for (let i = 0; i < 600 && pumping; i++) await new Promise((r) => setTimeout(r, 50));
      for (const kbId of [...repos.keys()]) closeRepo(kbId);
    },
  };
  return api;
}

function readKbName(root: string, kbId: string): string | undefined {
  try {
    const raw = JSON.parse(readFileSync(path.join(root, kbId, 'meta.json'), 'utf8')) as { name?: unknown };
    return typeof raw.name === 'string' ? raw.name : undefined;
  } catch {
    return undefined;
  }
}

/** 색인 파일 묶음(본 파일 + WAL·SHM)을 옮긴다. 없는 조각은 건너뛴다 */
function moveSet(from: string, to: string): void {
  for (const sfx of SIDECARS) {
    if (existsSync(`${from}${sfx}`)) renameSync(`${from}${sfx}`, `${to}${sfx}`);
  }
}

function removeSet(base: string): void {
  for (const sfx of SIDECARS) rmSync(`${base}${sfx}`, { force: true });
}

/**
 * 교체 중 중단된 흔적 복구. prev가 남아 있을 때 live가 없으면 prev를 되돌리고,
 * live가 이미 있으면(교체가 끝난 뒤 정리 전에 멈춘 경우) prev를 버린다.
 */
function recoverSwap(dir: string): void {
  const live = path.join(dir, INDEX_FILE);
  const prev = path.join(dir, PREV_INDEX_FILE);
  if (!existsSync(prev)) return;
  if (existsSync(live)) removeSet(prev);
  else moveSet(prev, live);
}

/**
 * 새 색인(next)을 live 자리로 옮긴다. live는 prev로 물러났다가 교체가 성공하면 버린다.
 * 교체 도중 실패하면 prev를 되돌려 기존 색인을 살린다. 호출 전 live 연결은 닫혀 있어야 한다.
 */
function swapIndexFiles(dir: string): void {
  const live = path.join(dir, INDEX_FILE);
  const next = path.join(dir, NEXT_INDEX_FILE);
  const prev = path.join(dir, PREV_INDEX_FILE);
  removeSet(prev);
  moveSet(live, prev);
  try {
    moveSet(next, live);
  } catch (err) {
    removeSet(live);
    moveSet(prev, live);
    throw err;
  }
  removeSet(prev);
}

/** 루트 아래 유효한 KB 디렉터리 이름 (meta.json이 있는 것만) */
export function listKbIds(root: string): string[] {
  try {
    return readdirSync(root, { withFileTypes: true })
      .filter((e) => e.isDirectory() && KB_RE.test(e.name) && existsSync(path.join(root, e.name, 'meta.json')))
      .map((e) => e.name)
      .sort();
  } catch {
    return [];
  }
}

async function defaultFreeBytes(dir: string): Promise<number> {
  await mkdir(dir, { recursive: true });
  const s = await statfs(dir);
  return Number(s.bavail) * Number(s.bsize);
}
