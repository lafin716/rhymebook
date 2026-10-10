import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type { BridgeServerMsg, DesktopApi } from '@branch/core';
import { CH } from './ipc';

// 렌더러에는 좁은 API만 노출한다 (ipcRenderer 자체는 노출하지 않음)
const persistent = ipcRenderer.sendSync(CH.secretPersistent) === true;

const api: DesktopApi = {
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
};

contextBridge.exposeInMainWorld('branchDesktop', api);
