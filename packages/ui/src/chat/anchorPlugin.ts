import {
  buildSegmentMap,
  isMarkColor,
  layoutAnchorRanges,
  locateAnchor,
  type ID,
  type RenderTextNode,
  type SegmentMap,
  type Annotation,
  type AnnotationStyle,
  type MarkColor,
} from '@branch/core';
import type { Element, ElementContent, Parent, Root, Text } from 'hast';
import { SKIP, visitParents } from 'unist-util-visit-parents';

/** 메시지 안에 하이라이트할 가지 앵커 */
export interface AnchorMark {
  sessionId: ID;
  text: string;
  startOffset: number;
  hasSummary: boolean;
}

export interface RehypeAnchorsOptions {
  anchors: AnchorMark[];
  annotations?: Annotation[];
  messageId?: ID;
  /** 렌더↔원문 맵과 복원 결과(sessionId → 찾음 여부) 콜백 */
  onMap?: (map: SegmentMap, located: Record<ID, boolean>) => void;
}

interface Entry {
  node: Text;
  parent: Parent;
  renderStart: number;
  /** 가장 가까운 블록 조상 (영역 모드 판정용) */
  block: Parent | null;
  /** 속한 수식 래퍼 (KaTeX 출력은 쪼개지 않고 통째로 감싼다) */
  math: Element | null;
}

function insidePre(ancestors: Parent[]): boolean {
  return ancestors.some((a) => (a as Element).tagName === 'pre');
}

function classList(node: unknown): string[] {
  const cls = (node as Partial<Element>).properties?.className;
  return Array.isArray(cls) ? cls.map(String) : [];
}

/** rehypeMathSource가 만든 수식 래퍼 조상 */
function mathRoot(ancestors: Parent[]): Element | null {
  return (ancestors.find((a) => (a as Partial<Element>).properties?.dataMath != null) as Element | undefined) ?? null;
}

function isBlockElement(node: unknown): boolean {
  if (typeof node !== 'object' || !node || !('tagName' in node)) return false;
  const tagName = (node as { tagName: string }).tagName;
  if (tagName === 'div' && (node as Element).properties?.dataMath === 'display') return true;
  return /^(p|li|h[1-6]|pre|blockquote|tr|td|th)$/.test(tagName);
}

/**
 * rehype 플러그인 (rehype-katex 앞에 실행).
 * remark-math의 수식 요소를 원문 position을 가진 래퍼(span/div[data-math])로 감싼다.
 * KaTeX 출력에는 원문 위치가 없으므로(환경에 따라 KaTeX HTML 기준 위치라 쓸 수 없으므로) 앵커 맵은 이 래퍼 범위를 쓴다.
 * 문단에 `$$…$$` 하나만 있으면 블록 수식으로 올린다.
 */
export function rehypeMathSource() {
  return (tree: Root, file: { value?: unknown }) => {
    const source = typeof file.value === 'string' ? file.value : String(file.value ?? '');
    visitParents(tree, 'element', (node, ancestors) => {
      const cls = classList(node);
      if (node.tagName !== 'code' || !cls.some((c) => c === 'math-inline' || c === 'math-display' || c === 'language-math')) {
        return;
      }
      const parent = ancestors[ancestors.length - 1] as Element | Root | undefined;
      const grand = ancestors[ancestors.length - 2] as Element | Root | undefined;
      if (!parent) return;
      let scope: Element = node;
      let host: Parent = parent;
      let child: Element = node;
      let display = cls.includes('math-display');
      if (parent.type === 'element' && parent.tagName === 'pre' && grand) {
        display = true;
        scope = child = parent;
        host = grand;
      } else if (
        !display &&
        parent.type === 'element' &&
        parent.tagName === 'p' &&
        grand &&
        node.position?.start.offset != null &&
        source.startsWith('$$', node.position.start.offset) &&
        parent.children.every((c) => c === node || (c.type === 'text' && !c.value.trim()))
      ) {
        // 단독 `$$…$$` 문단 → 블록 수식 (p 자리에 래퍼, 안에는 code만)
        node.properties.className = [...cls.filter((c) => c !== 'math-inline'), 'math-display'];
        display = true;
        scope = parent;
        host = grand;
      }
      const wrapper: Element = {
        type: 'element',
        tagName: display ? 'div' : 'span',
        properties: { dataMath: display ? 'display' : 'inline' },
        children: [child],
        position: scope.position,
      };
      const idx = host.children.indexOf(scope);
      if (idx >= 0) host.children.splice(idx, 1, wrapper);
      return SKIP;
    });
  };
}

/** 겹친 어노테이션 서식을 합친다 (나중에 수정한 것이 이긴다) → span 속성 */
function annotationProps(annots: Annotation[]): Record<string, string | undefined> {
  const m: AnnotationStyle = {};
  for (const a of [...annots].sort((x, y) => x.updatedAt - y.updatedAt)) {
    if (a.highlight) m.highlight = a.highlight;
    if (a.underline) m.underline = a.underline;
    if (a.textColor) m.textColor = a.textColor;
    if (a.font) m.font = a.font;
    if (a.bold) m.bold = true;
    if (a.italic) m.italic = true;
  }
  // 사용자 지정 색(#rrggbb)은 data-*="custom" + CSS 변수로 (검증된 값만 저장되므로 그대로 넣어도 안전)
  const vars: string[] = [];
  const pick = (c: MarkColor | undefined, cssVar: string) => {
    if (!c || !isMarkColor(c)) return undefined;
    if (!c.startsWith('#')) return c;
    vars.push(`${cssVar}:${c}`);
    return 'custom';
  };
  const props: Record<string, string | undefined> = {
    dataHl: pick(m.highlight, '--hl'),
    dataUl: pick(m.underline, '--ul'),
    dataTc: pick(m.textColor, '--tc'),
    dataFont: m.font,
    dataBold: m.bold ? 'true' : undefined,
    dataItalic: m.italic ? 'true' : undefined,
  };
  if (vars.length) props.style = vars.join(';');
  return props;
}

/**
 * rehype 플러그인 (rehype-highlight 다음에 실행).
 * 1) 블록 사이 공백 텍스트 노드를 제거해 DOM 텍스트 = renderText가 되게 한다
 * 2) 텍스트 노드의 원문 position으로 세그먼트 맵을 만든다 (ADR-002)
 * 3) 앵커를 텍스트 매칭으로 복원해 <mark class="anchor">로 감싼다
 *
 * 수식(KaTeX): 숨김 `.katex-mathml` 텍스트는 renderText에서 뺀다 (selection.ts도 같은 규칙으로 DOM offset을 센다).
 * 보이는 `.katex-html` 텍스트는 수식 래퍼의 원문 범위 안에서만 정렬하고, 표시는 수식 전체를 한 번에 감싼다.
 */
export function rehypeAnchors(options: RehypeAnchorsOptions) {
  return (tree: Root, file: { value?: unknown }) => {
    const source = typeof file.value === 'string' ? file.value : String(file.value ?? '');

    // 1) 블록 사이 공백 제거 (pre 내부, 수식 내부 제외 — 수식 안 공백은 KaTeX 레이아웃)
    const drop: { parent: Parent; node: Text }[] = [];
    visitParents(tree, 'text', (node, ancestors) => {
      const anc = ancestors as Parent[];
      if (!node.position && node.value.trim() === '' && !insidePre(anc) && !mathRoot(anc)) {
        drop.push({ parent: ancestors[ancestors.length - 1] as Parent, node });
      }
    });
    for (const { parent, node } of drop) {
      parent.children = parent.children.filter((c) => c !== node) as typeof parent.children;
    }

    // 2) 세그먼트 맵
    const entries: Entry[] = [];
    const nodes: RenderTextNode[] = [];
    let offset = 0;
    visitParents(tree, 'text', (node, ancestors) => {
      const anc = ancestors as Parent[];
      if (anc.some((a) => classList(a).includes('katex-mathml'))) return;
      const math = mathRoot(anc);
      const start = node.position?.start.offset;
      const end = node.position?.end.offset;
      if (math) {
        // KaTeX 출력 노드의 position은 원문 기준이 아니다 → 수식 래퍼의 원문 범위 안에서만 정렬
        const p = math.position;
        nodes.push(
          p?.start.offset != null && p.end.offset != null
            ? { value: node.value, bound: { start: p.start.offset, end: p.end.offset } }
            : { value: node.value },
        );
      } else if (start != null && end != null) nodes.push({ value: node.value, hint: { start, end } });
      else {
        // 구문 강조 등으로 위치를 잃은 노드: 위치가 있는 가장 가까운 조상(코드 블록 등) 범위 안에서만 찾는다
        const owner = [...ancestors].reverse().find((a) => a.position?.start.offset != null && a.position.end.offset != null);
        nodes.push(
          owner?.position
            ? { value: node.value, bound: { start: owner.position.start.offset!, end: owner.position.end.offset! } }
            : { value: node.value },
        );
      }
      entries.push({
        node,
        parent: ancestors[ancestors.length - 1] as Parent,
        renderStart: offset,
        block: ([...ancestors].reverse().find(isBlockElement) as Parent | undefined) ?? null,
        math,
      });
      offset += node.value.length;
    });
    const map = buildSegmentMap(nodes, source);

    // 3) 앵커 복원. 겹치거나 중첩된 앵커는 조각으로 나눠 모두 표시한다 (ADR-013)
    const located: Record<ID, boolean> = {};
    const byId = new Map<ID, AnchorMark>();
    const ranges: { start: number; end: number; id: ID }[] = [];
    for (const a of options.anchors) {
      const r = locateAnchor(map, a);
      located[a.sessionId] = !!r;
      byId.set(a.sessionId, a);
      if (r) ranges.push({ ...r, id: a.sessionId });
    }
    const pieces = layoutAnchorRanges(ranges);

    // 4) 영역 모드: 2개 이상 블록에 걸친 앵커는 배경 대신 왼쪽 막대로 표시 (ADR-030)
    const region = new Set<ID>();
    for (const r of ranges) {
      const blocks = new Set<Parent | null>();
      for (const e of entries) {
        if (e.renderStart < r.end && e.renderStart + e.node.value.length > r.start && e.node.value.trim()) blocks.add(e.block);
      }
      if (blocks.size > 1) region.add(r.id);
    }

    // 5) 어노테이션(서식·메모) 범위 (ADR-029)
    const annots: { start: number; end: number; a: Annotation }[] = [];
    for (const a of options.annotations ?? []) {
      if (options.messageId && a.anchor.messageId !== options.messageId) continue;
      const r = locateAnchor(map, a.anchor);
      if (r && r.end > r.start) annots.push({ ...r, a });
    }

    /** 렌더 범위 [from, to)에 해당하는 children을 앵커 mark / 어노테이션 span으로 감싼다 */
    const wrap = (children: ElementContent[], from: number, to: number): ElementContent[] => {
      let out = children;
      const piece = pieces.find((p) => p.start < to && p.end > from);
      if (piece) {
        // 가지 표시 아이콘은 각 가지 범위의 끝 조각에 CSS ::after로 (DOM 텍스트 불변)
        const branchEnd = ranges.some((r) => r.end > from && r.end <= to && piece.ids.includes(r.id));
        out = [
          {
            type: 'element',
            tagName: 'mark',
            properties: {
              className: ['anchor'],
              dataSessionId: piece.id,
              dataSessionIds: piece.ids.join(' '),
              dataHasSummary: String(!!byId.get(piece.id)?.hasSummary),
              dataNested: piece.ids.length > 1 ? 'true' : undefined,
              dataRegion: piece.ids.every((id) => region.has(id)) ? 'true' : undefined,
              dataBranchEnd: branchEnd ? 'true' : undefined,
            },
            children: out,
          },
        ];
      }
      const hits = annots.filter((p) => p.start < to && p.end > from).map((p) => p.a);
      if (hits.length) {
        // 메모 표시는 메모가 달린 범위의 끝 조각에 CSS ::after로 (DOM 텍스트 불변)
        const noteEnd = annots.some((p) => p.a.note && p.end > from && p.end <= to);
        out = [
          {
            type: 'element',
            tagName: 'span',
            properties: {
              className: ['annot'],
              dataAnnotIds: hits.map((h) => h.id).join(' '),
              dataNote: hits.some((h) => h.note) ? 'true' : undefined,
              dataNoteEnd: noteEnd ? 'true' : undefined,
              ...annotationProps(hits),
            },
            children: out,
          },
        ];
      }
      return out;
    };

    if (pieces.length || annots.length) {
      const marks = [...pieces, ...annots];
      // 수식: KaTeX 내부를 쪼개지 않고 래퍼 내용 전체를 한 번에 감싼다
      const mathSpans = new Map<Element, { start: number; end: number }>();
      for (const e of entries) {
        if (!e.math) continue;
        const end = e.renderStart + e.node.value.length;
        const span = mathSpans.get(e.math);
        if (span) span.end = Math.max(span.end, end);
        else mathSpans.set(e.math, { start: e.renderStart, end });
      }
      for (const [math, { start, end }] of mathSpans) {
        if (end > start && marks.some((p) => p.start < end && p.end > start)) math.children = wrap(math.children, start, end);
      }

      for (const e of entries) {
        if (e.math) continue;
        const s = e.renderStart;
        const len = e.node.value.length;
        const cuts = new Set<number>([0, len]);
        let hit = false;
        for (const p of marks) {
          if (p.start < s + len && p.end > s) {
            hit = true;
            cuts.add(Math.max(0, p.start - s));
            cuts.add(Math.min(len, p.end - s));
          }
        }
        if (!hit) continue;
        const sorted = [...cuts].sort((x, y) => x - y);
        const out: ElementContent[] = [];
        for (let i = 0; i < sorted.length - 1; i++) {
          const a = sorted[i]!;
          const b = sorted[i + 1]!;
          if (b <= a) continue;
          out.push(...wrap([{ type: 'text', value: e.node.value.slice(a, b) }], s + a, s + b));
        }
        const idx = e.parent.children.indexOf(e.node);
        if (idx >= 0) e.parent.children.splice(idx, 1, ...(out as typeof e.parent.children));
      }
    }

    options.onMap?.(map, located);
  };
}
