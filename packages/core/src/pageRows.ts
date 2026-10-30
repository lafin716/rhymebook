/** 페이지 편집기의 행 단위 조작 — 스페이스로 바뀌는 줄 머리 기호와 아래에 행 넣기 (ADR-095) */
import { markdownBlocks } from './pageColumns';

export interface RowPrefix {
  kind: 'heading' | 'bullet' | 'ordered' | 'todo' | 'quote';
  /** 앞 공백 길이 */
  indent: number;
  /** 공백까지 포함한 머리 기호 끝 = 내용 시작(줄 안 위치) */
  end: number;
  /** 제목 단계(1~6) */
  level?: number;
}

/**
 * 줄 머리 기호. 기호 뒤에 공백이 있어야 블록으로 본다 — `#`만 친 줄은 평범한 글이고 스페이스를 눌러야 제목이 된다.
 */
export function rowPrefix(line: string): RowPrefix | null {
  let m = /^( {0,3})(#{1,6}) /.exec(line);
  if (m) return { kind: 'heading', indent: m[1]!.length, end: m[0].length, level: m[2]!.length };
  m = /^(\s*)[-*+] \[[ xX]\] /.exec(line);
  if (m) return { kind: 'todo', indent: m[1]!.length, end: m[0].length };
  m = /^(\s*)[-*+] /.exec(line);
  if (m) return { kind: 'bullet', indent: m[1]!.length, end: m[0].length };
  m = /^(\s*)\d{1,9}[.)] /.exec(line);
  if (m) return { kind: 'ordered', indent: m[1]!.length, end: m[0].length };
  m = /^( {0,3})> /.exec(line);
  if (m) return { kind: 'quote', indent: m[1]!.length, end: m[0].length };
  return null;
}

/**
 * 스페이스 지름길 — 공백을 친 직후 커서 앞 글(줄 처음부터)이 지름길이면 바꿀 글을 돌려준다.
 * `[] ` · `[ ] ` → 할 일, `[x] ` → 끝낸 할 일.
 */
export function spaceShortcut(beforeCursor: string): string | null {
  const m = /^(\s*)\[( |x|X)?\] $/.exec(beforeCursor);
  if (!m) return null;
  return `${m[1]}- [${m[2] && m[2] !== ' ' ? 'x' : ' '}] `;
}

/**
 * index번째 블록 바로 아래에 새 행을 넣는다. 목록은 같은 기호로 새 항목을 잇고(번호는 다음 수),
 * 여러 줄 문법(인용·표·코드·수식·칸 묶음) 뒤는 빈 줄로 띄워 새 행이 그 문법에 붙지 않게 한다.
 * cursor는 새 행의 내용 시작 자리.
 */
export function insertRowAfter(text: string, index: number): { text: string; cursor: number } | null {
  const block = markdownBlocks(text)[index];
  if (!block) return null;
  const lineStart = text.lastIndexOf('\n', block.to - 1) + 1;
  const last = text.slice(lineStart, block.to);
  const prefix = rowPrefix(last);
  let insert = '\n';
  if (prefix && prefix.kind !== 'heading' && prefix.kind !== 'quote') {
    const indent = last.slice(0, prefix.indent);
    const marker = last.slice(prefix.indent, prefix.end);
    if (prefix.kind === 'ordered') {
      const n = /^(\d+)([.)])/.exec(marker)!;
      insert += `${indent}${Number(n[1]) + 1}${n[2]} `;
    } else if (prefix.kind === 'todo') {
      insert += `${indent}${marker[0]} [ ] `;
    } else {
      insert += `${indent}${marker}`;
    }
  } else if (['quote', 'table', 'code', 'math', 'columns'].includes(block.kind) || prefix?.kind === 'quote') {
    // 바로 아래가 이미 빈 줄이면 그 빈 줄을 띄움 줄로 쓰고 그 아래에 새 행을 넣는다
    const blank = /^\n[ \t]*(?=\n|$)/.exec(text.slice(block.to));
    if (blank) {
      const at = block.to + blank[0].length;
      return { text: `${text.slice(0, at)}\n${text.slice(at)}`, cursor: at + 1 };
    }
    insert = '\n\n';
  }
  return { text: text.slice(0, block.to) + insert + text.slice(block.to), cursor: block.to + insert.length };
}

const LIST_KINDS = new Set<RowPrefix['kind']>(['bullet', 'ordered', 'todo']);
const leading = (line: string) => /^ */.exec(line)![0].length;

/** 목록 기호 폭 — 하위 항목이 들여써야 하는 칸 수. 할 일의 `[ ] `는 내용이라 빼고 센다 */
function markerWidth(p: RowPrefix): number {
  return p.end - p.indent - (p.kind === 'todo' ? 4 : 0);
}

/**
 * Tab·Shift+Tab 목록 들여쓰기 — first..last 줄(0부터) 가운데 목록 항목을 하위 목록으로 넣거나(dir 1) 꺼낸다(dir -1).
 * 하위 항목도 같이 움직인다. 들여쓸 폭은 바로 위 같은 깊이 항목(새 부모)의 기호 폭, 내어쓸 때는 부모 깊이로.
 * 돌려주는 값은 줄마다 앞 공백 증감. 목록 줄이 없으면 null, 움직일 수 없으면(첫 항목·맨 바깥) 빈 배열.
 */
export function shiftListLines(text: string, first: number, last: number, dir: 1 | -1): Array<{ line: number; delta: number }> | null {
  const lines = text.split('\n');
  let head = -1;
  for (let i = first; i <= last && i < lines.length; i++) {
    const p = rowPrefix(lines[i]!);
    if (p && LIST_KINDS.has(p.kind)) {
      head = i;
      break;
    }
  }
  if (head < 0) return null;
  const hp = rowPrefix(lines[head]!)!;
  let delta = 0;
  if (dir === 1) {
    for (let j = head - 1; j >= 0; j--) {
      const t = lines[j]!;
      if (!t.trim()) continue;
      const q = rowPrefix(t);
      if (q && LIST_KINDS.has(q.kind)) {
        if (q.indent === hp.indent) delta = markerWidth(q);
        if (q.indent <= hp.indent) break;
      } else if (leading(t) <= hp.indent) break;
    }
  } else if (hp.indent > 0) {
    let parent = 0;
    for (let j = head - 1; j >= 0; j--) {
      const t = lines[j]!;
      const q = rowPrefix(t);
      if (q && LIST_KINDS.has(q.kind) && q.indent < hp.indent) {
        parent = q.indent;
        break;
      }
      if (t.trim() && !q && leading(t) === 0) break;
    }
    delta = parent - hp.indent;
  }
  if (!delta) return [];
  // 고른 마지막 줄의 하위 항목·이어지는 줄까지 — 그 줄보다 깊이 들여쓴 줄
  let end = Math.max(head, Math.min(last, lines.length - 1));
  const endIndent = leading(lines[end]!);
  while (end + 1 < lines.length && lines[end + 1]!.trim() && leading(lines[end + 1]!) > endIndent) end++;
  const out: Array<{ line: number; delta: number }> = [];
  for (let i = head; i <= end; i++) {
    const t = lines[i]!;
    if (!t.trim()) continue;
    const d = delta > 0 ? delta : -Math.min(-delta, leading(t));
    if (d) out.push({ line: i, delta: d });
  }
  return out;
}
