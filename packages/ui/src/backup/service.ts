import {
  BACKUP_TARGET_LABEL,
  backupFileName,
  createBackupManager,
  createDriveTarget,
  createGithubTarget,
  createSnapshot,
  memoryBackupTarget,
  readBackupHeader,
  restoreData,
  secretName,
  serializeBackup,
  shouldAutoBackup,
  toStoredData,
  type AutoBackupMode,
  type BackupEntry,
  type BackupRunResult,
  type BackupTarget,
  type RestoreMode,
} from '@branch/core';
import { create } from 'zustand';
import { isDemo, secrets } from '../app/runtime';
import { appStore, applyPlatformSettings, db, persistence } from '../app/store';
import { googleClientId, requestDriveToken, revokeDriveToken } from './google';
import { saveTextFile } from '../lib/download';
import { dexieBackupTarget } from './targets';

/**
 * 백업 서비스 (ADR-015). 백업 탭과 자동 백업이 함께 쓴다.
 * - 설정(자동·보관 개수·암호화 여부·GitHub 저장소 이름)은 IndexedDB kv 'backup'에 저장
 * - 토큰은 SecretStore(웹은 탭 메모리), 백업 암호는 이 모듈의 메모리에만 둔다
 * - 데모 모드에서는 실제 DB를 건드리지 않도록 메모리 대상을 쓴다
 */
export interface BackupPrefs {
  auto: AutoBackupMode;
  keep: number;
  encrypt: boolean;
  githubRepo: string | null;
  lastBackupAt: number;
}

const DEFAULT_PREFS: BackupPrefs = { auto: 'change', keep: 10, encrypt: false, githubRepo: null, lastBackupAt: 0 };
const TICK_MS = 30_000;

interface BackupState extends BackupPrefs {
  /** 백업 암호 (저장하지 않음) */
  passphrase: string;
  /** 연결된 드라이브 계정 표시 이름 */
  gdrive: string | null;
  /** 연결된 GitHub 저장소 */
  github: string | null;
  entries: BackupEntry[];
  busy: 'backup' | 'restore' | 'connect' | null;
  error: string | null;
  notice: string | null;
}

export const useBackup = create<BackupState>(() => ({
  ...DEFAULT_PREFS,
  passphrase: '',
  gdrive: null,
  github: null,
  entries: [],
  busy: null,
  error: null,
  notice: null,
}));

const get = () => useBackup.getState();
const set = (p: Partial<BackupState>) => useBackup.setState(p);
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

// ── 대상 ────────────────────────────────────────────────

const demoDevice = memoryBackupTarget('file');
const demoDrive = memoryBackupTarget('gdrive');
let drive: BackupTarget | null = null;
let github: BackupTarget | null = null;

const device = (): BackupTarget => (isDemo() ? demoDevice : dexieBackupTarget(db, 'file'));
const remotes = () => [drive, github].filter((t): t is BackupTarget => !!t);

const manager = createBackupManager({
  device: lazy(device),
  remotes,
  getData: () => toStoredData(appStore.getState()),
});

/** 데모 모드 전환에 따라 실제/메모리 대상을 고르는 위임 */
function lazy(pick: () => BackupTarget): BackupTarget {
  return {
    id: 'file',
    label: BACKUP_TARGET_LABEL.file,
    available: () => pick().available(),
    list: () => pick().list(),
    put: (b, m) => pick().put(b, m),
    get: (id) => pick().get(id),
    remove: (id) => pick().remove(id),
  };
}

/** 암호화가 켜져 있으면 암호를 요구한다 */
function passphraseOrThrow(): string | undefined {
  const s = get();
  if (!s.encrypt) return undefined;
  if (!s.passphrase) throw new Error('암호화가 켜져 있어요. 백업 암호를 입력하세요.');
  return s.passphrase;
}

// ── 설정 ────────────────────────────────────────────────

async function savePrefs() {
  if (isDemo()) return;
  const { auto, keep, encrypt, githubRepo, lastBackupAt } = get();
  try {
    await db.kv.put({ key: 'backup', value: { auto, keep, encrypt, githubRepo, lastBackupAt } satisfies BackupPrefs });
  } catch (e) {
    console.warn('[backup] 설정 저장 실패', e);
  }
}

export function setPrefs(p: Partial<Pick<BackupPrefs, 'auto' | 'keep' | 'encrypt'>>) {
  set(p);
  void savePrefs();
}

export function setPassphrase(passphrase: string) {
  set({ passphrase });
}

export function dismissMessages() {
  set({ error: null, notice: null });
}

// ── 목록·백업·복원 ──────────────────────────────────────

function failureText(r: BackupRunResult) {
  return r.failures.map((f) => `${BACKUP_TARGET_LABEL[f.targetId]}: ${f.message}`).join(' · ') || null;
}

export async function refreshList() {
  const r = await manager.list();
  set({ entries: r.entries, ...(r.failures.length ? { error: failureText(r) } : {}) });
}

async function runBackup(auto: boolean) {
  if (get().busy) return;
  set({ busy: 'backup', error: null, notice: null });
  try {
    const passphrase = passphraseOrThrow();
    const r = await manager.backupNow({ keep: get().keep, ...(passphrase ? { passphrase } : {}) });
    const at = r.entries[0]?.at ?? Date.now();
    set({ lastBackupAt: at, error: failureText(r), notice: r.entries.length > 1 || !r.failures.length ? (auto ? '자동 백업했어요.' : '백업했어요.') : null });
    void savePrefs();
    await refreshList();
  } catch (e) {
    set({ error: message(e) });
  } finally {
    set({ busy: null });
  }
}

export const backupNow = () => runBackup(false);

/** 복원. 성공하면 true. 설정 창은 열린 채로 둔다 */
export async function restore(entry: BackupEntry, mode: RestoreMode, passphrase?: string): Promise<boolean> {
  if (get().busy) return false;
  set({ busy: 'restore', error: null, notice: null });
  try {
    if (!isDemo()) await persistence.flush();
    const pre = get().encrypt && get().passphrase ? get().passphrase : undefined;
    const { data } = await manager.restore(entry, mode, {
      keep: get().keep,
      ...(passphrase ? { passphrase } : {}),
      ...(pre ? { preBackupPassphrase: pre } : {}),
    });
    if (!isDemo()) await persistence.replaceAll(data);
    // 연결 상태는 기기마다 다르므로 그대로 둔다
    const { connections: _keep, ...restored } = restoreData(data);
    const app = appStore.getState();
    app.load(restored);
    applyPlatformSettings();
    app.setOverlay('settings');
    lastChangeAt = 0;
    set({ notice: mode === 'merge' ? '백업을 합쳤어요. 복원 전 상태는 이 기기에 백업해 두었어요.' : '백업으로 교체했어요. 복원 전 상태는 이 기기에 백업해 두었어요.' });
    await refreshList();
    return true;
  } catch (e) {
    set({ error: message(e) });
    return false;
  } finally {
    set({ busy: null });
  }
}

// ── 파일 내보내기·가져오기 ──────────────────────────────

export async function exportFile() {
  set({ error: null, notice: null });
  try {
    const passphrase = passphraseOrThrow();
    const snap = createSnapshot(toStoredData(appStore.getState()));
    const body = await serializeBackup(snap, passphrase);
    await saveTextFile(backupFileName(snap.createdAt, !!passphrase), body, 'application/json');
    set({ notice: '백업 파일을 내보냈어요.' });
  } catch (e) {
    set({ error: message(e) });
  }
}

/** 파일을 이 기기의 백업 목록에 넣는다. 복원은 사용자가 고른다 */
export async function importFile(file: File): Promise<BackupEntry | null> {
  set({ error: null, notice: null });
  try {
    const body = await file.text();
    const header = readBackupHeader(body);
    const entry = await device().put(body, { at: header.createdAt, encrypted: header.encrypted });
    await refreshList();
    set({ notice: '가져온 백업을 목록에 추가했어요. 복원 방법을 고르세요.' });
    return entry;
  } catch (e) {
    set({ error: message(e) });
    return null;
  }
}

// ── 연결 ────────────────────────────────────────────────

const tokenOf = (id: 'github' | 'gdrive') => () => secrets.get(secretName.backupToken(id));

async function attachGithub(repo: string) {
  const t = createGithubTarget({ repo, getToken: tokenOf('github') });
  await t.verify();
  github = t;
  set({ github: repo, githubRepo: repo });
}

export async function connectGithub(repo: string, token: string) {
  set({ busy: 'connect', error: null, notice: null });
  try {
    await secrets.set(secretName.backupToken('github'), token);
    await attachGithub(repo);
    void savePrefs();
    await refreshList();
  } catch (e) {
    await secrets.delete(secretName.backupToken('github'));
    throw e;
  } finally {
    set({ busy: null });
  }
}

export async function disconnectGithub() {
  github = null;
  await secrets.delete(secretName.backupToken('github'));
  set({ github: null });
  await refreshList();
}

/** 클라이언트 ID가 없으면 모의 드라이브 (B-01) */
export const driveIsMock = !googleClientId;

export async function connectDrive() {
  set({ busy: 'connect', error: null, notice: null });
  try {
    if (!googleClientId) {
      drive = isDemo() ? demoDrive : dexieBackupTarget(db, 'gdrive', '구글 드라이브(모의)');
      set({ gdrive: '모의 드라이브 (클라이언트 ID 없음)' });
    } else {
      await secrets.set(secretName.backupToken('gdrive'), await requestDriveToken(googleClientId));
      const t = createDriveTarget({ getToken: tokenOf('gdrive') });
      const account = await t.account();
      drive = t;
      set({ gdrive: account || 'Google 계정' });
    }
    await refreshList();
  } catch (e) {
    await secrets.delete(secretName.backupToken('gdrive'));
    set({ error: message(e) });
  } finally {
    set({ busy: null });
  }
}

export async function disconnectDrive() {
  drive = null;
  const token = await secrets.get(secretName.backupToken('gdrive'));
  await secrets.delete(secretName.backupToken('gdrive'));
  if (token) void revokeDriveToken(token).catch(() => undefined);
  set({ gdrive: null });
  await refreshList();
}

// ── 자동 백업 ───────────────────────────────────────────

let lastChangeAt = 0;
let started = false;

/** 앱 시작 시 한 번: 설정 불러오기, 저장된 토큰으로 재연결(OS 보안 저장소), 자동 백업 타이머 */
export async function startBackupService() {
  if (started) return;
  started = true;
  if (!isDemo()) {
    try {
      const row = await db.kv.get('backup');
      if (row?.value) set({ ...DEFAULT_PREFS, ...(row.value as Partial<BackupPrefs>) });
    } catch (e) {
      console.warn('[backup] 설정 불러오기 실패', e);
    }
    const repo = get().githubRepo;
    if (repo && (await tokenOf('github')())) await attachGithub(repo).catch(() => undefined);
  }
  void refreshList().catch(() => undefined);

  appStore.subscribe((s, prev) => {
    if (s.sessions !== prev.sessions || s.messages !== prev.messages) lastChangeAt = Date.now();
  });
  window.setInterval(() => void autoTick(), TICK_MS);
}

async function autoTick() {
  const s = get();
  if (s.busy || isDemo()) return;
  if (s.encrypt && !s.passphrase) return;
  if (Object.keys(appStore.getState().streaming).length) return;
  if (!shouldAutoBackup({ mode: s.auto, lastBackupAt: s.lastBackupAt, lastChangeAt, now: Date.now() })) return;
  await runBackup(true);
}
