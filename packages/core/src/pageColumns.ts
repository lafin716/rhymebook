/** 마크다운 블록 조작 — 나란히 배치·이동·번호 매기기 (ADR-087 P7-P9) */

export interface MarkdownBlock {
  from: number;
  to: number;
  kind: 'heading' | 'bullet' | 'ordered' | 'todo' | 'quote' | 'code' | 'math' | 'table' | 'paragraph' | 'columns' | 'hr' | 'image' | 'other';
}

export const COLUMNS_OPEN = '<!-- columns -->';
export const COLUMN_BREAK = '<!-- column -->';
export const COLUMNS_CLOSE = '<!-- /columns -->';

interface LineBlock extends MarkdownBlock {
  /** 시작·끝 줄 번호(0부터, 끝 포함) */
  start: number;
  end: number;
}

function lineKind(trimmed: string): MarkdownBlock['kind'] {
  if (/^#{1,6}(\s|$)/.test(trimmed)) return 'heading';
  if (/^[-*+]\s\[[xX ]\](\s|$)/.test(trimmed)) return 'todo';
  if (/^[-*+]\s/.test(trimmed)) return 'bullet';
  if (/^\d+[.)]\s/.test(trimmed)) return 'ordered';
  if (trimmed.startsWith('>')) return 'quote';
  if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) return 'hr';
  if (trimmed.startsWith('![')) return 'image';
  return 'paragraph';
}

function lineBlocks(lines: string[]): LineBlock[] {
  const starts: number[] = [];
  let p = 0;
  for (const l of lines) {
    starts.push(p);
    p += l.length + 1;
  }
  const blocks: LineBlock[] = [];
  const push = (start: number, end: number, kind: MarkdownBlock['kind']) =>
    blocks.push({ start, end, kind, from: starts[start]!, to: starts[end]! + lines[end]!.length });

  let i = 0;
  while (i < lines.length) {
    const trimmed = lines[i]!.trim();
    if (!trimmed) {
      i++;
      continue;
    }
    // 묶음 블록: 끝 줄을 찾지 못하면 문서 끝까지
    const until = (test: (t: string) => boolean) => {
      let j = i + 1;
      while (j < lines.length && !test(lines[j]!.trim())) j++;
      return Math.min(j, lines.length - 1);
    };
    if (trimmed === COLUMNS_OPEN) {
      let j = i + 1;
      while (j < lines.length && lines[j]!.trim() !== COLUMNS_CLOSE) j++;
      if (j < lines.length) {
        push(i, j, 'columns');
        i = j + 1;
      } else {
        push(i, i, 'other');
        i++;
      }
      continue;
    }
    const fence = /^(`{3,}|~{3,})/.exec(trimmed);
    if (fence) {
      const mark = fence[1]!;
      const j = until((t) => t.startsWith(mark[0]!.repeat(mark.length)) && /^(`{3,}|~{3,})\s*$/.test(t));
      push(i, j, 'code');
      i = j + 1;
      continue;
    }
    if (trimmed.startsWith('$$') && !(trimmed.length > 4 && trimmed.endsWith('$$'))) {
      const j = until((t) => t.endsWith('$$'));
      push(i, j, 'math');
      i = j + 1;
      continue;
    }
    if (trimmed.startsWith('|')) {
      let j = i;
      while (j + 1 < lines.length && lines[j + 1]!.trim().startsWith('|')) j++;
      push(i, j, 'table');
      i = j + 1;
      continue;
    }
    push(i, i, lineKind(trimmed));
    i++;
  }
  return blocks;
}

/**
 * 블록 목록 — 핸들 하나가 맡는 단위. 줄마다 하나지만 코드·수식·표·columns 묶음은 통째로 하나다.
 * 빈 줄은 블록이 아니다.
 */
export function markdownBlocks(text: string): MarkdownBlock[] {
  return lineBlocks(text.split('\n')).map(({ from, to, kind }) => ({ from, to, kind }));
}

/** 블록 줄을 떼어 낸다 — 블록을 감싸던 빈 줄 하나(뒤 우선)도 함께 떼어 빈 줄이 겹치지 않게 한다 */
function cut(lines: string[], b: LineBlock) {
  const body = lines.slice(b.start, b.end + 1);
  let from = b.start;
  let to = b.end;
  let gap = false;
  if (to + 1 < lines.length && !lines[to + 1]!.trim()) {
    to++;
    gap = true;
  } else if (from > 0 && !lines[from - 1]!.trim()) {
    from--;
    gap = true;
  }
  return { body, from, count: to - from + 1, gap };
}

/**
 * 블록을 다른 자리로 옮긴다. toSlot은 끼워 넣을 자리(0 = 맨 앞, blocks.length = 맨 뒤).
 * 원래 자리에는 빈 줄이 남지 않는다.
 */
export function moveMarkdownBlock(text: string, index: number, toSlot: number): string {
  const lines = text.split('\n');
  const blocks = lineBlocks(lines);
  if (index < 0 || index >= blocks.length || toSlot < 0 || toSlot > blocks.length) return text;
  if (toSlot === index || toSlot === index + 1) return text;

  const { body, from, count, gap } = cut(lines, blocks[index]!);
  // 떼어 내기 전 기준으로 끼울 줄 위치를 구하고, 앞쪽에서 뗐으면 당긴다
  let at: number;
  let insert: string[];
  if (toSlot < blocks.length) {
    at = blocks[toSlot]!.start;
    insert = gap ? [...body, ''] : body;
  } else {
    at = blocks[blocks.length - 1]!.end + 1;
    insert = gap ? ['', ...body] : body;
  }
  if (at > from) at -= count;
  lines.splice(from, count);
  lines.splice(at, 0, ...insert);
  return lines.join('\n');
}

/** columns 블록 텍스트를 칸별 내용으로 나눈다 */
export function parseColumns(blockText: string): string[] {
  const lines = blockText.split('\n');
  const cols: string[][] = [[]];
  for (const l of lines.slice(1, -1)) {
    if (l.trim() === COLUMN_BREAK) cols.push([]);
    else cols[cols.length - 1]!.push(l);
  }
  return cols.map((c) => c.join('\n').replace(/^\n+|\n+$/g, ''));
}

function columnsLines(cols: string[]): string[] {
  const out = [COLUMNS_OPEN];
  cols.forEach((c, i) => {
    if (i > 0) out.push(COLUMN_BREAK);
    out.push(...c.split('\n'));
  });
  out.push(COLUMNS_CLOSE);
  return out;
}

/**
 * 블록을 다른 블록 옆(좌/우)에 놓는다 — 두 블록을 columns 묶음으로 감싼다.
 * 대상이 이미 columns면 그 묶음에 칸을 하나 더한다. columns 블록 자체는 옆에 놓을 수 없다.
 */
export function placeBlockBeside(text: string, index: number, targetIndex: number, side: 'left' | 'right'): string {
  const lines = text.split('\n');
  const blocks = lineBlocks(lines);
  if (index === targetIndex || index < 0 || index >= blocks.length || targetIndex < 0 || targetIndex >= blocks.length) return text;
  const source = blocks[index]!;
  const target = blocks[targetIndex]!;
  if (source.kind === 'columns') return text;

  const sourceText = lines.slice(source.start, source.end + 1).join('\n');
  const targetText = lines.slice(target.start, target.end + 1).join('\n');
  const existing = target.kind === 'columns' ? parseColumns(targetText) : [targetText];
  const cols = side === 'left' ? [sourceText, ...existing] : [...existing, sourceText];
  const replacement = columnsLines(cols);

  const { from, count } = cut(lines, source);
  // 뒤쪽부터 바꿔야 앞쪽 줄 번호가 흔들리지 않는다
  if (target.start > source.start) {
    lines.splice(target.start, target.end - target.start + 1, ...replacement);
    lines.splice(from, count);
  } else {
    lines.splice(from, count);
    lines.splice(target.start, target.end - target.start + 1, ...replacement);
  }
  return lines.join('\n');
}

/** columns 묶음을 풀어 칸들을 빈 줄로 나눈 일반 블록으로 돌린다 */
export function unwrapColumns(text: string, index: number): string {
  const lines = text.split('\n');
  const blocks = lineBlocks(lines);
  const block = blocks[index];
  if (!block || block.kind !== 'columns') return text;
  const cols = parseColumns(lines.slice(block.start, block.end + 1).join('\n')).filter((c) => c.trim());
  const out: string[] = [];
  cols.forEach((c, i) => {
    if (i > 0) out.push('');
    out.push(...c.split('\n'));
  });
  lines.splice(block.start, block.end - block.start + 1, ...out);
  return lines.join('\n');
}

/**
 * 순서 있는 목록 번호를 다시 매긴다. 같은 들여쓰기의 이어진 항목(run)은 첫 항목 번호부터 1씩 늘린다.
 * 더 깊은 들여쓰기 줄과 빈 줄은 목록을 끊지 않고, 같거나 얕은 들여쓰기의 다른 줄은 끊는다.
 * 하위 목록은 상위 항목마다 새로 시작한다. 코드 울타리 안은 건드리지 않는다.
 */
export function renumberOrderedLists(text: string): string {
  const lines = text.split('\n');
  const runs: { indent: number; next: number; delim: string }[] = [];
  let fence: string | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const trimmed = line.trim();
    const f = /^(`{3,}|~{3,})/.exec(trimmed);
    if (fence) {
      if (f && trimmed.startsWith(fence)) fence = null;
      continue;
    }
    if (f) {
      fence = f[1]!;
      runs.length = 0;
      continue;
    }
    if (!trimmed) continue;

    const indent = line.length - line.trimStart().length;
    const m = /^(\s*)(\d+)([.)])(\s)/.exec(line);
    while (runs.length && runs[runs.length - 1]!.indent > indent) runs.pop();
    if (!m) {
      if (runs.length && runs[runs.length - 1]!.indent === indent) runs.pop();
      continue;
    }
    const top = runs[runs.length - 1];
    if (top && top.indent === indent && top.delim === m[3]) {
      const num = top.next++;
      if (String(num) !== m[2]) lines[i] = `${m[1]}${num}${line.slice(m[1]!.length + m[2]!.length)}`;
    } else {
      if (top && top.indent === indent) runs.pop();
      runs.push({ indent, next: Number(m[2]) + 1, delim: m[3]! });
    }
  }
  return lines.join('\n');
}
