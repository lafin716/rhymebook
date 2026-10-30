/**
 * 페이지 편집기의 행 단위 편집 (ADR-095) — 숨긴 줄 머리 기호 다루기, 스페이스 지름길, 아래에 행 넣기, 고른 행.
 * 줄 머리 기호(`# `·`> `·`- `·`- [ ] `)는 공백까지 쳐야 블록이 되고, 바뀐 뒤엔 편집 중에도 숨는다.
 * 그래서 커서가 숨은 기호 안에 서지 않게 하고, Backspace·Enter를 내용 시작 기준으로 다시 정한다.
 */
import { insertRowAfter, markdownBlocks, rowPrefix, spaceShortcut, type RowPrefix } from '@branch/core';
import { indentLess } from '@codemirror/commands';
import { syntaxTree } from '@codemirror/language';
import { EditorSelection, EditorState, Prec, StateEffect, StateField, type Extension, type Line, type Transaction } from '@codemirror/state';
import { Decoration, EditorView, keymap, type DecorationSet } from '@codemirror/view';
import { minimalChange } from './pageText';

const TREE_NODE: Record<RowPrefix['kind'], string> = {
  heading: 'ATXHeading',
  quote: 'Blockquote',
  bullet: 'ListItem',
  ordered: 'ListItem',
  todo: 'ListItem',
};

/** 줄의 머리 기호 — 문법 트리가 같은 블록으로 읽을 때만(코드 블록 안 `# `는 글이다). cs = 내용 시작(문서 위치) */
export function rowMarker(state: EditorState, line: Line): (RowPrefix & { cs: number }) | null {
  const p = rowPrefix(line.text);
  if (!p) return null;
  const want = TREE_NODE[p.kind];
  for (let n: ReturnType<typeof syntaxTree>['topNode'] | null = syntaxTree(state).resolveInner(line.from + p.indent, 1); n; n = n.parent) {
    if (n.name === 'FencedCode' || n.name === 'CodeBlock' || n.name === 'HTMLBlock') return null;
    if (n.name === want || n.name.startsWith(want)) return { ...p, cs: line.from + p.end };
  }
  return null;
}

/** 번호 기호는 글자로 보이니 그 앞에도 커서가 설 수 있다. 나머지는 기호가 숨거나 그림으로 바뀐다 */
const hiddenMarker = (p: RowPrefix) => p.kind !== 'ordered';

/**
 * 커서가 숨은 기호 안(들여쓰기 끝 ~ 내용 시작)에 서지 않게 한다.
 * 내용 시작에서 왼쪽으로 움직이면 윗줄 끝으로, 그 밖에는 내용 시작으로 보낸다.
 */
function clampRowMarkers(tr: Transaction): Transaction | readonly [Transaction, { selection: EditorSelection; sequential: true }] {
  if (!tr.selection || tr.docChanged) return tr;
  const state = tr.startState;
  const prev = state.selection.main.head;
  let changed = false;
  const ranges = tr.selection.ranges.map((r) => {
    if (!r.empty) return r;
    const line = state.doc.lineAt(r.head);
    const mk = rowMarker(state, line);
    if (!mk || !hiddenMarker(mk) || r.head >= mk.cs || r.head < line.from + mk.indent) return r;
    changed = true;
    if (prev === mk.cs && r.head < prev) return EditorSelection.cursor(line.number > 1 ? line.from - 1 : mk.cs);
    return EditorSelection.cursor(mk.cs);
  });
  if (!changed) return tr;
  return [tr, { selection: EditorSelection.create(ranges, tr.selection.mainIndex), sequential: true }];
}

/** 내용 시작에서 Backspace — 들여쓴 목록은 내어쓰고, 아니면 기호를 지워 평범한 줄로 되돌린다 */
function backspaceMarker(view: EditorView): boolean {
  const { state } = view;
  const sel = state.selection.main;
  if (!sel.empty) return false;
  const line = state.doc.lineAt(sel.head);
  const mk = rowMarker(state, line);
  if (!mk || sel.head !== mk.cs) return false;
  if (mk.kind !== 'heading' && mk.kind !== 'quote' && mk.indent > 0) return indentLess(view);
  view.dispatch({ changes: { from: line.from, to: mk.cs }, selection: { anchor: line.from }, userEvent: 'delete.backward', scrollIntoView: true });
  return true;
}

/** 제목·인용의 내용 시작에서 Enter — 위에 빈 줄을 넣는다(기호가 아랫줄로 밀려 블록이 깨지지 않게) */
function enterAtMarker(view: EditorView): boolean {
  const { state } = view;
  const sel = state.selection.main;
  if (!sel.empty) return false;
  const line = state.doc.lineAt(sel.head);
  const mk = rowMarker(state, line);
  if (!mk || (mk.kind !== 'heading' && mk.kind !== 'quote') || sel.head !== mk.cs || line.to === mk.cs) return false;
  view.dispatch({ changes: { from: line.from, insert: '\n' }, selection: { anchor: sel.head + 1 }, userEvent: 'input', scrollIntoView: true });
  return true;
}

/**
 * 입력 규칙 — `[] `를 치면 할 일로, 글 바로 아래 줄에 `---`를 치면 그 앞에 빈 줄을 넣어 구분선으로(밑줄 제목이 되지 않게).
 * 한글 조합 중에는 건드리지 않는다.
 */
function rowInputRules(tr: Transaction): Transaction | readonly [Transaction, { changes: { from: number; to?: number; insert: string }; selection?: { anchor: number }; sequential: true }] {
  if (!tr.docChanged || !tr.isUserEvent('input.type') || tr.isUserEvent('input.type.compose')) return tr;
  const sel = tr.newSelection.main;
  if (!sel.empty) return tr;
  const doc = tr.newDoc;
  const line = doc.lineAt(sel.head);
  const before = line.text.slice(0, sel.head - line.from);
  if (before.endsWith(' ')) {
    const repl = spaceShortcut(before);
    if (repl) return [tr, { changes: { from: line.from, to: sel.head, insert: repl }, selection: { anchor: line.from + repl.length }, sequential: true }];
    return tr;
  }
  if (/^(-{3,}|\*{3,}|_{3,})$/.test(line.text) && sel.head === line.to && line.number > 1) {
    const above = doc.line(line.number - 1).text;
    if (above.trim() && !rowPrefix(above) && !/^\s*(\||`{3,}|~{3,}|<!--)/.test(above)) {
      return [tr, { changes: { from: line.from, insert: '\n' }, sequential: true }];
    }
  }
  return tr;
}

/** index번째 블록 아래에 새 행을 넣고 그 자리로 커서를 옮긴다 — 되돌리기 한 번 */
export function insertRowBelow(view: EditorView, index: number): boolean {
  const before = view.state.doc.toString();
  const r = insertRowAfter(before, index);
  if (!r) return false;
  view.dispatch({ changes: minimalChange(before, r.text), selection: { anchor: r.cursor }, userEvent: 'input.row', scrollIntoView: true });
  return true;
}

/** 고른 행(모바일 첫 탭) — 블록 구간. 본문이 바뀌면 따라 움직인다 */
export const selectRow = StateEffect.define<{ from: number; to: number } | null>();
export const selectedRowField = StateField.define<{ from: number; to: number } | null>({
  create: () => null,
  update(v, tr) {
    for (const e of tr.effects) if (e.is(selectRow)) return e.value;
    if (!v || !tr.docChanged) return v;
    const from = tr.changes.mapPos(v.from, 1);
    const to = tr.changes.mapPos(v.to, -1);
    return to >= from ? { from, to } : null;
  },
});

/** pos가 든 블록 — 빈 줄이면 null */
export function blockAtPos(state: EditorState, pos: number): { index: number; from: number; to: number } | null {
  const blocks = markdownBlocks(state.doc.toString());
  const index = blocks.findIndex((b) => pos >= b.from && pos <= b.to);
  const b = blocks[index];
  return b ? { index, from: b.from, to: b.to } : null;
}

export type RowKind = 'paragraph' | 'h1' | 'h2' | 'h3' | 'bullet' | 'ordered' | 'todo' | 'quote';
const ROW_MARK: Record<RowKind, string> = { paragraph: '', h1: '# ', h2: '## ', h3: '### ', bullet: '- ', ordered: '1. ', todo: '- [ ] ', quote: '> ' };
const ROW_RE = /^(\s*)(#{1,6} |> |[-*+] \[[ xX]\] |[-*+] |\d+[.)] )?/;

/**
 * 줄(들)을 본문·제목·목록·번호·할 일·인용으로 바꾼다. 고른 줄이 모두 이미 그 모양이면 기호를 뗀다(토글).
 * range가 없으면 커서·선택 줄. 포커스는 건드리지 않는다.
 */
export function setRowKind(view: EditorView, kind: RowKind, range?: { from: number; to: number }): boolean {
  const marker = ROW_MARK[kind];
  const sel = range ?? view.state.selection.main;
  const doc = view.state.doc;
  const first = doc.lineAt(sel.from).number;
  const last = doc.lineAt(sel.to).number;
  const sameKind = (m: string | undefined) => {
    if (!m) return kind === 'paragraph';
    if (kind === 'ordered') return /^\d+[.)] $/.test(m);
    if (kind === 'todo') return /^[-*+] \[[ xX]\] $/.test(m);
    if (kind === 'bullet') return /^[-*+] $/.test(m);
    return m === marker;
  };
  const lines = [];
  for (let i = first; i <= last; i++) lines.push(doc.line(i));
  const filled = lines.filter((l) => l.text.trim());
  const off = kind !== 'paragraph' && filled.length > 0 && filled.every((l) => sameKind(ROW_RE.exec(l.text)?.[2]));
  let n = 1;
  const changes = lines
    .filter((l) => l.text.trim() || lines.length === 1)
    .map((l) => {
      const m = ROW_RE.exec(l.text)!;
      const indent = m[1] ?? '';
      const mark = off ? '' : kind === 'ordered' ? `${n++}. ` : marker;
      return { from: l.from + indent.length, to: l.from + m[0].length, insert: mark };
    });
  view.dispatch({ changes, userEvent: 'input.format' });
  return true;
}

export function pageRowEditing(): Extension {
  return [
    Prec.highest(
      keymap.of([
        { key: 'Backspace', run: backspaceMarker },
        { key: 'Enter', run: enterAtMarker },
      ]),
    ),
    EditorState.transactionFilter.of(rowInputRules),
    EditorState.transactionFilter.of(clampRowMarkers),
    selectedRowField,
    EditorView.decorations.compute([selectedRowField], (state): DecorationSet => {
      const v = state.field(selectedRowField);
      if (!v) return Decoration.none;
      const deco = Decoration.line({ class: 'cm-row-selected', attributes: { 'data-page-row-selected': '' } });
      const out = [];
      for (let p = v.from; p <= v.to; ) {
        const l = state.doc.lineAt(p);
        out.push(deco.range(l.from));
        p = l.to + 1;
      }
      return Decoration.set(out);
    }),
  ];
}
