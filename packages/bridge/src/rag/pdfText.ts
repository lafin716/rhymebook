/**
 * PDF 페이지 텍스트 추출 (pdfjs-dist legacy 빌드, Node). 렌더링·폰트 로딩 없이 텍스트만 읽는다.
 */
import { pathToFileURL } from 'node:url';

interface PdfTextItem {
  str?: string;
  hasEOL?: boolean;
}

interface PdfPage {
  getTextContent(): Promise<{ items: unknown[] }>;
  cleanup?(): void;
}

interface PdfDocument {
  numPages: number;
  getPage(n: number): Promise<PdfPage>;
  destroy(): Promise<void>;
}

interface PdfLoadingTask {
  promise: Promise<PdfDocument>;
  /** pdfjs 6: 문서 객체가 아니라 로딩 작업이 destroy를 가진다 */
  destroy(): Promise<void>;
}

interface PdfJsModule {
  getDocument(src: Record<string, unknown>): PdfLoadingTask;
}

export const PDF_MAX_PAGES = 2000;

const DEFAULT_SPECIFIER = 'pdfjs-dist/legacy/build/pdf.mjs';

let cached: Promise<PdfJsModule> | null = null;

async function loadPdfJs(pdfjsPath?: string): Promise<PdfJsModule> {
  if (!cached) {
    const specifier = pdfjsPath ? pathToFileURL(pdfjsPath).href : DEFAULT_SPECIFIER;
    cached = import(specifier).then((m: unknown) => {
      const mod = m as { getDocument?: unknown; default?: PdfJsModule };
      return typeof mod.getDocument === 'function' ? (mod as PdfJsModule) : (mod.default as PdfJsModule);
    });
    cached.catch(() => {
      cached = null;
    });
  }
  return cached;
}

/** 페이지별 텍스트 배열을 돌려주는 추출기 */
export function createPdfExtractor(pdfjsPath?: string): (bytes: Uint8Array) => Promise<string[]> {
  return async (bytes: Uint8Array): Promise<string[]> => {
    const pdfjs = await loadPdfJs(pdfjsPath);
    const task = pdfjs.getDocument({
      data: new Uint8Array(bytes),
      isEvalSupported: false,
      disableFontFace: true,
      useSystemFonts: false,
      verbosity: 0,
    });
    const doc = await task.promise;
    try {
      const pages: string[] = [];
      const n = Math.min(doc.numPages, PDF_MAX_PAGES);
      for (let i = 1; i <= n; i++) {
        const page = await doc.getPage(i);
        const content = await page.getTextContent();
        const text = content.items
          .map((it) => {
            const item = it as PdfTextItem;
            if (typeof item.str !== 'string') return '';
            return item.str + (item.hasEOL ? '\n' : ' ');
          })
          .join('')
          .replace(/[ \t]+\n/g, '\n')
          .trim();
        pages.push(text);
        page.cleanup?.();
      }
      return pages;
    } finally {
      await task.destroy();
    }
  };
}
