import { app, BrowserWindow, ipcMain, shell, type WebContents } from 'electron';
import path from 'node:path';
import { createBridgeServer, type BridgeConnection } from '@branch/bridge';
import type { BridgeClientMsg } from '@branch/core';
import { CH } from './ipc';
import { createSecretVault } from './secrets';

/**
 * rhymebook 데스크톱 main 프로세스.
 * - bridge를 내장: 렌더러가 IPC로 보낸 요청을 공식 CLI 무상태 실행으로 처리한다.
 * - 비밀 값은 safeStorage로 암호화해 userData에 저장한다.
 */
const DEV_URL = process.env.BRANCH_DEV_URL;
const RENDERER = path.join(__dirname, 'renderer', 'index.html');

if (process.env.BRANCH_USER_DATA) app.setPath('userData', process.env.BRANCH_USER_DATA);

const bridge = createBridgeServer({
  log: (m) => {
    if (process.env.BRANCH_BRIDGE_LOG) console.log(`[bridge] ${m}`);
  },
});

/** webContents마다 bridge 연결 하나. 새로고침/종료 시 진행 중 CLI를 멈춘다 */
const connections = new Map<number, BridgeConnection>();
const watched = new Set<number>();

function connectionFor(wc: WebContents): BridgeConnection {
  let conn = connections.get(wc.id);
  if (conn) return conn;
  conn = bridge.connect((msg) => {
    if (!wc.isDestroyed()) wc.send(CH.bridgeMsg, msg);
  });
  connections.set(wc.id, conn);
  if (!watched.has(wc.id)) {
    watched.add(wc.id);
    const drop = () => {
      connections.get(wc.id)?.close();
      connections.delete(wc.id);
    };
    wc.once('destroyed', () => {
      drop();
      watched.delete(wc.id);
    });
    // 해시 변경(같은 문서)은 무시하고 새로고침/페이지 이동만
    wc.on('did-start-navigation', (details) => {
      if (details.isMainFrame && !details.isSameDocument) drop();
    });
  }
  return conn;
}

function isClientMsg(v: unknown): v is BridgeClientMsg {
  if (typeof v !== 'object' || v === null) return false;
  const m = v as { type?: unknown; reqId?: unknown };
  return typeof m.reqId === 'string' && (m.type === 'status.get' || m.type === 'chat.start' || m.type === 'chat.abort');
}

function isAppUrl(url: string): boolean {
  if (DEV_URL) return url.startsWith(DEV_URL);
  return url.startsWith('file://');
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 360,
    minHeight: 560,
    title: 'rhymebook',
    backgroundColor: '#111113',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  // 외부 링크는 기본 브라우저로, 앱 밖으로의 이동은 막는다
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!isAppUrl(url)) {
      e.preventDefault();
      if (/^https?:\/\//.test(url)) void shell.openExternal(url);
    }
  });
  if (DEV_URL) void win.loadURL(DEV_URL);
  else void win.loadFile(RENDERER);
}

void app.whenReady().then(() => {
  const vault = createSecretVault(app.getPath('userData'));

  ipcMain.on(CH.secretPersistent, (e) => {
    e.returnValue = vault.persistent;
  });
  ipcMain.handle(CH.secretGet, (_e, name: unknown) => (typeof name === 'string' ? vault.get(name) : null));
  ipcMain.handle(CH.secretSet, (_e, name: unknown, value: unknown) => {
    if (typeof name === 'string' && typeof value === 'string') vault.set(name, value);
  });
  ipcMain.handle(CH.secretDelete, (_e, name: unknown) => {
    if (typeof name === 'string') vault.delete(name);
  });
  ipcMain.on(CH.bridgeSend, (e, msg: unknown) => {
    if (isClientMsg(msg)) connectionFor(e.sender).receive(msg);
  });

  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => bridge.shutdown());
