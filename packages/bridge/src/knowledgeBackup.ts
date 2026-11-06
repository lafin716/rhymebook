import { existsSync, mkdirSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/**
 * 색인 파일 백업 (유형 변경·마이그레이션용). 원본 files/와 meta.json은 건드리지 않는다.
 * 색인 파일은 <kb>/backup/<ts>/ 로 옮기고 manifest.json을 남긴다. 아무것도 지우지 않는다
 * (교체 중 남은 prev 흔적은 기존 recoverSwap이 처리한다).
 */

export const INDEX_BASENAME = 'index.sqlite';
export const INDEX_SET_FILES = ['index.sqlite', 'index.next.sqlite', 'index.prev.sqlite'] as const;
const SIDECARS = ['', '-wal', '-shm'] as const;
export const BACKUP_DIR_NAME = 'backup';
export const BACKUP_MANIFEST = 'manifest.json';

export interface IndexBackupManifest {
  version: 1;
  createdAt: number;
  reason: string;
  fromKind?: string;
  toKind?: string;
  /** 옮긴 색인 파일 이름 (sidecar 제외) */
  files: string[];
}

/** 색인 파일 묶음(본 파일·next·prev + sidecar)이 하나라도 있는가 */
export function hasIndexFiles(kbDir: string): boolean {
  return INDEX_SET_FILES.some((f) => existsSync(path.join(kbDir, f)));
}

function moveWithSidecars(fromBase: string, toBase: string): void {
  for (const sfx of SIDECARS) {
    const from = `${fromBase}${sfx}`;
    if (existsSync(from)) renameSync(from, `${toBase}${sfx}`);
  }
}

/** 백업 폴더 이름: 시각 기반, 같은 이름이 있으면 번호를 붙인다 */
function uniqueBackupDir(backupRoot: string, now: number): string {
  const stamp = new Date(now).toISOString().replace(/[:.]/g, '-');
  let name = stamp;
  let n = 1;
  while (existsSync(path.join(backupRoot, name))) name = `${stamp}-${n++}`;
  return path.join(backupRoot, name);
}

/**
 * 색인 파일을 backup/<ts>/로 옮기고 manifest를 쓴다. 옮길 파일이 없으면 undefined (폴더를 만들지 않는다).
 * 호출 전에 해당 KB의 색인 연결을 닫아 두어야 한다 (indexer.release).
 */
export function moveIndexFilesToBackup(
  kbDir: string,
  info: { now: number; reason: string; fromKind?: string; toKind?: string },
): IndexBackupManifest | undefined {
  const present = INDEX_SET_FILES.filter((f) => existsSync(path.join(kbDir, f)));
  if (present.length === 0) return undefined;
  const backupRoot = path.join(kbDir, BACKUP_DIR_NAME);
  mkdirSync(backupRoot, { recursive: true });
  const dest = uniqueBackupDir(backupRoot, info.now);
  mkdirSync(dest);
  for (const f of present) moveWithSidecars(path.join(kbDir, f), path.join(dest, f));
  const manifest: IndexBackupManifest = {
    version: 1,
    createdAt: info.now,
    reason: info.reason,
    fromKind: info.fromKind,
    toKind: info.toKind,
    files: [...present],
  };
  writeFileSync(path.join(dest, `${BACKUP_MANIFEST}.tmp`), JSON.stringify(manifest, null, 2));
  renameSync(path.join(dest, `${BACKUP_MANIFEST}.tmp`), path.join(dest, BACKUP_MANIFEST));
  return manifest;
}

/** 백업 폴더 목록 (최신순). 색인 파일이 들어 있는 것만 */
export function listIndexBackups(kbDir: string): string[] {
  const backupRoot = path.join(kbDir, BACKUP_DIR_NAME);
  let names: string[];
  try {
    names = readdirSync(backupRoot, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch {
    return [];
  }
  return names
    .sort()
    .reverse()
    .map((n) => path.join(backupRoot, n))
    .filter((d) => existsSync(path.join(d, INDEX_BASENAME)));
}

/**
 * 가장 최근 백업의 색인 파일을 KB 자리로 되돌린다. 현재 색인이 있으면 덮어쓰지 않고 false.
 * 되돌린 뒤 백업 폴더는 남는다 (빈 manifest만 남을 수 있다).
 */
export function restoreLatestIndexBackup(kbDir: string): boolean {
  // 색인 파일 세트 전체(본판·next·prev와 사이드카)의 목적지를 확인한다. 하나라도 있으면 덮어쓰지 않고 거부
  for (const f of INDEX_SET_FILES) {
    for (const s of SIDECARS) {
      if (existsSync(path.join(kbDir, `${f}${s}`))) return false;
    }
  }
  const latest = listIndexBackups(kbDir)[0];
  if (!latest) return false;
  for (const f of INDEX_SET_FILES) {
    const from = path.join(latest, f);
    if (existsSync(from)) moveWithSidecars(from, path.join(kbDir, f));
  }
  return existsSync(path.join(kbDir, INDEX_BASENAME));
}
