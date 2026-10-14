import type { Element, Root } from 'hast';
import { SKIP, visitParents } from 'unist-util-visit-parents';

/** 중첩 SVG·주석·CDATA를 고려한 완성된 SVG 원문 범위. */
export function svgRanges(source: string, ignored?: Uint8Array): { start: number; end: number }[] {
  const ranges: { start: number; end: number }[] = [];
  const tags = /<(?:!--[\s\S]*?--|!\[CDATA\[[\s\S]*?\]\]|\/?svg\b(?:[^>"']|"[^"]*"|'[^']*')*)>/g;
  let depth = 0;
  let start = 0;
  for (const match of source.matchAll(tags)) {
    if (ignored?.[match.index]) continue;
    const tag = match[0];
    if (tag.startsWith('<!')) continue;
    if (tag.startsWith('</')) {
      if (depth && --depth === 0) ranges.push({ start, end: match.index + tag.length });
    } else {
      if (!depth) start = match.index;
      if (!tag.endsWith('/>')) depth++;
      else if (!depth) ranges.push({ start, end: match.index + tag.length });
    }
  }
  return ranges;
}

export function svgDocument(source: string): string | null {
  const svg = source.trim().replace(/^<\?xml\s[\s\S]*?\?>\s*/, '').replace(/^(?:<!--[\s\S]*?-->\s*)+/, '');
  if (!/^<svg(?:\s|\/?>)/.test(svg) || !/(?:<\/svg\s*>|^<svg\b[^>]*\/>)$/.test(svg)) return null;
  return /^<svg\b[^>]*\sxmlns\s*=/.test(svg) ? svg : svg.replace(/^<svg\b/, '<svg xmlns="http://www.w3.org/2000/svg"');
}

function textContent(node: Element): string {
  return node.children.map((child) => child.type === 'text' ? child.value : child.type === 'element' ? textContent(child) : '').join('');
}

/** SVG 원문을 보관하며 HTML을 페이지에 삽입하지 않는다. */
export function rehypeSvgPreview() {
  return (tree: Root, file: { value?: unknown }) => {
    const source = String(file.value ?? '');
    const ignored = new Uint8Array(source.length);
    visitParents(tree, 'element', (node) => {
      if (node.tagName !== 'pre' && node.tagName !== 'code') return;
      if (node.position?.start.offset != null && node.position.end.offset != null) {
        ignored.fill(1, node.position.start.offset, node.position.end.offset);
      }
      return SKIP;
    });
    const ranges = svgRanges(source, ignored);
    visitParents(tree, (node, ancestors) => {
      if (node.type === 'element' && node.tagName === 'pre') {
        const source = textContent(node);
        if (svgDocument(source)) node.properties.dataSvgSource = source;
        return SKIP;
      }
      if (node.type !== 'raw' && !(node.type === 'element' && node.tagName === 'p')) return;
      const parent = ancestors[ancestors.length - 1];
      if (!parent) return;
      const index = parent.children.indexOf(node);
      let original = node.type === 'raw' ? node.value : source.slice(node.position?.start.offset, node.position?.end.offset);
      let count = 1;
      let position = node.position;
      if (!svgDocument(original)) {
        const range = ranges.find((r) => r.start === node.position?.start.offset);
        if (!range) return;
        // CommonMark는 빈 줄이 있는 HTML을 여러 노드로 나누므로 같은 SVG 범위를 합친다.
        for (let i = index + 1; i < parent.children.length; i++) {
          const end = parent.children[i]?.position?.end;
          if (end?.offset == null || end.offset < range.end) continue;
          original = source.slice(range.start, end.offset);
          count = i - index + 1;
          position = { start: node.position!.start, end };
          break;
        }
      }
      if (!svgDocument(original)) return;
      const pre: Element = {
        type: 'element', tagName: 'pre', properties: { dataSvgSource: original }, position,
        children: [{
          type: 'element', tagName: 'code', properties: { className: ['language-xml'] }, position,
          children: [{ type: 'text', value: original, position }],
        }],
      };
      parent.children.splice(index, count, pre);
      return SKIP;
    });
  };
}
