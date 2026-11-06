import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron';
import type { BridgeServerMsg, DesktopApi, HostState, IndexIntegrityReport, KnowledgeAddResult, KnowledgeBase, KnowledgeCreateOptions, KnowledgeFolderInspection, KnowledgeKind, KnowledgeDoc, KnowledgeEntry, KnowledgeIndexSettings, KnowledgeIndexState, KnowledgePreview, KnowledgeProgress, KnowledgeSource, RetrievalRequest, RetrievalResult, SourceView, SkillFolder, SttModelId, SttState, SyncClientMsg, SyncServerMsg, UpdateState } from '@branch/core';
import { CH } from './ipc';

/** DesktopApi.sync with onPeerGone extension (ADR-026) */
type DesktopSyncApi = {
  ready(on: boolean): void;
  send(peerId: string, msg: SyncServerMsg): void;
  onMessage(cb: (peerId: string, msg: SyncClientMsg) => void): () => void;
  onPeerGone(cb: (peerId: string) => void): () => void;
};

/** DesktopApi + onPeerGone extension */
type DesktopApiExt = Omit<DesktopApi, 'sync'> & { sync?: DesktopSyncApi };

// 렌더러에는 좁은 API만 노출한다 (ipcRenderer 자체는 노출하지 않음)
const persistent = ipcRenderer.sendSync(CH.secretPersistent) === true;
const skillsRoot = String(ipcRenderer.sendSync(CH.skillsRoot) ?? '');

// DesktopApi 타입을 확장해서 onPeerGone을 추가로 노출한다
const api: DesktopApiExt = {
  platform: process.platform,
  setLocale: (locale) => ipcRenderer.send(CH.setLocale, locale),
  notifications: {
    supported: () => ipcRenderer.invoke(CH.notificationSupported) as Promise<boolean>,
    show: (input) => ipcRenderer.invoke(CH.notificationShow, input) as Promise<boolean>,
    onClick(listener) {
      const h = (_e: IpcRendererEvent, id: unknown) => { if (typeof id === 'string') listener(id); };
      ipcRenderer.on(CH.notificationClick, h);
      return () => ipcRenderer.removeListener(CH.notificationClick, h);
    },
  },
  bridge: {
    send: (msg) => ipcRenderer.send(CH.bridgeSend, msg),
    onMessage(listener) {
      const h = (_e: IpcRendererEvent, msg: BridgeServerMsg) => listener(msg);
      ipcRenderer.on(CH.bridgeMsg, h);
      return () => ipcRenderer.removeListener(CH.bridgeMsg, h);
    },
  },
  secrets: {
    persistent,
    get: (name) => ipcRenderer.invoke(CH.secretGet, name) as Promise<string | null>,
    set: (name, value) => ipcRenderer.invoke(CH.secretSet, name, value) as Promise<void>,
    delete: (name) => ipcRenderer.invoke(CH.secretDelete, name) as Promise<void>,
  },
  host: {
    getState: () => ipcRenderer.invoke(CH.hostGet) as Promise<HostState>,
    setEnabled: (enabled) => ipcRenderer.invoke(CH.hostSetEnabled, enabled) as Promise<HostState>,
    setRelay: (url) => ipcRenderer.invoke(CH.hostSetRelay, url) as Promise<HostState>,
    startPairing: () => ipcRenderer.invoke(CH.hostStartPairing) as Promise<HostState>,
    cancelPairing: () => ipcRenderer.invoke(CH.hostCancelPairing) as Promise<HostState>,
    unpair: (idOrAll) => ipcRenderer.invoke(CH.hostUnpair, idOrAll) as Promise<HostState>,
    setPolicy: (policy) => ipcRenderer.invoke(CH.hostSetPolicy, policy) as Promise<void>,
    onChange(listener) {
      const h = (_e: IpcRendererEvent, state: HostState) => listener(state);
      ipcRenderer.on(CH.hostChanged, h);
      return () => ipcRenderer.removeListener(CH.hostChanged, h);
    },
    sync: {
      ready(on: boolean) {
        ipcRenderer.send(CH.hostSyncReady, on);
      },
      send(peerId: string, msg: SyncServerMsg) {
        ipcRenderer.send(CH.hostSyncOut, { peerId, msg });
      },
      onMessage(cb: (peerId: string, msg: SyncClientMsg) => void) {
        const h = (_e: IpcRendererEvent, data: unknown) => {
          if (data && typeof data === 'object') {
            const d = data as { peerId?: unknown; msg?: unknown };
            if (typeof d.peerId === 'string') {
              cb(d.peerId, d.msg as SyncClientMsg);
            }
          }
        };
        ipcRenderer.on(CH.hostSyncIn, h);
        return () => ipcRenderer.removeListener(CH.hostSyncIn, h);
      },
      onPeerGone(cb: (peerId: string) => void) {
        const h = (_e: IpcRendererEvent, peerId: unknown) => {
          if (typeof peerId === 'string') cb(peerId);
        };
        ipcRenderer.on(CH.hostSyncGone, h);
        return () => ipcRenderer.removeListener(CH.hostSyncGone, h);
      },
    } as DesktopSyncApi,
  },
  // 세션 창 (ADR-036). link는 main이 세션 창으로 연 창에서만 동작한다
  windows: {
    openSession: (sessionId) => ipcRenderer.send(CH.winOpenSession, sessionId),
    link: {
      send: (msg) => ipcRenderer.send(CH.winSyncOut, msg),
      onMessage(cb) {
        const h = (_e: IpcRendererEvent, msg: SyncServerMsg) => cb(msg);
        ipcRenderer.on(CH.winSyncIn, h);
        return () => ipcRenderer.removeListener(CH.winSyncIn, h);
      },
    },
    // 발표 청중 창
    present: {
      open: (sessionId) => ipcRenderer.send(CH.presentOpen, sessionId),
      send: (msg) => ipcRenderer.send(CH.presentSend, msg),
      onMessage(cb) {
        const h = (_e: IpcRendererEvent, msg: unknown) => cb(msg as Record<string, unknown>);
        ipcRenderer.on(CH.presentRecv, h);
        return () => ipcRenderer.removeListener(CH.presentRecv, h);
      },
      close: () => ipcRenderer.send(CH.presentClose),
    },
  },
  // 스킬 폴더 (IMP-12, ADR-038). main이 이름·경로를 다시 확인한다
  skills: {
    root: skillsRoot,
    write: (folder, opts) => ipcRenderer.invoke(CH.skillsWrite, folder, opts) as Promise<void>,
    remove: (name) => ipcRenderer.invoke(CH.skillsRemove, name) as Promise<void>,
    open: (folder) => ipcRenderer.invoke(CH.skillsOpen, folder) as Promise<void>,
    readAll: () => ipcRenderer.invoke(CH.skillsReadAll) as Promise<SkillFolder[]>,
  },
  // 책 PDF (ADR-044)
  pdf: {
    fromHtml: (html) => ipcRenderer.invoke(CH.pdfFromHtml, html) as Promise<Uint8Array>,
  },
  // 학습별 지식베이스 (ADR-107). main이 id·경로·URL·크기를 다시 확인한다
  knowledge: {
    list: () => ipcRenderer.invoke(CH.knowledgeList) as Promise<KnowledgeBase[]>,
    create: (name: string, opts?: KnowledgeCreateOptions) =>
      ipcRenderer.invoke(CH.knowledgeCreate, name, opts) as Promise<KnowledgeBase>,
    rename: (id: string, name: string) => ipcRenderer.invoke(CH.knowledgeRename, id, name) as Promise<KnowledgeBase>,
    remove: (id: string) => ipcRenderer.invoke(CH.knowledgeRemove, id) as Promise<void>,
    tree: (id: string, dir?: string) => ipcRenderer.invoke(CH.knowledgeTree, id, dir) as Promise<KnowledgeEntry[]>,
    // 끌어다 놓은 파일의 절대 경로. 못 얻으면 ''
    pathForFile(file: File): string {
      try {
        return webUtils.getPathForFile(file) || '';
      } catch {
        return '';
      }
    },
    addPaths: (id: string, paths: string[], dest?: string) =>
      ipcRenderer.invoke(CH.knowledgeAddPaths, id, paths, dest) as Promise<KnowledgeAddResult>,
    addFiles: (id: string, files: { name: string; data: Uint8Array }[], dest?: string) =>
      ipcRenderer.invoke(CH.knowledgeAddFiles, id, files, dest) as Promise<KnowledgeAddResult>,
    pickFiles: (id: string, dest?: string) =>
      ipcRenderer.invoke(CH.knowledgePickFiles, id, dest) as Promise<KnowledgeAddResult>,
    addLink: (id: string, url: string) =>
      ipcRenderer.invoke(CH.knowledgeAddLink, id, url) as Promise<KnowledgeAddResult>,
    cloneGit: (id: string, url: string) =>
      ipcRenderer.invoke(CH.knowledgeCloneGit, id, url) as Promise<KnowledgeAddResult>,
    removeEntry: (id: string, path: string) => ipcRenderer.invoke(CH.knowledgeRemoveEntry, id, path) as Promise<void>,
    preview: (id: string, path: string) =>
      ipcRenderer.invoke(CH.knowledgePreview, id, path) as Promise<KnowledgePreview>,
    open: (id: string, path?: string) => ipcRenderer.invoke(CH.knowledgeOpen, id, path) as Promise<void>,
    // 가져오기 진행률 (main이 100ms 간격으로 보낸다)
    onProgress(listener: (p: KnowledgeProgress) => void) {
      const h = (_e: unknown, p: KnowledgeProgress) => listener(p);
      ipcRenderer.on(CH.knowledgeProgress, h);
      return () => {
        ipcRenderer.removeListener(CH.knowledgeProgress, h);
      };
    },
    cancel: () => ipcRenderer.invoke(CH.knowledgeCancel) as Promise<void>,
    // ── 색인·검색 (ADR-113). main은 id·설정을 검증하고 worker에 전달만 한다 ──
    setDescription: (id: string, description: string) =>
      ipcRenderer.invoke(CH.knowledgeSetDescription, id, description) as Promise<KnowledgeBase>,
    indexStates: (ids?: string[]) =>
      ipcRenderer.invoke(CH.knowledgeIndexStates, ids) as Promise<KnowledgeIndexState[]>,
    reindex: (id: string, opts?: { full?: boolean; paths?: string[]; retryFailed?: boolean }) =>
      ipcRenderer.invoke(CH.knowledgeReindex, id, opts) as Promise<void>,
    cancelIndex: (id: string) => ipcRenderer.invoke(CH.knowledgeCancelIndex, id) as Promise<void>,
    docs: (id: string, query?: string) =>
      ipcRenderer.invoke(CH.knowledgeDocs, id, query) as Promise<KnowledgeDoc[]>,
    getIndexSettings: (id: string) =>
      ipcRenderer.invoke(CH.knowledgeGetIndexSettings, id) as Promise<KnowledgeIndexSettings>,
    setIndexSettings: (id: string, s: KnowledgeIndexSettings) =>
      ipcRenderer.invoke(CH.knowledgeSetIndexSettings, id, s) as Promise<KnowledgeIndexState>,
    setKind: (id: string, kind: KnowledgeKind) => ipcRenderer.invoke(CH.knowledgeSetKind, id, kind) as Promise<KnowledgeBase>,
    setExcludes: (id: string, excludes: string[]) =>
      ipcRenderer.invoke(CH.knowledgeSetExcludes, id, excludes) as Promise<KnowledgeBase>,
    pickFolder: () => ipcRenderer.invoke(CH.knowledgePickFolder) as Promise<string | null>,
    inspectFolder: (path: string) =>
      ipcRenderer.invoke(CH.knowledgeInspectFolder, path) as Promise<KnowledgeFolderInspection>,
    verifyIndex: (id: string) => ipcRenderer.invoke(CH.knowledgeVerifyIndex, id) as Promise<IndexIntegrityReport>,
    restoreIndexBackup: (id: string) => ipcRenderer.invoke(CH.knowledgeRestoreIndexBackup, id) as Promise<boolean>,
    sources: (id: string) => ipcRenderer.invoke(CH.knowledgeSources, id) as Promise<KnowledgeSource[]>,
    updateSource: (id: string, sourceId: string) =>
      ipcRenderer.invoke(CH.knowledgeUpdateSource, id, sourceId) as Promise<KnowledgeAddResult>,
    retrieve: (req: RetrievalRequest, requestId?: string) =>
      ipcRenderer.invoke(CH.knowledgeRetrieve, req, requestId) as Promise<RetrievalResult>,
    cancelRetrieve: (requestId: string) => ipcRenderer.invoke(CH.knowledgeRetrieveCancel, requestId) as Promise<void>,
    source: (kbId: string, chunkId: string) =>
      ipcRenderer.invoke(CH.knowledgeSource, kbId, chunkId) as Promise<SourceView>,
    onIndexState(listener: (s: KnowledgeIndexState) => void) {
      const h = (_e: unknown, s: KnowledgeIndexState) => listener(s);
      ipcRenderer.on(CH.knowledgeIndexState, h);
      return () => {
        ipcRenderer.removeListener(CH.knowledgeIndexState, h);
      };
    },
  },
  // 음성 입력 관리 (ADR-045). 전사 자체는 bridge 메시지로 한다
  stt: {
    getState: () => ipcRenderer.invoke(CH.sttState) as Promise<SttState>,
    setEnabled: (enabled: boolean) => ipcRenderer.invoke(CH.sttSetEnabled, enabled) as Promise<SttState>,
    setModel: (model: SttModelId) => ipcRenderer.invoke(CH.sttSetModel, model) as Promise<SttState>,
    download: (model: SttModelId) => ipcRenderer.invoke(CH.sttDownload, model) as Promise<SttState>,
    cancelDownload: () => ipcRenderer.invoke(CH.sttCancel) as Promise<SttState>,
    remove: (model: SttModelId) => ipcRenderer.invoke(CH.sttRemove, model) as Promise<SttState>,
    onChange(listener: (state: SttState) => void) {
      const h = (_e: IpcRendererEvent, state: SttState) => listener(state);
      ipcRenderer.on(CH.sttChanged, h);
      return () => ipcRenderer.removeListener(CH.sttChanged, h);
    },
  },
  // 앱 업데이트 (ADR-118). 인자 없는 호출만 노출한다 (주소·경로는 main이 정한다)
  updater: {
    getState: () => ipcRenderer.invoke(CH.updateState) as Promise<UpdateState>,
    check: () => ipcRenderer.invoke(CH.updateCheck) as Promise<UpdateState>,
    download: () => ipcRenderer.invoke(CH.updateDownload) as Promise<UpdateState>,
    install: () => ipcRenderer.invoke(CH.updateInstall) as Promise<boolean>,
    openRelease: () => ipcRenderer.invoke(CH.updateOpenRelease) as Promise<boolean>,
    onChange(listener: (state: UpdateState) => void) {
      const h = (_e: IpcRendererEvent, state: UpdateState) => listener(state);
      ipcRenderer.on(CH.updateChanged, h);
      return () => ipcRenderer.removeListener(CH.updateChanged, h);
    },
  },
};

contextBridge.exposeInMainWorld('branchDesktop', api);
