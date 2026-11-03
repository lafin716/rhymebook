import { spawn, type ChildProcess } from 'node:child_process';
import { lookup as dnsLookup } from 'node:dns/promises';
import { randomBytes } from 'node:crypto';
import { constants as fsc } from 'node:fs';
import { copyFile, lstat, mkdir, open, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  KNOWLEDGE_ID_RE,
  KNOWLEDGE_LIMITS,
  cleanKnowledgeName,
  isKnowledgeId,
  isKnowledgeLinkUrl,
  isKnowledgePath,
  newId,
  parseGitHubRepo,
  parseGitProgress,
  t,
  type KnowledgeAddResult,
  type KnowledgeBase,
  type KnowledgeEntry,
  type KnowledgePreview,
  type KnowledgeProgress,
} from '@branch/core';

/**
 * 학습별 지식베이스 파일 저장소 `<root>/<id>/` (ADR-107).
 * 구조: `<root>/<id>/meta.json`, `<root>/<id>/files/` (사용자가 보는 트리 전체).
 * files/ 안에 links/(웹 페이지 마크다운), repos/<repo>/(GitHub 클론)이 놓인다.
 * 렌더러가 보낸 값은 믿지 않는다: id·상대 경로·이름·크기를 여기서 다시 확인하고,
 * 모든 경로 조각을 lstat으로 확인해 심볼릭 링크는 따라가지도, 쓰지도 않는다.
 * 숨김 항목(`.`으로 시작)과 .git은 목록·복사에서 건너뛴다. 파일 내용은 로그에 남기지 않는다.
 */

/** 숨김·.git·심볼릭 링크처럼 건너뛰는 항목 */
const isHidden = (name: string) => name.startsWith('.');

/** Windows 예약 장치 이름·끝의 점/공백, 금지 문자 */
const WIN_BAD_SEGMENT_RE = /^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$|[. ]$/i;
// eslint-disable-next-line no-control-regex -- 제어 문자 차단이 목적
const WIN_BAD_CHARS_RE = /[<>:"|?*\\/]|[\u0000-\u001f]/;

/** 링크 본문 최대 크기 (바이트) */
const HTML_MAX_BYTES = 5 * 1024 * 1024;
/** 링크 가져오기 제한 시간 */
const FETCH_TIMEOUT_MS = 15_000;
/** 클론 전체 제한 시간 (진행 중이어도 이 시간을 넘으면 멈춘다) */
const CLONE_TIMEOUT_MS = 10 * 60_000;
/** 클론이 이 시간 동안 아무 출력이 없으면 멈춘 것으로 본다 */
const CLONE_IDLE_MS = 60_000;
/** 클론 종료 후 stderr가 닫히길 기다리는 최대 시간 (손자 프로세스가 붙잡고 있을 수 있다) */
const CLONE_CLOSE_GRACE_MS = 500;
/** 한 번에 훑을 항목 수 상한 (큰 폴더에서 멈추지 않게) */
const WALK_MAX_ENTRIES = 20_000;
/** 미리보기로 읽을 최대 바이트 (문자 수 * 4) */
const PREVIEW_READ_BYTES = KNOWLEDGE_LIMITS.previewChars * 4;

/** 이 모듈에서 쓰는 오류 (메시지는 한국어로 렌더러에 그대로 보인다) */
function fail(message: string): never {
  throw new Error(message);
}

/** 지식베이스가 없을 때의 오류 (채팅은 이 경우 지식베이스 없이 답한다) */
export class KnowledgeNotFoundError extends Error {}

/** 경로 조각 하나가 안전한지: 빈 값·점·숨김·Windows 예약 이름·금지 문자 금지 */
export function isSafeSegment(s: string): boolean {
  return (
    s.length > 0 &&
    s.length <= 255 &&
    s !== '.' &&
    s !== '..' &&
    !isHidden(s) &&
    !WIN_BAD_SEGMENT_RE.test(s) &&
    !WIN_BAD_CHARS_RE.test(s)
  );
}

/** 제목·호스트명에서 파일 이름을 만든다 (안전한 문자만, 최대 60자) */
export function slugify(raw: string): string {
  const s = raw
    .normalize('NFC')
    // eslint-disable-next-line no-control-regex
    .replace(/[<>:"|?*\\/\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[.\s]+|[.\s]+$/g, '')
    .slice(0, 60)
    .trim();
  return s && isSafeSegment(s) ? s : 'page';
}

/** 지식베이스 id를 확인해 돌려준다. 잘못되면 throw */
export function checkId(id: unknown): string {
  if (!isKnowledgeId(id) || !KNOWLEDGE_ID_RE.test(id)) fail(t('bridge.knowledge.badId'));
  return id;
}

/** files/ 기준 상대 경로를 조각으로 나눈다. 빈 값은 [] (루트). 잘못되면 throw */
function splitRel(rel: string | undefined | null): string[] {
  if (rel === undefined || rel === null || rel === '') return [];
  if (!isKnowledgePath(rel)) fail(t('bridge.knowledge.badPath'));
  const segs = rel.split('/');
  if (!segs.every(isSafeSegment)) fail(t('bridge.knowledge.badPath'));
  return segs;
}

async function lstatOrNull(p: string) {
  try {
    return await lstat(p);
  } catch {
    return null;
  }
}

/** 이름이 겹치면 `이름 (2).ext`처럼 바꾼 이름을 고른다 */
async function uniqueName(dir: string, name: string): Promise<string> {
  if (!(await lstatOrNull(path.join(dir, name)))) return name;
  const ext = path.extname(name);
  const base = ext ? name.slice(0, -ext.length) : name;
  for (let n = 2; n < 1000; n++) {
    const cand = `${base} (${n})${ext}`;
    if (!(await lstatOrNull(path.join(dir, cand)))) return cand;
  }
  return fail(t('bridge.knowledge.nameTaken', { name }));
}

/** 사설·내부 주소인지 (문자열 검사만: localhost, 루프백, 사설 IPv4, 링크 로컬, 사설 IPv6) */
export function isPrivateHost(hostname: string): boolean {
  let h = hostname.toLowerCase();
  if (h.startsWith('[') && h.endsWith(']')) h = h.slice(1, -1);
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) return true;
  if (h === '::' || h === '::1' || h === '0.0.0.0') return true;
  // IPv4 대응 IPv6: URL은 [::ffff:127.0.0.1]을 [::ffff:7f00:1]로 바꿔 쓴다 → 점 표기로 되돌려 다시 본다
  const mapped = /^(?:0{0,4}:){0,5}(?:ffff:)?(?:0{1,4}:)?([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(h);
  if (mapped && h.startsWith('::') && (h.startsWith('::ffff:') || /^::[0-9a-f]{1,4}:[0-9a-f]{1,4}$/.test(h))) {
    const hi = parseInt(mapped[1]!, 16);
    const lo = parseInt(mapped[2]!, 16);
    return isPrivateHost(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
  }
  if (h.startsWith('::ffff:')) return isPrivateHost(h.slice(7));
  // NAT64(64:ff9b::/96)도 내부 주소로 본다
  if (h.startsWith('64:ff9b:')) return true;
  if (h.startsWith('fc') || h.startsWith('fd') || h.startsWith('fe8') || h.startsWith('fe9') || h.startsWith('fea') || h.startsWith('feb')) {
    return h.includes(':');
  }
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 198 && (b === 18 || b === 19))
  );
}

const decodeEntities = (s: string) =>
  s
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#x([0-9a-f]{1,6});/gi, (_, h) => safeChar(parseInt(h, 16)))
    .replace(/&#(\d{1,7});/g, (_, d) => safeChar(parseInt(d, 10)))
    .replace(/&amp;/gi, '&');

function safeChar(cp: number): string {
  if (!Number.isFinite(cp) || cp <= 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) return '';
  return String.fromCodePoint(cp);
}

const stripTags = (s: string) => s.replace(/<[^>]+>/g, '');

/** HTML 문서의 제목 (없으면 빈 문자열) */
export function extractTitle(html: string): string {
  const m = /<title[^>]*>([\s\S]*?)<\/title\s*>/i.exec(html);
  return m ? decodeEntities(stripTags(m[1] ?? '')).replace(/\s+/g, ' ').trim().slice(0, 120) : '';
}

/**
 * HTML을 읽을 수 있는 마크다운 텍스트로 바꾼다 (외부 라이브러리 없이 간단히).
 * script·style 등 실행·장식 블록은 버리고, 제목·목록·링크만 살린다.
 */
export function htmlToMarkdown(html: string): string {
  let s = html.replace(/<!--[\s\S]*?-->/g, '');
  s = s.replace(/<(script|style|noscript|svg|template|head|iframe|object|canvas)\b[\s\S]*?<\/\1\s*>/gi, '');
  s = s.replace(/<(script|style|head)\b[^>]*>/gi, '');
  s = s.replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1\s*>/gi, (_, n: string, inner: string) => {
    const text = decodeEntities(stripTags(inner)).replace(/\s+/g, ' ').trim();
    return text ? `\n\n${'#'.repeat(Number(n))} ${text}\n\n` : '\n';
  });
  s = s.replace(/<a\b[^>]*?href\s*=\s*["']([^"'#][^"']*)["'][^>]*>([\s\S]*?)<\/a\s*>/gi, (_, href: string, inner: string) => {
    const text = decodeEntities(stripTags(inner)).replace(/\s+/g, ' ').trim();
    return text ? `[${text}](${decodeEntities(href)})` : '';
  });
  s = s.replace(/<li\b[^>]*>/gi, '\n- ');
  s = s.replace(/<\/?(p|div|section|article|tr|ul|ol|pre|blockquote|table|header|footer|main|nav|br|hr|dt|dd|figure|figcaption)\b[^>]*>/gi, '\n');
  s = decodeEntities(stripTags(s));
  return s
    .split('\n')
    .map((line) => line.replace(/[ \t\u00a0]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** 얕은 클론 인자 (shell 없이 spawn한다). 심볼릭 링크는 파일로 풀어 따라가지 못하게 한다 */
export function gitCloneArgs(url: string, dest: string): string[] {
  return [
    '-c',
    'core.symlinks=false',
    // 자격 증명 도우미(키체인·GCM 창)를 부르지 않는다: 공개 저장소만 받는다
    '-c',
    'credential.helper=',
    'clone',
    '--depth',
    '1',
    '--single-branch',
    '--no-tags',
    '--progress',
    '--',
    url,
    dest,
  ];
}

/** 가져오기 진행 알림·취소 (main이 렌더러 창마다 하나씩 만든다) */
export interface KnowledgeTaskControl {
  onProgress?: (p: KnowledgeProgress) => void;
  signal?: AbortSignal;
}

const cancelledError = () => new Error(t('bridge.knowledge.cancelled'));

/** git stderr 메시지 중 보여줄 한 줄: fatal/error 줄 → 마지막 줄 → 종료 코드 */
export function gitErrorLine(messages: string[], code: number | null): string {
  const pick =
    messages.find((l) => /^fatal:/i.test(l)) ?? messages.find((l) => /^error:/i.test(l)) ?? messages.filter((l) => !/^Cloning into\b/.test(l)).pop();
  return (pick ?? `exit ${code ?? '?'}`).replace(/^(fatal|error):\s*/i, '');
}

export interface KnowledgeStoreOptions {
  /** 지식베이스 루트 폴더 (`<userData>/knowledge`) */
  root: string;
  /** 링크 가져오기용 fetch (테스트에서 바꾼다) */
  fetch?: typeof fetch;
  /** git 실행 환경 (PATH 등). 기본은 process.env */
  env?: NodeJS.ProcessEnv;
  /**
   * 호스트 이름의 모든 주소 (링크가 사설 주소로 풀리는지 확인).
   * 기본은 DNS 조회. fetch를 바꾼 테스트에서는 조회하지 않는다.
   */
  lookup?: (hostname: string) => Promise<string[]>;
  /** git 실행 파일 (테스트에서 가짜 git으로 바꾼다). 기본 'git' */
  gitBin?: string;
  /** 클론 무응답·전체 제한 시간 (테스트용) */
  cloneIdleMs?: number;
  cloneTimeoutMs?: number;
}

const dnsLookupAll = async (hostname: string): Promise<string[]> =>
  (await dnsLookup(hostname, { all: true, verbatim: true })).map((a) => a.address);

/** 링크 리디렉션 최대 횟수 */
const MAX_REDIRECTS = 5;

export interface KnowledgeStore {
  list(): Promise<KnowledgeBase[]>;
  create(name: string): Promise<KnowledgeBase>;
  rename(id: string, name: string): Promise<KnowledgeBase>;
  remove(id: string): Promise<void>;
  tree(id: string): Promise<KnowledgeEntry[]>;
  addPaths(id: string, paths: string[], dest?: string, ctl?: KnowledgeTaskControl): Promise<KnowledgeAddResult>;
  addFiles(
    id: string,
    files: { name: string; data: Uint8Array }[],
    dest?: string,
    ctl?: KnowledgeTaskControl,
  ): Promise<KnowledgeAddResult>;
  addLink(id: string, url: string, ctl?: KnowledgeTaskControl): Promise<KnowledgeAddResult>;
  cloneGit(id: string, url: string, ctl?: KnowledgeTaskControl): Promise<KnowledgeAddResult>;
  removeEntry(id: string, relPath: string): Promise<void>;
  preview(id: string, relPath: string): Promise<KnowledgePreview>;
  /** 지식베이스 폴더(files/) 절대 경로. 답변 CLI의 작업 폴더로 쓴다 */
  dirFor(id: string): string;
  /** 답변용 파일 목록: 파일 경로(files/ 기준)를 최대 indexPaths개 + 전체 개수 */
  index(id: string): Promise<{ paths: string[]; total: number }>;
  /** 경로(files/ 기준)를 절대 경로로 바꾼다. 항목이 없거나 링크면 throw */
  resolvePath(id: string, relPath: string): Promise<string>;
}

interface Budget {
  files: number;
  bytes: number;
  visited: number;
  skipped: number;
  /** 이번 호출에서 복사한 파일 수·바이트 (진행 알림용) */
  copied: number;
  copiedBytes: number;
  ctl?: KnowledgeTaskControl;
}

/** 디렉터리를 재귀로 훑어 항목을 모은다 (숨김·링크 제외) */
async function walk(dirAbs: string, prefix: string, out: KnowledgeEntry[], budget: { n: number }): Promise<void> {
  let names: import('node:fs').Dirent[];
  try {
    names = await readdir(dirAbs, { withFileTypes: true });
  } catch {
    return;
  }
  names.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const d of names) {
    if (isHidden(d.name) || budget.n >= WALK_MAX_ENTRIES) continue;
    budget.n++;
    const rel = prefix ? `${prefix}/${d.name}` : d.name;
    const abs = path.join(dirAbs, d.name);
    if (d.isSymbolicLink()) continue;
    if (d.isDirectory()) {
      out.push({ path: rel, dir: true });
      await walk(abs, rel, out, budget);
    } else if (d.isFile()) {
      const st = await lstatOrNull(abs);
      out.push({ path: rel, dir: false, size: st?.size ?? 0 });
    }
  }
}

/** 크기·개수 합계 (files/ 기준) */
async function measure(dirAbs: string): Promise<{ fileCount: number; totalBytes: number }> {
  const entries: KnowledgeEntry[] = [];
  await walk(dirAbs, '', entries, { n: 0 });
  let fileCount = 0;
  let totalBytes = 0;
  for (const e of entries) {
    if (!e.dir) {
      fileCount++;
      totalBytes += e.size ?? 0;
    }
  }
  return { fileCount, totalBytes };
}

export function createKnowledgeStore(opts: KnowledgeStoreOptions): KnowledgeStore {
  const root = path.resolve(opts.root);
  const doFetch = opts.fetch ?? fetch;
  /** 지식베이스 폴더를 품거나 그 안에 있는 경로 (자기 자신으로 복사해 끝없이 커지는 것을 막는다) */
  const overlapsRoot = (p: string): boolean => {
    const src = path.resolve(p);
    const base = path.resolve(root);
    return src === base || base.startsWith(src + path.sep) || src.startsWith(base + path.sep);
  };
  const lookupAll = opts.lookup ?? (opts.fetch ? async () => [] : dnsLookupAll);
  const gitEnv = opts.env ?? process.env;
  const gitBin = opts.gitBin ?? 'git';
  const cloneIdleMs = opts.cloneIdleMs ?? CLONE_IDLE_MS;
  const cloneTimeoutMs = opts.cloneTimeoutMs ?? CLONE_TIMEOUT_MS;

  // 변경 작업은 하나씩 (같은 지식베이스에 동시에 쓰지 않게)
  let chain: Promise<unknown> = Promise.resolve();
  function serial<T>(fn: () => Promise<T>): Promise<T> {
    const p = chain.then(fn, fn);
    chain = p.catch(() => undefined);
    return p;
  }

  const kbDir = (id: string) => path.join(root, checkId(id));
  const filesDir = (id: string) => path.join(kbDir(id), 'files');
  const metaPath = (id: string) => path.join(kbDir(id), 'meta.json');

  async function readMeta(id: string): Promise<{ name: string; createdAt: number; updatedAt: number } | null> {
    try {
      const raw = JSON.parse(await readFile(metaPath(id), 'utf8')) as Record<string, unknown>;
      if (typeof raw.name !== 'string' || typeof raw.createdAt !== 'number' || typeof raw.updatedAt !== 'number') return null;
      return { name: raw.name, createdAt: raw.createdAt, updatedAt: raw.updatedAt };
    } catch {
      return null;
    }
  }

  async function existingKb(id: string): Promise<{ name: string; createdAt: number; updatedAt: number }> {
    const st = await lstatOrNull(kbDir(id));
    if (!st?.isDirectory()) throw new KnowledgeNotFoundError(t('bridge.knowledge.notFound'));
    const meta = await readMeta(id);
    if (!meta) throw new KnowledgeNotFoundError(t('bridge.knowledge.notFound'));
    return meta;
  }

  async function toBase(id: string, meta: { name: string; createdAt: number; updatedAt: number }): Promise<KnowledgeBase> {
    const m = await measure(filesDir(id));
    return { id, name: meta.name, createdAt: meta.createdAt, updatedAt: meta.updatedAt, ...m };
  }

  async function saveMeta(id: string, meta: { name: string; createdAt: number; updatedAt: number }) {
    // 임시 파일에 쓰고 바꿔 끼워, 중간에 꺼져도 meta.json이 깨지지 않게 한다
    const tmp = `${metaPath(id)}.${randomBytes(4).toString('hex')}.tmp`;
    await writeFile(tmp, JSON.stringify(meta), 'utf8');
    await rename(tmp, metaPath(id));
  }

  /**
   * files/ 아래 상대 경로의 실제 위치를 찾는다. 중간 조각이 링크이거나 파일이면 throw.
   * mustExist=false면 없는 조각을 허용한다(쓰기 전 확인용).
   */
  async function locate(id: string, rel: string | undefined, mustExist: boolean): Promise<{ abs: string; exists: boolean }> {
    const segs = splitRel(rel);
    let cur = filesDir(id);
    for (const [i, seg] of segs.entries()) {
      cur = path.join(cur, seg);
      const st = await lstatOrNull(cur);
      if (!st) {
        if (mustExist) fail(t('bridge.knowledge.entryNotFound'));
        return { abs: path.join(filesDir(id), ...segs), exists: false };
      }
      if (st.isSymbolicLink()) fail(t('bridge.knowledge.badPath'));
      if (i < segs.length - 1 && !st.isDirectory()) fail(t('bridge.knowledge.badPath'));
    }
    return { abs: cur, exists: true };
  }

  /** dest 폴더를 찾아 없으면 만든다 (쓰기 전용) */
  async function ensureDir(id: string, rel: string | undefined): Promise<string> {
    const segs = splitRel(rel);
    let cur = filesDir(id);
    await mkdir(cur, { recursive: true });
    for (const s of segs) {
      cur = path.join(cur, s);
      const st = await lstatOrNull(cur);
      if (!st) await mkdir(cur);
      else if (st.isSymbolicLink() || !st.isDirectory()) fail(t('bridge.knowledge.badPath'));
    }
    return cur;
  }

  const relOf = (id: string, abs: string) => path.relative(filesDir(id), abs).split(path.sep).join('/');

  /** 디스크 항목 하나를 dstDir로 복사한다. 제한을 넘으면 건너뛰고 skipped를 센다 */
  async function importEntry(
    src: string,
    name: string,
    dstDir: string,
    budget: Budget,
    onCreate?: (abs: string) => void,
  ): Promise<string | null> {
    if (budget.ctl?.signal?.aborted) throw cancelledError();
    if (budget.visited++ > WALK_MAX_ENTRIES) {
      budget.skipped++;
      return null;
    }
    if (isHidden(name) || !isSafeSegment(name)) {
      budget.skipped++;
      return null;
    }
    const st = await lstatOrNull(src);
    if (!st || st.isSymbolicLink()) {
      budget.skipped++;
      return null;
    }
    if (st.isDirectory()) {
      const target = path.join(dstDir, await uniqueName(dstDir, name));
      await mkdir(target);
      onCreate?.(target);
      let kids: import('node:fs').Dirent[];
      try {
        kids = await readdir(src, { withFileTypes: true });
      } catch {
        kids = [];
      }
      kids.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
      for (const k of kids) {
        await importEntry(path.join(src, k.name), k.name, target, budget);
      }
      return target;
    }
    if (!st.isFile()) {
      budget.skipped++;
      return null;
    }
    if (st.size > KNOWLEDGE_LIMITS.fileBytes || budget.files + 1 > KNOWLEDGE_LIMITS.files || budget.bytes + st.size > KNOWLEDGE_LIMITS.totalBytes) {
      budget.skipped++;
      return null;
    }
    const target = path.join(dstDir, await uniqueName(dstDir, name));
    onCreate?.(target);
    await copyFile(src, target, fsc.COPYFILE_EXCL);
    budget.files++;
    budget.bytes += st.size;
    reportCopy(budget, st.size);
    return target;
  }

  async function budgetOf(id: string, ctl?: KnowledgeTaskControl): Promise<Budget> {
    const m = await measure(filesDir(id));
    return { files: m.fileCount, bytes: m.totalBytes, visited: 0, skipped: 0, copied: 0, copiedBytes: 0, ctl };
  }

  function reportCopy(budget: Budget, size: number) {
    budget.copied++;
    budget.copiedBytes += size;
    budget.ctl?.onProgress?.({ phase: 'copy', files: budget.copied, bytes: budget.copiedBytes });
  }

  /** 취소되면 이번 호출에서 만든 최상위 항목을 지운다 (반쯤 복사된 폴더를 남기지 않게) */
  async function rollback(created: string[]) {
    for (const abs of created.reverse()) await rm(abs, { recursive: true, force: true }).catch(() => undefined);
  }

  function checkBudget(b: { files: number; bytes: number }, adding: { files: number; bytes: number }) {
    if (b.files + adding.files > KNOWLEDGE_LIMITS.files) fail(t('bridge.knowledge.tooManyFiles'));
    if (b.bytes + adding.bytes > KNOWLEDGE_LIMITS.totalBytes) fail(t('bridge.knowledge.tooManyBytes'));
  }

  /** 디스크에서 클론한 임시 폴더가 지식베이스 한도 안인지 */
  async function assertCloneFits(id: string, dirAbs: string) {
    const added = await measure(dirAbs);
    const cur = await measure(filesDir(id));
    checkBudget({ files: cur.fileCount, bytes: cur.totalBytes }, { files: added.fileCount, bytes: added.totalBytes });
  }

  async function removeSymlinks(dirAbs: string) {
    const names = await readdir(dirAbs, { withFileTypes: true }).catch(() => []);
    for (const d of names) {
      const abs = path.join(dirAbs, d.name);
      if (d.isSymbolicLink()) await rm(abs, { force: true });
      else if (d.isDirectory()) await removeSymlinks(abs);
    }
  }

  /** git 프로세스와 그 자식(git-remote-https 등)을 모두 끝낸다 */
  function killTree(child: ChildProcess) {
    const pid = child.pid;
    if (!pid) return;
    try {
      if (process.platform === 'win32') {
        spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }).on('error', () => undefined);
      } else {
        process.kill(-pid, 'SIGKILL');
      }
    } catch {
      try {
        child.kill('SIGKILL');
      } catch {
        // 이미 끝났다
      }
    }
  }

  /**
   * git을 실행한다. stderr의 진행 줄을 진행률로 알리고, 무응답·전체 시간 초과·취소 시 프로세스 트리를 끝낸다.
   * 'close'(stdio 닫힘)만 기다리면 손자 프로세스가 파이프를 붙잡아 영원히 끝나지 않을 수 있어 'exit'로 끝낸다.
   */
  function runGit(args: string[], cwd: string, ctl?: KnowledgeTaskControl): Promise<void> {
    return new Promise((resolve, reject) => {
      const signal = ctl?.signal;
      if (signal?.aborted) return reject(cancelledError());
      const win = process.platform === 'win32';
      let child: ChildProcess;
      try {
        child = spawn(gitBin, args, {
          cwd,
          shell: false,
          // posix: 새 프로세스 그룹으로 띄워 그룹째 끝낼 수 있게 한다
          detached: !win,
          windowsHide: true,
          stdio: ['ignore', 'ignore', 'pipe'],
          env: {
            ...gitEnv,
            GIT_TERMINAL_PROMPT: '0',
            GCM_INTERACTIVE: 'never',
            GIT_ASKPASS: '',
            SSH_ASKPASS: '',
            GIT_LFS_SKIP_SMUDGE: '1',
          },
        });
      } catch {
        return reject(new Error(t('bridge.knowledge.gitMissing')));
      }
      let done = false;
      let tail = '';
      const messages: string[] = [];
      const handleLine = (raw: string) => {
        const line = raw.trim();
        if (!line) return;
        const ratio = parseGitProgress(line);
        if (ratio === null) {
          if (messages.length < 20) messages.push(line);
        } else {
          ctl?.onProgress?.({ phase: 'clone', ratio });
        }
      };
      const settle = (err?: Error) => {
        if (done) return;
        done = true;
        clearTimeout(idle);
        clearTimeout(hard);
        clearTimeout(grace);
        signal?.removeEventListener('abort', onAbort);
        if (tail) handleLine(tail);
        tail = '';
        child.stderr?.destroy();
        if (err) reject(err);
        else resolve();
      };
      const stop = (err: Error) => {
        killTree(child);
        settle(err);
      };
      const onAbort = () => stop(cancelledError());
      const idle = setTimeout(() => stop(new Error(t('bridge.knowledge.cloneStalled'))), cloneIdleMs);
      const hard = setTimeout(() => stop(new Error(t('bridge.knowledge.cloneTimeout'))), cloneTimeoutMs);
      let grace: ReturnType<typeof setTimeout> | undefined;
      signal?.addEventListener('abort', onAbort, { once: true });
      child.stderr?.setEncoding('utf8');
      child.stderr?.on('data', (c: string) => {
        idle.refresh();
        tail += c;
        const parts = tail.split(/[\r\n]+/);
        tail = parts.pop() ?? '';
        if (tail.length > 4000) tail = tail.slice(-4000);
        for (const line of parts) handleLine(line);
      });
      child.stderr?.on('error', () => undefined);
      child.on('error', (err: NodeJS.ErrnoException) => {
        settle(
          new Error(err.code === 'ENOENT' ? t('bridge.knowledge.gitMissing') : t('bridge.knowledge.cloneFailed', { error: err.code ?? 'error' })),
        );
      });
      const finish = (code: number | null) => {
        if (done) return;
        if (tail) handleLine(tail);
        tail = '';
        if (code === 0) return settle();
        // 남은 자식이 있으면 함께 끝낸다
        killTree(child);
        // 없는/비공개 저장소는 git이 인증을 요구하며 실패한다 (인증 프롬프트는 끈다)
        const notFound = messages.some((m) => /could not read Username|Authentication failed|repository .*not found|terminal prompts disabled/i.test(m));
        settle(new Error(notFound ? t('bridge.knowledge.repoNotFound') : t('bridge.knowledge.cloneFailed', { error: gitErrorLine(messages, code).slice(0, 200) })));
      };
      child.on('exit', (code) => {
        // stderr 마지막 줄을 읽을 시간을 잠깐 준다
        grace = setTimeout(() => finish(code), CLONE_CLOSE_GRACE_MS);
      });
      child.on('close', (code) => finish(code));
    });
  }

  /** 링크 한 개를 가져온다 (네트워크, 큐 밖에서 실행). 마크다운 본문을 돌려준다 */
  async function fetchPage(url: string, outer?: AbortSignal): Promise<{ title: string; markdown: string; finalUrl: string }> {
    if (!isKnowledgeLinkUrl(url)) fail(t('bridge.knowledge.badUrl'));
    const first = new URL(url.trim());
    /** 호스트가 사설 주소이거나 사설 주소로 풀리면 막는다 */
    const assertPublic = async (u: URL) => {
      if (u.protocol !== 'https:' && u.protocol !== 'http:') fail(t('bridge.knowledge.badUrl'));
      if (u.username || u.password) fail(t('bridge.knowledge.badUrl'));
      if (isPrivateHost(u.hostname)) fail(t('bridge.knowledge.privateHost'));
      let addrs: string[];
      try {
        addrs = await lookupAll(u.hostname.replace(/^\[|\]$/g, ''));
      } catch {
        return fail(t('bridge.knowledge.fetchFailed'));
      }
      if (addrs.some((a) => isPrivateHost(a))) fail(t('bridge.knowledge.privateHost'));
    };
    // 리디렉션은 직접 따라가며 매 단계 주소를 확인한다 (요청 전에)
    let current = first;
    let res: Response | null = null;
    const signal = outer ? AbortSignal.any([outer, AbortSignal.timeout(FETCH_TIMEOUT_MS)]) : AbortSignal.timeout(FETCH_TIMEOUT_MS);
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      await assertPublic(current);
      let r: Response;
      try {
        r = await doFetch(current.href, {
          redirect: 'manual',
          signal,
          headers: { accept: 'text/html,application/xhtml+xml,text/plain;q=0.8' },
        });
      } catch {
        if (outer?.aborted) throw cancelledError();
        return fail(t('bridge.knowledge.fetchFailed'));
      }
      const loc = r.status >= 300 && r.status < 400 ? r.headers.get('location') : null;
      if (!loc) {
        res = r;
        break;
      }
      try {
        current = new URL(loc, current);
      } catch {
        return fail(t('bridge.knowledge.fetchFailed'));
      }
    }
    if (!res) return fail(t('bridge.knowledge.fetchFailed'));
    if (!res.ok) fail(t('bridge.knowledge.fetchFailed'));
    // fetch가 스스로 따라간 경우(테스트·다른 구현)도 최종 주소를 다시 본다
    const finalUrl = res.url || current.href;
    if (isPrivateHost(new URL(finalUrl).hostname)) fail(t('bridge.knowledge.privateHost'));
    const type = res.headers.get('content-type') ?? '';
    if (type && !/text\/|html|xml/i.test(type)) fail(t('bridge.knowledge.notHtml'));
    const len = Number(res.headers.get('content-length') ?? '0');
    if (len > HTML_MAX_BYTES) fail(t('bridge.knowledge.htmlTooLarge'));
    let buf: Uint8Array;
    try {
      buf = new Uint8Array(await res.arrayBuffer());
    } catch {
      if (outer?.aborted) throw cancelledError();
      return fail(t('bridge.knowledge.fetchFailed'));
    }
    if (buf.byteLength > HTML_MAX_BYTES) fail(t('bridge.knowledge.htmlTooLarge'));
    const html = new TextDecoder('utf-8').decode(buf);
    const title = extractTitle(html);
    const markdown = htmlToMarkdown(html);
    return { title, markdown, finalUrl };
  }

  async function addDocument(id: string, dir: string, name: string, body: string | Uint8Array, budget: Budget): Promise<string> {
    const size = typeof body === 'string' ? Buffer.byteLength(body, 'utf8') : body.byteLength;
    if (size > KNOWLEDGE_LIMITS.fileBytes) fail(t('bridge.knowledge.tooLarge'));
    checkBudget(budget, { files: 1, bytes: size });
    const target = path.join(dir, await uniqueName(dir, name));
    await writeFile(target, body, { flag: 'wx' });
    budget.files++;
    budget.bytes += size;
    return relOf(id, target);
  }

  const store: KnowledgeStore = {
    async list() {
      let names: string[];
      try {
        names = await readdir(root);
      } catch {
        return [];
      }
      const out: KnowledgeBase[] = [];
      for (const n of names.sort()) {
        if (!KNOWLEDGE_ID_RE.test(n)) continue;
        const st = await lstatOrNull(path.join(root, n));
        if (!st?.isDirectory()) continue;
        const meta = await readMeta(n);
        if (meta) out.push(await toBase(n, meta));
      }
      return out;
    },

    create(name) {
      return serial(async () => {
        const clean = cleanKnowledgeName(name);
        if (!clean) fail(t('bridge.knowledge.badName'));
        await mkdir(root, { recursive: true });
        const id = newId('kb');
        checkId(id);
        await mkdir(filesDir(id), { recursive: true });
        const now = Date.now();
        const meta = { name: clean, createdAt: now, updatedAt: now };
        await saveMeta(id, meta);
        return toBase(id, meta);
      });
    },

    rename(id, name) {
      return serial(async () => {
        const clean = cleanKnowledgeName(name);
        if (!clean) fail(t('bridge.knowledge.badName'));
        const meta = await existingKb(id);
        const next = { ...meta, name: clean, updatedAt: Date.now() };
        await saveMeta(id, next);
        return toBase(id, next);
      });
    },

    remove(id) {
      return serial(async () => {
        await existingKb(id);
        await rm(kbDir(id), { recursive: true, force: false });
      });
    },

    async tree(id) {
      await existingKb(id);
      const out: KnowledgeEntry[] = [];
      await walk(filesDir(id), '', out, { n: 0 });
      return out;
    },

    async index(id) {
      await existingKb(id);
      const entries: KnowledgeEntry[] = [];
      await walk(filesDir(id), '', entries, { n: 0 });
      const files = entries.filter((e) => !e.dir).map((e) => e.path);
      return { paths: files.slice(0, KNOWLEDGE_LIMITS.indexPaths), total: files.length };
    },

    dirFor(id) {
      return filesDir(id);
    },

    addPaths(id, paths, dest, ctl) {
      return serial(async () => {
        if (ctl?.signal?.aborted) throw cancelledError();
        await existingKb(id);
        if (!Array.isArray(paths) || paths.length > 500) fail(t('bridge.knowledge.badPath'));
        const dstDir = await ensureDir(id, dest);
        const budget = await budgetOf(id, ctl);
        ctl?.onProgress?.({ phase: 'copy', files: 0, bytes: 0 });
        const added: string[] = [];
        const created: string[] = [];
        try {
          for (const p of paths) {
            if (typeof p !== 'string' || !path.isAbsolute(p) || p.includes('\0') || overlapsRoot(p)) {
              budget.skipped++;
              continue;
            }
            let top = true;
            const target = await importEntry(p, path.basename(p), dstDir, budget, (abs) => {
              if (top) created.push(abs);
              top = false;
            });
            if (target) added.push(relOf(id, target));
          }
        } catch (e) {
          await rollback(created);
          throw e;
        }
        await touch(id);
        return { added, skipped: budget.skipped };
      });
    },

    addFiles(id, files, dest, ctl) {
      return serial(async () => {
        if (ctl?.signal?.aborted) throw cancelledError();
        await existingKb(id);
        if (!Array.isArray(files) || files.length > 500) fail(t('bridge.knowledge.badPath'));
        const dstDir = await ensureDir(id, dest);
        const budget = await budgetOf(id, ctl);
        const added: string[] = [];
        for (const f of files) {
          if (ctl?.signal?.aborted) {
            await rollback(added.map((r) => path.join(filesDir(id), ...r.split('/'))));
            throw cancelledError();
          }
          const name = typeof f?.name === 'string' ? f.name.trim() : '';
          if (!isSafeSegment(name) || !(f.data instanceof Uint8Array) || f.data.byteLength > KNOWLEDGE_LIMITS.fileBytes) {
            budget.skipped++;
            continue;
          }
          if (budget.files + 1 > KNOWLEDGE_LIMITS.files || budget.bytes + f.data.byteLength > KNOWLEDGE_LIMITS.totalBytes) {
            budget.skipped++;
            continue;
          }
          added.push(await addDocument(id, dstDir, name, f.data, budget));
          reportCopy(budget, f.data.byteLength);
        }
        await touch(id);
        return { added, skipped: budget.skipped };
      });
    },

    async addLink(id, url, ctl) {
      await existingKb(id);
      ctl?.onProgress?.({ phase: 'download' });
      const page = await fetchPage(url, ctl?.signal);
      return serial(async () => {
        if (ctl?.signal?.aborted) throw cancelledError();
        await existingKb(id);
        ctl?.onProgress?.({ phase: 'save' });
        const dstDir = await ensureDir(id, 'links');
        const budget = await budgetOf(id);
        const title = page.title || new URL(page.finalUrl).hostname;
        const body = `# ${page.title || title}\n\n${page.finalUrl}\n\n${page.markdown}\n`;
        const name = `${slugify(title)}.md`;
        const rel = await addDocument(id, dstDir, name, body, budget);
        await touch(id);
        return { added: [rel], skipped: 0 };
      });
    },

    async cloneGit(id, url, ctl) {
      await existingKb(id);
      const repo = parseGitHubRepo(url);
      if (!repo) fail(t('bridge.knowledge.badRepo'));
      // 임시 클론은 지식베이스 폴더 안(files/ 밖)에 두고, 확인 후 files/repos/로 옮긴다
      const tmp = path.join(kbDir(id), `.clone-${randomBytes(6).toString('hex')}`);
      try {
        ctl?.onProgress?.({ phase: 'clone' });
        await runGit(gitCloneArgs(repo.url, tmp), kbDir(id), ctl);
        ctl?.onProgress?.({ phase: 'save' });
        await rm(path.join(tmp, '.git'), { recursive: true, force: true });
        await removeSymlinks(tmp);
        return await serial(async () => {
          if (ctl?.signal?.aborted) throw cancelledError();
          await existingKb(id);
          await assertCloneFits(id, tmp);
          const reposDir = await ensureDir(id, 'repos');
          const target = path.join(reposDir, await uniqueName(reposDir, repo.repo));
          await rename(tmp, target);
          await touch(id);
          return { added: [relOf(id, target)], skipped: 0 };
        });
      } finally {
        await rm(tmp, { recursive: true, force: true }).catch(() => undefined);
      }
    },

    removeEntry(id, relPath) {
      return serial(async () => {
        await existingKb(id);
        if (!relPath) fail(t('bridge.knowledge.badPath'));
        const { abs, exists } = await locate(id, relPath, false);
        if (!exists) fail(t('bridge.knowledge.entryNotFound'));
        await rm(abs, { recursive: true, force: false });
        await touch(id);
      });
    },

    async preview(id, relPath) {
      await existingKb(id);
      if (!relPath) fail(t('bridge.knowledge.badPath'));
      const { abs } = await locate(id, relPath, true);
      const st = await lstatOrNull(abs);
      if (!st?.isFile()) fail(t('bridge.knowledge.badPath'));
      const fh = await open(abs, 'r');
      try {
        const buf = Buffer.alloc(Math.min(st.size, PREVIEW_READ_BYTES));
        const { bytesRead } = await fh.read(buf, 0, buf.length, 0);
        const head = buf.subarray(0, bytesRead);
        if (head.includes(0)) return { text: null, size: st.size, truncated: false };
        const full = head.toString('utf8');
        const text = full.slice(0, KNOWLEDGE_LIMITS.previewChars);
        return { text, size: st.size, truncated: st.size > bytesRead || full.length > text.length };
      } finally {
        await fh.close();
      }
    },

    async resolvePath(id, relPath) {
      await existingKb(id);
      const { abs, exists } = await locate(id, relPath, true);
      if (!exists) fail(t('bridge.knowledge.entryNotFound'));
      return abs;
    },
  };

  /** 수정 시각 갱신 (메타 파일이 있을 때만) */
  async function touch(id: string) {
    const meta = await readMeta(id);
    if (meta) await saveMeta(id, { ...meta, updatedAt: Date.now() });
  }

  return store;
}
