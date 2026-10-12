import { app, BrowserWindow, ipcMain, shell, Menu, Tray, Notification, type WebContents } from 'electron';
import path from 'node:path';
import { createBridgeServer, type BridgeConnection } from '@branch/bridge';
import { isHostPolicy, isSyncServerMsg, type BridgeClientMsg, type HostState, type SyncServerMsg, type SyncClientMsg } from '@branch/core';
import { createHostService, type HostService } from './host';
import { CH } from './ipc';
import { createSecretVault } from './secrets';

/**
 * rhymebook 데스크톱 main 프로세스.
 * - bridge를 내장: 렌더러가 IPC로 보낸 요청을 공식 CLI 무상태 실행으로 처리한다.
 * - 비밀 값은 safeStorage로 암호화해 userData에 저장한다.
 * - 원격 페어링 호스트(ADR-025): 켜면 이 PC를 휴대폰·웹이 페어링해 쓰는 bridge로 연다.
 */
const DEV_URL = process.env.BRANCH_DEV_URL;
const RENDERER = path.join(__dirname, 'renderer', 'index.html');

if (process.env.BRANCH_USER_DATA) app.setPath('userData', process.env.BRANCH_USER_DATA);

const bridge = createBridgeServer({
  log: (m) => {
    if (process.env.BRANCH_BRIDGE_LOG) console.log(`[bridge] ${m}`);
  },
});

/** 원격 페어링 호스트 (whenReady에서 만든다) */
let host: HostService | null = null;

/** webContents마다 bridge 연결 하나. 새로고침/종료 시 진행 중 CLI를 멈춘다 */
const connections = new Map<number, BridgeConnection>();
const watched = new Set<number>();

/** 동기화 호스트 엔진 창 (첫 번째 창이 엔진) */
let engineWindow: WebContents | null = null;
let syncReady = false;

/** macOS: Cmd+Q 등 정상 종료 플래그. true면 close 이벤트에서 숨기지 않는다 */
let quitting = false;

/** 호스트 서버 활성화 상태 (백그라운드 스로틀링 제어용) */
let hostEnabled = false;

/** 트레이 아이콘 */
let tray: Tray | null = null;

/** 첫 숨김 알림 표시 여부 */
let hasShownBackgroundNotification = false;

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

/** 트레이 아이콘 경로 — build.mjs가 dist(main.cjs 옆)에 복사하고, 패키지에서는 app.asar 안에서 읽는다 */
function getTrayIconPath(): string {
  return path.join(__dirname, 'trayIcon.png');
}

function createWindow(): BrowserWindow {
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
  return win;
}

/** Create tray with context menu */
function createTray(hostState: HostState): Tray | null {
  const iconPath = getTrayIconPath();
  try {
    const newTray = new Tray(iconPath);
    updateTrayMenu(newTray, hostState);
    newTray.setToolTip('rhymebook — 원격 연결 실행 중');

    // Left-click on Windows/Linux opens the window
    if (process.platform !== 'darwin') {
      newTray.on('click', () => {
        showOrCreateWindow();
      });
    }

    return newTray;
  } catch (e) {
    console.error('Failed to create tray:', e);
    return null;
  }
}

/** Show existing window or create new one */
function showOrCreateWindow() {
  const existing = BrowserWindow.getAllWindows();
  const visible = existing.find((w) => w.isVisible());
  if (visible) {
    visible.focus();
    return;
  }
  const hidden = existing.find((w) => !w.isDestroyed());
  if (hidden) {
    showWindow(hidden);
    return;
  }
  spawnEngineWindow?.();
}

/** 엔진 창 새로 만들기 (whenReady에서 연결) */
let spawnEngineWindow: (() => void) | null = null;

/** Build and set tray menu */
function updateTrayMenu(trayIcon: Tray, hostState: HostState) {
  const menu = Menu.buildFromTemplate([
    {
      label: 'rhymebook 열기',
      click: () => {
        showOrCreateWindow();
      },
    },
    {
      type: 'separator',
    },
    {
      label: `원격 연결: ${hostState.enabled ? '켜짐' : '꺼짐'}${hostState.devices ? ' · 기기 ' + hostState.devices.length + '대' : ''}`,
      enabled: false,
    },
    {
      type: 'separator',
    },
    {
      label: '완전 종료',
      click: () => {
        quitting = true;
        app.quit();
      },
    },
  ]);
  trayIcon.setContextMenu(menu);
}

/** Destroy tray */
function destroyTray() {
  if (tray) {
    tray.destroy();
    tray = null;
  }
}

/** Handle window close: hide if hostEnabled, otherwise use default behavior */
function attachCloseHandler(win: BrowserWindow) {
  win.on('close', (e) => {
    if (hostEnabled && !quitting) {
      e.preventDefault();
      hideWindow(win);
    }
  });
}

/** Hide window and show notification on first hide */
function hideWindow(win: BrowserWindow) {
  win.hide();
  if (process.platform === 'darwin' && app.dock) {
    app.dock.hide();
  }
  if (!hasShownBackgroundNotification && Notification.isSupported()) {
    hasShownBackgroundNotification = true;
    const notification = new Notification({
      title: 'rhymebook이 백그라운드에서 계속 실행 중입니다',
      body: '페어링된 기기에서 계속 사용할 수 있어요. 완전히 끄려면 트레이 아이콘에서 [완전 종료]를 누르세요.',
    });
    notification.show();
  }
}

/** Show window */
function showWindow(win: BrowserWindow) {
  win.show();
  win.focus();
  if (process.platform === 'darwin' && app.dock) {
    app.dock.show();
  }
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

  // 동기화 IPC 핸들러
  ipcMain.on(CH.hostSyncReady, (_e, ready: unknown) => {
    syncReady = ready === true;
    if (syncReady && host) {
      // Engine is ready, broadcast sync.reset to all clients
      host.broadcastSync?.({ type: 'sync.reset' });
    }
  });

  ipcMain.on(CH.hostSyncOut, (e, data: unknown) => {
    // Validate sender is the engine window
    if (e.sender !== engineWindow) return;
    if (!data || typeof data !== 'object') return;
    const m = data as { peerId?: unknown; msg?: unknown };
    if (typeof m.peerId !== 'string' || !m.msg) return;

    // Validate message is a SyncServerMsg
    if (!isSyncServerMsg(m.msg)) return;

    host?.syncSend?.(m.peerId, m.msg as SyncServerMsg);
  });

  /** 엔진 창에 이벤트 리스너를 붙인다 */
  function attachEngineListeners(wc: WebContents) {
    // 네비게이션 시작: 같은 문서(해시 변경) 제외, 새로고침/이동만 인지
    wc.on('did-start-navigation', (details) => {
      if (details.isMainFrame && !details.isSameDocument) {
        syncReady = false;
      }
    });
    wc.once('destroyed', () => {
      syncReady = false;
      if (engineWindow === wc) engineWindow = null;
    });
    wc.on('render-process-gone', () => {
      syncReady = false;
    });
  }

  const broadcast = (state: HostState) => {
    for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send(CH.hostChanged, state);
    // 호스트 활성화 상태에 따라 트레이 생성/제거
    if (state.enabled && !tray) {
      tray = createTray(state);
    } else if (!state.enabled && tray) {
      destroyTray();
    } else if (tray) {
      updateTrayMenu(tray, state);
    }
  };
  host = createHostService({
    dir: app.getPath('userData'),
    emit: broadcast,
    log: (m) => {
      if (process.env.BRANCH_BRIDGE_LOG) console.log(`[host] ${m}`);
    },
    sync: {
      receive(peerId: string, _deviceId: string, msg: SyncClientMsg) {
        // Route sync message to the engine window
        if (!syncReady) {
          // Engine not ready, respond with error
          host?.syncSend?.(peerId, { type: 'sync.error', error: 'not-ready' });
          return;
        }
        if (engineWindow && !engineWindow.isDestroyed()) {
          engineWindow.send(CH.hostSyncIn, { peerId, msg });
        }
      },
      peerGone(peerId: string) {
        // Notify engine about peer disconnection
        if (engineWindow && !engineWindow.isDestroyed()) {
          engineWindow.send(CH.hostSyncGone, peerId);
        }
      },
    },
  });
  const h = host;

  /** 백그라운드 스로틀링을 호스트 상태에 맞춰 적용 */
  const applyThrottling = () => {
    if (engineWindow && !engineWindow.isDestroyed()) {
      engineWindow.setBackgroundThrottling(!hostEnabled);
    }
  };

  // 상태를 바꾸는 호출은 결과를 모든 창에 알린다
  const changed = async (p: Promise<HostState>) => {
    const state = await p;
    broadcast(state);
    return state;
  };
  ipcMain.handle(CH.hostGet, () => h.state());
  ipcMain.handle(CH.hostSetEnabled, (_e, on: unknown) => {
    hostEnabled = on === true;
    applyThrottling();
    return changed(h.setEnabled(on === true));
  });
  ipcMain.handle(CH.hostSetRelay, (_e, url: unknown) => changed(h.setRelay(typeof url === 'string' ? url : null)));
  ipcMain.handle(CH.hostStartPairing, () => changed(h.startPairing()));
  ipcMain.handle(CH.hostCancelPairing, () => changed(h.cancelPairing()));
  ipcMain.handle(CH.hostUnpair, (_e, id: unknown) => (typeof id === 'string' ? changed(h.unpair(id)) : h.state()));
  ipcMain.handle(CH.hostSetPolicy, (_e, policy: unknown) => {
    if (isHostPolicy(policy)) h.setPolicy(policy);
  });

  // 시작 시 호스트 상태 복원 및 hostEnabled 초기화 (켜져 있으면 트레이도 만든다)
  void h.restore().then(async () => {
    const state = await h.state();
    hostEnabled = state.enabled;
    applyThrottling();
    broadcast(state);
  });

  spawnEngineWindow = () => {
    const w = createWindow();
    engineWindow = w.webContents;
    attachEngineListeners(engineWindow);
    applyThrottling();
    attachCloseHandler(w);
  };
  spawnEngineWindow();

  app.on('activate', () => {
    const existing = BrowserWindow.getAllWindows();
    if (existing.length > 0) {
      // 숨겨진 창이 있으면 보여주기
      const hidden = existing.find((w) => !w.isVisible());
      if (hidden) {
        showWindow(hidden);
      }
    } else {
      // 창이 없으면 새로 만들기
      spawnEngineWindow?.();
    }
  });
});

app.on('window-all-closed', () => {
  // 호스트가 켜져 있고 창이 숨겨져 있으면 앱을 끝내지 않는다
  if (hostEnabled && BrowserWindow.getAllWindows().some((w) => !w.isDestroyed())) {
    return;
  }
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  quitting = true;
  bridge.shutdown();
  void host?.shutdown();
});
