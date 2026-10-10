import {
  buildSegmentMap,
  layoutAnchorRanges,
  locateAnchor,
  type ID,
  type RenderTextNode,
  type SegmentMap,
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
  /** 렌더↔원문 맵과 복원 결과(sessionId → 찾음 여부) 콜백 */
  onMap?: (map: SegmentMap, located: Record<ID, boolean>) => void;
}

interface Entry {
  node: Text;
  parent: Parent;
  renderStart: number;
}

function insidePre(ancestors: Parent[]): boolean {
  return ancestors.some((a) => (a as Element).tagName === 'pre');
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
      entries.push({ node, parent: ancestors[ancestors.length - 1] as Parent, renderStart: offset });
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

    if (pieces.length) {
      for (const e of entries) {
        const s = e.renderStart;
        const len = e.node.value.length;
        const hits = pieces.filter((r) => r.start < s + len && r.end > s);
        if (!hits.length) continue;
        const out: ElementContent[] = [];
        let cur = 0;
        for (const r of hits) {
          const a = Math.max(0, r.start - s);
          const b = Math.min(len, r.end - s);
          if (a > cur) out.push({ type: 'text', value: e.node.value.slice(cur, a) });
          out.push({
            type: 'element',
            tagName: 'mark',
            properties: {
              className: ['anchor'],
              dataSessionId: r.id,
              dataSessionIds: r.ids.join(' '),
              dataHasSummary: String(!!byId.get(r.id)?.hasSummary),
              dataNested: r.ids.length > 1 ? 'true' : undefined,
            },
            children: [{ type: 'text', value: e.node.value.slice(a, b) }],
          });
          cur = b;
        }
        if (cur < len) out.push({ type: 'text', value: e.node.value.slice(cur) });
        const idx = e.parent.children.indexOf(e.node);
        if (idx >= 0) e.parent.children.splice(idx, 1, ...(out as typeof e.parent.children));
      }
    }

    options.onMap?.(map, located);
  };
}
