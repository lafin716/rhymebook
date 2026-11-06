/**
 * 데스크톱 앱 자동 업데이트 (ADR-118).
 * 실제 확인·다운로드·설치는 Electron main의 electron-updater(또는 GitHub API)가 한다.
 * 이 파일은 플랫폼 무관 순수 로직만 둔다: 상태 모양, 상태 머신 컨트롤러(백엔드·타이머 주입),
 * 버전 비교, 릴리스 노트 → 글자, 오류 분류, 플랫폼별 업데이트 방식 결정.
 */

/** idle: 아직 확인 전, up-to-date: 최신 버전 사용 중 */
export type UpdateStatus =
  | 'idle'
  | 'checking'
  | 'up-to-date'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'installing'
  | 'error';

/**
 * auto: 앱 안에서 받아 설치 (Windows NSIS, 서명된 macOS, Linux AppImage)
 * manual: 새 버전 알림만 하고 버튼은 릴리스 페이지를 연다 (미서명 macOS, deb 등)
 * disabled: 개발 실행 등 — 확인하지 않는다
 */
export type UpdateMode = 'auto' | 'manual' | 'disabled';

export type UpdateErrorKind = 'network' | 'rate-limit' | 'integrity' | 'signature' | 'not-found' | 'disk' | 'unknown';

export interface UpdateError {
  kind: UpdateErrorKind;
  /** 어느 단계에서 났는지. 자동 확인 실패는 알림 카드에 띄우지 않는다 */
  during: 'check' | 'download' | 'install';
  /** 확인을 사용자가 눌렀는지 (설정 화면에서만 보여 준다) */
  manual: boolean;
  /** 원문 오류 (로그·자세히 보기용, 300자 이내) */
  detail: string;
}

export interface UpdateState {
  status: UpdateStatus;
  mode: UpdateMode;
  /** disabled·manual인 이유 (설정 화면 안내) */
  modeReason?: UpdateModeReason;
  currentVersion: string;
  /** 새 버전 정보 (available 이후) */
  latestVersion?: string;
  releaseName?: string;
  /** 글자만 (HTML 제거 완료) */
  releaseNotes?: string;
  releaseDate?: string;
  /** https://github.com/<owner>/<repo>/releases/tag/v<버전> */
  releaseUrl?: string;
  /** 다운로드 진행률 0~100 */
  percent?: number;
  transferred?: number;
  total?: number;
  bytesPerSecond?: number;
  error?: UpdateError;
  /** 마지막 확인 완료 시각 (ms) */
  lastCheckedAt?: number;
}

/** 백엔드가 찾은 새 버전 */
export interface UpdateCandidate {
  version: string;
  releaseName?: string;
  /** HTML 문자열·마크다운·electron-updater의 노트 배열 무엇이든 */
  releaseNotes?: unknown;
  releaseDate?: string;
}

export interface UpdateProgress {
  percent: number;
  transferred?: number;
  total?: number;
  bytesPerSecond?: number;
}

/**
 * 플랫폼 백엔드. check는 새 버전이 없으면 null.
 * download·install은 auto 모드에서만 쓴다 (download는 끝까지 받은 뒤 resolve, 무결성 검증 포함).
 */
export interface UpdateBackend {
  check(): Promise<UpdateCandidate | null>;
  download?(onProgress: (p: UpdateProgress) => void): Promise<void>;
  install?(): void;
}

export interface UpdateTimers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface UpdateControllerOptions {
  currentVersion: string;
  mode: UpdateMode;
  modeReason?: UpdateModeReason;
  backend: UpdateBackend;
  /** 릴리스 페이지 주소 */
  releaseUrl?: (version: string) => string;
  onChange?: (state: UpdateState) => void;
  log?: (message: string) => void;
  now?: () => number;
  timers?: UpdateTimers;
  /** 시작 후 첫 확인 (기본 10초) */
  initialDelayMs?: number;
  /** 주기 확인 (기본 6시간) */
  intervalMs?: number;
  /** 자동 확인 실패 후 다시 시도 (기본 30분) */
  retryDelayMs?: number;
  /** 사용자 확인 버튼 연타 방지 (기본 5초) */
  manualCooldownMs?: number;
}

export const UPDATE_DEFAULTS = {
  initialDelayMs: 10_000,
  intervalMs: 6 * 60 * 60 * 1000,
  retryDelayMs: 30 * 60 * 1000,
  manualCooldownMs: 5_000,
} as const;

export interface UpdateController {
  getState(): UpdateState;
  /** 첫 확인·주기 확인 예약. 두 번 불러도 한 번만 예약한다 */
  start(): void;
  stop(): void;
  /** 진행 중이면 같은 확인을 기다린다 */
  check(opts?: { manual?: boolean }): Promise<UpdateState>;
  /** available(또는 다운로드 오류)일 때만. 이미 받는 중이면 같은 다운로드를 기다린다 */
  download(): Promise<UpdateState>;
  /** downloaded일 때만 true를 돌려주고 설치를 시작한다 */
  install(): boolean;
  /** 설치를 시작했는데 앱이 끝나지 않았을 때 downloaded로 되돌린다 (오류와 함께) */
  installStalled(): void;
}

const BUSY: ReadonlySet<UpdateStatus> = new Set(['checking', 'downloading', 'installing']);

export function createUpdateController(opts: UpdateControllerOptions): UpdateController {
  const timers: UpdateTimers = opts.timers ?? {
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
  };
  const now = opts.now ?? (() => Date.now());
  const log = opts.log ?? (() => {});
  const initialDelay = opts.initialDelayMs ?? UPDATE_DEFAULTS.initialDelayMs;
  const interval = opts.intervalMs ?? UPDATE_DEFAULTS.intervalMs;
  const retryDelay = opts.retryDelayMs ?? UPDATE_DEFAULTS.retryDelayMs;
  const cooldown = opts.manualCooldownMs ?? UPDATE_DEFAULTS.manualCooldownMs;

  let state: UpdateState = {
    status: 'idle',
    mode: opts.mode,
    ...(opts.modeReason ? { modeReason: opts.modeReason } : {}),
    currentVersion: opts.currentVersion,
  };
  let checking: Promise<UpdateState> | null = null;
  let downloading: Promise<UpdateState> | null = null;
  let timer: unknown = null;
  let started = false;
  let lastManualAt = -Infinity;

  const set = (patch: Partial<UpdateState>, drop: (keyof UpdateState)[] = []) => {
    const next: UpdateState = { ...state, ...patch };
    for (const k of drop) delete next[k];
    state = next;
    opts.onChange?.(state);
  };

  const schedule = (ms: number) => {
    if (!started) return;
    if (timer !== null) timers.clearTimeout(timer);
    timer = timers.setTimeout(() => {
      timer = null;
      void check({ manual: false });
    }, ms);
  };

  const fail = (during: UpdateError['during'], manual: boolean, e: unknown) => {
    const detail = errorText(e);
    log(`update ${during} failed: ${detail}`);
    set({ status: 'error', error: { kind: classifyUpdateError(detail), during, manual, detail } }, ['percent']);
  };

  function check({ manual = false }: { manual?: boolean } = {}): Promise<UpdateState> {
    if (state.mode === 'disabled') return Promise.resolve(state);
    if (checking) return checking;
    // 받는 중·받은 뒤·설치 중에는 다시 확인하지 않는다 (같은 업데이트를 두 번 받지 않게)
    if (downloading || state.status === 'downloaded' || state.status === 'installing') {
      // 주기 확인이 여기서 끊기지 않게 다음 확인을 다시 잡는다
      if (!manual) schedule(interval);
      return Promise.resolve(state);
    }
    if (manual) {
      if (now() - lastManualAt < cooldown) return Promise.resolve(state);
      lastManualAt = now();
    }
    const prev = state;
    set({ status: 'checking' }, ['error']);
    log(`update check (${manual ? 'manual' : 'auto'})`);
    checking = (async () => {
      try {
        const found = await opts.backend.check();
        if (found && isNewerVersion(found.version, state.currentVersion)) {
          log(`update available: ${found.version}`);
          const notes = releaseNotesToText(found.releaseNotes);
          set(
            {
              status: 'available',
              latestVersion: found.version,
              lastCheckedAt: now(),
              ...(found.releaseName ? { releaseName: found.releaseName } : {}),
              ...(notes ? { releaseNotes: notes } : {}),
              ...(found.releaseDate ? { releaseDate: found.releaseDate } : {}),
              ...(opts.releaseUrl ? { releaseUrl: opts.releaseUrl(found.version) } : {}),
            },
            [
              'percent',
              'transferred',
              'total',
              'bytesPerSecond',
              ...(found.releaseName ? [] : (['releaseName'] as const)),
              ...(notes ? [] : (['releaseNotes'] as const)),
              ...(found.releaseDate ? [] : (['releaseDate'] as const)),
            ],
          );
        } else {
          log('update: up to date');
          set({ status: 'up-to-date', lastCheckedAt: now() }, [
            'latestVersion',
            'releaseName',
            'releaseNotes',
            'releaseDate',
            'releaseUrl',
            'percent',
          ]);
        }
        schedule(interval);
      } catch (e) {
        // 이미 찾은 새 버전(또는 다시 받을 수 있는 다운로드 오류)이 있으면 확인 실패로 잃지 않는다.
        // 자동 확인은 조용히, 수동 확인은 설정 화면에 오류만 함께 보여 준다
        const keep = prev.status === 'available' || (prev.status === 'error' && prev.error?.during !== 'check' && !!prev.latestVersion);
        if (keep) {
          const detail = errorText(e);
          log(`update check failed (kept ${prev.status}): ${detail}`);
          if (prev.status === 'available') {
            if (manual) set({ status: 'available', error: { kind: classifyUpdateError(detail), during: 'check', manual, detail } });
            else set({ status: 'available' });
          } else {
            set({ status: prev.status, ...(prev.error ? { error: prev.error } : {}) });
          }
        } else {
          fail('check', manual, e);
        }
        schedule(retryDelay);
      } finally {
        checking = null;
      }
      return state;
    })();
    return checking;
  }

  function download(): Promise<UpdateState> {
    if (downloading) return downloading;
    const retryable = state.status === 'error' && state.error?.during !== 'check' && !!state.latestVersion;
    if (state.mode !== 'auto' || !opts.backend.download || !(state.status === 'available' || retryable)) {
      return Promise.resolve(state);
    }
    const run = opts.backend.download;
    set({ status: 'downloading', percent: 0 }, ['error', 'transferred', 'total', 'bytesPerSecond']);
    log(`update download start: ${state.latestVersion}`);
    downloading = (async () => {
      try {
        await run((p) => {
          if (state.status !== 'downloading') return;
          set({
            percent: clampPercent(p.percent),
            ...(p.transferred !== undefined ? { transferred: p.transferred } : {}),
            ...(p.total !== undefined ? { total: p.total } : {}),
            ...(p.bytesPerSecond !== undefined ? { bytesPerSecond: p.bytesPerSecond } : {}),
          });
        });
        log('update downloaded');
        set({ status: 'downloaded', percent: 100 }, ['bytesPerSecond']);
      } catch (e) {
        fail('download', true, e);
      } finally {
        downloading = null;
      }
      return state;
    })();
    return downloading;
  }

  function install(): boolean {
    if (state.mode !== 'auto' || state.status !== 'downloaded' || !opts.backend.install) return false;
    set({ status: 'installing' });
    log(`update install: ${state.latestVersion}`);
    try {
      opts.backend.install();
      return true;
    } catch (e) {
      fail('install', true, e);
      // 받은 파일은 그대로라 다시 설치할 수 있게 되돌린다
      set({ status: 'downloaded' });
      return false;
    }
  }

  /** 설치를 시작했는데 앱이 끝나지 않았을 때 (main의 감시 타이머). 받은 파일로 다시 설치할 수 있게 되돌린다 */
  function installStalled(): void {
    if (state.status !== 'installing') return;
    fail('install', true, new Error('install did not start'));
    set({ status: 'downloaded' });
  }

  return {
    getState: () => state,
    start() {
      if (started || state.mode === 'disabled') return;
      started = true;
      schedule(initialDelay);
    },
    stop() {
      started = false;
      if (timer !== null) timers.clearTimeout(timer);
      timer = null;
    },
    check,
    download,
    install,
    installStalled,
  };
}

/** 렌더러에 보여 줄 수 있는 상태인지 (알림 카드). 자동 확인 오류·최신 상태는 띄우지 않는다 */
export function shouldShowUpdateNotice(state: UpdateState, dismissedVersion?: string | null): boolean {
  switch (state.status) {
    case 'available':
      return state.latestVersion !== dismissedVersion;
    case 'downloading':
    case 'downloaded':
    case 'installing':
      return true;
    case 'error':
      return state.error?.during !== 'check' && !!state.latestVersion;
    default:
      return false;
  }
}

export function isBusyUpdate(state: UpdateState): boolean {
  return BUSY.has(state.status);
}

function clampPercent(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n * 10) / 10));
}

function errorText(e: unknown): string {
  const raw = e instanceof Error ? e.message : typeof e === 'string' ? e : String(e);
  return raw.replace(/\s+/g, ' ').trim().slice(0, 300);
}

/* ───────────── 버전 ───────────── */

interface ParsedVersion {
  nums: [number, number, number];
  pre: string[];
}

function parseVersion(v: string): ParsedVersion | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(v.trim());
  if (!m) return null;
  return { nums: [Number(m[1]), Number(m[2]), Number(m[3])], pre: m[4] ? m[4].split('.') : [] };
}

/** semver 비교. a>b면 양수. 읽을 수 없는 버전은 가장 낮게 본다 */
export function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa || !pb) return pa ? 1 : pb ? -1 : 0;
  for (let i = 0; i < 3; i++) {
    const d = pa.nums[i]! - pb.nums[i]!;
    if (d) return d;
  }
  // 정식 버전이 같은 숫자의 프리릴리스보다 높다
  if (!pa.pre.length || !pb.pre.length) return pb.pre.length - pa.pre.length;
  for (let i = 0; i < Math.max(pa.pre.length, pb.pre.length); i++) {
    const x = pa.pre[i];
    const y = pb.pre[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const nx = /^\d+$/.test(x);
    const ny = /^\d+$/.test(y);
    if (nx && ny) {
      const d = Number(x) - Number(y);
      if (d) return d;
    } else if (nx !== ny) {
      return nx ? -1 : 1;
    } else if (x !== y) {
      return x < y ? -1 : 1;
    }
  }
  return 0;
}

/** 낮은 버전·같은 버전으로는 바꾸지 않는다 (다운그레이드 방지) */
export function isNewerVersion(candidate: string, current: string): boolean {
  return parseVersion(candidate) !== null && compareVersions(candidate, current) > 0;
}

/** -beta.1 같은 프리릴리스가 아닌 정식 버전 */
export function isStableVersion(v: string): boolean {
  const p = parseVersion(v);
  return !!p && p.pre.length === 0;
}

/* ───────────── 릴리스 노트 ───────────── */

const NOTES_MAX = 4000;

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+|#39);/gi, (all, name: string) => {
    const lower = name.toLowerCase();
    if (lower.startsWith('#x')) return safeCodePoint(parseInt(lower.slice(2), 16)) ?? all;
    if (lower.startsWith('#') && lower !== '#39') return safeCodePoint(parseInt(lower.slice(1), 10)) ?? all;
    return ENTITIES[lower] ?? all;
  });
}

function safeCodePoint(n: number): string | null {
  if (!Number.isFinite(n) || n <= 0 || n > 0x10ffff || (n >= 0xd800 && n <= 0xdfff)) return null;
  return String.fromCodePoint(n);
}

/**
 * 릴리스 노트를 글자로. electron-updater GitHub provider는 HTML 문자열(또는 버전별 배열)을,
 * GitHub API는 마크다운을 준다. 태그는 모두 지우고(스크립트·스타일은 내용째) 목록·문단은 줄바꿈으로 남긴다.
 * 결과는 React 글자 노드로만 보여 준다 (innerHTML 금지).
 */
export function releaseNotesToText(notes: unknown): string {
  let raw: string;
  if (typeof notes === 'string') raw = notes;
  else if (Array.isArray(notes)) {
    raw = notes
      .map((n) => (n && typeof n === 'object' && typeof (n as { note?: unknown }).note === 'string' ? (n as { note: string }).note : ''))
      .filter(Boolean)
      .join('\n\n');
  } else return '';
  const text = decodeEntities(
    raw
      .replace(/\r\n?/g, '\n')
      .replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, '')
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<li\b[^>]*>/gi, '\n• ')
      .replace(/<\/(p|div|h[1-6]|ul|ol|pre|blockquote|tr)\s*>/gi, '\n')
      .replace(/<(h[1-6]|p|ul|ol|pre|blockquote)\b[^>]*>/gi, '\n')
      .replace(/<[^>]*>/g, ''),
  )
    .split('\n')
    .map((l) => l.replace(/[ \t]+/g, ' ').trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return text.length > NOTES_MAX ? `${text.slice(0, NOTES_MAX).trimEnd()}…` : text;
}

/* ───────────── 오류 분류 ───────────── */

export function classifyUpdateError(message: string): UpdateErrorKind {
  const m = message.toLowerCase();
  if (/sha512|sha256|checksum|integrity|mismatch/.test(m)) return 'integrity';
  if (/code signature|codesign|not signed|signature|publisher/.test(m)) return 'signature';
  if (/\b(403|429)\b|rate limit/.test(m)) return 'rate-limit';
  if (/\b404\b|cannot find latest|no published versions|latest[-\w]*\.yml/.test(m)) return 'not-found';
  if (/enospc|no space|eacces|eperm|erofs/.test(m)) return 'disk';
  if (/enotfound|econnrefused|econnreset|etimedout|eai_again|enetunreach|net::err|network|socket|timeout|offline|fetch failed/.test(m)) {
    return 'network';
  }
  return 'unknown';
}

/* ───────────── 플랫폼별 방식 ───────────── */

export type UpdateModeReason = 'dev' | 'env-disabled' | 'mac-unsigned' | 'linux-package' | 'portable' | 'unsupported-platform';

export interface UpdateEnvironment {
  packaged: boolean;
  platform: string;
  /** macOS: Developer ID로 서명돼 Squirrel.Mac이 설치를 받아 줄 수 있음 */
  macSigned?: boolean;
  /** Linux: APPIMAGE 환경 변수 (AppImage로 실행 중) */
  appImage?: boolean;
  /** Windows: 포터블 실행 (PORTABLE_EXECUTABLE_DIR) */
  portable?: boolean;
  /** 사용자가 끈 경우 (환경 변수) */
  disabled?: boolean;
}

export function resolveUpdateMode(env: UpdateEnvironment): { mode: UpdateMode; reason?: UpdateModeReason } {
  if (!env.packaged) return { mode: 'disabled', reason: 'dev' };
  if (env.disabled) return { mode: 'disabled', reason: 'env-disabled' };
  switch (env.platform) {
    case 'win32':
      return env.portable ? { mode: 'manual', reason: 'portable' } : { mode: 'auto' };
    case 'darwin':
      return env.macSigned ? { mode: 'auto' } : { mode: 'manual', reason: 'mac-unsigned' };
    case 'linux':
      return env.appImage ? { mode: 'auto' } : { mode: 'manual', reason: 'linux-package' };
    default:
      return { mode: 'manual', reason: 'unsupported-platform' };
  }
}

/** 릴리스 페이지 주소. owner·repo는 앱에 고정된 값만 넣는다 */
export function releasePageUrl(owner: string, repo: string, version: string): string {
  return `https://github.com/${owner}/${repo}/releases/tag/v${encodeURIComponent(version.replace(/^v/, ''))}`;
}

/** main이 외부 브라우저로 열기 전에 다시 확인한다 */
export function isTrustedReleaseUrl(url: string, owner: string, repo: string): boolean {
  try {
    const u = new URL(url);
    return (
      u.protocol === 'https:' &&
      u.hostname === 'github.com' &&
      !u.username &&
      !u.password &&
      !u.port &&
      u.pathname.startsWith(`/${owner}/${repo}/releases/`)
    );
  } catch {
    return false;
  }
}

/**
 * GitHub API `GET /repos/:owner/:repo/releases/latest` 응답 → 후보 (manual 모드용).
 * 이 API는 draft·prerelease를 돌려주지 않지만 한 번 더 거른다.
 */
export function candidateFromGithubRelease(json: unknown): UpdateCandidate | null {
  if (!json || typeof json !== 'object') return null;
  const r = json as Record<string, unknown>;
  if (r.draft === true || r.prerelease === true) return null;
  const tag = typeof r.tag_name === 'string' ? r.tag_name : '';
  const version = tag.replace(/^v/, '');
  if (!isStableVersion(version)) return null;
  return {
    version,
    ...(typeof r.name === 'string' && r.name ? { releaseName: r.name } : {}),
    ...(typeof r.body === 'string' && r.body ? { releaseNotes: r.body } : {}),
    ...(typeof r.published_at === 'string' ? { releaseDate: r.published_at } : {}),
  };
}
