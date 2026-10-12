import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { describe, expect, it } from 'vitest';
import { rehypeAnchors } from '../src/chat/anchorPlugin';

const SRC = ['깊이 0 응답. **어텐션**은 값을 가중합한다.', '', '- 스케일링: √d로 나눈다', '- 소프트맥스: 확률', '', '끝.'].join('\n');

function render(anchors: Parameters<typeof rehypeAnchors>[0]['anchors']) {
  return renderToStaticMarkup(
    createElement(ReactMarkdown, { remarkPlugins: [remarkGfm], rehypePlugins: [[rehypeAnchors, { anchors }]] }, SRC),
  );
}

describe('rehypeAnchors 영역 모드', () => {
  it('두 목록 항목에 걸친 앵커는 모든 조각이 data-region', () => {
    const start = SRC.indexOf('스케일링');
    const html = render([{ sessionId: 's1', text: '스케일링: √d로 나눈다소프트맥스', startOffset: start, hasSummary: false }]);
    expect(html.match(/data-region="true"/g)?.length).toBe(2);
  });
});
