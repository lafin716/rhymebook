/**
 * 문서 → 계층형 청크 (Small-to-Big). 섹션(부모, 큰 문맥)을 먼저 만들고 그 안을 leaf(검색 단위)로 나눈다.
 * 섹션 경계: 제목(markdown/html), 심볼(code), 페이지(pdf). text·config는 한 섹션 안에서 문단·줄 단위로 나눈다.
 */
import { sha256Hex } from './hash';
import { normalizeText } from './tokenize';
import type { Chunk, ChunkingOptions, ChunkingStrategy, ParsedBlock, ParsedDocument } from './types';

const DEFAULTS: Required<ChunkingOptions> = {
  leafChars: 900,
  maxLeafChars: 1600,
  maxSectionChars: 6000,
  overlapChars: 120,
};

interface Section {
  headingPath: string[];
  symbol?: string;
  page?: number;
  blocks: ParsedBlock[];
}

interface Unit {
  text: string;
  page?: number;
  lineStart?: number;
  lineEnd?: number;
}

function blockBody(b: ParsedBlock): string {
  return b.type === 'heading' ? `${'#'.repeat(b.depth ?? 1)} ${b.text}` : b.text;
}

/** 블록들을 섹션으로 묶는다 */
function groupSections(doc: ParsedDocument): Section[] {
  const sections: Section[] = [];
  const stack: { depth: number; text: string }[] = [];
  let cur = null as Section | null;

  const open = (headingPath: string[], extra: Partial<Section> = {}) => {
    if (cur && cur.blocks.length) sections.push(cur);
    cur = { headingPath, blocks: [], ...extra };
  };

  for (const b of doc.blocks) {
    if (!b.text.trim()) continue;
    if (b.type === 'heading') {
      const depth = b.depth ?? 1;
      while (stack.length && (stack[stack.length - 1]?.depth ?? 0) >= depth) stack.pop();
      stack.push({ depth, text: b.text });
      open(stack.map((s) => s.text));
      cur!.blocks.push(b);
      continue;
    }
    const path = stack.map((s) => s.text);
    if (b.type === 'symbol') {
      open([...path, b.symbol ?? ''].filter(Boolean), { symbol: b.symbol });
    } else if (!cur) {
      open(path, { page: b.page });
    } else if (b.page !== undefined && b.page !== (cur as Section).page) {
      open(path, { page: b.page });
    }
    (cur as Section).blocks.push(b);
  }
  if (cur && (cur as Section).blocks.length) sections.push(cur);
  return sections;
}

/** 긴 블록을 maxLen 이하 조각으로 자른다 (줄 단위로 채우고, 한 줄이 길면 글자 단위로 자른다) */
function splitUnit(b: ParsedBlock, maxLen: number): Unit[] {
  const text = blockBody(b);
  const page = b.page;
  if (text.length <= maxLen) return [{ text, page, lineStart: b.lineStart, lineEnd: b.lineEnd }];

  const out: Unit[] = [];
  const lines = text.split('\n');
  const lineNo = (idx: number) => (b.lineStart !== undefined ? b.lineStart + idx : undefined);
  let buf = '';
  let from = 0;
  const flush = (to: number) => {
    if (buf.trim()) out.push({ text: buf, page, lineStart: lineNo(from), lineEnd: lineNo(to) });
    buf = '';
  };
  lines.forEach((line, idx) => {
    let rest = line;
    if (buf && buf.length + 1 + rest.length > maxLen) flush(idx - 1);
    while (rest.length > maxLen) {
      flush(idx);
      out.push({ text: rest.slice(0, maxLen), page, lineStart: lineNo(idx), lineEnd: lineNo(idx) });
      rest = rest.slice(maxLen);
    }
    if (!buf) from = idx;
    buf = buf ? `${buf}\n${rest}` : rest;
  });
  flush(lines.length - 1);
  return out;
}

/** 섹션을 leaf 목록으로 (leafChars까지 채우고, 넘치면 겹침을 붙여 다음 leaf로) */
function packLeaves(section: Section, o: Required<ChunkingOptions>): Unit[] {
  const units = section.blocks.flatMap((b) => splitUnit(b, o.maxLeafChars));
  const leaves: Unit[] = [];
  let cur = null as Unit | null;
  const SEP = '\n\n';

  const flush = () => {
    if (!cur) return;
    leaves.push(cur);
    cur = null;
  };

  for (const u of units) {
    if (cur && cur.text.length + SEP.length + u.text.length > o.leafChars) {
      const tail: string = o.overlapChars > 0 ? cur.text.slice(-o.overlapChars) : '';
      flush();
      cur = { text: tail ? `${tail}${SEP}${u.text}` : u.text, page: u.page, lineStart: u.lineStart, lineEnd: u.lineEnd };
      continue;
    }
    if (!cur) {
      cur = { ...u };
    } else {
      cur = {
        text: `${cur.text}${SEP}${u.text}`,
        page: cur.page ?? u.page,
        lineStart: cur.lineStart ?? u.lineStart,
        lineEnd: u.lineEnd ?? cur.lineEnd,
      };
    }
  }
  flush();
  return leaves;
}

function hashOf(text: string): string {
  return sha256Hex(normalizeText(text)).slice(0, 32);
}

/** 공통 청킹 엔진. 전략은 어떤 문서 종류에 쓸지만 고른다 */
function chunkWith(doc: ParsedDocument, docId: string, opts?: ChunkingOptions): Chunk[] {
  const o = { ...DEFAULTS, ...opts };
  const out: Chunk[] = [];
  let ord = 0;
  const title = doc.title || doc.path;

  for (const section of groupSections(doc)) {
    const body = section.blocks.map(blockBody).join('\n\n');
    if (!body.trim()) continue;
    const pathLabel = [title, ...section.headingPath].join(' > ');
    const sectionText = body.length > o.maxSectionChars ? body.slice(0, o.maxSectionChars) : body;
    const sectionId = `${docId}:${ord++}`;
    out.push({
      id: sectionId,
      docId,
      parentId: null,
      level: 'section',
      ordinal: ord - 1,
      headingPath: section.headingPath,
      text: sectionText,
      embedText: `${pathLabel}\n${sectionText}`,
      page: section.page,
      lineStart: section.blocks[0]?.lineStart,
      lineEnd: section.blocks[section.blocks.length - 1]?.lineEnd,
      symbol: section.symbol,
      hash: hashOf(sectionText),
    });

    for (const leaf of packLeaves(section, o)) {
      if (!leaf.text.trim()) continue;
      out.push({
        id: `${docId}:${ord++}`,
        docId,
        parentId: sectionId,
        level: 'leaf',
        ordinal: ord - 1,
        headingPath: section.headingPath,
        text: leaf.text,
        embedText: `${pathLabel}\n${leaf.text}`,
        page: leaf.page,
        lineStart: leaf.lineStart,
        lineEnd: leaf.lineEnd,
        symbol: section.symbol,
        hash: hashOf(leaf.text),
      });
    }
  }
  return out;
}

function strategy(id: string, supports: (d: ParsedDocument) => boolean): ChunkingStrategy {
  return { id, supports, chunk: (doc, docId, opts) => chunkWith(doc, docId, opts) };
}

/** 문서 종류별 전략. 앞에서부터 처음 맞는 것을 쓴다 (마지막은 전부 받는 기본값) */
export const CHUNKING_STRATEGIES: ChunkingStrategy[] = [
  strategy('markdown', (d) => d.kind === 'markdown' || d.kind === 'html'),
  strategy('code', (d) => d.kind === 'code'),
  strategy('pdf', (d) => d.kind === 'pdf'),
  strategy('config', (d) => d.kind === 'config'),
  strategy('text', (d) => d.kind === 'text'),
  strategy('generic', () => true),
];

/** 문서를 계층형 청크로 나눈다. 블록이 없으면 빈 배열 */
export function chunkDocument(doc: ParsedDocument, docId: string, opts?: ChunkingOptions): Chunk[] {
  const s = CHUNKING_STRATEGIES.find((c) => c.supports(doc)) ?? strategy('generic', () => true);
  return s.chunk(doc, docId, opts);
}
