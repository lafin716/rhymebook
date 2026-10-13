import { selectionToAnchor, type SegmentMap } from '@branch/core';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ReactMarkdown from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';
import rehypeKatex from 'rehype-katex';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import { describe, expect, it } from 'vitest';
import { normalizeMathDelimiters } from '../src/chat/Markdown';
import { rehypeAnchors, rehypeMathSource, type AnchorMark } from '../src/chat/anchorPlugin';

function render(src: string, anchors: AnchorMark[] = [], annotations: Parameters<typeof rehypeAnchors>[0]['annotations'] = []) {
  let map: SegmentMap | null = null;
  let located: Record<string, boolean> = {};
  const html = renderToStaticMarkup(
    createElement(
      ReactMarkdown,
      {
        remarkPlugins: [remarkGfm, remarkMath],
        rehypePlugins: [
          rehypeMathSource,
          [rehypeKatex, { throwOnError: false, strict: 'ignore' }],
          [rehypeHighlight, { plainText: ['text', 'txt'] }],
          [
            rehypeAnchors,
            {
              anchors,
              annotations,
              onMap: (m: SegmentMap, l: Record<string, boolean>) => {
                map = m;
                located = l;
              },
            },
          ],
        ],
      },
      normalizeMathDelimiters(src),
    ),
  );
  return { html, map: map as unknown as SegmentMap, located };
}

/** 렌더된 HTML에서 MathML을 뺀 텍스트 (selection.ts가 세는 DOM 텍스트와 같은 규칙) */
function visibleText(html: string): string {
  const noMathml = html.replace(/<span class="katex-mathml">[\s\S]*?<\/math><\/span>/g, '');
  return noMathml
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, '&');
}

describe('수식 렌더', () => {
  it('인라인 $…$ 과 블록 $$…$$(여러 줄)을 KaTeX로 렌더한다', () => {
    const { html } = render('식 $x^2$ 입니다.\n\n$$\n\\sum_{i=1}^n i\n$$\n\n끝.');
    expect(html).toContain('data-math="inline"');
    expect(html).toContain('data-math="display"');
    expect(html).toContain('class="katex-display"');
    expect(html).not.toContain('math-inline');
  });

  it('한 줄짜리 단독 $$…$$ 문단은 블록 수식으로 올린다', () => {
    const { html } = render('앞 문단.\n\n$$x^2 + y^2$$\n\n뒤 문단.');
    expect(html).toContain('data-math="display"');
    expect(html).toContain('class="katex-display"');
  });

  it('문장 속 $$…$$ 는 인라인으로 둔다', () => {
    const { html } = render('문장 $$a+b$$ 안.');
    expect(html).toContain('data-math="inline"');
    expect(html).not.toContain('katex-display');
  });

  it('잘못된 수식도 던지지 않는다', () => {
    expect(() => render('깨진 $\\frac{$ 수식')).not.toThrow();
  });
});

describe('수식과 앵커', () => {
  const SRC = '어텐션 점수는 $QK^T$ 로 구한다.\n\n$$\nE = mc^2\n$$\n\n소프트맥스로 정규화한다.';

  it('renderText는 MathML 숨김 텍스트를 빼고 DOM 보이는 텍스트와 같다', () => {
    const { html, map } = render(SRC);
    expect(map.renderText).toBe(visibleText(html));
    expect(map.renderText).not.toContain('QK^T');
  });

  it('수식 앞뒤 앵커가 위치를 찾고 mark로 감싸진다', () => {
    const a1: AnchorMark = { sessionId: 's1', text: '소프트맥스', startOffset: SRC.indexOf('소프트맥스'), hasSummary: false };
    const a2: AnchorMark = { sessionId: 's2', text: '어텐션 점수', startOffset: 0, hasSummary: false };
    const { html, located } = render(SRC, [a1, a2]);
    expect(located).toEqual({ s1: true, s2: true });
    expect(html).toMatch(/data-session-id="s1"[^>]*>소프트맥스</);
    expect(html).toMatch(/data-session-id="s2"[^>]*>어텐션 점수</);
  });

  it('수식을 포함한 선택 → 앵커 → 다시 렌더해도 찾고, 수식은 통째로 감싼다', () => {
    const { map } = render(SRC);
    const rs = map.renderText.indexOf('점수는');
    const re = map.renderText.indexOf('로 구한다') + '로 구한다'.length;
    const anchor = selectionToAnchor('m1', map, rs, re);
    expect(anchor).not.toBeNull();
    // 원문 offset이 수식 원문을 포함한다
    expect(SRC.slice(anchor!.startOffset, anchor!.endOffset)).toContain('$QK^T$');
    const { html, located } = render(SRC, [{ sessionId: 's3', text: anchor!.text, startOffset: anchor!.startOffset, hasSummary: false }]);
    expect(located.s3).toBe(true);
    // 수식 래퍼 안에서 KaTeX 전체가 하나의 mark로 감싸진다 (KaTeX 내부 span은 쪼개지 않음)
    expect(html).toMatch(/data-math="inline"><mark class="anchor"[^>]*><span class="katex">/);
    // 가지 끝 표시는 하나
    expect(html.match(/data-branch-end="true"/g)?.length).toBe(1);
  });

  it('블록 수식만 선택한 서식(어노테이션)도 통째로 감싼다', () => {
    const { map } = render(SRC);
    const start = map.renderText.indexOf('E');
    const anchor = selectionToAnchor('m1', map, start, start + 1)!;
    expect(anchor).not.toBeNull();
    const { html } = render(SRC, [], [{ id: 'n1', sessionId: 's', anchor, highlight: 'yellow', createdAt: 0, updatedAt: 0 }]);
    expect(html).toMatch(/data-math="display"><span class="annot"[^>]*data-hl="yellow"[^>]*><span class="katex-display">/);
  });
});

describe('LaTeX 구분자 변환 (길이 보존)', () => {
  const cases = [
    '식 \\(x+1\\) 입니다.',
    '블록:\n\n\\[\na^2+b^2=c^2\n\\]\n\n끝',
    '한 줄 \\[x^2\\] 수식',
    '코드 `\\(x\\)` 와 ```\n\\[y\\]\n``` 은 그대로',
    '행렬 $$\\begin{matrix}a\\\\[2pt]b\\end{matrix}$$',
  ];
  it.each(cases)('길이가 같다: %s', (src) => {
    expect(normalizeMathDelimiters(src).length).toBe(src.length);
  });

  it('\\( \\) 와 \\[ \\] 를 바꾼다', () => {
    expect(normalizeMathDelimiters('식 \\(x+1\\) 입니다.')).toBe('식 $ x+1 $ 입니다.');
    expect(normalizeMathDelimiters('\\[\na\n\\]')).toBe('$$\na\n$$');
  });

  it('코드·이스케이프된 역슬래시·짝 없는 구분자는 그대로', () => {
    expect(normalizeMathDelimiters('코드 `\\(x\\)` 끝')).toBe('코드 `\\(x\\)` 끝');
    expect(normalizeMathDelimiters('```\n\\[y\\]\n```')).toBe('```\n\\[y\\]\n```');
    expect(normalizeMathDelimiters('a\\\\[2pt] b')).toBe('a\\\\[2pt] b');
    expect(normalizeMathDelimiters('배열 \\[ 하나만')).toBe('배열 \\[ 하나만');
    // 여는 줄에 내용이 있는 여러 줄 블록은 닫히지 않는 수식 블록 위험 → 바꾸지 않는다
    expect(normalizeMathDelimiters('\\[ a\nb \\]')).toBe('\\[ a\nb \\]');
  });

  it('변환된 \\(…\\) 는 인라인 수식으로, \\[…\\] 는 블록 수식으로 렌더된다', () => {
    const { html } = render('식 \\(x+1\\) 입니다.\n\n\\[\na^2\n\\]');
    expect(html).toContain('data-math="inline"');
    expect(html).toContain('data-math="display"');
  });
});
