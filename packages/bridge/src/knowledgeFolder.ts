import { lstat, readFile, readdir, realpath, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import {
  DEFAULT_CODEBASE_EXCLUDES,
  GUIDE_FILES,
  KnowledgePolicyError,
  PROJECT_MARKERS,
  BINARY_EXTS,
  cleanExcludes,
  compileExcludes,
  extOf,
  isCodeExt,
  isDocumentExt,
  type KnowledgeEntry,
  type KnowledgeFolderInspection,
  type KnowledgeKind,
} from '@branch/core';

/** 폴더 훑기 상한 (항목 수). 넘으면 truncated로 표시하고 멈춘다 */
export const FOLDER_WALK_MAX_ENTRIES = 20_000;
/** 훑으며 셀 파일 상한 (크기 합 계산 포함) */
const FOLDER_WALK_MAX_FILES = 50_000;

/**
 * 연결 폴더 검증 (ADR-128). 절대 경로이고, 심볼릭 링크를 풀어 실제 폴더여야 하며,
 * 루트·홈 폴더 자체나 앱 지식 폴더(root)와 겹치거나 그 안에 있는 폴더는 허용하지 않는다.
 * 허용하면 realpath를, 아니면 KnowledgePolicyError(folder_not_allowed)를 던진다.
 */
export async function validateLinkedFolder(raw: unknown, knowledgeRoot: string): Promise<string> {
  if (typeof raw !== 'string' || !path.isAbsolute(raw) || raw.includes('\0') || raw.length > 4096) {
    throw new KnowledgePolicyError('folder_not_allowed', 'linked folder must be an absolute path');
  }
  let real: string;
  try {
    real = await realpath(raw);
  } catch {
    throw new KnowledgePolicyError('folder_not_allowed', 'linked folder does not exist');
  }
  const st = await stat(real).catch(() => null);
  if (!st?.isDirectory()) throw new KnowledgePolicyError('folder_not_allowed', 'linked path is not a directory');
  const home = await realpath(homedir()).catch(() => homedir());
  if (real === path.parse(real).root || real === home) {
    throw new KnowledgePolicyError('folder_not_allowed', 'filesystem root or home folder cannot be linked');
  }
  const base = path.resolve(knowledgeRoot);
  const rootReal = await realpath(base).catch(() => base);
  // 앱 지식 폴더를 품거나(상위) 그 안에 있는(하위) 폴더는 안 된다 — 순환 색인·실수로 앱 데이터를 건드리는 것을 막는다
  if (real === rootReal || rootReal.startsWith(real + path.sep) || real.startsWith(rootReal + path.sep)) {
    throw new KnowledgePolicyError('folder_not_allowed', 'folder overlaps the app knowledge store');
  }
  return real;
}

/** 폴더의 .gitignore 규칙 (있으면). 기본 제외에 더해 쓴다 */
async function gitignoreRules(dir: string): Promise<string[]> {
  try {
    const raw = await readFile(path.join(dir, '.gitignore'), 'utf8');
    return cleanExcludes(raw.split(/\r?\n/).filter((l) => l.trim() && !l.trim().startsWith('#')));
  } catch {
    return [];
  }
}

export interface LinkedWalkResult {
  entries: KnowledgeEntry[];
  fileCount: number;
  totalBytes: number;
  codeFiles: number;
  docFiles: number;
  languages: Map<string, number>;
  truncated: boolean;
}

/**
 * 연결 폴더를 제외 규칙(기본 + 사용자 + .gitignore)을 적용해 훑는다. 숨김 항목·심볼릭 링크는 건너뛴다.
 * 상한에 닿으면 truncated. 파일 내용은 읽지 않는다.
 */
export async function walkLinkedFolder(
  root: string,
  excludes: readonly string[],
  opts: { collectTop?: boolean; maxEntries?: number } = {},
): Promise<LinkedWalkResult> {
  const matcher = compileExcludes([...DEFAULT_CODEBASE_EXCLUDES, ...excludes, ...(await gitignoreRules(root))]);
  const max = opts.maxEntries ?? FOLDER_WALK_MAX_ENTRIES;
  const res: LinkedWalkResult = {
    entries: [],
    fileCount: 0,
    totalBytes: 0,
    codeFiles: 0,
    docFiles: 0,
    languages: new Map(),
    truncated: false,
  };
  let visited = 0;

  async function visit(absDir: string, rel: string): Promise<void> {
    if (res.truncated) return;
    let names: import('node:fs').Dirent[];
    try {
      names = await readdir(absDir, { withFileTypes: true });
    } catch {
      return;
    }
    names.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const d of names) {
      if (d.name.startsWith('.') || d.isSymbolicLink()) continue;
      const childRel = rel ? `${rel}/${d.name}` : d.name;
      const isDir = d.isDirectory();
      if (!isDir && !d.isFile()) continue;
      if (matcher(childRel, isDir)) continue;
      visited++;
      if (visited > max) {
        res.truncated = true;
        return;
      }
      if (opts.collectTop && rel === '') res.entries.push({ path: childRel, dir: isDir });
      if (isDir) {
        await visit(path.join(absDir, d.name), childRel);
        if (res.truncated) return;
        continue;
      }
      const ext = extOf(d.name);
      if (BINARY_EXTS.has(ext)) continue;
      const st = await lstat(path.join(absDir, d.name)).catch(() => null);
      if (!st) continue;
      res.fileCount++;
      res.totalBytes += st.size;
      if (isCodeExt(ext)) res.codeFiles++;
      else if (isDocumentExt(ext)) res.docFiles++;
      if (isCodeExt(ext)) res.languages.set(ext, (res.languages.get(ext) ?? 0) + 1);
      if (res.fileCount >= FOLDER_WALK_MAX_FILES) {
        res.truncated = true;
        return;
      }
    }
  }

  await visit(root, '');
  if (opts.collectTop) {
    res.entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    res.entries = res.entries.slice(0, 200);
  }
  return res;
}

/** 연결 폴더의 개수·크기 (KB 목록 캐시용). 제외 규칙을 따른다 */
export async function measureLinked(root: string, excludes: readonly string[]): Promise<{ fileCount: number; totalBytes: number }> {
  const w = await walkLinkedFolder(root, excludes, { maxEntries: FOLDER_WALK_MAX_ENTRIES });
  return { fileCount: w.fileCount, totalBytes: w.totalBytes };
}

/** 폴더를 훑어 코드베이스 등록 전 미리보기를 만든다 (읽기 전용) */
export async function inspectKnowledgeFolder(raw: unknown, knowledgeRoot: string): Promise<KnowledgeFolderInspection> {
  const real = await validateLinkedFolder(raw, knowledgeRoot);
  const w = await walkLinkedFolder(real, [], { collectTop: true });
  let rootNames: string[] = [];
  try {
    rootNames = (await readdir(real)).sort();
  } catch {
    rootNames = [];
  }
  const markers = rootNames.filter((n) => PROJECT_MARKERS.some((m) => (m.startsWith('.') ? n.endsWith(m) : n === m)));
  const guides = GUIDE_FILES.filter((g) => rootNames.includes(g));
  const isGitRepo = rootNames.includes('.git');
  const languages = [...w.languages.entries()]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .slice(0, 8)
    .map(([ext, count]) => ({ ext, count }));
  const suggestedKind: KnowledgeKind =
    w.codeFiles > w.docFiles && (markers.length > 0 || w.codeFiles >= 3) ? 'codebase' : 'document';
  return {
    path: real,
    name: path.basename(real),
    top: w.entries,
    fileCount: w.fileCount,
    totalBytes: w.totalBytes,
    truncated: w.truncated,
    markers,
    guides,
    languages,
    suggestedKind,
    isGitRepo,
  };
}
