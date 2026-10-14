/** 책 인쇄 CSS (ADR-044) — A5, 양면(안쪽 여백이 넓음), 명조 본문 · 고딕 제목 */
export const BOOK_CSS = String.raw`
@page {
  size: 148mm 210mm;
  margin: 20mm 16mm 22mm 20mm;
  @bottom-center { content: none; }
}
@page :left {
  margin-left: 16mm;
  margin-right: 20mm;
  @bottom-left { content: counter(page); font: 8pt var(--sans); color: #777; }
  @top-left { font: 7.5pt var(--sans); color: #888; letter-spacing: 0.02em; }
}
@page :right {
  margin-left: 20mm;
  margin-right: 16mm;
  @bottom-right { content: counter(page); font: 8pt var(--sans); color: #777; }
  @top-right { font: 7.5pt var(--sans); color: #888; letter-spacing: 0.02em; }
}
@page cover {
  margin: 0;
  @bottom-left { content: none; }
  @bottom-right { content: none; }
}
@page plain {
  @bottom-left { content: none; }
  @bottom-right { content: none; }
}
@page opener {
  @bottom-left { content: none; }
  @bottom-right { content: none; }
}

:root {
  --serif: "Noto Serif KR", "Noto Serif CJK KR", "AppleMyungjo", "Nanum Myeongjo", "NanumMyeongjo", "Batang", serif;
  --sans: "Pretendard", "Apple SD Gothic Neo", "Noto Sans KR", "Noto Sans CJK KR", "Malgun Gothic", sans-serif;
  --mono: "SF Mono", "Menlo", "D2Coding", "Consolas", monospace;
  --ink: #1d1d1f;
  --accent: #8a4b2a;
  --paper-dark: #2b2f3a;
}
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body {
  font-family: var(--serif);
  font-size: 10pt;
  line-height: 1.75;
  color: var(--ink);
  word-break: keep-all;
  overflow-wrap: break-word;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}

/* 표지 */
.cover {
  page: cover;
  height: 210mm;
  width: 148mm;
  padding: 0;
  overflow: hidden;
  background: var(--paper-dark);
  color: #f4efe6;
  break-after: page;
}
.cover-inner {
  height: 100%;
  padding: 38mm 18mm 20mm;
  display: flex;
  flex-direction: column;
}
.cover-kicker {
  margin: 0;
  font: 500 8.5pt var(--sans);
  letter-spacing: 0.2em;
  color: #d9b48f;
}
.cover-title {
  margin: 8mm 0 0;
  font: 700 24pt/1.3 var(--serif);
  word-break: keep-all;
}
.cover-rule { width: 18mm; height: 1.2mm; margin-top: 10mm; background: #d9b48f; }
.cover-foot {
  margin: auto 0 0;
  font: 8.5pt/1.6 var(--sans);
  color: #c9c3b8;
  letter-spacing: 0.06em;
}

/* 속표지 */
.title-page {
  page: plain;
  break-after: page;
  padding-top: 50mm;
  text-align: center;
}
.title-page h1 { font: 700 17pt/1.4 var(--serif); margin: 0 0 6mm; }
.title-page p { font: 8.5pt var(--sans); color: #777; margin: 0; }

/* 차례 */
.toc { page: plain; break-after: page; }
.toc h2 {
  font: 700 15pt var(--sans);
  margin: 6mm 0 8mm;
  letter-spacing: 0.1em;
}
.toc ol, .toc ul { list-style: none; margin: 0; padding: 0; }
.toc > ol > li { margin: 0 0 2.2mm; break-inside: avoid; }
.toc a {
  display: flex;
  align-items: baseline;
  gap: 2mm;
  color: inherit;
  text-decoration: none;
  font: 10pt/1.5 var(--sans);
}
.toc-chapter > a { font-weight: 600; }
.toc-num { color: var(--accent); min-width: 9mm; }
.toc-dots { flex: 1; border-bottom: 0.6pt dotted #aaa; transform: translateY(-1mm); min-width: 6mm; }
.toc-pg { font-variant-numeric: tabular-nums; min-width: 5mm; text-align: right; }
.toc-sub { margin: 0.8mm 0 0 11mm !important; }
.toc-sub li { font: 8.5pt/1.55 var(--sans); color: #666; }

/* 머리말·맺음말 등 */
.part { break-before: page; }
.part-title {
  font: 700 15pt/1.4 var(--sans);
  margin: 4mm 0 9mm;
  padding-bottom: 3mm;
  border-bottom: 0.8pt solid var(--ink);
}

/* 장 여는 쪽 */
.opener {
  page: opener;
  break-before: page;
  break-after: page;
  padding-top: 36mm;
}
.opener-num {
  margin: 0;
  font: 700 40pt/1 var(--sans);
  color: var(--accent);
}
.opener-num span {
  display: block;
  font: 600 8pt var(--sans);
  letter-spacing: 0.3em;
  color: #999;
  margin-bottom: 3mm;
}
.opener-title { font: 700 18pt/1.4 var(--serif); margin: 8mm 0 12mm; }
.opener-sections {
  list-style: none;
  margin: 0;
  padding: 4mm 0 0;
  border-top: 0.6pt solid #ccc;
}
.opener-sections li { font: 9pt/1.9 var(--sans); color: #555; }

/* 본문 */
.prose { text-align: justify; hyphens: manual; }
/* 한국어 책처럼 음절 단위로 줄을 나눠 양쪽 정렬 간격을 고르게 */
.prose p, .prose li { word-break: normal; line-break: strict; }
.prose p { margin: 0 0 0.9em; orphans: 2; widows: 2; }
.prose h2, .prose h3, .prose h4 {
  font-family: var(--sans);
  break-after: avoid;
  text-align: left;
}
.prose h2 { font-size: 13pt; margin: 1.6em 0 0.7em; }
.prose h3 { font-size: 11.5pt; margin: 1.5em 0 0.6em; color: var(--accent); }
.prose h4 { font-size: 10.5pt; margin: 1.2em 0 0.5em; }
.prose > :first-child { margin-top: 0; }
.prose ul, .prose ol { margin: 0 0 0.9em; padding-left: 1.4em; }
.prose li { margin: 0.15em 0; }
.prose li > p { margin: 0 0 0.3em; }
.prose strong { font-weight: 700; }
.prose a { color: inherit; text-decoration: underline; text-decoration-color: #bbb; }
.prose blockquote {
  margin: 0 0 1em;
  padding: 0.2em 0 0.2em 4mm;
  border-left: 1.2pt solid var(--accent);
  color: #555;
}
.prose hr { border: 0; text-align: center; margin: 1.4em 0; }
.prose hr::after { content: "* * *"; color: #aaa; letter-spacing: 0.5em; font-size: 8pt; }
.prose code {
  font-family: var(--mono);
  font-size: 0.86em;
  background: #f3f1ec;
  padding: 0.05em 0.3em;
  border-radius: 2px;
}
.prose pre {
  font-size: 8pt;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-all;
  background: #f6f4ef;
  border: 0.5pt solid #e2ddd2;
  border-radius: 2mm;
  padding: 3mm 3.5mm;
  margin: 0 0 1em;
  text-align: left;
}
.prose pre code { background: none; padding: 0; font-size: inherit; }
.prose table {
  width: 100%;
  border-collapse: collapse;
  font: 8.5pt/1.5 var(--sans);
  margin: 0 0 1em;
  text-align: left;
  break-inside: avoid;
}
.prose th, .prose td { border-bottom: 0.5pt solid #ccc; padding: 1.2mm 1.5mm; vertical-align: top; }
.prose th { border-bottom: 0.9pt solid var(--ink); font-weight: 700; }
.prose img { max-width: 100%; }
.prose .katex-display { margin: 0.8em 0; overflow: hidden; }

/* 핵심 정리 · 확인 문제 상자 */
.box {
  break-inside: avoid;
  margin: 1.2em 0;
  padding: 3mm 4mm 1.5mm;
  background: #f7f1e8;
  border-radius: 2mm;
  text-align: left;
}
.box-title { font: 700 9pt var(--sans) !important; color: var(--accent); margin: 0 0 1.5mm !important; letter-spacing: 0.05em; }
.box ul, .box ol { font-size: 9.2pt; margin-bottom: 1.5mm; }

/* 판권 */
.colophon {
  page: plain;
  break-before: page;
  padding-top: 120mm;
  font: 8.5pt/1.7 var(--sans);
  color: #555;
}
.colophon-title { font-weight: 700; font-size: 10pt; color: var(--ink); margin: 0 0 3mm; padding-bottom: 2mm; border-bottom: 0.6pt solid #999; }
.colophon dl { display: grid; grid-template-columns: 16mm 1fr; margin: 0 0 4mm; }
.colophon dt { color: #888; }
.colophon dd { margin: 0; }
.colophon-note { margin: 0; color: #888; }

/* 코드 강조 (밝은 종이용) */
.hljs-comment, .hljs-quote { color: #8b8b8b; font-style: italic; }
.hljs-keyword, .hljs-selector-tag, .hljs-built_in, .hljs-type { color: #8a3b6f; }
.hljs-string, .hljs-attr, .hljs-template-tag, .hljs-addition { color: #3b7a3b; }
.hljs-number, .hljs-literal, .hljs-symbol { color: #a5561c; }
.hljs-title, .hljs-section, .hljs-function .hljs-title { color: #2b5c9e; }
.hljs-variable, .hljs-params, .hljs-meta { color: #555; }
.hljs-deletion { color: #b03030; }
`;
