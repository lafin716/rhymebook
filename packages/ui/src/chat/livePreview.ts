import { COLUMN_BREAK, COLUMNS_CLOSE, COLUMNS_OPEN, columnSpans, markdownBlocks, pageLinkId, type ID } from '@branch/core';
import { defaultKeymap, redo, undo } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { ensureSyntaxTree, syntaxTree } from '@codemirror/language';
import {
  Annotation,
  ChangeSet,
  Compartment,
  EditorState,
  Prec,
  RangeSet,
  StateEffect,
  StateField,
  type ChangeSpec,
  type Extension,
  type Range,
  type Text,
  type Transaction,
} from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, WidgetType, keymap, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import type { SyntaxNode } from '@lezer/common';
import katex from 'katex';
import { pageRowEditing } from './pageRowEditing';
import { handleButtons } from './pageRowHandles';
import { minimalChange } from './pageText';

/**
 * 노션처럼 쓰는 마크다운 실시간 미리보기 (ADR-075). 원문은 그대로 두고(앵커가 원문 오프셋에 기대므로)
 * 커서가 닿지 않은 곳의 기호를 숨기거나 위젯(구분선·체크박스·표·수식·페이지 링크)으로 바꿔 보여준다.
 * 커서가 들어가면 그 줄·구간은 원문 그대로 드러난다.
 */
export interface LivePreviewOptions {
  /** 하위 페이지 링크를 눌렀을 때 */
  openPage: (id: ID) => void;
  /** 링크한 페이지가 아직 있는지 (지워졌으면 흐리게) */
  pageExists: (id: ID) => boolean;
}

const setFocus = StateEffect.define<boolean>();
const focusField = StateField.define<boolean>({
  create: () => false,
  update: (v, tr) => tr.effects.reduce((acc, e) => (e.is(setFocus) ? e.value : acc), v),
});

/**
 * 마우스로 끌어 고르는 중 (ADR-077). 그동안은 장식을 다시 만들지 않는다 — 선택이 기호에 닿을 때마다 원문이
 * 드러나 글자가 밀리면 끄는 자리가 어긋난다. 버튼을 떼면 한 번에 다시 그린다.
 */
const setDrag = StateEffect.define<boolean>();
const dragField = StateField.define<boolean>({
  create: () => false,
  update: (v, tr) => tr.effects.reduce((acc, e) => (e.is(setDrag) ? e.value : acc), v),
});
/** 마우스로 고르는 중인가 — 선택 서식 팝업은 뗀 뒤에 띄운다 */
export const isDragging = (state: EditorState): boolean => state.field(dragField, false) ?? false;

const dragWatch = ViewPlugin.fromClass(
  class {
    private up: () => void;
    constructor(view: EditorView) {
      this.up = () => {
        if (isDragging(view.state)) view.dispatch({ effects: setDrag.of(false) });
      };
      window.addEventListener('mouseup', this.up, true);
      window.addEventListener('blur', this.up);
    }
    destroy() {
      window.removeEventListener('mouseup', this.up, true);
      window.removeEventListener('blur', this.up);
    }
  },
);

/** 본문에 넣은 첨부 data URL — 편집 중에도 긴 base64를 접어 보인다 */
const DATA_URL = /^data:([\w.+/-]+)[^,]*,/;

class DataUrlWidget extends WidgetType {
  constructor(
    readonly mime: string,
    readonly size: number,
  ) {
    super();
  }
  eq(o: DataUrlWidget) {
    return o.mime === this.mime && o.size === this.size;
  }
  toDOM() {
    const el = document.createElement('span');
    el.className = 'cm-lp-dataurl';
    const kb = this.size * 0.75 / 1024;
    el.textContent = `${this.mime} · ${kb >= 1024 ? `${(kb / 1024).toFixed(1)}MB` : `${Math.max(1, Math.round(kb))}KB`}`;
    el.title = '첨부 데이터';
    return el;
  }
}

/**
 * 고른 이미지 (ADR-087). 이미지를 누르면 그 원문 전체를 고르고 테두리·지우기 버튼을 보인다.
 * 지우면 원문이 통째로(줄만 남으면 줄까지) 한 번에 지워진다. 다른 곳을 고르거나 글이 바뀌면 풀린다.
 */
interface ImageRange {
  from: number;
  to: number;
}
const selectImage = StateEffect.define<ImageRange | null>();
const imageSelField = StateField.define<ImageRange | null>({
  create: () => null,
  update(v, tr) {
    for (const e of tr.effects) if (e.is(selectImage)) return e.value;
    if (!v) return v;
    if (tr.docChanged) return null;
    const m = tr.state.selection.main;
    return m.from === v.from && m.to === v.to ? v : null;
  },
});
/** 지금 고른 이미지 원문 범위 — 선택 메뉴는 이때 뜨지 않는다 */
export const selectedImage = (state: EditorState): ImageRange | null => state.field(imageSelField, false) ?? null;

/** 이미지 원문을 지운다. 그 줄에 다른 글이 없으면 줄째 지운다 */
function deleteImage(view: EditorView, r: ImageRange): boolean {
  const doc = view.state.doc;
  const line = doc.lineAt(r.from);
  const rest = doc.sliceString(line.from, r.from) + doc.sliceString(r.to, line.to);
  let from = r.from;
  let to = r.to;
  if (!rest.trim()) {
    from = line.from;
    to = line.to;
    if (line.to < doc.length) to++;
    else if (line.from > 0) from--;
  }
  view.dispatch({ changes: { from, to }, selection: { anchor: Math.min(from, doc.length - (to - from)) }, effects: selectImage.of(null), userEvent: 'delete.image' });
  view.focus();
  return true;
}

function deleteSelectedImage(view: EditorView): boolean {
  const r = selectedImage(view.state);
  return r ? deleteImage(view, r) : false;
}

/** 위젯 자리의 이미지 원문 범위 */
function imageRangeAt(view: EditorView, el: HTMLElement): ImageRange | null {
  const pos = view.posAtDOM(el);
  for (let n: SyntaxNode | null = syntaxTree(view.state).resolveInner(pos, 1); n; n = n.parent) {
    if (n.name === 'Image') return { from: n.from, to: n.to };
  }
  return null;
}

class ImageWidget extends WidgetType {
  constructor(
    readonly src: string,
    readonly alt: string,
    readonly selected: boolean,
  ) {
    super();
  }
  eq(o: ImageWidget) {
    return o.src === this.src && o.alt === this.alt && o.selected === this.selected;
  }
  toDOM(view: EditorView) {
    const wrap = document.createElement('span');
    wrap.className = 'cm-lp-image' + (this.selected ? ' cm-lp-image-selected' : '');
    wrap.dataset.pageImage = '';
    if (this.selected) wrap.dataset.selected = '';
    const img = document.createElement('img');
    img.alt = this.alt;
    img.draggable = false;
    // 본문에 넣은 이미지(data:)와 http(s) 이미지만 그린다
    if (/^data:image\/(?:png|jpeg|gif|webp);/i.test(this.src) || /^https?:\/\//i.test(this.src)) img.src = this.src;
    wrap.appendChild(img);
    wrap.addEventListener('mousedown', (e) => e.preventDefault());
    wrap.addEventListener('click', (e) => {
      e.preventDefault();
      if ((e.target as Element).closest('button')) return;
      const r = imageRangeAt(view, wrap);
      if (!r) return;
      view.dispatch({ selection: { anchor: r.from, head: r.to }, effects: selectImage.of(r) });
      view.focus();
    });
    if (this.selected) {
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'cm-lp-image-delete';
      del.textContent = '이미지 지우기';
      del.setAttribute('aria-label', '이미지 지우기');
      del.addEventListener('mousedown', (e) => e.preventDefault());
      del.addEventListener('click', (e) => {
        e.preventDefault();
        const r = imageRangeAt(view, wrap);
        if (r) deleteImage(view, r);
      });
      wrap.appendChild(del);
    }
    return wrap;
  }
}

const FILE_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/></svg>';

class BulletWidget extends WidgetType {
  eq() {
    return true;
  }
  toDOM() {
    const el = document.createElement('span');
    el.className = 'cm-lp-bullet';
    el.textContent = '•';
    return el;
  }
}

class HrWidget extends WidgetType {
  eq() {
    return true;
  }
  toDOM() {
    const el = document.createElement('span');
    el.className = 'cm-lp-hr';
    el.setAttribute('role', 'separator');
    return el;
  }
}

class CheckboxWidget extends WidgetType {
  constructor(
    readonly checked: boolean,
    readonly pos: number,
  ) {
    super();
  }
  eq(o: CheckboxWidget) {
    return o.checked === this.checked && o.pos === this.pos;
  }
  toDOM(view: EditorView) {
    const el = document.createElement('input');
    el.type = 'checkbox';
    el.className = 'cm-lp-check';
    el.checked = this.checked;
    el.setAttribute('aria-label', this.checked ? '완료한 할 일' : '할 일');
    el.addEventListener('mousedown', (e) => e.preventDefault());
    el.addEventListener('click', (e) => {
      e.preventDefault();
      // `[ ]` 가운데 글자를 바꾼다
      const at = this.pos + 1;
      view.dispatch({ changes: { from: at, to: at + 1, insert: this.checked ? ' ' : 'x' } });
    });
    return el;
  }
  ignoreEvent() {
    return true;
  }
}

class PageLinkWidget extends WidgetType {
  constructor(
    readonly title: string,
    readonly id: ID,
    readonly missing: boolean,
    readonly open: (id: ID) => void,
  ) {
    super();
  }
  eq(o: PageLinkWidget) {
    return o.title === this.title && o.id === this.id && o.missing === this.missing;
  }
  toDOM() {
    const el = document.createElement('a');
    el.className = 'cm-lp-pagelink' + (this.missing ? ' cm-lp-missing' : '');
    el.href = `#page:${this.id}`;
    el.dataset.pageLink = this.id;
    el.title = this.missing ? '지워진 페이지' : '하위 페이지 열기';
    el.innerHTML = FILE_ICON;
    el.append(document.createTextNode(this.title));
    el.addEventListener('mousedown', (e) => e.preventDefault());
    el.addEventListener('click', (e) => {
      e.preventDefault();
      if (!this.missing) this.open(this.id);
    });
    return el;
  }
  ignoreEvent() {
    return true;
  }
}

class MathWidget extends WidgetType {
  constructor(
    readonly tex: string,
    readonly display: boolean,
  ) {
    super();
  }
  eq(o: MathWidget) {
    return o.tex === this.tex && o.display === this.display;
  }
  toDOM() {
    const el = document.createElement(this.display ? 'div' : 'span');
    el.className = this.display ? 'cm-lp-math-block' : 'cm-lp-math';
    el.innerHTML = katex.renderToString(this.tex, { displayMode: this.display, throwOnError: false });
    return el;
  }
}

type Align = 'left' | 'center' | 'right' | '';

class TableWidget extends WidgetType {
  constructor(
    readonly head: string[],
    readonly rows: string[][],
    readonly align: Align[],
  ) {
    super();
  }
  eq(o: TableWidget) {
    return JSON.stringify([o.head, o.rows, o.align]) === JSON.stringify([this.head, this.rows, this.align]);
  }
  toDOM() {
    const wrap = document.createElement('div');
    wrap.className = 'cm-lp-table';
    const table = document.createElement('table');
    const row = (cells: string[], tag: 'th' | 'td') => {
      const tr = document.createElement('tr');
      cells.forEach((c, i) => {
        const td = document.createElement(tag);
        td.textContent = c;
        if (this.align[i]) td.style.textAlign = this.align[i]!;
        tr.append(td);
      });
      return tr;
    };
    const thead = document.createElement('thead');
    thead.append(row(this.head, 'th'));
    const tbody = document.createElement('tbody');
    for (const r of this.rows) tbody.append(row(r, 'td'));
    table.append(thead, tbody);
    wrap.append(table);
    return wrap;
  }
}

interface ColumnMarks {
  /** 묶음 전체 */
  from: number;
  to: number;
  /** 표시 줄 [줄 시작, 줄 끝] */
  marks: { from: number; to: number; kind: 'open' | 'break' | 'close' }[];
}

const marksCache = new WeakMap<Text, ColumnMarks[]>();
/** 문서의 칸 묶음과 그 표시 줄 (코드 블록 안은 제외) */
function columnMarks(doc: Text): ColumnMarks[] {
  let out = marksCache.get(doc);
  if (out) return out;
  out = [];
  for (const b of markdownBlocks(doc.toString())) {
    if (b.kind !== 'columns') continue;
    const first = doc.lineAt(b.from).number;
    const last = doc.lineAt(b.to).number;
    const marks: ColumnMarks['marks'] = [];
    for (let n = first; n <= last; n++) {
      const l = doc.line(n);
      const kind = n === first ? 'open' : n === last ? 'close' : l.text.trim() === COLUMN_BREAK ? 'break' : null;
      if (kind) marks.push({ from: l.from, to: l.to, kind });
    }
    out.push({ from: b.from, to: b.to, marks });
  }
  marksCache.set(doc, out);
  return out;
}

/**
 * 표시 줄은 글로 치지 않는다 — 입력·지우기로는 고칠 수 없다. 묶음을 통째로 지우는 건 된다.
 * 블록 옮기기·지우기 메뉴·AI·되돌리기처럼 묶음을 다시 쓰는 변경은 막지 않는다.
 */
function protectColumnMarks(tr: Transaction): boolean | readonly number[] {
  if (!((tr.isUserEvent('input') && !tr.isUserEvent('input.ai') && !tr.isUserEvent('input.row') && !tr.isUserEvent('input.column')) || (tr.isUserEvent('delete') && !tr.isUserEvent('delete.block') && !tr.isUserEvent('delete.column')))) return true;
  const groups = columnMarks(tr.startState.doc);
  if (!groups.length) return true;
  const whole: [number, number][] = [];
  tr.changes.iterChangedRanges((a, b) => whole.push([a, b]));
  const doc = tr.startState.doc;
  const ranges: number[] = [];
  for (const g of groups) {
    if (whole.some(([a, b]) => a <= g.from && b >= g.to)) continue;
    for (const m of g.marks) {
      // 표시 줄과 앞뒤 줄바꿈을 함께 지킨다 — 다른 줄이 붙어 표시 줄이 깨지지 않게. 위가 빈 줄이면 그 빈 줄은 지울 수 있다
      const before = m.from > 0 && doc.lineAt(m.from - 1).length > 0 ? m.from - 1 : m.from;
      ranges.push(before, Math.min(m.to + 1, doc.length));
    }
  }
  return ranges.length ? ranges : true;
}

/** 칸 안 편집기가 본문에서 받아 온 변경 — 본문으로 다시 보내지 않는다 */
const fromMain = Annotation.define<boolean>();
/** 칸 안 편집기의 쓰기 가능 여부 — 본문의 잠금·보기 모드를 따른다 */
const columnEditable = new Compartment();
const MARKER_LINES = new Set([COLUMNS_OPEN, COLUMN_BREAK, COLUMNS_CLOSE]);
function hasMarkerLine(doc: Text): boolean {
  for (let i = 1; i <= doc.lines; i++) if (MARKER_LINES.has(doc.line(i).text.trim())) return true;
  return false;
}
const editableOf = (main: EditorView): Extension => [
  EditorView.editable.of(main.state.facet(EditorView.editable)),
  EditorState.readOnly.of(main.state.readOnly),
];
const lockedOf = (main: EditorView) => !main.state.facet(EditorView.editable) || main.state.readOnly;

/** 칸 묶음 DOM → 칸마다의 편집기 */
const columnViews = new WeakMap<HTMLElement, EditorView[]>();
const columnObservers = new WeakMap<HTMLElement, ResizeObserver>();

/** 위젯 DOM이 놓인 묶음 */
function groupOf(main: EditorView, wrap: HTMLElement): ColumnMarks | null {
  let start: number;
  try {
    start = main.posAtDOM(wrap);
  } catch {
    return null;
  }
  return columnMarks(main.state.doc).find((g) => g.from === start) ?? null;
}

function columnsDomAt(main: EditorView, from: number): HTMLElement | null {
  for (const el of main.contentDOM.querySelectorAll<HTMLElement>('[data-page-columns]')) {
    try {
      if (main.posAtDOM(el) === from) return el;
    } catch {
      /* 화면 밖 */
    }
  }
  return null;
}

/** 묶음 `from`의 col번째 칸으로 들어간다 */
function focusColumn(main: EditorView, from: number, col: number | 'last', at: 'start' | 'end'): boolean {
  const wrap = columnsDomAt(main, from);
  const views = wrap && columnViews.get(wrap);
  const v = views?.[col === 'last' ? views.length - 1 : col];
  if (!v) return false;
  v.focus();
  v.dispatch({ selection: { anchor: at === 'start' ? 0 : v.state.doc.length }, scrollIntoView: true });
  return true;
}

/** 칸 편집기에서 본문으로 나간다 — 묶음이 문서 끝이면 빈 줄을 하나 만든다 */
function leaveColumns(main: EditorView, wrap: HTMLElement, dir: -1 | 1): boolean {
  const g = groupOf(main, wrap);
  if (!g) return false;
  const doc = main.state.doc;
  if (dir < 0) {
    if (g.from === 0) main.dispatch({ changes: { from: 0, insert: '\n' }, selection: { anchor: 0 }, userEvent: 'input.column' });
    else main.dispatch({ selection: { anchor: g.from - 1 }, scrollIntoView: true });
  } else if (g.to >= doc.length) main.dispatch({ changes: { from: g.to, insert: '\n' }, selection: { anchor: g.to + 1 }, userEvent: 'input.column' });
  else main.dispatch({ selection: { anchor: g.to + 1 }, scrollIntoView: true });
  main.focus();
  return true;
}

/** 커서가 첫(마지막) 화면 줄에 있는가 — 줄바꿈된 긴 줄 가운데서는 평소처럼 움직인다 */
function atVerticalEdge(view: EditorView, dir: -1 | 1): boolean {
  const r = view.state.selection.main;
  if (!r.empty) return false;
  const line = view.state.doc.lineAt(r.head);
  if (dir < 0 ? line.number !== 1 : line.number !== view.state.doc.lines) return false;
  const here = view.coordsAtPos(r.head);
  const edge = view.coordsAtPos(dir < 0 ? line.from : line.to);
  return !here || !edge || Math.abs(here.top - edge.top) < 2;
}

/** 칸에서 고친 것을 본문의 그 칸 자리에만 옮겨 쓴다 */
function pushToMain(main: EditorView, wrap: HTMLElement, col: number, before: Text, sub: EditorView, trs: readonly Transaction[]) {
  const g = groupOf(main, wrap);
  if (!g) return;
  const blockText = main.state.sliceDoc(g.from, g.to);
  const span = columnSpans(blockText)[col];
  if (!span) return;
  const base = g.from + span.from;
  const after = sub.state.doc.toString();
  const changes: ChangeSpec[] = [];
  if (span.empty) {
    if (!after) return;
    changes.push({ from: base, insert: `${after}\n` });
  } else if (blockText.slice(span.from, span.to) === before.toString()) {
    trs
      .reduce((acc, t) => acc.compose(t.changes), ChangeSet.empty(before.length))
      .iterChanges((fromA, toA, _fromB, _toB, ins) => changes.push({ from: base + fromA, to: base + toA, insert: ins.toString() }));
  } else changes.push({ from: base, to: g.from + span.to, insert: after });
  main.dispatch({ changes, userEvent: 'input.column' });
}

/** 칸 하나의 편집기 — 같은 실시간 미리보기·행 편집을 쓰고, 되돌리기는 본문 기록을 따른다 (ADR-096) */
function columnEditor(main: EditorView, wrap: HTMLElement, col: number, text: string, opts: LivePreviewOptions): EditorView {
  const colIndex = (v: EditorView) => Number(v.dom.closest<HTMLElement>('[data-page-column]')?.dataset.pageColumn ?? col);
  const sub = new EditorView({
    state: EditorState.create({
      doc: text,
      extensions: [
        columnEditable.of(editableOf(main)),
        // 칸 표시 줄은 칸 안에서 만들 수 없다 — 묶음이 깨진다
        EditorState.changeFilter.of((tr) => !!tr.annotation(fromMain) || !hasMarkerLine(tr.newDoc)),
        Prec.highest(
          keymap.of([
            { key: 'Mod-z', run: () => undo(main), preventDefault: true },
            { key: 'Mod-Shift-z', run: () => redo(main), preventDefault: true },
            { key: 'Mod-y', run: () => redo(main), preventDefault: true },
            { key: 'Escape', run: () => leaveColumns(main, wrap, 1) },
            { key: 'ArrowUp', run: (v) => atVerticalEdge(v, -1) && leaveColumns(main, wrap, -1) },
            { key: 'ArrowDown', run: (v) => atVerticalEdge(v, 1) && leaveColumns(main, wrap, 1) },
          ]),
        ),
        pageRowEditing(),
        keymap.of(defaultKeymap),
        markdown({ base: markdownLanguage }),
        EditorView.lineWrapping,
        EditorView.contentAttributes.of({ 'aria-label': `칸 ${col + 1}` }),
        livePreview(opts),
      ],
    }),
    dispatchTransactions: (trs, view) => {
      const before = view.state.doc;
      view.update(trs);
      if (!trs.some((t) => t.docChanged) || trs.some((t) => t.annotation(fromMain))) return;
      pushToMain(main, wrap, colIndex(view), before, view, trs);
    },
  });
  sub.dom.dataset.columnEditor = String(col);
  return sub;
}

/**
 * 나란히 배치 묶음 (ADR-087 P8 → ADR-096) — 칸마다 작은 편집기를 둔다. 표시 줄은 늘 숨기고,
 * 칸 안에서 고치면 본문의 그 칸 자리만 바뀐다. 칸마다 +·핸들(옮기기·꺼내기·지우기 메뉴)이 붙는다.
 */
class ColumnsWidget extends WidgetType {
  constructor(
    readonly source: string,
    readonly opts: LivePreviewOptions,
  ) {
    super();
  }
  eq(o: ColumnsWidget) {
    return o.source === this.source;
  }
  toDOM(main: EditorView) {
    const wrap = document.createElement('div');
    wrap.className = 'cm-lp-columns';
    wrap.dataset.pageColumns = '';
    const spans = columnSpans(this.source);
    wrap.style.setProperty('--cols', String(spans.length));
    const locked = lockedOf(main);
    const views = spans.map((s, i) => {
      const col = document.createElement('div');
      col.className = 'cm-lp-column';
      col.dataset.pageColumn = String(i);
      const btns = handleButtons(
        { label: `칸 ${i + 1} 끝에 행 추가`, attrs: { 'data-column-add': String(i) } },
        { label: `칸 ${i + 1} 옮기기·메뉴`, attrs: { 'data-column-handle': String(i) } },
      );
      btns.classList.add('cm-lp-colbtns');
      for (const b of btns.querySelectorAll('button')) b.disabled = locked;
      const sub = columnEditor(main, wrap, i, this.source.slice(s.from, s.to), this.opts);
      col.append(btns, sub.dom);
      wrap.append(col);
      return sub;
    });
    columnViews.set(wrap, views);
    wrap.addEventListener('mousedown', (e) => {
      if ((e.target as Element).closest('.cm-lp-colbtns')) e.preventDefault();
    });
    wrap.addEventListener('click', (e) => {
      const t = e.target as Element;
      const add = t.closest<HTMLElement>('[data-column-add]');
      const grip = t.closest<HTMLElement>('[data-column-handle]');
      if (!add && !grip) return;
      e.preventDefault();
      e.stopPropagation();
      if (lockedOf(main)) return;
      if (add) {
        const v = columnViews.get(wrap)?.[Number(add.dataset.columnAdd)];
        if (!v) return;
        const end = v.state.doc.length;
        v.focus();
        if (v.state.doc.toString().trim()) v.dispatch({ changes: { from: end, insert: '\n' }, selection: { anchor: end + 1 }, userEvent: 'input', scrollIntoView: true });
        else v.dispatch({ selection: { anchor: end } });
        return;
      }
      const g = groupOf(main, wrap);
      if (!g || !grip) return;
      const r = grip.getBoundingClientRect();
      wrap.dispatchEvent(
        new CustomEvent('page-column-menu', {
          bubbles: true,
          detail: { from: g.from, column: Number(grip.dataset.columnHandle), count: columnViews.get(wrap)?.length ?? 0, x: r.left, y: r.bottom },
        }),
      );
    });
    wrap.addEventListener('contextmenu', (e) => {
      if ((e.target as Element).closest('.cm-lp-colbtns')) e.preventDefault();
    });
    const ro = new ResizeObserver(() => main.requestMeasure());
    ro.observe(wrap);
    columnObservers.set(wrap, ro);
    return wrap;
  }
  updateDOM(dom: HTMLElement) {
    const views = columnViews.get(dom);
    const spans = columnSpans(this.source);
    if (!views || views.length !== spans.length) return false;
    spans.forEach((s, i) => {
      const v = views[i]!;
      const cur = v.state.doc.toString();
      const next = this.source.slice(s.from, s.to);
      if (cur !== next) v.dispatch({ changes: minimalChange(cur, next), annotations: fromMain.of(true) });
    });
    return true;
  }
  destroy(dom: HTMLElement) {
    for (const v of columnViews.get(dom) ?? []) v.destroy();
    columnViews.delete(dom);
    columnObservers.get(dom)?.disconnect();
    columnObservers.delete(dom);
  }
  get estimatedHeight() {
    return 48;
  }
  ignoreEvent() {
    return true;
  }
}

/** 본문 잠금·보기 모드가 바뀌면 칸 편집기도 따라 바꾼다 */
const columnLockSync = ViewPlugin.fromClass(
  class {
    update(u: ViewUpdate) {
      if (u.startState.facet(EditorView.editable) === u.state.facet(EditorView.editable) && u.startState.readOnly === u.state.readOnly) return;
      const ext = editableOf(u.view);
      const locked = lockedOf(u.view);
      for (const el of u.view.contentDOM.querySelectorAll<HTMLElement>('[data-page-columns]')) {
        for (const v of columnViews.get(el) ?? []) v.dispatch({ effects: columnEditable.reconfigure(ext), annotations: fromMain.of(true) });
        for (const b of el.querySelectorAll<HTMLButtonElement>('.cm-lp-colbtns button')) b.disabled = locked;
      }
    }
  },
);

/** 커서는 묶음을 한 덩어리로 건너뛴다 */
const atomicCache = new WeakMap<Text, RangeSet<Decoration>>();
const columnAtomic = EditorView.atomicRanges.of((view) => {
  const doc = view.state.doc;
  let set = atomicCache.get(doc);
  if (!set) {
    set = RangeSet.of(columnMarks(doc).map((g) => hide.range(g.from, g.to)));
    atomicCache.set(doc, set);
  }
  return set;
});

/**
 * 묶음 바로 옆에서의 지우기·위아래 — 묶음을 통째로 지우거나 건너뛰지 않고 칸으로 들어간다.
 * 묶음 옆 빈 줄은 지운다.
 */
function besideColumns(dir: -1 | 1, kind: 'delete' | 'move') {
  return (view: EditorView): boolean => {
    const r = view.state.selection.main;
    if (!r.empty) return false;
    const groups = columnMarks(view.state.doc);
    if (!groups.length) return false;
    const line = view.state.doc.lineAt(r.head);
    // dir -1: 위쪽 묶음(줄 머리에서), 1: 아래쪽 묶음(줄 끝에서)
    const g = dir < 0 ? groups.find((k) => k.to + 1 === line.from) : groups.find((k) => k.from === line.to + 1);
    if (!g) return false;
    if (kind === 'delete') {
      if (r.head !== (dir < 0 ? line.from : line.to)) return false;
      if (!line.length) {
        const from = dir < 0 ? line.from - 1 : line.from;
        view.dispatch({ changes: { from, to: from + 1 }, selection: { anchor: from }, userEvent: 'delete.column' });
      }
      const from = dir > 0 && !line.length ? g.from - 1 : g.from;
      return focusColumn(view, from, dir < 0 ? 'last' : 0, dir < 0 ? 'end' : 'start') || true;
    }
    if (!atVerticalEdgeOfLine(view, line, dir)) return false;
    return focusColumn(view, g.from, 0, dir < 0 ? 'end' : 'start');
  };
}

function atVerticalEdgeOfLine(view: EditorView, line: { from: number; to: number }, dir: -1 | 1): boolean {
  const here = view.coordsAtPos(view.state.selection.main.head);
  const edge = view.coordsAtPos(dir < 0 ? line.from : line.to);
  return !here || !edge || Math.abs(here.top - edge.top) < 2;
}

/** `| a | b |` 한 줄을 칸으로 — `\|`는 글자 */
function splitRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
  return s.split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|'));
}

const hide = Decoration.replace({});
const lineDeco = (cls: string) => Decoration.line({ class: cls });
const mark = (cls: string) => Decoration.mark({ class: cls });

/** 인라인 수식 `$…$` — 앞뒤가 공백이 아니고 뒤에 숫자가 오지 않는다(가격 `$5`와 구분) */
const INLINE_MATH = /(?<![\\$])\$(?!\s)([^$\n]+?)(?<![\s\\])\$(?![\d$])/g;

function build(state: EditorState, opts: LivePreviewOptions): DecorationSet {
  const tree = ensureSyntaxTree(state, state.doc.length, 50) ?? syntaxTree(state);
  const doc = state.doc;
  const focused = state.field(focusField);
  const imgSel = state.field(imageSelField, false) ?? null;
  // 커서가 있는 곳만 원문을 드러낸다 — 글을 고른 동안은 렌더된 모습 그대로 (ADR-077)
  const sel = focused ? state.selection.ranges.filter((r) => r.empty) : [];
  const touches = (from: number, to: number) => sel.some((r) => r.from <= to && r.to >= from);
  const lineTouched = (pos: number) => {
    const l = doc.lineAt(pos);
    return touches(l.from, l.to);
  };
  const out: Range<Decoration>[] = [];
  /** 블록 위젯(표·수식)이 덮은 구간 — 그 안에는 다른 장식을 두지 않는다 */
  const covered: [number, number][] = [];
  const isCovered = (pos: number) => covered.some(([a, b]) => pos >= a && pos <= b);
  const code: [number, number][] = [];
  const inCode = (from: number, to: number) => code.some(([a, b]) => from < b && to > a);
  const lines = (from: number, to: number, cls: string) => {
    for (let p = from; p <= to; ) {
      const l = doc.lineAt(p);
      out.push(lineDeco(cls).range(l.from));
      p = l.to + 1;
    }
  };
  /** 기호 뒤 공백 한 칸까지 숨긴다 */
  const withSpace = (to: number) => (to < doc.length && doc.sliceString(to, to + 1) === ' ' ? to + 1 : to);
  const spaceAt = (pos: number) => doc.sliceString(pos, pos + 1) === ' ';

  // 블록 수식 `$$ … $$` (코드 블록 밖)
  tree.iterate({
    enter: (n) => {
      if (n.name === 'FencedCode' || n.name === 'CodeBlock' || n.name === 'InlineCode') {
        code.push([n.from, n.to]);
        return false;
      }
    },
  });
  const text = doc.toString();
  for (const m of text.matchAll(/(^|\n)(\$\$[^\S\n]*\n?[\s\S]*?\$\$)[^\S\n]*(?=\n|$)/g)) {
    const from = m.index! + m[1]!.length;
    const to = from + m[2]!.length;
    if (inCode(from, to)) continue;
    const tex = m[2]!.slice(2, -2).trim();
    covered.push([from, to]);
    if (touches(from, to)) lines(from, to, 'cm-lp-mathsrc');
    else out.push(Decoration.replace({ widget: new MathWidget(tex, true), block: doc.lineAt(from).number !== doc.lineAt(to).number }).range(from, to));
  }

  // 나란히 배치 묶음 `<!-- columns --> … <!-- /columns -->` — 늘 칸 편집기로 그린다 (ADR-096)
  for (let i = 1; i <= doc.lines; i++) {
    const open = doc.line(i);
    if (open.text.trim() !== COLUMNS_OPEN || inCode(open.from, open.to)) continue;
    let j = i + 1;
    while (j <= doc.lines && doc.line(j).text.trim() !== COLUMNS_CLOSE) j++;
    if (j > doc.lines) break;
    const close = doc.line(j);
    covered.push([open.from, close.to]);
    out.push(Decoration.replace({ widget: new ColumnsWidget(doc.sliceString(open.from, close.to), opts), block: true }).range(open.from, close.to));
    i = j;
  }

  tree.iterate({
    enter: (n) => {
      if (isCovered(n.from)) return false;
      const name = n.name;
      // 줄 머리 기호는 뒤에 공백까지 쳐야 블록이 된다 — `#`만 친 줄은 평범한 글. 바뀐 뒤엔 편집 중에도 기호를 숨긴다 (ADR-095)
      // 밑줄(Setext) 제목은 그리지 않는다 — `---`를 치는 순간 윗줄이 커지지 않게
      const heading = /^ATXHeading(\d)$/.exec(name);
      if (heading) {
        const hm = n.node.getChild('HeaderMark');
        if (!hm || !spaceAt(hm.to)) return;
        const line = doc.lineAt(n.from);
        const empty = withSpace(hm.to) >= line.to;
        out.push(Decoration.line({ class: `cm-lp-h${heading[1]}${empty ? ' cm-lp-ph' : ''}`, attributes: empty ? { 'data-ph': `제목 ${heading[1]}` } : {} }).range(line.from));
        out.push(hide.range(hm.from, withSpace(hm.to)));
        return;
      }
      switch (name) {
        case 'Blockquote': {
          const qm = n.node.getChild('QuoteMark');
          if (!qm || !spaceAt(qm.to)) return false;
          // 기호가 있는 줄만 인용으로 그린다 — 기호 없이 이어 붙은 줄(lazy)은 평범한 글로 보인다
          for (let p = n.from; p <= n.to; ) {
            const l = doc.lineAt(p);
            if (/^\s*> /.test(l.text)) out.push(lineDeco('cm-lp-quote').range(l.from));
            p = l.to + 1;
          }
          return;
        }
        case 'QuoteMark':
          if (spaceAt(n.to)) out.push(hide.range(n.from, n.to + 1));
          return;
        case 'FencedCode': {
          const first = doc.lineAt(n.from).number;
          const last = doc.lineAt(n.to).number;
          for (let i = first; i <= last; i++) {
            const l = doc.line(i);
            const cls = ['cm-lp-code', i === first && 'cm-lp-code-first', i === last && 'cm-lp-code-last'].filter(Boolean).join(' ');
            out.push(lineDeco(cls).range(l.from));
          }
          for (const m of [n.node.getChild('CodeMark'), n.node.lastChild]) {
            if (m?.name === 'CodeMark') out.push(mark('cm-lp-fence').range(m.from, m.to));
          }
          return false;
        }
        case 'CodeBlock':
          lines(n.from, n.to, 'cm-lp-code cm-lp-code-first cm-lp-code-last');
          return false;
        case 'InlineCode':
          out.push(mark('cm-lp-inline-code').range(n.from, n.to));
          if (!touches(n.from, n.to)) for (const m of n.node.getChildren('CodeMark')) out.push(hide.range(m.from, m.to));
          return false;
        case 'Emphasis':
        case 'StrongEmphasis':
        case 'Strikethrough': {
          const cls = name === 'Emphasis' ? 'cm-lp-em' : name === 'StrongEmphasis' ? 'cm-lp-strong' : 'cm-lp-strike';
          out.push(mark(cls).range(n.from, n.to));
          if (!touches(n.from, n.to)) {
            const markName = name === 'Strikethrough' ? 'StrikethroughMark' : 'EmphasisMark';
            for (const m of n.node.getChildren(markName)) out.push(hide.range(m.from, m.to));
          }
          return;
        }
        case 'Link':
          return link(n.node);
        case 'Image':
          return image(n.node);
        case 'HorizontalRule':
          if (!lineTouched(n.from)) out.push(Decoration.replace({ widget: new HrWidget() }).range(n.from, n.to));
          return;
        case 'ListItem': {
          const lm = n.node.getChild('ListMark');
          const task = n.node.getChild('Task');
          if (!lm) return;
          if (!spaceAt(lm.to)) return;
          const marker = task?.getChild('TaskMarker');
          if (marker) {
            const checked = /x/i.test(doc.sliceString(marker.from, marker.to));
            out.push(hide.range(lm.from, withSpace(lm.to)));
            out.push(Decoration.replace({ widget: new CheckboxWidget(checked, marker.from) }).range(marker.from, marker.to));
            if (checked) {
              const body = withSpace(marker.to);
              const end = doc.lineAt(marker.from).to;
              if (end > body) out.push(mark('cm-lp-done').range(body, end));
            }
          } else if (/^[-*+]$/.test(doc.sliceString(lm.from, lm.to))) {
            out.push(Decoration.replace({ widget: new BulletWidget() }).range(lm.from, lm.to));
          } else {
            out.push(mark('cm-lp-listmark').range(lm.from, lm.to));
          }
          return;
        }
        case 'Table':
          return table(n.node);
      }
    },
  });

  /** 긴 data URL은 원문을 드러낼 때도 짧은 표시로 접는다 */
  function foldData(url: SyntaxNode | null) {
    if (!url || url.to - url.from < 64) return;
    const m = DATA_URL.exec(doc.sliceString(url.from, Math.min(url.to, url.from + 120)));
    if (m) out.push(Decoration.replace({ widget: new DataUrlWidget(m[1]!, url.to - url.from - m[0].length) }).range(url.from, url.to));
  }

  function image(node: SyntaxNode) {
    const marks = node.getChildren('LinkMark');
    const url = node.getChild('URL');
    if (marks.length < 2 || !url) return false;
    if (touches(node.from, node.to)) {
      foldData(url);
      return false;
    }
    const alt = doc.sliceString(marks[0]!.to, marks[1]!.from).replace(/\\([\\[\]])/g, '$1');
    const picked = !!imgSel && imgSel.from === node.from && imgSel.to === node.to;
    out.push(Decoration.replace({ widget: new ImageWidget(doc.sliceString(url.from, url.to), alt, picked) }).range(node.from, node.to));
    return false;
  }

  function link(node: SyntaxNode) {
    const marks = node.getChildren('LinkMark');
    const url = node.getChild('URL');
    if (marks.length < 2) return;
    const textFrom = marks[0]!.to;
    const textTo = marks[1]!.from;
    const id = pageLinkId(url ? doc.sliceString(url.from, url.to) : null);
    if (touches(node.from, node.to)) {
      out.push(mark('cm-lp-link').range(textFrom, textTo));
      foldData(url);
      return false;
    }
    if (id) {
      const title = doc.sliceString(textFrom, textTo).replace(/\\([\\[\]])/g, '$1');
      out.push(Decoration.replace({ widget: new PageLinkWidget(title, id, !opts.pageExists(id), opts.openPage) }).range(node.from, node.to));
      return false;
    }
    if (textTo > textFrom) out.push(mark('cm-lp-link').range(textFrom, textTo));
    out.push(hide.range(node.from, textFrom), hide.range(textTo, node.to));
    return false;
  }

  function table(node: SyntaxNode) {
    if (touches(node.from, node.to)) {
      lines(node.from, node.to, 'cm-lp-tablesrc');
      return false;
    }
    const rows: string[] = [];
    for (let p = node.from; p <= node.to; ) {
      const l = doc.lineAt(p);
      rows.push(l.text);
      p = l.to + 1;
    }
    const [head = '', delim = '', ...body] = rows;
    const align = splitRow(delim).map((c): Align => {
      const l = c.startsWith(':');
      const r = c.endsWith(':');
      return l && r ? 'center' : r ? 'right' : l ? 'left' : '';
    });
    const widget = new TableWidget(splitRow(head), body.map(splitRow), align);
    const from = doc.lineAt(node.from).from;
    const to = doc.lineAt(node.to).to;
    covered.push([from, to]);
    out.push(Decoration.replace({ widget, block: true }).range(from, to));
    return false;
  }

  // 인라인 수식 (코드·블록 수식 밖)
  for (let i = 1; i <= doc.lines; i++) {
    const l = doc.line(i);
    if (!l.text.includes('$')) continue;
    for (const m of l.text.matchAll(INLINE_MATH)) {
      const from = l.from + m.index!;
      const to = from + m[0].length;
      if (inCode(from, to) || isCovered(from) || touches(from, to)) continue;
      out.push(Decoration.replace({ widget: new MathWidget(m[1]!, false) }).range(from, to));
    }
  }

  return Decoration.set(dropOverlaps(out), true);
}

/** 숨김·위젯끼리 겹치면 CodeMirror가 거부하므로 먼저 놓인 쪽만 남긴다 */
function dropOverlaps(ranges: Range<Decoration>[]): Range<Decoration>[] {
  const isReplace = (r: Range<Decoration>) => r.from < r.to && (r.value as { point?: boolean }).point;
  const keep = new Set<Range<Decoration>>();
  let end = -1;
  for (const r of ranges.filter(isReplace).sort((a, b) => a.from - b.from || b.to - a.to)) {
    if (r.from < end) continue;
    keep.add(r);
    end = r.to;
  }
  return ranges.filter((r) => !isReplace(r) || keep.has(r));
}

/** 실시간 미리보기 확장 */
/** 누른 자리의 링크를 연다: 하위 페이지는 페이지로, 첨부(data:)는 내려받기, http(s)는 새 창 */
function openLinkAt(view: EditorView, e: MouseEvent, opts: LivePreviewOptions): boolean {
  const pos = view.posAtCoords({ x: e.clientX, y: e.clientY });
  if (pos === null) return false;
  for (let node: SyntaxNode | null = syntaxTree(view.state).resolveInner(pos, 1); node; node = node.parent) {
    if (node.name !== 'Link') continue;
    const urlNode = node.getChild('URL');
    if (!urlNode) return false;
    const url = view.state.sliceDoc(urlNode.from, urlNode.to);
    const id = pageLinkId(url);
    if (id) {
      if (opts.pageExists(id)) opts.openPage(id);
      return true;
    }
    const a = document.createElement('a');
    if (/^data:/i.test(url)) {
      // 실행될 수 있는 형식은 열지 않는다 (읽기 화면과 같은 기준)
      if (/^data:(?:text\/html|image\/svg|application\/xhtml|text\/xml|application\/xml)/i.test(url)) return true;
      const t = node.getChild('LinkTitle');
      const title = t ? view.state.sliceDoc(t.from + 1, t.to - 1) : '';
      a.download = title || 'file';
    } else if (/^https?:\/\//i.test(url)) {
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
    } else return false;
    a.href = url;
    a.click();
    return true;
  }
  return false;
}

export function livePreview(opts: LivePreviewOptions): Extension {
  const field = StateField.define<DecorationSet>({
    create: (state) => build(state, opts),
    update(deco, tr) {
      const effect = tr.effects.some((e) => e.is(setFocus) || e.is(setDrag) || e.is(selectImage)) || tr.startState.field(imageSelField) !== tr.state.field(imageSelField);
      const parsed = syntaxTree(tr.startState) !== syntaxTree(tr.state);
      // 끄는 동안 선택만 바뀐 건 다시 그리지 않는다
      if (tr.docChanged || effect || parsed || (tr.selection && !isDragging(tr.state))) return build(tr.state, opts);
      return deco;
    },
    provide: (f) => EditorView.decorations.from(f),
  });
  return [
    focusField,
    dragField,
    imageSelField,
    dragWatch,
    Prec.highest(
      keymap.of([
        { key: 'Backspace', run: deleteSelectedImage },
        { key: 'Delete', run: deleteSelectedImage },
      ]),
    ),
    EditorView.focusChangeEffect.of((_, focusing) => setFocus.of(focusing)),
    EditorState.changeFilter.of(protectColumnMarks),
    columnAtomic,
    columnLockSync,
    Prec.high(
      keymap.of([
        { key: 'Backspace', run: besideColumns(-1, 'delete') },
        { key: 'Delete', run: besideColumns(1, 'delete') },
        { key: 'ArrowUp', run: besideColumns(-1, 'move') },
        { key: 'ArrowDown', run: besideColumns(1, 'move') },
      ]),
    ),
    EditorView.domEventHandlers({
      mousedown: (e, view) => {
        if (e.button === 0 && !e.shiftKey && !e.metaKey && !e.ctrlKey) view.dispatch({ effects: setDrag.of(true) });
        // ⌘/Ctrl+클릭은 링크를 연다 — 보기 화면이 따로 없어 여기서 연다 (ADR-086)
        if (e.button === 0 && (e.metaKey || e.ctrlKey) && openLinkAt(view, e, opts)) {
          e.preventDefault();
          return true;
        }
        return false;
      },
    }),
    field,
  ];
}
