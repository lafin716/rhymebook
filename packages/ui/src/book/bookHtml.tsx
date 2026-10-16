import { chapterSections, type Book, type BookPart } from '@branch/core';
import type { Element, ElementContent, Root } from 'hast';
import { renderToStaticMarkup } from 'react-dom/server';
import ReactMarkdown, { type Options } from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';
import rehypeKatex from 'rehype-katex';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import { normalizeMathDelimiters } from '../chat/Markdown';
import { BOOK_CSS } from './bookCss';

/**
 * 책 → 인쇄용 단일 HTML (ADR-044).
 * 표지 · 속표지 · 차례(쪽 번호 자리) · 머리말 · 장(여는 쪽 + 본문, 쪽마다 머리글) · 맺음말 · 용어 찾아보기 · 판권.
 * 스크립트는 넣지 않는다 (CSP script-src 'none').
 */

export interface BookHtmlOptions {
  /** 엮은 날 (ms) */
  date: number;
  /** KaTeX 등 앱에서 옮겨 온 CSS */
  extraCss?: string;
  /** 차례 쪽 번호를 채울 수 있나 (데스크톱 PDF). 아니면 쪽 번호 칸을 숨긴다 */
  pageNumbers: boolean;
  /** 글꼴을 허용할 출처 (CSP) */
  fontOrigin?: string;
}

const BOX_TITLE = /^(핵심\s*정리|확인\s*문제|정리|요약|생각해\s*보기|연습\s*문제)/;

const textOf = (n: ElementContent): string =>
  n.type === 'text' ? n.value : n.type === 'element' ? n.children.map(textOf).join('') : '';

/** "**핵심 정리**" 같은 단락 + 바로 뒤 목록을 상자로 묶는다 */
function rehypeBoxes() {
  return (tree: Root) => {
    const kids = tree.children;
    for (let i = 0; i < kids.length; i++) {
      const p = kids[i];
      if (p?.type !== 'element' || p.tagName !== 'p') continue;
      const only = p.children.filter((c) => !(c.type === 'text' && !c.value.trim()));
      if (only.length !== 1 || only[0]!.type !== 'element' || only[0]!.tagName !== 'strong') continue;
      const title = textOf(only[0]!).trim();
      if (!BOX_TITLE.test(title)) continue;
      let j = i + 1;
      while (j < kids.length && kids[j]!.type === 'text') j++;
      const list = kids[j];
      if (list?.type !== 'element' || (list.tagName !== 'ul' && list.tagName !== 'ol')) continue;
      const box: Element = {
        type: 'element',
        tagName: 'aside',
        properties: { className: ['box'] },
        children: [{ type: 'element', tagName: 'p', properties: { className: ['box-title'] }, children: [{ type: 'text', value: title }] }, list],
      };
      kids.splice(i, j - i + 1, box);
    }
  };
}

const remarkPlugins: Options['remarkPlugins'] = [remarkGfm, remarkMath];
const rehypePlugins: Options['rehypePlugins'] = [
  [rehypeKatex, { throwOnError: false, strict: 'ignore' }],
  [rehypeHighlight, { plainText: ['text', 'txt'] }],
  rehypeBoxes,
];

function Md({ source }: { source: string }) {
  return (
    <ReactMarkdown remarkPlugins={remarkPlugins} rehypePlugins={rehypePlugins} skipHtml>
      {normalizeMathDelimiters(source)}
    </ReactMarkdown>
  );
}

const label = (p: BookPart) => (p.kind === 'chapter' ? `${p.number}장` : '');

function TocEntry({ part, sub }: { part: BookPart; sub?: string[] }) {
  return (
    <li className={`toc-${part.kind}`}>
      <a href={`#${part.id}`}>
        {part.kind === 'chapter' && <span className="toc-num">{label(part)}</span>}
        <span className="toc-title">{part.title}</span>
        <span className="toc-dots" />
        <span className="toc-pg" data-for={part.id} />
      </a>
      {sub && sub.length > 0 && (
        <ul className="toc-sub">
          {sub.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ul>
      )}
    </li>
  );
}

function Part({ part }: { part: BookPart }) {
  return (
    <section className={`part part-${part.kind}`} id={part.id}>
      <h2 className="part-title">{part.title}</h2>
      <div className="prose">
        <Md source={part.markdown} />
      </div>
    </section>
  );
}

function Chapter({ part }: { part: BookPart }) {
  const sections = chapterSections(part.markdown);
  return (
    <>
      <section className="opener" id={part.id}>
        <p className="opener-num">
          <span>CHAPTER</span>
          {part.number}
        </p>
        <h2 className="opener-title">{part.title}</h2>
        {sections.length > 0 && (
          <ul className="opener-sections">
            {sections.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        )}
      </section>
      <section className="chapter" style={{ page: `ch-${part.number}` } as React.CSSProperties}>
        <div className="prose">
          <Md source={part.markdown} />
        </div>
      </section>
    </>
  );
}

function BookDoc({ book, date }: { book: Book; date: number }) {
  const d = new Date(date);
  const when = `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일`;
  return (
    <>
      <section className="cover">
        <div className="cover-inner">
          <p className="cover-kicker">학습 기록으로 엮은 책</p>
          <h1 className="cover-title">{book.title}</h1>
          <div className="cover-rule" />
          <p className="cover-foot">
            octobooks
            <br />
            {when}
          </p>
        </div>
      </section>
      <section className="title-page">
        <h1>{book.title}</h1>
        <p>octobooks 학습 기록에서 엮음</p>
      </section>
      <nav className="toc" aria-label="차례">
        <h2>차례</h2>
        <ol>
          {book.front.map((p) => (
            <TocEntry key={p.id} part={p} />
          ))}
          {book.chapters.map((p) => (
            <TocEntry key={p.id} part={p} sub={chapterSections(p.markdown)} />
          ))}
          {book.back.map((p) => (
            <TocEntry key={p.id} part={p} />
          ))}
        </ol>
      </nav>
      {book.front.map((p) => (
        <Part key={p.id} part={p} />
      ))}
      {book.chapters.map((p) => (
        <Chapter key={p.id} part={p} />
      ))}
      {book.back.map((p) => (
        <Part key={p.id} part={p} />
      ))}
      <section className="colophon">
        <p className="colophon-title">{book.title}</p>
        <dl>
          <dt>엮은 날</dt>
          <dd>{when}</dd>
          <dt>엮은 곳</dt>
          <dd>octobooks</dd>
        </dl>
        <p className="colophon-note">이 책은 학습자의 질문과 이해를 바탕으로 AI가 쓴 글입니다. 사실관계는 원문과 함께 확인하세요.</p>
      </section>
    </>
  );
}

/** CSS 문자열 리터럴 (머리글 content용) */
export function cssString(s: string): string {
  return `"${s
    .replace(/[\r\n]+/g, ' ')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/</g, '\\3c ')}"`;
}

const escapeHtml = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** 장마다 이름 있는 쪽: 왼쪽 머리글 = 책 제목, 오른쪽 = 장 제목 */
function runningHeads(book: Book): string {
  const title = cssString(book.title);
  return book.chapters
    .map(
      (c) =>
        `@page ch-${c.number}:left { @top-left { content: ${title}; } }\n` +
        `@page ch-${c.number}:right { @top-right { content: ${cssString(`${c.number}장  ${c.title}`)}; } }`,
    )
    .join('\n');
}

export function buildBookHtml(book: Book, opts: BookHtmlOptions): string {
  const body = renderToStaticMarkup(<BookDoc book={book} date={opts.date} />);
  const fonts = ["'self'", 'data:', 'file:', ...(opts.fontOrigin ? [opts.fontOrigin] : [])].join(' ');
  const csp = `default-src 'none'; style-src 'unsafe-inline'; font-src ${fonts}; img-src data:; script-src 'none'`;
  const css = [BOOK_CSS, runningHeads(book), opts.pageNumbers ? '' : '.toc-pg, .toc-dots { display: none; }', opts.extraCss ?? '']
    .join('\n')
    .replace(/<\/style/gi, '<\\/style');
  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${escapeHtml(csp)}">
<title>${escapeHtml(book.title)}</title>
<style>
${css}
</style>
</head>
<body>
${body}
</body>
</html>
`;
}
