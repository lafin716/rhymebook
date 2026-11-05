/**
 * 파일 텍스트 → ParsedDocument (구조 블록). 바이너리 디코딩·PDF 텍스트 추출은 플랫폼 몫이고,
 * 여기서는 이미 텍스트가 된 입력(text 또는 PDF 페이지 배열)만 받는다.
 */
import type { DocKind, ParsedBlock, ParsedDocument } from './types';

const CODE_LANG: Record<string, string> = {
  ts: 'typescript', tsx: 'typescript', mts: 'typescript', cts: 'typescript',
  js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
  py: 'python', go: 'go', rs: 'rust', java: 'java', kt: 'kotlin', kts: 'kotlin',
  c: 'c', h: 'c', cc: 'cpp', cpp: 'cpp', hpp: 'cpp', cs: 'csharp', rb: 'ruby', php: 'php',
  swift: 'swift', sh: 'shell', bash: 'shell', zsh: 'shell',
};

const KIND_BY_EXT: Record<string, DocKind> = {
  md: 'markdown', markdown: 'markdown', mdx: 'markdown',
  txt: 'text', rst: 'text', adoc: 'text', log: 'text',
  html: 'html', htm: 'html',
  pdf: 'pdf',
  json: 'config', yaml: 'config', yml: 'config', toml: 'config', ini: 'config', cfg: 'config', xml: 'config',
  ...Object.fromEntries(Object.keys(CODE_LANG).map((e) => [e, 'code' as DocKind])),
};

const EXCLUDED_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'out', 'coverage', 'target', '.next', '.nuxt', '__pycache__',
  'vendor', '.venv', 'venv', '.cache', '.turbo',
]);

const LOCK_FILES = new Set([
  'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lockb', 'Cargo.lock', 'poetry.lock',
  'composer.lock', 'Gemfile.lock', 'go.sum',
]);

function baseName(path: string): string {
  const i = path.lastIndexOf('/');
  return i < 0 ? path : path.slice(i + 1);
}

function extOf(path: string): string | null {
  const name = baseName(path);
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return null;
  return name.slice(dot + 1).toLowerCase();
}

/** 확장자로 문서 종류를 정한다. 색인 대상이 아니면 null */
export function docKindOf(path: string): DocKind | null {
  const ext = extOf(path);
  if (!ext) return null;
  return KIND_BY_EXT[ext] ?? null;
}

/** 색인 대상인가: 지원 종류이고, 의존성·빌드 산출물·잠금 파일이 아니다 */
export function isIndexablePath(path: string): boolean {
  const parts = path.split('/');
  if (parts.some((p) => EXCLUDED_DIRS.has(p))) return false;
  const name = baseName(path);
  if (LOCK_FILES.has(name)) return false;
  if (/\.min\.(js|css)$/i.test(name) || /\.map$/i.test(name)) return false;
  return docKindOf(path) !== null;
}

export interface ParseInput {
  path: string;
  text?: string;
  /** PDF: 페이지별 추출 텍스트 (1페이지부터 순서대로) */
  pages?: string[];
  /** 링크 문서의 원본 URL. 없으면 본문 머리말 `source:`에서 찾는다 */
  url?: string;
}

function stripExt(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(0, dot) : name;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&amp;/g, '&');
}

/** 머리말에서 원본 URL 찾기: `source: https://…` 줄 또는 `<!-- source: … -->` */
function findSourceUrl(text: string): string | undefined {
  const head = text.split('\n').slice(0, 15).join('\n');
  const comment = /<!--\s*source:\s*(https?:\/\/\S+?)\s*-->/i.exec(head);
  if (comment) return comment[1];
  const line = /^\s*(?:source|url)\s*:\s*(https?:\/\/\S+)\s*$/im.exec(head);
  return line ? line[1] : undefined;
}

function paragraphsOf(text: string, page?: number): ParsedBlock[] {
  const out: ParsedBlock[] = [];
  const lines = text.split('\n');
  let start = -1;
  const flush = (end: number) => {
    if (start < 0) return;
    const body = lines.slice(start, end + 1).join('\n').trim();
    if (body) out.push({ type: 'paragraph', text: body, lineStart: start + 1, lineEnd: end + 1, ...(page ? { page } : {}) });
    start = -1;
  };
  lines.forEach((line, i) => {
    if (line.trim() === '') flush(i - 1);
    else if (start < 0) start = i;
  });
  flush(lines.length - 1);
  return out;
}

function parseMarkdown(text: string): { blocks: ParsedBlock[]; title?: string } {
  const lines = text.split('\n');
  const blocks: ParsedBlock[] = [];
  let title: string | undefined;
  let i = 0;

  // 머리말(front matter)
  if ((lines[0] ?? '')?.trim() === '---') {
    const end = lines.findIndex((l, idx) => idx > 0 && l.trim() === '---');
    if (end > 0) {
      const t = lines.slice(1, end).find((l) => /^title\s*:/i.test(l));
      if (t) title = t.replace(/^title\s*:\s*/i, '').replace(/^["']|["']$/g, '').trim() || undefined;
      i = end + 1;
    }
  }

  while (i < lines.length) {
    const line = lines[i] ?? '';
    if (line.trim() === '') { i++; continue; }
    if (/^<!--\s*source:/i.test(line.trim())) { i++; continue; }

    const fence = /^\s*(```+|~~~+)\s*([\w+#.-]*)/.exec(line);
    if (fence) {
      const marker = (fence[1] ?? '').charAt(0).repeat(3);
      const lang = fence[2] || undefined;
      const start = i;
      let j = i + 1;
      while (j < lines.length && !(lines[j] ?? '').trim().startsWith(marker)) j++;
      const body = lines.slice(start + 1, j).join('\n');
      if (body.trim()) blocks.push({ type: 'code', text: body, lang, lineStart: start + 2, lineEnd: Math.max(start + 1, j) });
      i = j + 1;
      continue;
    }

    const heading = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (heading) {
      const depth = (heading[1] ?? '').length;
      const h = (heading[2] ?? '').trim();
      if (depth === 1 && title === undefined && h) title = h;
      if (h) blocks.push({ type: 'heading', depth, text: h, lineStart: i + 1, lineEnd: i + 1 });
      i++;
      continue;
    }

    if (/^\s*\|/.test(line)) {
      const start = i;
      while (i < lines.length && /^\s*\|/.test((lines[i] ?? ''))) i++;
      blocks.push({ type: 'table', text: lines.slice(start, i).join('\n'), lineStart: start + 1, lineEnd: i });
      continue;
    }

    if (/^\s*([-*+]|\d+[.)])\s+/.test(line)) {
      const start = i;
      while (i < lines.length && (lines[i] ?? '').trim() !== '' && (/^\s*([-*+]|\d+[.)])\s+/.test((lines[i] ?? '')) || /^\s{2,}\S/.test((lines[i] ?? '')))) i++;
      blocks.push({ type: 'list', text: lines.slice(start, i).join('\n'), lineStart: start + 1, lineEnd: i });
      continue;
    }

    const start = i;
    while (
      i < lines.length &&
      (lines[i] ?? '').trim() !== '' &&
      !/^\s*(```|~~~|#{1,6}\s|\|)/.test((lines[i] ?? '')) &&
      !/^\s*([-*+]|\d+[.)])\s+/.test((lines[i] ?? ''))
    ) i++;
    if (i === start) i++;
    const body = lines.slice(start, i).join('\n').trim();
    if (body) blocks.push({ type: 'paragraph', text: body, lineStart: start + 1, lineEnd: i });
  }
  return { blocks, title };
}

function htmlToMarkdown(html: string): { md: string; title?: string } {
  const titleM = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const title = titleM ? decodeEntities((titleM[1] ?? '').replace(/<[^>]+>/g, '')).trim() || undefined : undefined;
  let s = html
    .replace(/<!--(?!\s*source:)[\s\S]*?-->/g, '')
    .replace(/<(script|style|noscript|svg)\b[\s\S]*?<\/\1>/gi, '')
    .replace(/<pre[^>]*>\s*<code(?:[^>]*class="[^"]*language-([\w+#-]+)[^"]*")?[^>]*>([\s\S]*?)<\/code>\s*<\/pre>/gi,
      (_m, lang: string | undefined, body: string) => `\n\`\`\`${lang ?? ''}\n${decodeEntities(body.replace(/<[^>]+>/g, ''))}\n\`\`\`\n`)
    .replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_m, n: string, inner: string) =>
      `\n${'#'.repeat(Number(n))} ${decodeEntities(inner.replace(/<[^>]+>/g, '')).trim()}\n`)
    .replace(/<li[^>]*>/gi, '\n- ')
    .replace(/<\/(p|div|section|article|tr|table|ul|ol|blockquote)>|<(br|p|div|section|article|tr|table|ul|ol|blockquote)\b[^>]*>/gi, '\n\n');
  s = decodeEntities(s.replace(/<[^>]+>/g, ''));
  return { md: s.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n'), title };
}

const SYMBOL_RE =
  /^(?:(?:export|default|public|private|protected|internal|static|final|abstract|sealed|open|data|async|pub|override|inline|extern|const)\s+)*(?:function\*?|class|interface|struct|enum|trait|impl|object|module|record|def|fun|func|fn)\s+(?:\([^)]*\)\s*)?([A-Za-z_$][\w$]*)/;

function parseCode(text: string, lang: string | undefined): ParsedBlock[] {
  const lines = text.split('\n');
  const blocks: ParsedBlock[] = [];
  let symbol: string | undefined;
  let start = 0;
  const flush = (end: number) => {
    const body = lines.slice(start, end).join('\n');
    if (!body.trim()) return;
    blocks.push(symbol
      ? { type: 'symbol', symbol, text: body, lang, lineStart: start + 1, lineEnd: end }
      : { type: 'code', text: body, lang, lineStart: start + 1, lineEnd: end });
  };
  lines.forEach((line, i) => {
    const m = SYMBOL_RE.exec(line);
    if (m && i > start) {
      flush(i);
      start = i;
      symbol = m[1];
    } else if (m && i === start) {
      symbol = m[1];
    }
  });
  flush(lines.length);
  return blocks;
}

function parseText(text: string): ParsedBlock[] {
  return paragraphsOf(text);
}

/** 파싱. 빈 본문이어도 문서를 돌려준다 (블록 0개) */
export function parseDocument(input: ParseInput): ParsedDocument {
  const kind: DocKind = docKindOf(input.path) ?? 'text';
  const name = baseName(input.path);
  const ext = extOf(input.path);
  const lang = kind === 'code' && ext ? CODE_LANG[ext] : kind === 'config' && ext ? ext : undefined;

  if (kind === 'pdf') {
    const blocks: ParsedBlock[] = [];
    (input.pages ?? []).forEach((pageText, idx) => {
      blocks.push(...paragraphsOf(pageText.replace(/\r\n?/g, '\n'), idx + 1));
    });
    return { path: input.path, kind, title: stripExt(name), url: input.url, blocks };
  }

  const text = (input.text ?? '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const url = input.url ?? findSourceUrl(text);
  const base = { path: input.path, kind, lang, url };

  if (kind === 'markdown') {
    const r = parseMarkdown(text);
    return { ...base, title: r.title ?? stripExt(name), blocks: r.blocks };
  }
  if (kind === 'html') {
    const h = htmlToMarkdown(text);
    const r = parseMarkdown(h.md);
    return { ...base, title: h.title ?? r.title ?? stripExt(name), blocks: r.blocks };
  }
  if (kind === 'code') {
    return { ...base, title: stripExt(name), blocks: parseCode(text, lang) };
  }
  if (kind === 'config') {
    const lineCount = text.split('\n').length;
    const blocks: ParsedBlock[] = text.trim()
      ? [{ type: 'code', text, lang, lineStart: 1, lineEnd: lineCount }]
      : [];
    return { ...base, title: name, blocks };
  }
  return { ...base, title: stripExt(name), blocks: parseText(text) };
}
