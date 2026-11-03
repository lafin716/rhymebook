import { app, BrowserWindow, ipcMain, shell, Menu, Tray, Notification, screen, type WebContents } from 'electron';
import path from 'node:path';
import { mkdirSync } from 'node:fs';
import { createBridgeServer, createSkillsDir, createSttEngine, type BridgeConnection } from '@branch/bridge';
import { t, isHostPolicy, isLocale, setLocale, isSttAudio, isSttModelId, isSyncClientType, isSyncServerMsg, type BridgeClientMsg, type HostState, type SyncServerMsg, type SyncClientMsg } from '@branch/core';
import { createHostService, type HostService } from './host';
import { CH } from './ipc';
import { htmlToPdf } from './pdf';
import { createSecretVault } from './secrets';

/**
 * octobooks 데스크톱 main 프로세스.
 * - bridge를 내장: 렌더러가 IPC로 보낸 요청을 공식 CLI 무상태 실행으로 처리한다.
 * - 비밀 값은 safeStorage로 암호화해 userData에 저장한다.
 * - 원격 페어링 호스트(ADR-025): 켜면 이 PC를 휴대폰·웹이 페어링해 쓰는 bridge로 연다.
 */
const DEV_URL = process.env.BRANCH_DEV_URL;
const RENDERER = path.join(__dirname, 'renderer', 'index.html');

// 표시 이름은 OctoBooks지만 내부 앱 이름은 rhymebook 그대로 둔다(ADR-062):
// userData 경로와 safeStorage 키체인 항목이 이름에 묶여 있어, 바꾸면 기존 학습 기록·API 키를 못 읽는다.
app.setName('rhymebook');
// NSIS 바로가기와 같은 AUMID를 사용해야 Windows 알림이 앱에 연결된다.
if (process.platform === 'win32') app.setAppUserModelId('app.branchlearn.desktop');
const userData = process.env.BRANCH_USER_DATA || path.join(app.getPath('appData'), 'rhymebook');
mkdirSync(userData, { recursive: true });
app.setPath('userData', userData);

const bridgeLog = (m: string) => {
  if (process.env.BRANCH_BRIDGE_LOG) console.log(`[bridge] ${m}`);
};

/** 로컬 음성 전사 (ADR-045). 앱 번들의 whisper-cli → 개발용 vendor → PATH 순. 원격 호스트와 공유한다 */
const WHISPER_PLATFORM = process.platform === 'darwin' ? 'mac' : process.platform === 'win32' ? 'win' : 'linux';
const WHISPER_BIN = process.platform === 'win32' ? 'whisper-cli.exe' : 'whisper-cli';
const stt = createSttEngine({
  dir: path.join(app.getPath('userData'), 'stt'),
  binCandidates: [
    path.join(process.resourcesPath, 'whisper', WHISPER_BIN),
    path.join(__dirname, '..', 'vendor', 'whisper', `${WHISPER_PLATFORM}-${process.arch}`, WHISPER_BIN),
  ],
  log: bridgeLog,
});

const bridge = createBridgeServer({ log: bridgeLog, stt });

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

/** 표시 중인 응답 완료 알림 (GC 방지) */
const liveNotifications = new Set<Notification>();

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
  if (typeof m.reqId !== 'string') return false;
  if (m.type === 'stt.transcribe') return isSttAudio((v as { audio?: unknown }).audio);
  return m.type === 'status.get' || m.type === 'chat.start' || m.type === 'chat.abort' || m.type === 'stt.status.get';
}

function isAppUrl(url: string): boolean {
  if (DEV_URL) return url.startsWith(DEV_URL);
  return url.startsWith('file://');
}

/** 트레이 아이콘 경로 — build.mjs가 dist(main.cjs 옆)에 복사하고, 패키지에서는 app.asar 안에서 읽는다 */
function getTrayIconPath(): string {
  return path.join(__dirname, 'trayIcon.png');
}

/** 세션 창 (ADR-036): webContents id → 창. 엔진 창 SyncHost의 `win-<id>` 피어가 된다 */
const sessionWindows = new Map<number, BrowserWindow>();
const SESSION_ID_RE = /^[\w-]{1,64}$/;
const windowPeer = (wcId: number) => `win-${wcId}`;

/** 발표 (ADR-089): 발표자 webContents id → 청중 창들, 청중 webContents id → 발표자 id */
const presentAudience = new Map<number, Set<BrowserWindow>>();
const audiencePresenter = new Map<number, number>();
const PRESENT_TYPES = new Set(['hello', 'doc', 'page', 'ink', 'laser', 'end']);
const isPresentMsg = (m: unknown): boolean =>
  !!m && typeof m === 'object' && PRESENT_TYPES.has((m as { type?: unknown }).type as string);

function createWindow(sessionId?: string): BrowserWindow {
  const win = new BrowserWindow({
    width: sessionId ? 820 : 1280,
    height: 860,
    minWidth: 360,
    minHeight: 560,
    title: 'octobooks',
    backgroundColor: '#101f29',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      backgroundThrottling: false,
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
  const query = sessionId ? { window: 'session', session: sessionId } : undefined;
  if (DEV_URL) void win.loadURL(query ? `${DEV_URL}?${new URLSearchParams(query)}` : DEV_URL);
  else void win.loadFile(RENDERER, query ? { query } : undefined);
  return win;
}

/** Create tray with context menu */
function createTray(hostState: HostState): Tray | null {
  const iconPath = getTrayIconPath();
  try {
    const newTray = new Tray(iconPath);
    updateTrayMenu(newTray, hostState);
    newTray.setToolTip(t('desktop.tray.tooltip'));

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
  const engine = engineWindow && !engineWindow.isDestroyed() ? BrowserWindow.fromWebContents(engineWindow) : null;
  if (engine) {
    showWindow(engine);
    return;
  }
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
      label: t('desktop.tray.open'),
      click: () => {
        showOrCreateWindow();
      },
    },
    {
      type: 'separator',
    },
    {
      label: t('desktop.tray.remote', { state: hostState.enabled ? t('desktop.tray.on') : t('desktop.tray.off'), devices: hostState.devices ? t('desktop.tray.devices', { count: hostState.devices.length }) : '' }),
      enabled: false,
    },
    {
      type: 'separator',
    },
    {
      label: t('desktop.tray.quit'),
      click: () => {
        quitting = true;
        app.quit();
      },
    },
  ]);
  trayIcon.setContextMenu(menu);
}

/**
 * 메인 창 닫기: 끝내지 않고 숨긴다 (ADR-106). 진행 중인 응답 생성·완료 알림·예약·원격 호스트가
 * 계속 동작해야 하기 때문. 완전히 끄려면 트레이 메뉴의 [종료]나 ⌘Q.
 */
function attachCloseHandler(win: BrowserWindow) {
  win.on('close', (e) => {
    if (!quitting) {
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
      title: t('desktop.notify.hiddenTitle'),
      body: t('desktop.notify.hiddenBody', { quit: t('desktop.tray.quit') }),
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
  // 창 위 기본 메뉴 막대(File·Edit·View…)는 쓰지 않는다. macOS는 화면 위 메뉴가 없으면
  // ⌘C/⌘V/⌘Q 등 기본 단축키가 동작하지 않아 앱·편집 역할 메뉴만 남긴다
  Menu.setApplicationMenu(
    process.platform === 'darwin' ? Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'windowMenu' }]) : null,
  );
  const vault = createSecretVault(app.getPath('userData'));

  // 앱 언어 (ADR-105): 트레이·알림·bridge 오류 문구가 렌더러와 같은 언어를 쓴다
  ipcMain.on(CH.setLocale, (_e, locale: unknown) => {
    if (!isLocale(locale)) return;
    setLocale(locale);
    tray?.setToolTip(t('desktop.tray.tooltip'));
    if (tray && host) void host.state().then((st) => tray && updateTrayMenu(tray, st));
  });
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

  // 스킬 폴더 (IMP-12, ADR-038). 이름·경로 확인은 skillsDir가 한다
  const skillsDir = createSkillsDir(path.join(app.getPath('userData'), 'skills'), (dir) => shell.openPath(dir));
  ipcMain.on(CH.skillsRoot, (e) => {
    e.returnValue = skillsDir.root;
  });
  ipcMain.handle(CH.skillsWrite, (_e, folder: unknown, opts: unknown) => skillsDir.write(folder, opts));
  ipcMain.handle(CH.skillsRemove, (_e, name: unknown) => skillsDir.remove(name));
  ipcMain.handle(CH.skillsOpen, (_e, folder: unknown) => skillsDir.open(folder));
  ipcMain.handle(CH.skillsReadAll, () => skillsDir.readAll());

  // 엔진 창만 알림을 표시한다. 다른 창과 임의 프레임의 IPC는 거절한다.
  const notificationSender = (e: Electron.IpcMainInvokeEvent) =>
    e.sender === engineWindow && e.senderFrame === e.sender.mainFrame && isAppUrl(e.sender.getURL());
  ipcMain.handle(CH.notificationSupported, (e) => notificationSender(e) && Notification.isSupported());
  ipcMain.handle(CH.notificationShow, (e, input: unknown) => {
    if (!notificationSender(e) || !Notification.isSupported() || !input || typeof input !== 'object') return false;
    const { sessionId, title, body } = input as Record<string, unknown>;
    if (typeof sessionId !== 'string' || !SESSION_ID_RE.test(sessionId)
      || typeof title !== 'string' || title.length < 1 || title.length > 120
      || typeof body !== 'string' || body.length > 240) return false;
    return new Promise<boolean>((resolve) => {
      try {
        const notification = new Notification({ title, body });
        // 참조를 잡아 두지 않으면 GC가 거둬 클릭 처리가 사라진다 (macOS 알림 센터에 오래 남는 경우)
        liveNotifications.add(notification);
        const release = () => liveNotifications.delete(notification);
        notification.once('close', release);
        setTimeout(release, 10 * 60_000).unref();
        const timer = setTimeout(() => resolve(false), 5000);
        timer.unref();
        const finish = (shown: boolean) => { clearTimeout(timer); resolve(shown); };
        notification.once('show', () => finish(true));
        notification.once('failed', () => finish(false));
        notification.on('click', () => {
          if (e.sender.isDestroyed()) return;
          release();
          const window = BrowserWindow.fromWebContents(e.sender);
          if (window && !window.isDestroyed()) {
            if (window.isMinimized()) window.restore();
            showWindow(window);
            e.sender.send(CH.notificationClick, sessionId);
          }
        });
        notification.show();
      } catch {
        resolve(false);
      }
    });
  });

  // 책 PDF (ADR-044). 숨은 창에서 인쇄한다
  ipcMain.handle(CH.pdfFromHtml, (_e, html: unknown) => htmlToPdf(html));

  // 음성 입력 관리 (ADR-045). 바뀌면 모든 창에 알린다(원격 기기는 stt.status.get으로 따라온다)
  const modelArg = (v: unknown) => {
    if (!isSttModelId(v)) throw new Error(t('desktop.errors.unknownModel'));
    return v;
  };
  ipcMain.handle(CH.sttState, () => stt.state());
  ipcMain.handle(CH.sttSetEnabled, (_e, on: unknown) => stt.setEnabled(on === true));
  ipcMain.handle(CH.sttSetModel, (_e, id: unknown) => stt.setModel(modelArg(id)));
  ipcMain.handle(CH.sttDownload, (_e, id: unknown) => stt.download(modelArg(id)));
  ipcMain.handle(CH.sttCancel, () => stt.cancelDownload());
  ipcMain.handle(CH.sttRemove, (_e, id: unknown) => stt.remove(modelArg(id)));
  stt.onChange((state) => {
    for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send(CH.sttChanged, state);
  });

  // 동기화 IPC 핸들러
  ipcMain.on(CH.hostSyncReady, (_e, ready: unknown) => {
    syncReady = ready === true;
    if (syncReady && host) {
      // Engine is ready, broadcast sync.reset to all clients
      host.broadcastSync?.({ type: 'sync.reset' });
    }
    if (syncReady) toSessionWindows({ type: 'sync.reset' });
  });

  /** 세션 창들에 동기화 메시지를 보낸다 */
  function toSessionWindows(msg: SyncServerMsg) {
    for (const w of sessionWindows.values()) if (!w.isDestroyed()) w.webContents.send(CH.winSyncIn, msg);
  }

  /** 세션 창 열기 (ADR-036). 같은 세션이라도 매번 새 창 */
  ipcMain.on(CH.winOpenSession, (_e, sessionId: unknown) => {
    if (typeof sessionId !== 'string' || !SESSION_ID_RE.test(sessionId)) return;
    const w = createWindow(sessionId);
    const wcId = w.webContents.id;
    sessionWindows.set(wcId, w);
    applyThrottling();
    w.once('closed', () => {
      sessionWindows.delete(wcId);
      applyThrottling();
      if (engineWindow && !engineWindow.isDestroyed()) engineWindow.send(CH.hostSyncGone, windowPeer(wcId));
    });
    // 새로고침하면 새 피어처럼 hello부터 다시 받는다
    w.webContents.on('did-start-navigation', (details) => {
      if (details.isMainFrame && !details.isSameDocument && engineWindow && !engineWindow.isDestroyed()) {
        engineWindow.send(CH.hostSyncGone, windowPeer(wcId));
      }
    });
  });

  /** 발표 청중 창 열기 (ADR-089): 외부 디스플레이가 있으면 그 화면에 전체 화면, 없으면 주 화면에 창으로 */
  ipcMain.on(CH.presentOpen, (e, sessionId: unknown) => {
    if (typeof sessionId !== 'string' || !SESSION_ID_RE.test(sessionId)) return;
    const presenter = e.sender;
    const primary = screen.getPrimaryDisplay();
    const external = screen.getAllDisplays().find((d) => d.id !== primary.id);
    const area = (external ?? primary).workArea;
    const w = new BrowserWindow({
      x: area.x,
      y: area.y,
      width: external ? area.width : Math.min(1280, area.width),
      height: external ? area.height : Math.min(800, area.height),
      title: t('desktop.present.title'),
      backgroundColor: '#000000',
      show: false,
      webPreferences: {
        preload: path.join(__dirname, 'preload.cjs'),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
      },
    });
    w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    w.webContents.on('will-navigate', (ev, url) => {
      if (!isAppUrl(url)) ev.preventDefault();
    });
    w.once('ready-to-show', () => {
      w.show();
      if (external) w.setFullScreen(true);
    });
    const wcId = w.webContents.id;
    const set = presentAudience.get(presenter.id) ?? new Set<BrowserWindow>();
    set.add(w);
    presentAudience.set(presenter.id, set);
    audiencePresenter.set(wcId, presenter.id);
    w.once('closed', () => {
      presentAudience.get(presenter.id)?.delete(w);
      audiencePresenter.delete(wcId);
    });
    const query = { window: 'present', session: sessionId };
    if (DEV_URL) void w.loadURL(`${DEV_URL}?${new URLSearchParams(query)}`);
    else void w.loadFile(RENDERER, { query });
  });

  /** 발표 메시지 중계: 발표자 → 청중 창들, 청중 창(hello) → 발표자 */
  ipcMain.on(CH.presentSend, (e, msg: unknown) => {
    if (!isPresentMsg(msg)) return;
    const presenterId = audiencePresenter.get(e.sender.id);
    if (presenterId !== undefined) {
      const target = BrowserWindow.getAllWindows().find((x) => !x.isDestroyed() && x.webContents.id === presenterId);
      target?.webContents.send(CH.presentRecv, msg);
      return;
    }
    for (const w of presentAudience.get(e.sender.id) ?? []) {
      if (!w.isDestroyed()) w.webContents.send(CH.presentRecv, msg);
    }
  });

  /** 발표 끝: 발표자가 연 청중 창을 모두 닫는다 */
  ipcMain.on(CH.presentClose, (e) => {
    for (const w of presentAudience.get(e.sender.id) ?? []) if (!w.isDestroyed()) w.close();
    presentAudience.delete(e.sender.id);
  });

  // 세션 창 → 엔진 창 (피어 id는 main이 붙인다)
  ipcMain.on(CH.winSyncOut, (e, msg: unknown) => {
    if (!sessionWindows.has(e.sender.id)) return;
    if (!msg || typeof msg !== 'object' || !isSyncClientType((msg as { type?: unknown }).type)) return;
    if (!syncReady || !engineWindow || engineWindow.isDestroyed()) {
      e.sender.send(CH.winSyncIn, { type: 'sync.error', error: 'not-ready' } satisfies SyncServerMsg);
      return;
    }
    engineWindow.send(CH.hostSyncIn, { peerId: windowPeer(e.sender.id), msg });
  });

  ipcMain.on(CH.hostSyncOut, (e, data: unknown) => {
    // Validate sender is the engine window
    if (e.sender !== engineWindow) return;
    if (!data || typeof data !== 'object') return;
    const m = data as { peerId?: unknown; msg?: unknown };
    if (typeof m.peerId !== 'string' || !m.msg) return;

    // Validate message is a SyncServerMsg
    if (!isSyncServerMsg(m.msg)) return;

    // 같은 PC의 세션 창 피어 (ADR-036)
    if (m.peerId.startsWith('win-')) {
      const w = sessionWindows.get(Number(m.peerId.slice(4)));
      if (w && !w.isDestroyed()) w.webContents.send(CH.winSyncIn, m.msg);
      return;
    }
    if (m.peerId === '*') toSessionWindows(m.msg);
    host?.syncSend?.(m.peerId, m.msg as SyncServerMsg);
  });

  /** 엔진 창에 이벤트 리스너를 붙인다 */
  function attachEngineListeners(wc: WebContents) {
    // 네비게이션 시작: 같은 문서(해시 변경) 제외, 새로고침/이동만 인지
    wc.on('did-start-navigation', (details) => {
      if (details.isMainFrame && !details.isSameDocument) {
        syncReady = false;
        toSessionWindows({ type: 'sync.error', error: 'not-ready' });
      }
    });
    wc.once('destroyed', () => {
      syncReady = false;
      if (engineWindow === wc) engineWindow = null;
      // 메인 창을 닫으면 (백그라운드 호스트가 아니면) 세션 창도 함께 닫는다
      for (const w of sessionWindows.values()) if (!w.isDestroyed()) w.close();
    });
    wc.on('render-process-gone', () => {
      syncReady = false;
      toSessionWindows({ type: 'sync.error', error: 'not-ready' });
    });
  }

  const broadcast = (state: HostState) => {
    for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send(CH.hostChanged, state);
    // 창을 닫아도 앱이 백그라운드에 남으므로 트레이는 항상 둔다 (다시 열기·종료 경로, ADR-106)
    if (!tray) tray = createTray(state);
    else updateTrayMenu(tray, state);
  };
  host = createHostService({
    dir: app.getPath('userData'),
    emit: broadcast,
    log: (m) => {
      if (process.env.BRANCH_BRIDGE_LOG) console.log(`[host] ${m}`);
    },
    stt,
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

  /** 로컬 예약 엔진은 호스트 설정과 관계없이 백그라운드에서도 실행한다 */
  const applyThrottling = () => {
    if (engineWindow && !engineWindow.isDestroyed()) {
      // 로컬 예약과 원격 동기화가 숨은 메인 창에서도 동작해야 한다
      engineWindow.setBackgroundThrottling(false);
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

  // 시작 시 호스트 상태 복원 (트레이도 이때 만든다)
  void h.restore().then(async () => {
    const state = await h.state();
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
  // 메인 창이 숨겨져 있으면 앱을 끝내지 않는다
  if (BrowserWindow.getAllWindows().some((w) => !w.isDestroyed())) {
    return;
  }
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  quitting = true;
  bridge.shutdown();
  void host?.shutdown();
});
