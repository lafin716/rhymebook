/**
 * 폴더 메타데이터 저장소 (ADR-123). 앱 관리 폴더 `<kbDir>/meta/` 아래에만 쓴다 (사용자 원본 files/는 건드리지 않는다).
 * - meta/folders.json: 검색·도구가 읽는 원천 (FolderMetaFile)
 * - meta/INDEX.md, meta/tree/<folder>/INFO.md: 사람이 읽는 미러
 * 읽기 실패(없음·깨짐·버전 다름)는 null로 돌려주고, 호출자는 원문 검색만 쓴다.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  buildFolderMetas,
  parseFolderMetaFile,
  renderFolderIndexMd,
  renderFolderInfoMd,
  toFolderMetaFile,
  type FolderDocInput,
  type FolderMeta,
  type FolderMetaFile,
} from '@branch/core';

export const META_DIR = 'meta';
export const FOLDERS_FILE = 'folders.json';
export const INDEX_MD_FILE = 'INDEX.md';
const TREE_DIR = 'tree';

export interface FolderRefreshResult {
  folders: number;
  /** 하위 해시가 같아 이전 결과를 그대로 쓴 폴더 수 */
  reused: number;
  /** 새로 쓴 INFO.md 수 */
  written: number;
}

export function metaDirOf(kbDir: string): string {
  return path.join(kbDir, META_DIR);
}

/** 폴더 경로를 tree/ 아래 경로로 바꾼다. '..'·'.' 같은 조각은 허용하지 않는다 */
function treeDirOf(metaDir: string, folder: string): string {
  const parts = folder === '' ? [] : folder.split('/');
  if (parts.some((p) => p === '' || p === '.' || p === '..')) throw new Error(`unsafe folder path: ${folder}`);
  return path.join(metaDir, TREE_DIR, ...parts);
}

/** 저장된 폴더 메타데이터를 읽는다. 없거나 깨졌거나 버전이 다르면 null */
export function readFolderMeta(kbDir: string): FolderMetaFile | null {
  try {
    const raw = readFileSync(path.join(metaDirOf(kbDir), FOLDERS_FILE), 'utf8');
    return parseFolderMetaFile(JSON.parse(raw));
  } catch {
    return null;
  }
}

/** 같은 디렉터리의 임시 파일에 쓰고 이름을 바꾼다 (중간에 끊겨도 이전 파일이 남는다) */
function writeAtomic(file: string, text: string): void {
  const tmp = `${file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  writeFileSync(tmp, text, 'utf8');
  renameSync(tmp, file);
}

/**
 * 문서 목록으로 폴더 메타데이터를 만들어 저장한다. 이전 파일이 있으면 하위 해시가 같은 폴더는 재사용하고,
 * 바뀐 폴더의 INFO.md만 다시 쓴다. 사라진 폴더의 INFO.md는 지운다.
 */
export function refreshFolderMeta(kbDir: string, docs: FolderDocInput[], now: number = Date.now()): FolderRefreshResult {
  const metaDir = metaDirOf(kbDir);
  const prev = readFolderMeta(kbDir);
  const prevFolders: FolderMeta[] = prev?.folders ?? [];
  const { folders, reused } = buildFolderMetas(docs, { previous: prevFolders });

  mkdirSync(metaDir, { recursive: true });
  const prevByPath = new Map(prevFolders.map((f) => [f.path, f]));
  let written = 0;
  for (const f of folders) {
    const info = path.join(treeDirOf(metaDir, f.path), 'INFO.md');
    const old = prevByPath.get(f.path);
    if (old && JSON.stringify(old) === JSON.stringify(f) && existsSync(info)) continue;
    mkdirSync(path.dirname(info), { recursive: true });
    writeAtomic(info, renderFolderInfoMd(f));
    written += 1;
  }

  // 사라진 폴더: 상위 폴더가 없으면 하위도 없으므로 폴더 통째로 지워도 안전하다
  const keep = new Set(folders.map((f) => f.path));
  for (const old of prevFolders) {
    if (keep.has(old.path)) continue;
    rmSync(treeDirOf(metaDir, old.path), { recursive: true, force: true });
  }

  writeAtomic(path.join(metaDir, FOLDERS_FILE), JSON.stringify(toFolderMetaFile(folders, now), null, 2));
  writeAtomic(path.join(metaDir, INDEX_MD_FILE), renderFolderIndexMd(folders));
  return { folders: folders.length, reused, written };
}
