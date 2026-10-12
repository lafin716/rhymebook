import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { describe, expect, it } from 'vitest';
import { rehypeAnchors } from '../src/chat/anchorPlugin';

const SRC = ['깊이 0 응답. **어텐션**은 값을 가중합한다.', '', '- 스케일링: √d로 나눈다', '- 소프트맥스: 확률', '', '끝.'].join('\n');

function render(
  anchors: Parameters<typeof rehypeAnchors>[0]['anchors'],
  annotations: Parameters<typeof rehypeAnchors>[0]['annotations'] = [],
) {
  return renderToStaticMarkup(
    createElement(
      ReactMarkdown,
      { remarkPlugins: [remarkGfm], rehypePlugins: [[rehypeAnchors, { anchors, annotations }]] },
      SRC,
    ),
  );
}

describe('rehypeAnchors 영역 모드', () => {
  it('두 목록 항목에 걸친 앵커는 모든 조각이 data-region', () => {
    const start = SRC.indexOf('스케일링');
    const html = render([{ sessionId: 's1', text: '스케일링: √d로 나눈다소프트맥스', startOffset: start, hasSummary: false }]);
    expect(html.match(/data-region="true"/g)?.length).toBe(2);
  });
});

describe('rehypeAnchors 가지 끝 표시', () => {
  it('여러 조각으로 나뉜 앵커도 마지막 조각에만 data-branch-end', () => {
    const start = SRC.indexOf('스케일링');
    const html = render([{ sessionId: 's1', text: '스케일링: √d로 나눈다소프트맥스', startOffset: start, hasSummary: false }]);
    expect(html.match(/data-branch-end="true"/g)?.length).toBe(1);
    expect(html).toMatch(/data-branch-end="true"[^>]*>소프트맥스</);
  });
});

describe('rehypeAnchors 사용자 지정 색', () => {
  it('#rrggbb 색은 data-*="custom"과 CSS 변수로 렌더한다', () => {
    const start = SRC.indexOf('끝.');
    const anchor = { messageId: 'm1', text: '끝', startOffset: start, endOffset: start + 1 };
    const html = render([], [
      { id: 'a1', sessionId: 's', anchor, highlight: '#12ab34', textColor: 'blue', createdAt: 0, updatedAt: 0 },
    ]);
    expect(html).toContain('data-hl="custom"');
    expect(html).toContain('data-tc="blue"');
    expect(html).toContain('--hl:#12ab34');
  });
});
