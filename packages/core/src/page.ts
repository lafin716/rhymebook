import type { Message, Session } from './model';

/** 마크다운 페이지 세션인가 (ADR-072) */
export const isPage = (s: Pick<Session, 'kind'> | undefined): boolean => s?.kind === 'page';

/** 페이지 본문 문서 메시지 — 페이지 세션의 첫 번째 assistant 메시지 */
export const pageDoc = (messages: readonly Message[] | undefined): Message | undefined =>
  messages?.find((m) => m.role === 'assistant');

/* ── / 블록 입력 (ADR-073) ── */

/** 페이지 편집기에서 `/`로 넣는 마크다운 블록 */
export interface PageBlock {
  id: string;
  label: string;
  /** 메뉴에 보이는 마크다운 모양 */
  hint: string;
  /** 영문·축약 검색어 */
  keywords: readonly string[];
  /** 'line' = 줄 앞에 붙는 표시, 'block' = 앞뒤를 빈 줄로 띄우는 덩어리 */
  kind: 'line' | 'block';
  text: string;
  /** 넣은 뒤 선택할 범위 (text 안 위치). 없으면 text 끝에 커서 */
  select?: readonly [number, number];
}

const TABLE = '| 항목 | 설명 |\n| --- | --- |\n|  |  |';
const CODE = '```\n\n```';

export const PAGE_BLOCKS: readonly PageBlock[] = [
  { id: 'h1', label: '제목 1', hint: '#', keywords: ['heading', 'h1', 'title'], kind: 'line', text: '# ' },
  { id: 'h2', label: '제목 2', hint: '##', keywords: ['heading', 'h2'], kind: 'line', text: '## ' },
  { id: 'h3', label: '제목 3', hint: '###', keywords: ['heading', 'h3'], kind: 'line', text: '### ' },
  { id: 'bullet', label: '글머리 목록', hint: '-', keywords: ['bullet', 'list', 'ul', '목록'], kind: 'line', text: '- ' },
  { id: 'number', label: '번호 목록', hint: '1.', keywords: ['number', 'list', 'ol', '목록'], kind: 'line', text: '1. ' },
  { id: 'todo', label: '할 일 목록', hint: '- [ ]', keywords: ['todo', 'task', 'check', '체크'], kind: 'line', text: '- [ ] ' },
  { id: 'quote', label: '인용', hint: '>', keywords: ['quote', 'blockquote'], kind: 'line', text: '> ' },
  { id: 'code', label: '코드 블록', hint: '```', keywords: ['code', 'pre'], kind: 'block', text: CODE, select: [4, 4] },
  { id: 'divider', label: '구분선', hint: '---', keywords: ['divider', 'hr', 'line', '줄'], kind: 'block', text: '---' },
  { id: 'table', label: '표', hint: '| |', keywords: ['table', '테이블'], kind: 'block', text: TABLE, select: [2, 4] },
  { id: 'math', label: '수식', hint: '$$', keywords: ['math', 'latex', 'equation'], kind: 'block', text: '$$\n\n$$', select: [3, 3] },
];

const QUERY_MAX = 20;

/**
 * 커서 바로 앞이 `/검색어`인지 — `/`는 줄 처음이나 공백 뒤에만, 검색어는 공백 없이.
 * 맞으면 `/`의 위치와 검색어를 돌려준다.
 */
export function pageSlashQuery(text: string, caret: number): { start: number; query: string } | null {
  const from = Math.max(0, caret - QUERY_MAX - 1);
  for (let i = caret - 1; i >= from; i--) {
    const c = text[i]!;
    if (/\s/.test(c)) return null;
    if (c !== '/') continue;
    const prev = text[i - 1];
    if (prev !== undefined && !/\s/.test(prev)) return null;
    if (inFence(text, i)) return null;
    return { start: i, query: text.slice(i + 1, caret) };
  }
  return null;
}

/** pos가 코드(```·~~~)나 수식($$) 울타리 안인가 — 그 안의 `/`는 글자 그대로다 */
function inFence(text: string, pos: number): boolean {
  let open: string | null = null;
  for (const line of text.slice(0, text.lastIndexOf('\n', pos - 1) + 1).split('\n')) {
    const m = /^\s*(`{3,}|~{3,}|\$\$)/.exec(line);
    if (!m) continue;
    const mark = m[1]!.slice(0, 2);
    if (open === null) open = mark;
    else if (open === mark) open = null;
  }
  return open !== null;
}

/** 이름·검색어로 블록을 고른다 (대소문자·띄어쓰기 무시) */
export function filterPageBlocks(query: string, blocks: readonly PageBlock[] = PAGE_BLOCKS): PageBlock[] {
  const q = query.toLowerCase().replace(/\s+/g, '');
  if (!q) return [...blocks];
  return blocks.filter(
    (b) => b.label.replace(/\s+/g, '').includes(q) || b.id.startsWith(q) || b.keywords.some((k) => k.startsWith(q)),
  );
}

/**
 * `/검색어`(start~caret)를 블록으로 바꾼다. 줄 표시는 줄 처음에, 덩어리는 앞뒤 빈 줄로 띄워
 * (예: 문단 바로 밑 `---`가 제목으로 읽히지 않게) 넣고 새 커서·선택 범위를 돌려준다.
 */
export function applyPageBlock(
  text: string,
  start: number,
  caret: number,
  block: PageBlock,
): { text: string; selStart: number; selEnd: number } {
  let before = text.slice(0, start);
  let after = text.slice(caret);
  const lineStart = before.lastIndexOf('\n') + 1;
  const midLine = before.slice(lineStart).trim() !== '';
  if (block.kind === 'line') {
    // `- /제목`처럼 빈 목록·인용 표시 뒤면 그 표시를 바꾼다 (들여쓰기는 둔다)
    const marker = /^(\s*)(?:[-*+]|\d+[.)]|>)(?:\s+\[[ xX]\])?\s*$/.exec(before.slice(lineStart));
    if (marker) before = before.slice(0, lineStart) + marker[1];
    else if (midLine) before = `${before.trimEnd()}\n`;
  } else {
    before = before.trimEnd();
    if (before) before += '\n\n';
    if (after.trim()) after = `\n\n${after.replace(/^[ \t]*\n*/, '')}`;
    else if (!after) after = '\n';
  }
  // 구분선처럼 안에 쓸 곳이 없는 덩어리는 다음 줄로 커서를 넘긴다
  const end = block.text.length + (block.kind === 'block' ? 1 : 0);
  const [s, e] = block.select ?? [end, end];
  return { text: before + block.text + after, selStart: before.length + s, selEnd: before.length + e };
}
