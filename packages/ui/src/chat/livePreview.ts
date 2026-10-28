import { COLUMNS_CLOSE, COLUMNS_OPEN, pageLinkId, parseColumns, type ID } from '@branch/core';
import { ensureSyntaxTree, syntaxTree } from '@codemirror/language';
import { EditorState, Prec, StateEffect, StateField, type Extension, type Range } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, WidgetType, keymap, type DecorationSet } from '@codemirror/view';
import type { SyntaxNode } from '@lezer/common';
import katex from 'katex';

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

/** 한 칸의 마크다운을 간단히 그린다 — 제목·목록·할 일·인용·이미지·굵게/기울임/코드 */
function renderColumn(md: string, el: HTMLElement) {
  const inline = (text: string, parent: HTMLElement) => {
    const re = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*|~~[^~]+~~)/g;
    let last = 0;
    for (const m of text.matchAll(re)) {
      if (m.index! > last) parent.append(text.slice(last, m.index));
      const t = m[0];
      const tag = t.startsWith('**') ? 'strong' : t.startsWith('`') ? 'code' : t.startsWith('~~') ? 's' : 'em';
      const cut = tag === 'strong' || tag === 's' ? 2 : 1;
      const node = document.createElement(tag);
      node.textContent = t.slice(cut, -cut);
      parent.append(node);
      last = m.index! + t.length;
    }
    if (last < text.length) parent.append(text.slice(last));
  };
  for (const line of md.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    let m: RegExpExecArray | null;
    const row = document.createElement('div');
    row.className = 'cm-lp-col-line';
    if ((m = /^(#{1,6})\s+(.*)$/.exec(t))) {
      row.classList.add(`cm-lp-h${Math.min(m[1]!.length, 3)}`);
      inline(m[2]!, row);
    } else if ((m = /^!\[([^\]]*)\]\(([^)\s]+)[^)]*\)$/.exec(t))) {
      const img = document.createElement('img');
      img.alt = m[1]!;
      img.draggable = false;
      if (/^data:image\/(?:png|jpeg|gif|webp);/i.test(m[2]!) || /^https?:\/\//i.test(m[2]!)) img.src = m[2]!;
      row.append(img);
    } else if ((m = /^[-*+]\s\[([ xX])\]\s?(.*)$/.exec(t))) {
      row.append(m[1] === ' ' ? '☐ ' : '☑ ');
      inline(m[2]!, row);
    } else if ((m = /^[-*+]\s(.*)$/.exec(t))) {
      row.append('• ');
      inline(m[1]!, row);
    } else if ((m = /^(\d+[.)])\s(.*)$/.exec(t))) {
      row.append(`${m[1]} `);
      inline(m[2]!, row);
    } else if ((m = /^>\s?(.*)$/.exec(t))) {
      row.classList.add('cm-lp-col-quote');
      inline(m[1]!, row);
    } else inline(t, row);
    el.append(row);
  }
}

/** 나란히 배치 묶음 (ADR-087 P8) — 칸마다 그리고, 누른 칸의 원문으로 커서를 옮긴다 */
class ColumnsWidget extends WidgetType {
  constructor(readonly source: string) {
    super();
  }
  eq(o: ColumnsWidget) {
    return o.source === this.source;
  }
  toDOM(view: EditorView) {
    const wrap = document.createElement('div');
    wrap.className = 'cm-lp-columns';
    wrap.dataset.pageColumns = '';
    const cols = parseColumns(this.source);
    wrap.style.setProperty('--cols', String(cols.length));
    cols.forEach((md, i) => {
      const col = document.createElement('div');
      col.className = 'cm-lp-column';
      col.dataset.pageColumn = String(i);
      renderColumn(md, col);
      col.addEventListener('mousedown', (e) => e.preventDefault());
      col.addEventListener('click', () => {
        const start = view.posAtDOM(wrap);
        // i번째 칸 원문 첫 글자로
        const lines = this.source.split('\n');
        let offset = lines[0]!.length + 1;
        let seen = 0;
        for (let k = 1; k < lines.length - 1; k++) {
          if (seen === i && lines[k]!.trim()) break;
          if (lines[k]!.trim() === '<!-- column -->') seen++;
          offset += lines[k]!.length + 1;
        }
        view.dispatch({ selection: { anchor: Math.min(start + offset, view.state.doc.length) } });
        view.focus();
      });
      wrap.append(col);
    });
    return wrap;
  }
  ignoreEvent() {
    return true;
  }
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

  // 나란히 배치 묶음 `<!-- columns --> … <!-- /columns -->` — 커서가 없으면 칸으로 그린다
  for (let i = 1; i <= doc.lines; i++) {
    const open = doc.line(i);
    if (open.text.trim() !== COLUMNS_OPEN || inCode(open.from, open.to)) continue;
    let j = i + 1;
    while (j <= doc.lines && doc.line(j).text.trim() !== COLUMNS_CLOSE) j++;
    if (j > doc.lines) break;
    const close = doc.line(j);
    // 커서가 들어가면 칸 원문을 보이되 안쪽은 평소처럼 실시간으로 그린다
    if (touches(open.from, close.to)) {
      out.push(lineDeco('cm-lp-colmark').range(open.from));
      for (let k = i + 1; k < j; k++) {
        const l = doc.line(k);
        out.push(lineDeco(l.text.trim() === '<!-- column -->' ? 'cm-lp-colmark' : 'cm-lp-colsrc').range(l.from));
      }
      out.push(lineDeco('cm-lp-colmark').range(close.from));
    } else {
      covered.push([open.from, close.to]);
      out.push(Decoration.replace({ widget: new ColumnsWidget(doc.sliceString(open.from, close.to)), block: true }).range(open.from, close.to));
    }
    i = j;
  }

  tree.iterate({
    enter: (n) => {
      if (isCovered(n.from)) return false;
      const name = n.name;
      const heading = /^(?:ATX|Setext)Heading(\d)$/.exec(name);
      if (heading) {
        out.push(lineDeco(`cm-lp-h${heading[1]}`).range(doc.lineAt(n.from).from));
        if (!lineTouched(n.from)) {
          const hm = n.node.getChild('HeaderMark');
          if (hm && name.startsWith('ATX')) out.push(hide.range(hm.from, withSpace(hm.to)));
        }
        return;
      }
      switch (name) {
        case 'Blockquote':
          lines(n.from, n.to, 'cm-lp-quote');
          return;
        case 'QuoteMark':
          if (!lineTouched(n.from)) out.push(hide.range(n.from, withSpace(n.to)));
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
          const marker = task?.getChild('TaskMarker');
          if (marker) {
            if (!touches(marker.from, marker.to)) {
              const checked = /x/i.test(doc.sliceString(marker.from, marker.to));
              if (!lineTouched(lm.from)) out.push(hide.range(lm.from, withSpace(lm.to)));
              out.push(Decoration.replace({ widget: new CheckboxWidget(checked, marker.from) }).range(marker.from, marker.to));
              if (checked) {
                const body = withSpace(marker.to);
                const end = doc.lineAt(marker.from).to;
                if (end > body) out.push(mark('cm-lp-done').range(body, end));
              }
            }
          } else if (/^[-*+]$/.test(doc.sliceString(lm.from, lm.to)) && !lineTouched(lm.from)) {
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
