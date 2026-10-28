import type { CanvasPdf, CanvasPdfPage } from '@branch/core';
import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

/** 한 번에 가져오는 최대 쪽 수 */
export const PDF_MAX_PAGES = 100;
/** PDF 1pt를 캔버스 몇 px로 놓나 (A4 → 1190×1684) */
const PT_TO_CANVAS = 2;
/** 캔버스 쪽 한 변 상한 (core의 PDF_PAGE_MAX_SIDE와 같다) */
const PAGE_MAX_SIDE = 4000;

/** 쪽 그림의 긴 변(px). 쪽이 많을수록 줄여 캔버스 저장 상한 안에 넣는다 */
const renderSide = (n: number) => (n <= 10 ? 1600 : n <= 25 ? 1200 : n <= 50 ? 900 : 700);

export interface PdfImport {
  pdf: CanvasPdf;
  /** PDF 전체 쪽 수 */
  total: number;
  /** 쪽 수나 용량 상한 때문에 앞쪽만 가져왔나 */
  truncated: boolean;
}

/**
 * PDF 파일을 쪽마다 그림(webp, 안 되면 jpeg)으로 바꾼다. pdf.js는 처음 쓸 때만 불러온다.
 * budget: 쪽 그림 글자 수 합계 상한 — 넘으면 거기까지만 가져온다(첫 쪽은 항상).
 */
export async function pdfFromFile(file: File, budget: number, onProgress?: (done: number, total: number) => void): Promise<PdfImport> {
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;
  const at = (dir: string) => new URL(`pdfjs/${dir}/`, document.baseURI).href;
  const task = pdfjs.getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
    cMapUrl: at('cmaps'),
    cMapPacked: true,
    standardFontDataUrl: at('standard_fonts'),
    wasmUrl: at('wasm'),
    iccUrl: at('iccs'),
  });
  let doc: Awaited<typeof task.promise>;
  try {
    doc = await task.promise;
  } catch (e) {
    void task.destroy();
    if (e instanceof Error && e.name === 'PasswordException') throw new Error('암호가 걸린 PDF는 가져올 수 없어요.', { cause: e });
    throw new Error(`${file.name} 을(를) 읽지 못했어요. PDF 파일이 맞는지 확인하세요.`, { cause: e });
  }
  try {
    const total = doc.numPages;
    const n = Math.min(total, PDF_MAX_PAGES);
    const side = renderSide(n);
    const pages: CanvasPdfPage[] = [];
    let used = 0;
    let truncated = n < total;
    for (let i = 1; i <= n; i++) {
      const page = await doc.getPage(i);
      const base = page.getViewport({ scale: 1 });
      const long = Math.max(base.width, base.height);
      const ws = Math.min(PT_TO_CANVAS, PAGE_MAX_SIDE / long);
      const vp = page.getViewport({ scale: side / long });
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.ceil(vp.width));
      canvas.height = Math.max(1, Math.ceil(vp.height));
      await page.render({ canvas, viewport: vp, background: '#ffffff' }).promise;
      let src = canvas.toDataURL('image/webp', 0.82);
      // webp로 못 만드는 브라우저(옛 Safari)는 png를 돌려준다 — jpeg가 훨씬 작다
      if (!src.startsWith('data:image/webp')) src = canvas.toDataURL('image/jpeg', 0.85);
      canvas.width = canvas.height = 0;
      page.cleanup();
      if (pages.length && used + src.length > budget) {
        truncated = true;
        break;
      }
      used += src.length;
      pages.push({ src, w: Math.round(base.width * ws), h: Math.round(base.height * ws) });
      onProgress?.(i, n);
    }
    return { pdf: { name: file.name.replace(/\.pdf$/i, '').slice(0, 300) || 'PDF', pages }, total, truncated };
  } finally {
    void task.destroy();
  }
}
