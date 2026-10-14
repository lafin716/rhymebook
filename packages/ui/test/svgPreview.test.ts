import { selectionToAnchor, type SegmentMap } from '@branch/core';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Markdown } from '../src/chat/Markdown';
import { svgDocument } from '../src/chat/svgPlugin';

const SVG = '<svg viewBox="0 0 320 120"><rect width="320" height="120" fill="#eef2ff"/><text x="20" y="65">이미지 &amp; 코드</text></svg>';
function render(content: string) {
  let map: SegmentMap | undefined;
  const html = renderToStaticMarkup(createElement(Markdown, { content, onMap: (value) => { map = value; } }));
  return { html, map: map! };
}

describe('SVG 이미지 출력', () => {
  it.each(['svg', 'xml', 'html', ''])('%s 코드 블록을 이미지로 표시하며 원본을 보관한다', (lang) => {
    const { html, map } = render('```' + lang + '\n' + SVG + '\n```');
    expect(html).toContain('data-svg-preview');
    expect(html).toContain('data:image/svg+xml;charset=utf-8,');
    expect(html).toContain('<details>');
    expect(html).toContain('SVG 코드 보기');
    expect(map.renderText).toContain('<svg');
    expect(map.renderText).not.toContain('SVG 코드 보기');
    expect(html).not.toContain('data-svg-source=');
  });

  it('단독 SVG도 렌더하고 일반 HTML은 활성화하지 않는다', () => {
    expect(render(SVG).html).toContain('data-svg-preview');
    expect(render('<script>alert(1)</script>').html).not.toContain('<script>');
  });

  it('빈 줄이 있는 단독 SVG와 그 뒤 원문 offset을 보존한다', () => {
    const svg = '<svg viewBox="0 0 320 120">\n\n<rect width="320" height="120"/>\n\n</svg>';
    const content = svg + '\n\n뒤 설명.';
    const { html, map } = render(content);
    expect(html).toContain('data-svg-preview');
    expect(map.renderText).toContain(svg);
    const start = map.renderText.indexOf('뒤 설명');
    expect(selectionToAnchor('m', map, start, start + 4)?.startOffset).toBe(content.indexOf('뒤 설명'));
  });

  it('단독 SVG 안 수식 구분자와 중첩 SVG를 원문 그대로 둔다', () => {
    const svg = '<svg viewBox="0 0 320 120"><svg><text>\\(hello\\)</text></svg></svg>';
    const { html, map } = render(svg);
    expect(html).toContain('data-svg-preview');
    expect(map.renderText).toBe(svg);
    expect(decodeURIComponent(html.match(/src="([^"]+)"/)![1]!.split(',')[1]!)).toContain('\\(hello\\)');
    expect(svgDocument('<svg/>')).toContain('xmlns=');
  });

  it('앞 코드 예시의 닫히지 않은 SVG 태그는 뒤 단독 SVG에 영향을 주지 않는다', () => {
    const svg = '<svg viewBox="0 0 320 120">\n\n<text>\\(hello\\)</text>\n\n</svg>';
    const content = '```html\n<svg>\n```\n\n`<svg>` 예시.\n\n' + svg;
    const { html, map } = render(content);
    expect(html.match(/data-svg-preview/g)).toHaveLength(1);
    expect(map.renderText).toContain(svg);
  });

  it('xmlns 생략·XML 선언·한글·색상 #·& 문자를 데이터 URL로 보존한다', () => {
    const svg = svgDocument('<?xml version="1.0"?>\n<!-- 그림 -->\n' + SVG)!;
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    const { html } = render('```svg\n' + SVG + '\n```');
    const url = html.match(/src="([^"]+)"/)![1]!;
    expect(decodeURIComponent(url.split(',')[1]!)).toBe(svg);
    expect(svgDocument('<svg xmlns="http://www.w3.org/2000/svg"/>')).toBe('<svg xmlns="http://www.w3.org/2000/svg"/>');
  });

  it('미완성 SVG·일반 코드·인라인 코드는 이미지로 바꾸지 않는다', () => {
    for (const content of ['```svg\n<svg><rect', '```python\nprint("hello")\n```', '`' + SVG + '`']) {
      expect(render(content).html).not.toContain('data-svg-preview');
    }
    expect(svgDocument('<svg></svg> 뒤 문장')).toBeNull();
  });

  it('SVG 뒤 텍스트 선택은 원문 위치를 유지하고 다시 가지 표시를 찾는다', () => {
    const content = '앞 설명.\n\n```svg\n' + SVG + '\n```\n\n뒤 설명을 선택한다.';
    const { map } = render(content);
    const start = map.renderText.indexOf('뒤 설명');
    const anchor = selectionToAnchor('m', map, start, start + '뒤 설명'.length)!;
    expect(anchor.text).toBe('뒤 설명');
    expect(anchor.startOffset).toBe(content.indexOf('뒤 설명'));
    const html = renderToStaticMarkup(createElement(Markdown, {
      content, anchors: [{ sessionId: 'branch', text: anchor.text, startOffset: anchor.startOffset, hasSummary: false }],
    }));
    expect(html).toMatch(/data-session-id="branch"[^>]*>뒤 설명</);
  });
});
