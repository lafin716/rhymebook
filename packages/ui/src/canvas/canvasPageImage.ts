import { ATTACHMENT_LIMITS, CANVAS_PAPER, CANVAS_PATTERN_STEP, newId, type Attachment, type CanvasDoc, type CanvasRect, type CanvasTextItem } from '@branch/core';
import { isDark } from './canvasBackground';
import { strokeOpacity, strokePath } from './strokePath';

/** 쪽 그림의 긴 변 (px) */
const MAX_SIDE = 2000;
/** 글 카드 모양 — 화면의 카드(CanvasBoard ItemView)와 맞춘다 */
const CARD = { radius: 12, padX: 12, titleH: 30, titleSize: 13, bodySize: 14, lineH: 21 };

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('그림을 읽지 못했어요.'));
    img.src = src;
  });
}

/** 바탕색·무늬 (쪽 왼쪽 위가 무늬의 원점 — 화면의 쪽 배경과 같다) */
function drawBackground(ctx: CanvasRenderingContext2D, doc: CanvasDoc, r: CanvasRect) {
  const color = doc.bg?.color ?? CANVAS_PAPER;
  ctx.fillStyle = color;
  ctx.fillRect(r.x, r.y, r.w, r.h);
  const pattern = doc.bg?.pattern;
  if (!pattern) return;
  ctx.fillStyle = isDark(color) ? 'rgba(255,255,255,0.16)' : 'rgba(31,41,55,0.11)';
  const step = CANVAS_PATTERN_STEP[pattern];
  for (let y = 0; y < r.h; y += step) ctx.fillRect(r.x, r.y + y, r.w, 1);
  if (pattern !== 'lines') for (let x = 0; x < r.w; x += step) ctx.fillRect(r.x + x, r.y, 1, r.h);
}

/** 그림은 상자 안에 비율을 지켜 가운데 놓는다 (object-contain) */
function drawContained(ctx: CanvasRenderingContext2D, img: HTMLImageElement, x: number, y: number, w: number, h: number) {
  const s = Math.min(w / img.naturalWidth, h / img.naturalHeight);
  const dw = img.naturalWidth * s;
  const dh = img.naturalHeight * s;
  ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
}

/** 글자 단위로 줄을 나눈다 (한국어는 띄어쓰기 없이 길게 이어질 수 있다) */
function wrapLines(ctx: CanvasRenderingContext2D, text: string, width: number, max: number): string[] {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const ch of para) {
      if (line && ctx.measureText(line + ch).width > width) {
        out.push(line);
        if (out.length >= max) return out;
        line = ch.trimStart();
      } else line += ch;
    }
    out.push(line);
    if (out.length >= max) return out;
  }
  return out;
}

/** 화면의 카드 색·본문을 그대로 쓴다. 화면에 없으면 기본 밝은 카드와 원문 */
function cardLook(item: CanvasTextItem) {
  const el = document.querySelector<HTMLElement>(`[data-canvas-item="${CSS.escape(item.id)}"]`);
  const box = el?.firstElementChild as HTMLElement | null | undefined;
  const st = box ? getComputedStyle(box) : null;
  const body = el?.querySelector<HTMLElement>('[data-canvas-scroll]');
  return {
    bg: st?.backgroundColor || '#ffffff',
    fg: st?.color || '#1f2937',
    line: st?.borderTopColor || 'rgba(31,41,55,0.15)',
    font: st?.fontFamily || getComputedStyle(document.body).fontFamily,
    text: (body?.innerText ?? item.text).replace(/\n{2,}/g, '\n').trim(),
  };
}

function drawCard(ctx: CanvasRenderingContext2D, item: CanvasTextItem) {
  const look = cardLook(item);
  const { x, y, w, h } = item;
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, CARD.radius);
  ctx.fillStyle = look.bg;
  ctx.fill();
  ctx.strokeStyle = look.line;
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.clip();
  ctx.fillStyle = look.fg;
  ctx.textBaseline = 'middle';
  ctx.font = `600 ${CARD.titleSize}px ${look.font}`;
  const [title = ''] = wrapLines(ctx, item.title, w - CARD.padX * 2, 1);
  ctx.fillText(title === item.title ? title : `${title.slice(0, -1)}…`, x + CARD.padX, y + CARD.titleH / 2);
  ctx.fillStyle = look.line;
  ctx.fillRect(x, y + CARD.titleH, w, 1);
  ctx.fillStyle = look.fg;
  ctx.textBaseline = 'top';
  ctx.font = `${CARD.bodySize}px ${look.font}`;
  const max = Math.max(0, Math.floor((h - CARD.titleH - 8) / CARD.lineH));
  wrapLines(ctx, look.text, w - CARD.padX * 2, max).forEach((ln, i) => ctx.fillText(ln, x + CARD.padX, y + CARD.titleH + 8 + i * CARD.lineH));
  ctx.restore();
}

const overlaps = (a: CanvasRect, b: CanvasRect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/**
 * 쪽 하나를 그림으로 그린다: 바탕(또는 PDF 쪽) → 가져온 그림·글 카드 → 필기 순서. 쪽 밖으로 걸친 부분은 잘린다.
 * 보관함 이미지 첨부로 돌려준다 (webp, 안 되면 png. 첨부 한도를 넘으면 jpeg로 줄인다).
 */
export async function canvasPageAttachment(doc: CanvasDoc, rect: CanvasRect, pageIdx: number, title: string): Promise<Attachment> {
  const scale = Math.min(2, MAX_SIDE / Math.max(rect.w, rect.h));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(rect.w * scale);
  canvas.height = Math.round(rect.h * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('쪽 그림을 만들지 못했어요.');
  ctx.scale(scale, scale);
  ctx.translate(-rect.x, -rect.y);
  ctx.beginPath();
  ctx.rect(rect.x, rect.y, rect.w, rect.h);
  ctx.clip();

  const pdfPage = doc.pdf?.pages[pageIdx];
  if (pdfPage) {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
    ctx.drawImage(await loadImage(pdfPage.src), rect.x, rect.y, rect.w, rect.h);
  } else drawBackground(ctx, doc, rect);

  for (const item of doc.items) {
    if (!overlaps(item, rect)) continue;
    if (item.type === 'image') drawContained(ctx, await loadImage(item.src), item.x, item.y, item.w, item.h);
    else drawCard(ctx, item);
  }

  for (const s of doc.strokes) {
    ctx.globalAlpha = strokeOpacity(s);
    ctx.globalCompositeOperation = s.tool === 'marker' ? 'multiply' : 'source-over';
    ctx.fillStyle = s.color;
    ctx.fill(new Path2D(strokePath(s)));
  }

  let url = canvas.toDataURL('image/webp', 0.9);
  if (!url.startsWith('data:image/webp')) url = canvas.toDataURL('image/png');
  for (const q of [0.85, 0.7, 0.5]) {
    if (base64Bytes(url) <= ATTACHMENT_LIMITS.fileBytes) break;
    url = canvas.toDataURL('image/jpeg', q);
  }
  canvas.width = canvas.height = 0;
  const [head = '', data = ''] = url.split(',', 2);
  const mime = head.slice(5, head.indexOf(';'));
  if (base64Bytes(url) > ATTACHMENT_LIMITS.fileBytes) throw new Error('쪽 그림이 너무 커서 담지 못했어요.');
  const ext = mime.split('/')[1] === 'jpeg' ? 'jpg' : mime.split('/')[1];
  const name = `${title.trim() || '캔버스'} ${pageIdx + 1}쪽`.slice(0, ATTACHMENT_LIMITS.name - 6);
  return { id: newId('f'), kind: 'image', name: `${name}.${ext}`, mime, size: base64Bytes(url), data };
}

/** data URL의 원본 바이트 수 */
function base64Bytes(url: string): number {
  const b64 = url.slice(url.indexOf(',') + 1);
  return Math.floor((b64.length * 3) / 4) - (b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0);
}
