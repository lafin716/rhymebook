import { pageLinkId, type ID } from '@branch/core';
import { ensureSyntaxTree, syntaxTree } from '@codemirror/language';
import { EditorState, StateEffect, StateField, type Extension, type Range } from '@codemirror/state';
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view';
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
  const sel = focused ? state.selection.ranges : [];
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

  function link(node: SyntaxNode) {
    const marks = node.getChildren('LinkMark');
    const url = node.getChild('URL');
    if (marks.length < 2) return;
    const textFrom = marks[0]!.to;
    const textTo = marks[1]!.from;
    const id = pageLinkId(url ? doc.sliceString(url.from, url.to) : null);
    if (touches(node.from, node.to)) {
      out.push(mark('cm-lp-link').range(textFrom, textTo));
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
export function livePreview(opts: LivePreviewOptions): Extension {
  const field = StateField.define<DecorationSet>({
    create: (state) => build(state, opts),
    update(deco, tr) {
      if (tr.docChanged || tr.selection || tr.effects.some((e) => e.is(setFocus)) || syntaxTree(tr.startState) !== syntaxTree(tr.state))
        return build(tr.state, opts);
      return deco;
    },
    provide: (f) => EditorView.decorations.from(f),
  });
  return [
    focusField,
    EditorView.focusChangeEffect.of((_, focusing) => setFocus.of(focusing)),
    field,
  ];
}
