/**
 * 데스크톱 앱 자동 업데이트 (ADR-118).
 *
 * - 상태 머신은 @branch/core의 createUpdateController (확인 주기·중복 방지·오류 처리).
 * - auto 모드: electron-updater가 GitHub Releases의 latest*.yml을 읽고 설치 파일을 받는다.
 *   sha512 검증은 electron-updater가 하며, 사용자 동의 전에는 받지 않는다(autoDownload=false).
 * - manual 모드(미서명 macOS·deb·포터블): GitHub API로 최신 정식 릴리스만 확인하고 릴리스 페이지를 연다.
 * - 클라이언트에 토큰을 넣지 않는다 (공개 저장소, 인증 없는 요청).
 */
import { app, net, shell, BrowserWindow } from 'electron';
import { execFile } from 'node:child_process';
import path from 'node:path';
import {
  candidateFromGithubRelease,
  createUpdateController,
  isTrustedReleaseUrl,
  releasePageUrl,
  resolveUpdateMode,
  type UpdateBackend,
  type UpdateCandidate,
  type UpdateController,
  type UpdateMode,
  type UpdateModeReason,
  type UpdateProgress,
  type UpdateState,
} from '@branch/core';

export const UPDATE_OWNER = 'lafin716';
export const UPDATE_REPO = 'octobooks';
const API_LATEST = `https://api.github.com/repos/${UPDATE_OWNER}/${UPDATE_REPO}/releases/latest`;

export interface AppUpdater {
  controller: UpdateController;
  start(): void;
  stop(): void;
  /** 알림 카드·설정에서 쓰는 릴리스 페이지 열기 (manual 모드 버튼) */
  openRelease(): Promise<boolean>;
}

export interface AppUpdaterOptions {
  /** 상태가 바뀔 때 (모든 창에 보낸다) */
  onChange(state: UpdateState): void;
  /** 설치 직전. 창 닫기 가로채기(숨김)를 풀어야 종료·설치가 진행된다 */
  beforeInstall(): void;
  /** 설치 시작에 실패했을 때 beforeInstall을 되돌린다 */
  installFailed(): void;
}

function log(message: string): void {
  // 업데이트 로그에는 비밀 값이 없다 (토큰을 쓰지 않음). 주소·버전·오류 문구만 남긴다
  console.log(`[updater] ${message}`);
}

/** macOS: Developer ID로 서명된 앱이어야 Squirrel.Mac이 업데이트를 설치한다 */
function macSignedWithDeveloperId(): Promise<boolean> {
  if (process.platform !== 'darwin') return Promise.resolve(false);
  // …/OctoBooks.app/Contents/MacOS/OctoBooks → …/OctoBooks.app
  const bundle = path.resolve(path.dirname(process.execPath), '..', '..');
  return new Promise((resolve) => {
    execFile('/usr/bin/codesign', ['-dv', '--verbose=2', bundle], { timeout: 10_000 }, (_err, stdout, stderr) => {
      resolve(/Authority=Developer ID Application/.test(`${stdout}\n${stderr}`));
    });
  });
}

/** manual 모드: GitHub API로 최신 정식 릴리스만 본다 (draft·prerelease는 API가 돌려주지 않음) */
function githubApiBackend(): UpdateBackend {
  return {
    async check(): Promise<UpdateCandidate | null> {
      const res = await net.fetch(API_LATEST, {
        headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
        cache: 'no-store',
      });
      if (res.status === 404) return null; // 아직 정식 릴리스가 없음
      if (res.status === 403 || res.status === 429) throw new Error(`GitHub API rate limit (HTTP ${res.status})`);
      if (!res.ok) throw new Error(`GitHub API HTTP ${res.status}`);
      return candidateFromGithubRelease(await res.json());
    },
  };
}

/** auto 모드: electron-updater */
async function electronUpdaterBackend(): Promise<UpdateBackend> {
  // 번들에 포함된다. disabled·manual 모드에서는 불러오지 않는다
  const { autoUpdater } = await import('electron-updater');
  autoUpdater.autoDownload = false; // 사용자 동의 후에만 받는다
  // 설치는 사용자가 [재시작하여 설치]를 눌렀을 때만. 받은 파일은 캐시에 남아 다음 실행에서 다시 받지 않는다
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.allowPrerelease = false; // 정식 릴리스만
  autoUpdater.allowDowngrade = false;
  autoUpdater.fullChangelog = false;
  autoUpdater.logger = {
    info: (m: unknown) => log(String(m)),
    warn: (m: unknown) => log(`warn: ${String(m)}`),
    error: (m: unknown) => log(`error: ${String(m)}`),
    debug: () => {},
  };

  // 진행률 리스너는 한 번만 등록하고 현재 다운로드의 콜백으로 넘긴다 (중복 등록 방지)
  let onProgress: ((p: UpdateProgress) => void) | null = null;
  autoUpdater.on('download-progress', (p) => {
    onProgress?.({ percent: p.percent, transferred: p.transferred, total: p.total, bytesPerSecond: p.bytesPerSecond });
  });
  // 'error' 리스너가 없으면 EventEmitter가 예외를 던진다. 실제 처리는 각 프로미스에서 한다
  autoUpdater.on('error', (e) => log(`event error: ${e instanceof Error ? e.message : String(e)}`));

  return {
    async check() {
      const result = await autoUpdater.checkForUpdates();
      if (!result || !result.isUpdateAvailable) return null;
      const info = result.updateInfo;
      return {
        version: info.version,
        ...(info.releaseName ? { releaseName: info.releaseName } : {}),
        ...(info.releaseNotes ? { releaseNotes: info.releaseNotes } : {}),
        ...(info.releaseDate ? { releaseDate: info.releaseDate } : {}),
      };
    },
    async download(cb) {
      onProgress = cb;
      try {
        // sha512(latest*.yml) 검증까지 끝나야 resolve된다. 가능하면 blockmap 차등 다운로드
        await autoUpdater.downloadUpdate();
      } finally {
        onProgress = null;
      }
    },
    install() {
      // isSilent=true: Windows NSIS를 기존 설치 경로에 조용히 설치, isForceRunAfter=true: 설치 후 다시 실행
      autoUpdater.quitAndInstall(true, true);
    },
  };
}

export async function createAppUpdater(opts: AppUpdaterOptions): Promise<AppUpdater> {
  const env = process.env;
  const disabled = env.RHYMEBOOK_DISABLE_UPDATE === '1';
  const { mode, reason } = resolveUpdateMode({
    packaged: app.isPackaged,
    platform: process.platform,
    // 꺼져 있으면 서명 확인(codesign 실행)도 하지 않는다
    macSigned: app.isPackaged && !disabled ? await macSignedWithDeveloperId() : false,
    appImage: Boolean(env.APPIMAGE),
    portable: Boolean(env.PORTABLE_EXECUTABLE_DIR),
    disabled,
  });
  log(`mode=${mode}${reason ? ` (${reason})` : ''} version=${app.getVersion()}`);

  let backend: UpdateBackend = { check: () => Promise.resolve(null) };
  let finalMode: UpdateMode = mode;
  let finalReason: UpdateModeReason | undefined = reason;
  try {
    if (mode === 'auto') backend = await electronUpdaterBackend();
    else if (mode === 'manual') backend = githubApiBackend();
  } catch (e) {
    // electron-updater 초기화 실패 (app-update.yml 없음 등) → 알림만이라도 한다
    console.error('[updater] electron-updater init failed, falling back to manual mode', e);
    backend = githubApiBackend();
    finalMode = 'manual';
    finalReason = 'unsupported-platform';
  }

  let stallTimer: ReturnType<typeof setTimeout> | null = null;
  const controller: UpdateController = createUpdateController({
    currentVersion: app.getVersion(),
    mode: finalMode,
    ...(finalReason ? { modeReason: finalReason } : {}),
    backend: {
      ...backend,
      ...(backend.install
        ? {
            install: () => {
              opts.beforeInstall();
              try {
                backend.install?.();
              } catch (e) {
                opts.installFailed();
                throw e;
              }
              // 정상이면 곧 앱이 끝난다. 20초가 지나도 살아 있으면 설치를 되돌리고 다시 시도할 수 있게 한다
              if (stallTimer) clearTimeout(stallTimer);
              stallTimer = setTimeout(() => {
                stallTimer = null;
                if (controller.getState().status !== 'installing') return;
                log('install stalled; app did not quit');
                opts.installFailed();
                controller.installStalled();
              }, 20_000);
            },
          }
        : {}),
    },
    releaseUrl: (v) => releasePageUrl(UPDATE_OWNER, UPDATE_REPO, v),
    onChange: opts.onChange,
    log,
  });

  return {
    controller,
    start: () => controller.start(),
    stop: () => controller.stop(),
    async openRelease() {
      const s = controller.getState();
      const url = s.releaseUrl ?? `https://github.com/${UPDATE_OWNER}/${UPDATE_REPO}/releases/latest`;
      if (!isTrustedReleaseUrl(url, UPDATE_OWNER, UPDATE_REPO)) return false;
      await shell.openExternal(url);
      return true;
    },
  };
}

/** 모든 창에 상태 보내기 */
export function sendToAllWindows(channel: string, payload: unknown): void {
  for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send(channel, payload);
}
