/**
 * 행 앞 +·핸들 자리 (ADR-096) — 블록마다 시작 줄 바로 앞에 높이 0 블록 위젯을 두고 그 안에 버튼을 절대 배치한다.
 * 버튼이 그 행의 흐름 안에 있으니 위 블록의 높이(제목·표·그림·칸)와 상관없이 늘 행의 왼쪽 위에 붙는다.
 * 세로 자리는 행 종류별 첫 줄 가운데(CSS `[data-row-kind]`). 누르기·끌기는 PageBlockHandles가 위임으로 받는다.
 */
import { markdownBlocks, type MarkdownBlock } from '@branch/core';
import { StateField, type EditorState, type Extension } from '@codemirror/state';
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** lucide 아이콘을 그대로 그린다 (Plus · GripVertical) */
function icon(kind: 'plus' | 'grip'): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  for (const [k, v] of Object.entries({
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': '2',
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    'aria-hidden': 'true',
  }))
    svg.setAttribute(k, v);
  const add = (tag: string, attrs: Record<string, string>) => {
    const el = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    svg.append(el);
  };
  if (kind === 'plus') {
    add('path', { d: 'M5 12h14' });
    add('path', { d: 'M12 5v14' });
  } else {
    for (const cx of ['9', '15']) for (const cy of ['5', '12', '19']) add('circle', { cx, cy, r: '1' });
  }
  return svg;
}

/** 버튼 한 벌 — 블록 앞 +·핸들, 칸 앞 +·핸들이 같이 쓴다 */
export function handleButtons(
  add: { label: string; attrs: Record<string, string> },
  grip: { label: string; attrs: Record<string, string> },
): HTMLElement {
  const box = document.createElement('div');
  box.className = 'cm-lp-rowbtns';
  const make = (kind: 'plus' | 'grip', spec: { label: string; attrs: Record<string, string> }) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = kind === 'plus' ? 'page-handle page-row-add' : 'page-handle page-grip';
    b.setAttribute('aria-label', spec.label);
    for (const [k, v] of Object.entries(spec.attrs)) b.setAttribute(k, v);
    if (kind === 'plus') b.tabIndex = -1;
    b.append(icon(kind));
    box.append(b);
  };
  make('plus', add);
  make('grip', grip);
  return box;
}

/** 첫 줄 모양 — 제목은 단계별로 글자 크기·위 여백이 달라 따로 */
function rowKind(state: EditorState, b: MarkdownBlock): string {
  if (b.kind !== 'heading') return b.kind;
  const m = /^ {0,3}(#{1,6}) /.exec(state.doc.lineAt(b.from).text);
  return m ? `h${m[1]!.length}` : 'paragraph';
}

class RowAnchorWidget extends WidgetType {
  constructor(
    readonly index: number,
    readonly kind: MarkdownBlock['kind'],
    readonly rowKind: string,
  ) {
    super();
  }
  eq(o: RowAnchorWidget) {
    return o.index === this.index && o.kind === this.kind && o.rowKind === this.rowKind;
  }
  toDOM() {
    const el = document.createElement('div');
    el.className = 'cm-lp-rowanchor';
    el.setAttribute('data-row-anchor', String(this.index));
    el.setAttribute('data-row-kind', this.rowKind);
    el.append(
      handleButtons(
        { label: `블록 ${this.index + 1} 아래에 행 추가`, attrs: { 'data-page-row-add': String(this.index) } },
        { label: `블록 ${this.index + 1} 옮기기·메뉴`, attrs: { 'data-page-handle': String(this.index), 'data-block-kind': this.kind } },
      ),
    );
    return el;
  }
  get estimatedHeight() {
    return 0;
  }
  ignoreEvent() {
    return true;
  }
}

function build(state: EditorState): DecorationSet {
  const blocks = markdownBlocks(state.doc.toString());
  return Decoration.set(
    blocks.map((b, i) =>
      Decoration.widget({ widget: new RowAnchorWidget(i, b.kind, rowKind(state, b)), block: true, side: -1 }).range(b.from),
    ),
  );
}

const rowAnchorField = StateField.define<DecorationSet>({
  create: build,
  update: (deco, tr) => (tr.docChanged ? build(tr.state) : deco),
  provide: (f) => EditorView.decorations.from(f),
});

/** 본문 편집기에만 — 칸 안 편집기는 칸 단위 +·핸들을 따로 단다 */
export function rowHandles(): Extension {
  return rowAnchorField;
}
