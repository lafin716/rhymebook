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
