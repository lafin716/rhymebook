import {
  buildSegmentMap,
  layoutAnchorRanges,
  locateAnchor,
  type ID,
  type RenderTextNode,
  type SegmentMap,
  type Annotation,
  type AnnotationStyle,
} from '@branch/core';
import type { Element, ElementContent, Parent, Root, Text } from 'hast';
import { visitParents } from 'unist-util-visit-parents';

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
}

function insidePre(ancestors: Parent[]): boolean {
  return ancestors.some((a) => (a as Element).tagName === 'pre');
}

function isBlockElement(node: unknown): boolean {
  if (typeof node !== 'object' || !node || !('tagName' in node)) return false;
  const tagName = (node as { tagName: string }).tagName;
  return /^(p|li|h[1-6]|pre|blockquote|tr|td|th)$/.test(tagName);
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
  return {
    dataHl: m.highlight,
    dataUl: m.underline,
    dataTc: m.textColor,
    dataFont: m.font,
    dataBold: m.bold ? 'true' : undefined,
    dataItalic: m.italic ? 'true' : undefined,
  };
}

/**
 * rehype 플러그인 (rehype-highlight 다음에 실행).
 * 1) 블록 사이 공백 텍스트 노드를 제거해 DOM 텍스트 = renderText가 되게 한다
 * 2) 텍스트 노드의 원문 position으로 세그먼트 맵을 만든다 (ADR-002)
 * 3) 앵커를 텍스트 매칭으로 복원해 <mark class="anchor">로 감싼다
 */
export function rehypeAnchors(options: RehypeAnchorsOptions) {
  return (tree: Root, file: { value?: unknown }) => {
    const source = typeof file.value === 'string' ? file.value : String(file.value ?? '');

    // 1) 블록 사이 공백 제거 (pre 내부 제외)
    const drop: { parent: Parent; node: Text }[] = [];
    visitParents(tree, 'text', (node, ancestors) => {
      if (!node.position && node.value.trim() === '' && !insidePre(ancestors as Parent[])) {
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
      const start = node.position?.start.offset;
      const end = node.position?.end.offset;
      if (start != null && end != null) nodes.push({ value: node.value, hint: { start, end } });
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

    if (pieces.length || annots.length) {
      for (const e of entries) {
        const s = e.renderStart;
        const len = e.node.value.length;
        const cuts = new Set<number>([0, len]);
        let hit = false;
        for (const p of [...pieces, ...annots]) {
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
          const from = s + a;
          const to = s + b;
          let node: ElementContent = { type: 'text', value: e.node.value.slice(a, b) };
          const piece = pieces.find((p) => p.start < to && p.end > from);
          if (piece) {
            node = {
              type: 'element',
              tagName: 'mark',
              properties: {
                className: ['anchor'],
                dataSessionId: piece.id,
                dataSessionIds: piece.ids.join(' '),
                dataHasSummary: String(!!byId.get(piece.id)?.hasSummary),
                dataNested: piece.ids.length > 1 ? 'true' : undefined,
                dataRegion: piece.ids.every((id) => region.has(id)) ? 'true' : undefined,
              },
              children: [node],
            };
          }
          const hits = annots.filter((p) => p.start < to && p.end > from).map((p) => p.a);
          if (hits.length) {
            // 메모 표시는 메모가 달린 범위의 끝 조각에 CSS ::after로 (DOM 텍스트 불변)
            const noteEnd = annots.some((p) => p.a.note && p.end === to);
            node = {
              type: 'element',
              tagName: 'span',
              properties: {
                className: ['annot'],
                dataAnnotIds: hits.map((h) => h.id).join(' '),
                dataNote: hits.some((h) => h.note) ? 'true' : undefined,
                dataNoteEnd: noteEnd ? 'true' : undefined,
                ...annotationProps(hits),
              },
              children: [node],
            };
          }
          out.push(node);
        }
        const idx = e.parent.children.indexOf(e.node);
        if (idx >= 0) e.parent.children.splice(idx, 1, ...(out as typeof e.parent.children));
      }
    }

    options.onMap?.(map, located);
  };
}
