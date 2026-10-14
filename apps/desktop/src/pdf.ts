import { BrowserWindow, session } from 'electron';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRef, PDFString, PDFHexString, type PDFObject } from 'pdf-lib';

/**
 * 책 HTML → PDF (ADR-044).
 * 숨은 창(샌드박스, 스크립트 없는 HTML, file:/data:만 허용)에서 Chromium 인쇄로 만든다.
 * 1차 인쇄의 이름 있는 목적지(`<a href="#id">`가 만든 /Dests)로 각 id의 쪽 번호를 읽어
 * 차례의 `.toc-pg[data-for]`를 채우고 2차 인쇄한다.
 */

const MAX_HTML = 20 * 1024 * 1024;
const TIMEOUT_MS = 90_000;
const PARTITION = 'book-pdf';
const DEV_URL = process.env.BRANCH_DEV_URL;

let queue: Promise<unknown> = Promise.resolve();

export function htmlToPdf(html: unknown): Promise<Uint8Array> {
  if (typeof html !== 'string' || !html.length || html.length > MAX_HTML) return Promise.reject(new Error('invalid'));
  const job = queue.then(() => {
    const ctl = { win: null as BrowserWindow | null };
    return withTimeout(render(html, ctl), TIMEOUT_MS).catch((e: unknown) => {
      // 시간 초과 시 멈춘 인쇄 창을 바로 닫아 다음 작업과 겹치지 않게
      if (ctl.win && !ctl.win.isDestroyed()) ctl.win.destroy();
      throw e;
    });
  });
  queue = job.catch(() => undefined);
  return job;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(t);
        reject(e instanceof Error ? e : new Error(String(e)));
      },
    );
  });
}

let guarded = false;

/** 책 창 전용 세션: 네트워크 요청을 막는다 (KaTeX 글꼴 등 앱 파일만) */
function bookSession() {
  const ses = session.fromPartition(PARTITION);
  if (!guarded) {
    guarded = true;
    const devOrigin = DEV_URL ? new URL(DEV_URL).origin : null;
    ses.webRequest.onBeforeRequest((details, cb) => {
      const u = details.url;
      const ok = u.startsWith('file:') || u.startsWith('data:') || (!!devOrigin && u.startsWith(devOrigin + '/'));
      cb({ cancel: !ok });
    });
    ses.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
  }
  return ses;
}

async function render(html: string, ctl: { win: BrowserWindow | null }): Promise<Uint8Array> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'rhymebook-book-'));
  const file = path.join(dir, 'book.html');
  const win = new BrowserWindow({
    show: false,
    width: 800,
    height: 1100,
    webPreferences: {
      session: bookSession(),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      javascript: true,
      spellcheck: false,
    },
  });
  ctl.win = win;
  const wc = win.webContents;
  wc.setWindowOpenHandler(() => ({ action: 'deny' }));
  wc.on('will-navigate', (e) => e.preventDefault());
  try {
    await writeFile(file, html, 'utf-8');
    await win.loadFile(file);
    await wc.executeJavaScript('document.fonts.ready.then(() => true)');
    const print = () =>
      wc.printToPDF({
        preferCSSPageSize: true,
        printBackground: true,
        generateDocumentOutline: true,
        generateTaggedPDF: true,
      });
    const first = await print();
    const pages = await pageMap(first);
    if (!Object.keys(pages).length) return new Uint8Array(first);
    const filled = (await wc.executeJavaScript(
      `(${fillToc.toString()})(${JSON.stringify(pages)})`,
    )) as number;
    if (!filled) return new Uint8Array(first);
    return new Uint8Array(await print());
  } finally {
    if (!win.isDestroyed()) win.destroy();
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** 페이지 안에서 실행: 차례 쪽 번호 채우기 */
function fillToc(pages: Record<string, number>): number {
  let n = 0;
  document.querySelectorAll<HTMLElement>('.toc-pg[data-for]').forEach((el) => {
    const p = pages[el.dataset.for ?? ''];
    if (p) {
      el.textContent = String(p);
      n++;
    }
  });
  return n;
}

/** 이름 있는 목적지 → 쪽 번호(1부터) */
async function pageMap(pdf: Uint8Array | Buffer): Promise<Record<string, number>> {
  const doc = await PDFDocument.load(pdf, { updateMetadata: false });
  const pageIndex = new Map<string, number>();
  doc.getPages().forEach((p, i) => pageIndex.set(p.ref.toString(), i + 1));
  const ctx = doc.context;
  const out: Record<string, number> = {};
  const lookup = (o: PDFObject | undefined) => (o instanceof PDFRef ? ctx.lookup(o) : o);
  const add = (name: string, value: PDFObject | undefined) => {
    let v = lookup(value);
    if (v instanceof PDFDict) v = lookup(v.get(PDFName.of('D')));
    if (!(v instanceof PDFArray)) return;
    const page = v.get(0);
    if (page instanceof PDFRef) {
      const n = pageIndex.get(page.toString());
      if (n) out[name] = n;
    }
  };
  // PDF 1.1 방식: 카탈로그 /Dests 사전
  const dests = lookup(doc.catalog.get(PDFName.of('Dests')));
  if (dests instanceof PDFDict) for (const [k, v] of dests.entries()) add(k.decodeText(), v);
  // PDF 1.2 방식: /Names /Dests 이름 트리
  const names = lookup(doc.catalog.get(PDFName.of('Names')));
  const walk = (node: PDFObject | undefined, depth: number) => {
    const n = lookup(node);
    if (!(n instanceof PDFDict) || depth > 32) return;
    const leaf = lookup(n.get(PDFName.of('Names')));
    if (leaf instanceof PDFArray) {
      for (let i = 0; i + 1 < leaf.size(); i += 2) {
        const key = lookup(leaf.get(i));
        if (key instanceof PDFString || key instanceof PDFHexString) add(key.decodeText(), leaf.get(i + 1));
      }
    }
    const kids = lookup(n.get(PDFName.of('Kids')));
    if (kids instanceof PDFArray) for (let i = 0; i < kids.size(); i++) walk(kids.get(i), depth + 1);
  };
  if (names instanceof PDFDict) walk(names.get(PDFName.of('Dests')), 0);
  return out;
}
