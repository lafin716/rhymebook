import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Markdown } from '../src/chat/Markdown';

const render = (content: string) => renderToStaticMarkup(createElement(Markdown, { content }));

describe('한국어 조사가 붙은 강조', () => {
  it.each([
    ['**"인용"**은 좋다', '<strong>&quot;인용&quot;</strong>은'],
    ['**함수(f)**를 본다', '<strong>함수(f)</strong>를'],
    ['값은**"x"**이다', '값은<strong>&quot;x&quot;</strong>이다'],
    ['**100%**가', '<strong>100%</strong>가'],
    ['*기울임(예)*과', '<em>기울임(예)</em>과'],
    ['**텍스트**는', '<strong>텍스트</strong>는'],
  ])('%s', (src, html) => {
    expect(render(src)).toContain(html);
  });

  it('영문 강조 규칙은 그대로', () => {
    expect(render('a**"b"**c')).not.toContain('<strong>');
    expect(render('**bold** text')).toContain('<strong>bold</strong> text');
  });
});
