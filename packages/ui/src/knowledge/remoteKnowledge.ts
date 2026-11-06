import {
  KNOWLEDGE_LIMITS,
  SYNC_RPC_LIMITS,
  SyncRpcCallError,
  bytesToBase64,
  isUploadName,
  newId,
  uploadChunkArgs,
} from '@branch/core';
import type {
  DesktopKnowledgeApi,
  KnowledgeAddResult,
  KnowledgeBase,
  KnowledgeDoc,
  KnowledgeEntry,
  KnowledgeIndexSettings,
  KnowledgeIndexState,
  KnowledgePreview,
  KnowledgeProgress,
  KnowledgeSource,
  SourceView,
  SyncEventTopic,
  SyncRpcMethod,
} from '@branch/core';
import { t } from '@branch/core/i18n';

/** 원격 업로드 한 파일. bytes는 조각을 만들 때 한 번만 읽는다 */
export interface UploadSource {
  name: string;
  size: number;
  bytes: () => Promise<Uint8Array>;
}

export type RemoteRpc = <T = unknown>(method: SyncRpcMethod, args?: unknown[], opts?: { timeoutMs?: number }) => Promise<T>;

export interface RemoteKnowledgeDeps {
  rpc: RemoteRpc;
  onEvent: (listener: (topic: SyncEventTopic, data: unknown) => void) => () => void;
  /** OS 파일 선택 창 (취소하면 빈 배열). 호출은 사용자 제스처 안에서 동기로 시작해야 한다 */
  pickFiles: () => Promise<UploadSource[]>;
  sleep?: (ms: number) => Promise<void>;
}

const UPLOAD_TIMEOUT_MS = 30_000;
const RATE_LIMIT_RETRIES = 6;

const emptyResult = (): KnowledgeAddResult => ({ added: [], skipped: 0 });

/** PC가 권한 없음(forbidden)으로 거절했는가 */
export function isRemoteForbidden(e: unknown): boolean {
  return e instanceof SyncRpcCallError && e.code === 'forbidden';
}

/**
 * 원격(휴대폰·웹·세션 창)에서 PC의 지식베이스를 다루는 DesktopKnowledgeApi.
 * 순수 모듈: rpc·이벤트·파일 선택을 주입받아 노드 테스트가 가능하다.
 * retrieve는 두지 않는다(검색·답변은 PC에서 실행).
 */
export function createRemoteKnowledgeApi(deps: RemoteKnowledgeDeps): DesktopKnowledgeApi {
  const { rpc } = deps;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const localListeners = new Set<(p: KnowledgeProgress) => void>();
  let cancelled = false;

  const emitLocal = (p: KnowledgeProgress) => {
    for (const l of localListeners) l(p);
  };

  /** 한 파일을 조각 단위로 보낸다. 마지막 조각의 응답이 결과다 */
  async function uploadOne(kbId: string, src: UploadSource, dest: string | undefined, progress: { bytes: number; total: number; files: number }): Promise<KnowledgeAddResult> {
    const uploadId = newId('up');
    const size = src.size;
    const total = Math.max(1, Math.ceil(size / SYNC_RPC_LIMITS.chunkBytes));
    const data = await src.bytes();
    let last: KnowledgeAddResult = emptyResult();
    for (let index = 0; index < total; index++) {
      if (cancelled) throw new Error(t('knowledge.progress.cancelled'));
      const start = index * SYNC_RPC_LIMITS.chunkBytes;
      const part = data.subarray(start, Math.min(size, start + SYNC_RPC_LIMITS.chunkBytes));
      const args = uploadChunkArgs({ kbId, uploadId, name: src.name, index, total, size, data: bytesToBase64(part), ...(dest ? { dest } : {}) });
      const res = await callWithRetry(args);
      if (index === total - 1) last = res as KnowledgeAddResult;
      progress.bytes += part.length;
      emitLocal({
        phase: 'copy',
        ratio: progress.total ? progress.bytes / progress.total : 1,
        files: progress.files,
        bytes: progress.bytes,
      });
    }
    return last;
  }

  async function callWithRetry(args: unknown[]): Promise<unknown> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await rpc('knowledge.upload', args, { timeoutMs: UPLOAD_TIMEOUT_MS });
      } catch (e) {
        if (e instanceof SyncRpcCallError && e.code === 'rate-limit' && attempt < RATE_LIMIT_RETRIES) {
          await sleep(1000 * (attempt + 1));
          continue;
        }
        throw e;
      }
    }
  }

  /** 크기·이름 규칙을 먼저 걸러 건너뛴 수로 센다 (PC addFiles와 같은 의미) */
  async function uploadFiles(kbId: string, sources: UploadSource[], dest?: string): Promise<KnowledgeAddResult> {
    cancelled = false;
    const ok: UploadSource[] = [];
    let skipped = 0;
    for (const s of sources) {
      if (s.size > KNOWLEDGE_LIMITS.fileBytes || !isUploadName(s.name) || s.name.length > SYNC_RPC_LIMITS.fileName) skipped++;
      else ok.push(s);
    }
    const total = ok.reduce((sum, s) => sum + s.size, 0);
    const progress = { bytes: 0, total, files: 0 };
    const added: string[] = [];
    if (ok.length) emitLocal({ phase: 'copy', ratio: 0, files: 0, bytes: 0 });
    for (const src of ok) {
      const res = await uploadOne(kbId, src, dest, progress);
      added.push(...res.added);
      skipped += res.skipped;
      progress.files++;
    }
    return { added, skipped };
  }

  return {
    list: () => rpc<KnowledgeBase[]>('knowledge.list'),
    create: (name) => rpc<KnowledgeBase>('knowledge.create', [name]),
    rename: (id, name) => rpc<KnowledgeBase>('knowledge.rename', [id, name]),
    remove: (id) => rpc<void>('knowledge.remove', [id]),
    // 이전 버전 PC는 dir 인자를 거절한다: 그때는 전체 목록을 받는다 (화면이 경로로 합친다)
    tree: (id, dir) =>
      dir === undefined
        ? rpc<KnowledgeEntry[]>('knowledge.tree', [id])
        : rpc<KnowledgeEntry[]>('knowledge.tree', [id, dir]).catch((e: unknown) => {
            if (e instanceof SyncRpcCallError && e.code === 'invalid') return rpc<KnowledgeEntry[]>('knowledge.tree', [id]);
            throw e;
          }),
    pathForFile: () => '',
    addPaths: async () => {
      throw new Error(t('knowledge.remote.noOpen'));
    },
    addFiles: (id, files, dest) =>
      uploadFiles(
        id,
        files.map((f) => ({ name: f.name, size: f.data.length, bytes: async () => f.data })),
        dest,
      ),
    pickFiles: async (id, dest) => {
      const picked = await deps.pickFiles();
      if (!picked.length) return emptyResult();
      return uploadFiles(id, picked, dest);
    },
    addLink: (id, url) => rpc<KnowledgeAddResult>('knowledge.addLink', [id, url]),
    cloneGit: (id, url) => rpc<KnowledgeAddResult>('knowledge.cloneGit', [id, url]),
    removeEntry: (id, path) => rpc<void>('knowledge.removeEntry', [id, path]),
    preview: (id, path) => rpc<KnowledgePreview>('knowledge.preview', [id, path]),
    open: async () => {
      throw new Error(t('knowledge.remote.noOpen'));
    },
    onProgress: (listener) => {
      localListeners.add(listener);
      const off = deps.onEvent((topic, data) => {
        if (topic === 'knowledge.progress') listener(data as KnowledgeProgress);
      });
      return () => {
        localListeners.delete(listener);
        off();
      };
    },
    cancel: async () => {
      cancelled = true;
      await rpc<void>('knowledge.cancel');
    },
    setDescription: (id, description) => rpc<KnowledgeBase>('knowledge.setDescription', [id, description]),
    indexStates: (ids) => rpc<KnowledgeIndexState[]>('knowledge.indexStates', ids ? [ids] : []),
    reindex: (id, opts) => rpc<void>('knowledge.reindex', opts ? [id, opts] : [id]),
    cancelIndex: (id) => rpc<void>('knowledge.cancelIndex', [id]),
    docs: (id, query) => rpc<KnowledgeDoc[]>('knowledge.docs', query ? [id, query] : [id]),
    getIndexSettings: (id) => rpc<KnowledgeIndexSettings>('knowledge.getIndexSettings', [id]),
    setIndexSettings: (id, s) => rpc<KnowledgeIndexState>('knowledge.setIndexSettings', [id, s]),
    sources: (id) => rpc<KnowledgeSource[]>('knowledge.sources', [id]),
    updateSource: (id, sourceId) => rpc<KnowledgeAddResult>('knowledge.updateSource', [id, sourceId]),
    source: (kbId, chunkId) => rpc<SourceView>('knowledge.source', [kbId, chunkId]),
    onIndexState: (listener) =>
      deps.onEvent((topic, data) => {
        if (topic === 'knowledge.index') listener(data as KnowledgeIndexState);
      }),
  };
}
