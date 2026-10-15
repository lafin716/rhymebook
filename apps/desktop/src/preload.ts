import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type { BridgeServerMsg, DesktopApi, HostState, SkillFolder, SttModelId, SttState, SyncClientMsg, SyncServerMsg } from '@branch/core';
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
};

contextBridge.exposeInMainWorld('branchDesktop', api);
