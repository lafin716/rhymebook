import { lstat, open, readdir, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { KB_TOOL_LIMITS, KbToolError, type KbDirEntry, type KbOutlineItem, isKnowledgePath } from '@branch/core';


/**
 * KB files/ 아래 상대 경로를 실제 경로로 바꾸고, 결과가 files/ 안에 있는지 확인한다.
 * 경로 형식이 틀리면 bad_path. 중간이나 끝의 구성 요소가 심볼릭 링크면 bad_path (링크 폴더 미추적).
 * 없으면 not_found. rel은 빈 문자열이면 루트다.
 */
export async function resolveInside(filesRoot: string, rel: string): Promise<{ abs: string; isDir: boolean; size: number }> {
  if (rel && !isKnowledgePath(rel)) throw new KbToolError('bad_path', 'invalid path');
  const rootReal = await realpath(filesRoot).catch(() => {
    throw new KbToolError('not_found', 'knowledge files folder not found');
  });
  // 구성 요소를 하나씩 lstat해서 심볼릭 링크(디렉터리 포함)를 거부한다
  let walk = filesRoot;
  for (const part of rel ? rel.split('/') : []) {
    walk = path.join(walk, part);
    const st = await lstat(walk).catch(() => {
      throw new KbToolError('not_found', `not found: ${rel}`);
    });
    if (st.isSymbolicLink()) throw new KbToolError('bad_path', 'symbolic links are not followed');
  }
  const candidate = rel ? path.join(filesRoot, ...rel.split('/')) : filesRoot;
  let real: string;
  try {
    real = await realpath(candidate);
  } catch {
    throw new KbToolError('not_found', `not found: ${rel || '/'}`);
  }
  if (real !== rootReal && !real.startsWith(rootReal + path.sep)) {
    throw new KbToolError('bad_path', 'path leaves the knowledge base');
  }
  const st = await stat(real);
  return { abs: real, isDir: st.isDirectory(), size: st.size };
}

/** 한 폴더의 항목 (숨김·심볼릭 링크 제외). 페이지 단위로 자른다 */
export async function listDir(
  filesRoot: string,
  rel: string,
  offset: number,
  /** 추가 필터 (상대 경로, 폴더 여부). false면 목록에서 뺀다 (코드베이스 제외 규칙) */
  filter?: (rel: string, dir: boolean) => boolean,
): Promise<{ entries: KbDirEntry[]; nextOffset?: number }> {
  const target = await resolveInside(filesRoot, rel);
  if (!target.isDir) throw new KbToolError('not_a_directory', `not a directory: ${rel || '/'}`);
  const names = await readdir(target.abs, { withFileTypes: true });
  const visible = names
    .filter((d) => !d.name.startsWith('.') && !d.isSymbolicLink() && (d.isDirectory() || d.isFile()))
    .filter((d) => !filter || filter(rel ? `${rel}/${d.name}` : d.name, d.isDirectory()))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const page = visible.slice(offset, offset + KB_TOOL_LIMITS.listPageSize);
  const entries: KbDirEntry[] = [];
  for (const d of page) {
    const childRel = rel ? `${rel}/${d.name}` : d.name;
    if (d.isDirectory()) {
      entries.push({ name: d.name, path: `${childRel}`, type: 'directory' });
    } else {
      const st = await stat(path.join(target.abs, d.name)).catch(() => undefined);
      entries.push({ name: d.name, path: childRel, type: 'file', ...(st ? { size: st.size } : {}) });
    }
  }
  const next = offset + page.length;
  return { entries, ...(next < visible.length ? { nextOffset: next } : {}) };
}

/** 파일 본문을 읽는다. 크기·바이너리 검사 후 UTF-8 텍스트와 줄 배열을 돌려준다 */
export async function readText(filesRoot: string, rel: string): Promise<{ lines: string[]; path: string }> {
  const target = await resolveInside(filesRoot, rel);
  if (target.isDir) throw new KbToolError('not_a_file', 'path is a directory');
  if (target.size > KB_TOOL_LIMITS.readMaxFileBytes) throw new KbToolError('too_large', 'file is too large to read');
  const fh = await open(target.abs, 'r');
  let buf: Buffer;
  try {
    buf = Buffer.alloc(target.size);
    await fh.read(buf, 0, target.size, 0);
  } finally {
    await fh.close();
  }
  if (buf.includes(0)) throw new KbToolError('binary_file', 'binary file is not readable as text');
  const text = buf.toString('utf8');
  const lines = text.split('\n').map((l) => (l.endsWith('\r') ? l.slice(0, -1) : l));
  // 마지막 줄바꿈 뒤의 빈 조각은 줄이 아니다
  if (lines.length && lines[lines.length - 1] === '') lines.pop();
  return { lines, path: rel };
}

const HEADING_RE = /^(#{1,6})\s+(.+?)\s*#*\s*$/;
const SYMBOL_RE =
  /^\s*(?:export\s+(?:default\s+)?)?(?:pub\s+)?(?:async\s+)?(?:public\s+|private\s+|protected\s+)?(function|class|interface|type|enum|struct|trait|impl|def|fn|func|const|let|var)\s+([A-Za-z_][\w$]*)/;

/** 파일 개요: 마크다운 헤딩과 흔한 선언 키워드 (정규식 기반, 근사치) */
export function outlineOfLines(lines: string[], isMarkdown: boolean): { items: KbOutlineItem[]; truncated: boolean } {
  const items: KbOutlineItem[] = [];
  let truncated = false;
  lines.forEach((line, i) => {
    if (truncated) return;
    let item: KbOutlineItem | undefined;
    const h = isMarkdown ? HEADING_RE.exec(line) : null;
    if (h) item = { kind: 'heading', name: h[2]!.slice(0, 200), level: h[1]!.length, startLine: i + 1 };
    else if (!isMarkdown) {
      const s = SYMBOL_RE.exec(line);
      if (s) item = { kind: 'symbol', name: `${s[1]} ${s[2]}`.slice(0, 200), startLine: i + 1 };
    }
    if (!item) return;
    if (items.length >= KB_TOOL_LIMITS.outlineMaxItems) {
      truncated = true;
      return;
    }
    items.push(item);
  });
  return { items, truncated };
}

export function isMarkdownPath(p: string): boolean {
  return /\.(md|markdown|mdx)$/i.test(p);
}
