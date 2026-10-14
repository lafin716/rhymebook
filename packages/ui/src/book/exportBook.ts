import { bookFileName, collectBookAnswers, parseBook, safeFileName, type Book, type ID } from '@branch/core';
import { actions } from '../app/store';
import { desktop, mobile } from '../app/runtime';
import { saveBytesFile, saveTextFile } from '../lib/download';
import { buildBookHtml } from './bookHtml';

/**
 * 책 세션 → 진짜 책 같은 PDF (ADR-044).
 * - 데스크톱: 숨은 창에서 Chromium 인쇄로 PDF를 만들고(차례 쪽 번호 채움) 파일로 저장
 * - 웹: 같은 HTML을 숨은 iframe에 넣고 인쇄 창을 연다 ('PDF로 저장')
 * - 모바일: 인쇄용 HTML 파일을 공유 시트로 내보낸다
 */

export function buildSessionBook(sessionId: ID): Book {
  const s = actions();
  const session = s.sessions[sessionId];
  const answers = collectBookAnswers(s.messages[sessionId] ?? []);
  if (!answers.length) throw new Error('아직 책 내용이 없어요. 책을 다 쓴 뒤 저장하세요.');
  const book = parseBook(answers, session?.title ?? '책');
  if (!book.chapters.length && !book.front.length && !book.back.length) {
    throw new Error('책 본문을 찾지 못했어요. "## 1장. 제목" 형식으로 쓴 답변이 있어야 해요.');
  }
  return book;
}

/** 앱에 로드된 KaTeX CSS(@font-face 포함)를 책에 옮긴다. 글꼴 url은 절대 경로로 */
function katexCss(): string {
  const out: string[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      continue;
    }
    const base = sheet.href ?? location.href;
    for (const rule of Array.from(rules)) {
      const text = rule.cssText;
      const isFont = rule instanceof CSSFontFaceRule && /KaTeX/i.test(text);
      const isKatex = rule instanceof CSSStyleRule && rule.selectorText.includes('.katex');
      if (!isFont && !isKatex) continue;
      out.push(
        text.replace(/url\((['"]?)([^'")]+)\1\)/g, (m, _q: string, u: string) => {
          if (/^(data|file|https?):/i.test(u)) return m;
          try {
            return `url("${new URL(u, base).href}")`;
          } catch {
            return m;
          }
        }),
      );
    }
  }
  return out.join('\n');
}

function html(book: Book, pageNumbers: boolean): string {
  const draft = buildBookHtml(book, { date: Date.now(), pageNumbers });
  const extraCss = draft.includes('class="katex') ? katexCss() : '';
  if (!extraCss) return draft;
  const fontOrigin = /^https?:/.test(location.origin) ? location.origin : undefined;
  return buildBookHtml(book, { date: Date.now(), pageNumbers, extraCss, fontOrigin });
}

/** 웹: 숨은 iframe에서 인쇄 창 */
function printInFrame(doc: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const frame = document.createElement('iframe');
    frame.setAttribute('aria-hidden', 'true');
    frame.style.cssText = 'position:fixed;left:-10000px;top:0;width:800px;height:1100px;border:0;opacity:0';
    let removed = false;
    const cleanup = () => {
      if (removed) return;
      removed = true;
      frame.remove();
    };
    frame.onload = () => {
      const w = frame.contentWindow;
      if (!w) {
        cleanup();
        reject(new Error('인쇄 창을 열지 못했어요.'));
        return;
      }
      void w.document.fonts.ready.then(() => {
        w.addEventListener('afterprint', () => window.setTimeout(cleanup, 500));
        w.focus();
        w.print();
        // afterprint가 오지 않는 브라우저 대비
        window.setTimeout(cleanup, 120_000);
        resolve();
      });
    };
    frame.srcdoc = doc;
    document.body.appendChild(frame);
  });
}

export async function exportBookPdf(sessionId: ID): Promise<string> {
  const book = buildSessionBook(sessionId);
  if (desktop?.pdf) {
    const bytes = await desktop.pdf.fromHtml(html(book, true));
    await saveBytesFile(bookFileName(book.title), bytes, 'application/pdf');
    return '책을 PDF로 저장했어요.';
  }
  if (mobile) {
    await saveTextFile(`${safeFileName(book.title, 60)}.html`, html(book, false), 'text/html');
    return '인쇄용 책 파일을 저장했어요. 브라우저로 열어 인쇄 › PDF로 저장하세요.';
  }
  await printInFrame(html(book, false));
  return "인쇄 창에서 'PDF로 저장'을 고르세요.";
}
