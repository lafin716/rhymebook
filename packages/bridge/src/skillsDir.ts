import { lstat, mkdir, readdir, readFile, rename, rm, rmdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  isSkillFilePath,
  mergeSkillMd,
  SKILL_FILE_LIMITS,
  SKILL_NAME_RE,
  validateSkillFiles,
  type SkillFile,
  type SkillFolder,
} from '@branch/core';

/**
 * 스킬 폴더 `<root>/<name>/` (IMP-12, ADR-038).
 * 렌더러가 보낸 값은 믿지 않는다: 이름·경로·크기를 여기서 다시 확인하고,
 * 확인된 경로가 `<root>/<name>/` 안에 있을 때만 쓰고 지운다. 심볼릭 링크는 따라가지 않는다.
 * 파일 내용은 로그에 남기지 않는다.
 */

/** SKILL.md 최대 길이 (문자) */
const SKILL_MD_MAX = 200_000;
/** 스킬 하나를 훑을 때 볼 항목 수 상한 (큰 폴더를 넣어도 멈추지 않게) */
const WALK_MAX_ENTRIES = 2_000;
const SKILL_MD = 'SKILL.md';

/** Windows 예약 장치 이름·끝의 점/공백은 다른 이름과 겹치거나 열 수 없어 막는다 */
const WIN_BAD_SEGMENT_RE = /^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$|[. ]$/i;

const isHidden = (name: string) => name.startsWith('.');

/** 이 모듈에서 쓰는 오류 (메시지는 한국어로 렌더러에 그대로 보인다) */
function fail(message: string): never {
  throw new Error(message);
}

function isValidName(name: unknown): name is string {
  return typeof name === 'string' && SKILL_NAME_RE.test(name) && !WIN_BAD_SEGMENT_RE.test(name);
}

function isValidFilePath(p: string): boolean {
  return isSkillFilePath(p) && !p.split('/').some((s) => WIN_BAD_SEGMENT_RE.test(s));
}

/** 렌더러가 보낸 폴더 값을 확인해 깨끗한 사본으로 돌려준다. 잘못되면 throw */
export function parseSkillFolder(raw: unknown): SkillFolder {
  if (!raw || typeof raw !== 'object') fail('스킬 폴더 형식이 올바르지 않습니다');
  const r = raw as { name?: unknown; skillMd?: unknown; files?: unknown };
  if (!isValidName(r.name)) fail('스킬 이름이 올바르지 않습니다');
  if (typeof r.skillMd !== 'string' || r.skillMd.length > SKILL_MD_MAX) fail('SKILL.md 내용이 올바르지 않습니다');
  if (!Array.isArray(r.files) || r.files.length > SKILL_FILE_LIMITS.count) fail('부수 파일 목록이 올바르지 않습니다');
  const files: SkillFile[] = [];
  for (const f of r.files as unknown[]) {
    if (!f || typeof f !== 'object') fail('부수 파일 형식이 올바르지 않습니다');
    const { path: p, content } = f as { path?: unknown; content?: unknown };
    if (typeof p !== 'string' || typeof content !== 'string') fail('부수 파일 형식이 올바르지 않습니다');
    if (!isValidFilePath(p)) fail('부수 파일 경로가 올바르지 않습니다');
    files.push({ path: p, content });
  }
  if (validateSkillFiles(files)) fail('부수 파일이 너무 많거나 크거나 겹칩니다');
  // `a`(파일)와 `a/b.md`처럼 파일과 폴더가 겹치면 쓸 수 없다
  const dirs = new Set(files.flatMap((f) => f.path.toLowerCase().split('/').slice(0, -1).map((_, i, a) => a.slice(0, i + 1).join('/'))));
  if (files.some((f) => dirs.has(f.path.toLowerCase()))) fail('부수 파일 경로가 폴더 이름과 겹칩니다');
  return { name: r.name, skillMd: r.skillMd, files };
}

/** dir 안쪽인지 (dir 자신은 아님) */
function inside(dir: string, p: string): boolean {
  return p.startsWith(dir + path.sep);
}

async function lstatOrNull(p: string) {
  try {
    return await lstat(p);
  } catch {
    return null;
  }
}

/** 텍스트로 읽을 수 있는 작은 파일이면 내용, 아니면 null (바이너리·너무 큼·링크 제외) */
async function readText(p: string, maxChars: number): Promise<string | null> {
  const st = await lstatOrNull(p);
  // UTF-8은 한 글자가 최대 4바이트
  if (!st?.isFile() || st.size > maxChars * 4) return null;
  const text = await readFile(p, 'utf8');
  if (text.length > maxChars || text.includes('\0')) return null;
  return text;
}

/** 스킬 폴더 안의 (숨김·링크 아닌) 파일을 POSIX 상대 경로로 모은다. SKILL.md(최상위)는 뺀다 */
async function walkFiles(dir: string, maxDepth: number): Promise<{ files: string[]; dirs: string[] }> {
  const files: string[] = [];
  const dirs: string[] = [];
  let seen = 0;
  async function visit(rel: string, depth: number) {
    let entries;
    try {
      entries = await readdir(rel ? path.join(dir, ...rel.split('/')) : dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (++seen > WALK_MAX_ENTRIES) return;
      if (isHidden(e.name)) continue;
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        dirs.push(r);
        if (depth < maxDepth) await visit(r, depth + 1);
      } else if (e.isFile() || e.isSymbolicLink()) {
        if (!rel && e.name === SKILL_MD) continue;
        files.push(r);
      }
    }
  }
  await visit('', 1);
  return { files, dirs };
}

export interface SkillsDir {
  root: string;
  write(folder: unknown, opts?: unknown): Promise<void>;
  remove(name: unknown): Promise<void>;
  open(folder?: unknown): Promise<void>;
  readAll(): Promise<SkillFolder[]>;
}

/**
 * openPath: 폴더를 OS 파일 탐색기로 연다 (Electron shell.openPath — 실패하면 오류 문구, 성공하면 '')
 */
export function createSkillsDir(rootDir: string, openPath?: (dir: string) => Promise<string>): SkillsDir {
  const root = path.resolve(rootDir);
  // 같은 폴더를 동시에 고치지 않게 쓰기·지우기를 한 줄로 세운다
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(job: () => Promise<T>): Promise<T> => {
    const run = queue.then(job, job);
    queue = run.catch(() => undefined);
    return run;
  };

  function skillDir(name: string): string {
    const dir = path.resolve(root, name);
    if (!inside(root, dir) || path.dirname(dir) !== root) fail('스킬 폴더 경로가 올바르지 않습니다');
    return dir;
  }

  function filePath(dir: string, rel: string): string {
    const p = path.resolve(dir, ...rel.split('/'));
    if (!inside(dir, p)) fail('부수 파일 경로가 올바르지 않습니다');
    return p;
  }

  /** dir과 그 사이 폴더가 링크가 아닌 진짜 폴더인지 확인하며 만든다 */
  async function ensureDir(base: string, relDirs: string[]): Promise<void> {
    let cur = base;
    for (const seg of relDirs) {
      cur = path.join(cur, seg);
      const st = await lstatOrNull(cur);
      if (!st) await mkdir(cur);
      else if (!st.isDirectory()) fail('스킬 폴더 안에 폴더 대신 파일이나 링크가 있습니다');
    }
  }

  /** 내용이 다를 때만 쓴다. 그 자리에 링크가 있으면 링크를 지우고 새로 쓴다 */
  async function writeIfChanged(p: string, content: string): Promise<void> {
    const st = await lstatOrNull(p);
    if (st?.isSymbolicLink()) await rm(p);
    else if (st?.isFile() && st.size <= content.length * 4 + 4) {
      if ((await readFile(p, 'utf8')) === content) return;
    } else if (st && !st.isFile()) fail('파일 자리에 폴더가 있습니다');
    await writeFile(p, content, 'utf8');
  }

  async function writeFolder(folder: SkillFolder, prevName?: string, removed: readonly string[] = []): Promise<void> {
    await mkdir(root, { recursive: true });
    const dir = skillDir(folder.name);

    // 0) 이름이 바뀌었으면 이전 폴더를 통째로 옮긴다 (앱이 모르는 이미지·숨김 파일도 함께).
    //    새 이름 폴더가 이미 따로 있으면 옮길 수 없어 쓴 뒤 이전 폴더를 지운다 (남기면 다음 동기화에 다시 가져온다)
    let stalePrev: string | null = null;
    if (prevName !== undefined && isValidName(prevName) && prevName !== folder.name) {
      const prev = skillDir(prevName);
      if ((await lstatOrNull(prev))?.isDirectory()) {
        if (!(await lstatOrNull(dir))) await rename(prev, dir);
        else if (prev.toLowerCase() !== dir.toLowerCase()) stalePrev = prev;
      }
    }
    await ensureDir(root, [folder.name]);

    // 1) 앱에서 사용자가 뺀 파일만 지운다. 앱이 모르는 파일(가져오지 못한 파일·바이너리·숨김)은 사용자 것이므로 둔다
    const keep = new Set(folder.files.map((f) => f.path.toLowerCase()));
    const emptied = new Set<string>();
    for (const rel of removed) {
      if (keep.has(rel.toLowerCase())) continue;
      const p = filePath(dir, rel);
      const st = await lstatOrNull(p);
      if (st?.isFile() || st?.isSymbolicLink()) {
        await rm(p, { force: true });
        const segs = rel.split('/');
        for (let i = segs.length - 1; i > 0; i--) emptied.add(segs.slice(0, i).join('/'));
      }
    }
    // 2) 지운 파일 때문에 비게 된 하위 폴더를 깊은 것부터 지운다 (다른 파일이 남아 있으면 그대로 둔다)
    for (const rel of [...emptied].sort((a, b) => b.split('/').length - a.split('/').length)) {
      try {
        await rmdir(filePath(dir, rel));
      } catch {
        // 비어 있지 않음
      }
    }

    // 3) SKILL.md와 부수 파일을 쓴다 (내용이 같으면 건드리지 않는다). SKILL.md의 모르는 frontmatter 키는 유지
    const mdPath = filePath(dir, SKILL_MD);
    await writeIfChanged(mdPath, mergeSkillMd(await readText(mdPath, SKILL_MD_MAX), folder.skillMd));
    for (const f of folder.files) {
      const segs = f.path.split('/');
      await ensureDir(dir, segs.slice(0, -1));
      await writeIfChanged(filePath(dir, f.path), f.content);
    }
    if (stalePrev) await rm(stalePrev, { recursive: true, force: true });
  }

  async function readFolder(name: string): Promise<SkillFolder | null> {
    const dir = path.join(root, name);
    const skillMd = await readText(path.join(dir, SKILL_MD), SKILL_MD_MAX);
    if (skillMd === null) return null;
    const { files: paths } = await walkFiles(dir, SKILL_FILE_LIMITS.depth);
    const candidates = paths.filter(isValidFilePath).sort((a, b) => a.localeCompare(b));
    const files: SkillFile[] = [];
    let total = 0;
    for (const rel of candidates) {
      if (files.length >= SKILL_FILE_LIMITS.count) break;
      const content = await readText(filePath(dir, rel), SKILL_FILE_LIMITS.file);
      if (content === null || total + content.length > SKILL_FILE_LIMITS.total) continue;
      total += content.length;
      files.push({ path: rel, content });
    }
    return { name, skillMd, files };
  }

  return {
    root,

    async write(folder, opts) {
      const f = parseSkillFolder(folder);
      const o = opts && typeof opts === 'object' ? (opts as { prevName?: unknown; removed?: unknown }) : {};
      const prevName = typeof o.prevName === 'string' ? o.prevName : undefined;
      // 지울 경로도 이름·경로 규칙을 다시 확인한다
      const removed = Array.isArray(o.removed) ? o.removed.filter((p): p is string => typeof p === 'string' && isValidFilePath(p)).slice(0, 200) : [];
      await serial(() => writeFolder(f, prevName, removed));
    },

    async remove(name) {
      if (!isValidName(name)) fail('스킬 이름이 올바르지 않습니다');
      const dir = skillDir(name);
      await serial(() => rm(dir, { recursive: true, force: true }));
    },

    async open(folder) {
      let dir = root;
      if (folder !== undefined && folder !== null) {
        const f = parseSkillFolder(folder);
        dir = skillDir(f.name);
        await serial(async () => {
          if (!(await lstatOrNull(path.join(dir, SKILL_MD)))?.isFile()) await writeFolder(f);
        });
      } else {
        await mkdir(root, { recursive: true });
      }
      if (!openPath) return;
      const err = await openPath(dir);
      if (err) fail(`폴더를 열 수 없습니다: ${err}`);
    },

    // 이름 변경(옮기기 → 쓰기) 도중의 반쯤 된 상태를 읽지 않게 쓰기와 같은 줄에 세운다
    readAll: () => serial(readAllNow),
  };

  async function readAllNow(): Promise<SkillFolder[]> {
    let entries;
    try {
      entries = await readdir(root, { withFileTypes: true });
    } catch {
      return [];
    }
    const out: SkillFolder[] = [];
    for (const e of entries) {
      if (!e.isDirectory() || isHidden(e.name)) continue;
      const folder = await readFolder(e.name).catch(() => null);
      if (folder) out.push(folder);
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }
}
