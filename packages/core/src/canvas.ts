import type { ID, Message, Session } from './model';

/**
 * 캔버스 세션 (ADR-079). 페이지(ADR-072)처럼 본문은 문서 메시지 하나이고, 그 content는 `CanvasDoc` JSON이다.
 * 가져온 항목(이미지·글 카드)이 아래, 펜 필기가 그 위에 그려진다.
 */

export const NEW_CANVAS_TITLE = '새 캔버스';

/** 캔버스 본문 전체 크기 상한 (JSON 길이) — 동기화 `SYNC_LIMITS.doc`과 같다 */
export const CANVAS_MAX_CHARS = 8_000_000;

export const isCanvas = (s: Pick<Session, 'kind'> | undefined): boolean => s?.kind === 'canvas';

/** 글 카드의 출처 */
export interface CanvasSource {
  kind: 'session' | 'page' | 'vault';
  id: ID;
}

interface CanvasBox {
  id: ID;
  /** 캔버스 좌표 (확대 1 기준 px) */
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface CanvasImageItem extends CanvasBox {
  type: 'image';
  /** data:image/(png|jpeg|gif|webp);base64,… */
  src: string;
  name?: string;
}

export interface CanvasTextItem extends CanvasBox {
  type: 'text';
  title: string;
  /** 마크다운 */
  text: string;
  source?: CanvasSource;
}

export type CanvasItem = CanvasImageItem | CanvasTextItem;

export type CanvasTool = 'pen' | 'marker';

export interface CanvasStroke {
  id: ID;
  tool: CanvasTool;
  /** CSS 색 (#rrggbb) */
  color: string;
  /** 굵기 px */
  size: number;
  /** [x, y, 필압(0~1)] 반복. 소수 1자리(필압 2자리)로 반올림 */
  points: number[];
}

/** 판 모양: 자유(끝없는 판), 가로형 16:9, 세로형 9:16 쪽 나눔 */
export type CanvasLayout = 'free' | 'landscape' | 'portrait';
/** 쪽이 이어지는 방향: 옆으로(오른쪽) 또는 위아래로(아래쪽) */
export type CanvasFlow = 'horizontal' | 'vertical';

export interface CanvasDoc {
  v: 1;
  /** 배열 순서 = 아래부터 위로 */
  items: CanvasItem[];
  strokes: CanvasStroke[];
  /** 없으면 'free' */
  layout?: CanvasLayout;
  /** 쪽 나눔 판의 쪽 수 (1 이상). 자유 판에서는 없다 */
  pages?: number;
  /** 쪽 나눔 판의 쪽 방향. 없으면 'horizontal' */
  flow?: CanvasFlow;
}

export const emptyCanvas = (): CanvasDoc => ({ v: 1, items: [], strokes: [] });

/** 쪽 크기 (캔버스 px) */
export const CANVAS_PAGE_SIZE: Record<Exclude<CanvasLayout, 'free'>, { w: number; h: number }> = {
  landscape: { w: 1600, h: 900 },
  portrait: { w: 900, h: 1600 },
};
/** 쪽 사이 간격 (캔버스 px) */
export const CANVAS_PAGE_GAP = 80;
export const CANVAS_MAX_PAGES = 200;

export const canvasLayout = (doc: Pick<CanvasDoc, 'layout'>): CanvasLayout => doc.layout ?? 'free';

export const canvasFlow = (doc: Pick<CanvasDoc, 'flow'>): CanvasFlow => doc.flow ?? 'horizontal';

export const canvasPageCount = (doc: Pick<CanvasDoc, 'layout' | 'pages'>): number =>
  canvasLayout(doc) === 'free' ? 0 : Math.max(1, doc.pages ?? 1);

/**
 * i번째 쪽(0부터)의 사각형. 쪽은 오른쪽(위아래 방향이면 아래쪽)으로 이어지고, 첫 쪽의 가운데가 캔버스 원점이다
 * (자유 판에서 원점 둘레에 쓴 내용이 첫 쪽에 들어온다). 자유 판이면 null.
 */
export function canvasPageRect(layout: CanvasLayout, i: number, flow: CanvasFlow = 'horizontal'): CanvasRect | null {
  if (layout === 'free') return null;
  const { w, h } = CANVAS_PAGE_SIZE[layout];
  return flow === 'vertical'
    ? { x: -w / 2, y: i * (h + CANVAS_PAGE_GAP) - h / 2, w, h }
    : { x: i * (w + CANVAS_PAGE_GAP) - w / 2, y: -h / 2, w, h };
}

/** 판 모양 바꾸기. 내용은 그대로 두고, 쪽 나눔이면 쪽 수·쪽 방향을 지킨다 */
export function setCanvasLayout(doc: CanvasDoc, layout: CanvasLayout): CanvasDoc {
  if (layout === canvasLayout(doc)) return doc;
  const { layout: _l, pages: _p, flow, ...rest } = doc;
  if (layout === 'free') return rest;
  return { ...rest, layout, pages: Math.max(1, doc.pages ?? 1), ...(flow === 'vertical' ? { flow } : {}) };
}

/** 쪽 방향 바꾸기. 자유 판에서는 그대로 */
export function setCanvasFlow(doc: CanvasDoc, flow: CanvasFlow): CanvasDoc {
  if (canvasLayout(doc) === 'free' || flow === canvasFlow(doc)) return doc;
  const { flow: _f, ...rest } = doc;
  return flow === 'vertical' ? { ...rest, flow } : rest;
}

/** 쪽 나눔 판에 빈 쪽을 하나 더한다 (상한이면 그대로) */
export function addCanvasPage(doc: CanvasDoc): CanvasDoc {
  const n = canvasPageCount(doc);
  if (!n || n >= CANVAS_MAX_PAGES) return doc;
  return { ...doc, pages: n + 1 };
}

const IMAGE_SRC_RE = /^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/=]+$/;
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const str = (v: unknown, max: number): v is string => typeof v === 'string' && v.length <= max;

function parseItem(v: unknown): CanvasItem | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  if (!str(o.id, 64) || !o.id || ![o.x, o.y, o.w, o.h].every(num) || (o.w as number) <= 0 || (o.h as number) <= 0) return null;
  const box = { id: o.id, x: o.x as number, y: o.y as number, w: o.w as number, h: o.h as number };
  if (o.type === 'image') {
    if (typeof o.src !== 'string' || !IMAGE_SRC_RE.test(o.src)) return null;
    return { ...box, type: 'image', src: o.src, ...(str(o.name, 300) ? { name: o.name } : {}) };
  }
  if (o.type === 'text') {
    if (!str(o.title, 300) || typeof o.text !== 'string') return null;
    const src = o.source as Record<string, unknown> | undefined;
    const kind = src?.kind;
    const source: CanvasSource | undefined =
      src && (kind === 'session' || kind === 'page' || kind === 'vault') && str(src.id, 64) ? { kind, id: src.id } : undefined;
    return { ...box, type: 'text', title: o.title, text: o.text, ...(source ? { source } : {}) };
  }
  return null;
}

function parseStroke(v: unknown): CanvasStroke | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  if (!str(o.id, 64) || !o.id || (o.tool !== 'pen' && o.tool !== 'marker')) return null;
  if (typeof o.color !== 'string' || !COLOR_RE.test(o.color) || !num(o.size) || o.size <= 0 || o.size > 200) return null;
  if (!Array.isArray(o.points) || o.points.length < 3 || o.points.length % 3 !== 0 || !o.points.every(num)) return null;
  return { id: o.id, tool: o.tool, color: o.color, size: o.size, points: o.points as number[] };
}

/** 문서 메시지 content → 캔버스. 비었거나 깨졌으면 빈 캔버스, 잘못된 항목·획은 버린다 */
export function parseCanvas(content: string | undefined): CanvasDoc {
  if (!content?.trim()) return emptyCanvas();
  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch {
    return emptyCanvas();
  }
  if (!raw || typeof raw !== 'object') return emptyCanvas();
  const o = raw as Record<string, unknown>;
  const items = Array.isArray(o.items) ? o.items.map(parseItem).filter((x): x is CanvasItem => !!x) : [];
  const strokes = Array.isArray(o.strokes) ? o.strokes.map(parseStroke).filter((x): x is CanvasStroke => !!x) : [];
  const doc: CanvasDoc = { v: 1, items, strokes };
  if (o.layout === 'landscape' || o.layout === 'portrait') {
    doc.layout = o.layout;
    doc.pages = num(o.pages) ? Math.min(CANVAS_MAX_PAGES, Math.max(1, Math.floor(o.pages))) : 1;
    if (o.flow === 'vertical') doc.flow = 'vertical';
  }
  return doc;
}

export const serializeCanvas = (doc: CanvasDoc): string => JSON.stringify(doc);

const round = (n: number, d: number) => {
  const f = 10 ** d;
  return Math.round(n * f) / f;
};

/**
 * 입력 점 정리: 앞 점과 minDist보다 가까운 점은 버리고(마지막 점은 남김) 좌표·필압을 반올림한다.
 * points는 [x, y, p] 반복. 필압이 없으면(0) 0.5로 본다.
 */
export function compactPoints(points: readonly number[], minDist = 1): number[] {
  const out: number[] = [];
  const n = Math.floor(points.length / 3);
  for (let i = 0; i < n; i++) {
    const x = round(points[i * 3]!, 1);
    const y = round(points[i * 3 + 1]!, 1);
    const p = round(points[i * 3 + 2]! || 0.5, 2);
    const last = out.length - 3;
    if (last >= 0 && i < n - 1 && Math.hypot(x - out[last]!, y - out[last + 1]!) < minDist) continue;
    if (last >= 0 && i === n - 1 && out[last] === x && out[last + 1] === y) continue;
    out.push(x, y, p);
  }
  return out;
}

/** 점 (px, py)에서 선분 (ax,ay)-(bx,by)까지 거리 */
function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** 획이 점 (x, y)에서 radius 안에 닿는가 (획 굵기 절반 포함) */
export function strokeHit(stroke: CanvasStroke, x: number, y: number, radius: number): boolean {
  const r = radius + stroke.size / 2;
  const p = stroke.points;
  if (p.length === 3) return Math.hypot(x - p[0]!, y - p[1]!) <= r;
  for (let i = 0; i + 5 < p.length; i += 3) {
    if (segDist(x, y, p[i]!, p[i + 1]!, p[i + 3]!, p[i + 4]!) <= r) return true;
  }
  return false;
}

/** 지우개: (x, y) 반경에 닿는 획을 통째로 지운다. 지운 게 없으면 같은 doc을 돌려준다 */
export function eraseStrokesAt(doc: CanvasDoc, x: number, y: number, radius: number): CanvasDoc {
  const strokes = doc.strokes.filter((s) => !strokeHit(s, x, y, radius));
  return strokes.length === doc.strokes.length ? doc : { ...doc, strokes };
}

export const addStroke = (doc: CanvasDoc, stroke: CanvasStroke): CanvasDoc => ({ ...doc, strokes: [...doc.strokes, stroke] });

export const addCanvasItem = (doc: CanvasDoc, item: CanvasItem): CanvasDoc => ({ ...doc, items: [...doc.items, item] });

/** 항목 위치·크기 바꾸기 (w·h는 최소 24) */
export function updateCanvasItem(doc: CanvasDoc, id: ID, patch: Partial<Pick<CanvasItem, 'x' | 'y' | 'w' | 'h'>>): CanvasDoc {
  const i = doc.items.findIndex((it) => it.id === id);
  if (i < 0) return doc;
  const cur = doc.items[i]!;
  const next = { ...cur, ...patch };
  next.w = Math.max(24, round(next.w, 1));
  next.h = Math.max(24, round(next.h, 1));
  next.x = round(next.x, 1);
  next.y = round(next.y, 1);
  const items = doc.items.slice();
  items[i] = next;
  return { ...doc, items };
}

export const removeCanvasItem = (doc: CanvasDoc, id: ID): CanvasDoc => ({ ...doc, items: doc.items.filter((it) => it.id !== id) });

/** 항목을 맨 위(배열 끝)로 */
export function raiseCanvasItem(doc: CanvasDoc, id: ID): CanvasDoc {
  const i = doc.items.findIndex((it) => it.id === id);
  if (i < 0 || i === doc.items.length - 1) return doc;
  const items = doc.items.slice();
  items.push(items.splice(i, 1)[0]!);
  return { ...doc, items };
}

export interface CanvasRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 모든 항목과 획을 감싸는 사각형. 비었으면 null */
export function canvasBounds(doc: CanvasDoc): CanvasRect | null {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const it of doc.items) {
    x0 = Math.min(x0, it.x);
    y0 = Math.min(y0, it.y);
    x1 = Math.max(x1, it.x + it.w);
    y1 = Math.max(y1, it.y + it.h);
  }
  for (const s of doc.strokes) {
    const r = s.size / 2;
    for (let i = 0; i + 2 < s.points.length; i += 3) {
      x0 = Math.min(x0, s.points[i]! - r);
      y0 = Math.min(y0, s.points[i + 1]! - r);
      x1 = Math.max(x1, s.points[i]! + r);
      y1 = Math.max(y1, s.points[i + 1]! + r);
    }
  }
  return x0 === Infinity ? null : { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

const CARD_MAX_CHARS = 20_000;

/** 본문 속 data URL 이미지·파일은 이름만 남긴다 — 카드에 base64를 싣지 않는다 */
const dropEmbeds = (s: string): string =>
  s.replace(/!\[([^\]]*)\]\(data:[^)\s]*\)/g, (_, n: string) => `_🖼 ${n || '이미지'}_`).replace(/\[([^\]]*)\]\(data:[^)]*\)/g, '$1');

const clipText = (s: string, max: number) => (s.length > max ? `${s.slice(0, max).trimEnd()}\n\n…(생략)` : s);

/** 대화 세션을 글 카드용 마크다운으로 (질문·답변 차례, 첨부 data는 뺀다) */
export function sessionCardText(messages: readonly Message[], max = CARD_MAX_CHARS): string {
  const parts: string[] = [];
  for (const m of messages) {
    if (m.status === 'streaming' || m.status === 'error') continue;
    const body = dropEmbeds(m.content).trim();
    const files = (m.attachments ?? []).map((a) => `📎 ${a.name}`).join('  ');
    if (!body && !files) continue;
    parts.push(m.role === 'user' ? `**🙋 ${body.split('\n').join('  \n')}**${files ? `  \n${files}` : ''}` : [body, files].filter(Boolean).join('\n\n'));
  }
  return clipText(parts.join('\n\n---\n\n'), max);
}

/** 페이지 본문을 글 카드용으로 (본문 속 data URL 첨부는 뺀다) */
export const pageCardText = (content: string, max = CARD_MAX_CHARS): string => clipText(dropEmbeds(content).trim(), max);

/** 맥락·검색·내보내기용 캔버스 글: 글 카드 제목과 내용, 이미지·필기 개수 */
export function canvasText(doc: CanvasDoc, max = 6000): string {
  const out: string[] = [];
  for (const it of doc.items) {
    if (it.type === 'text') out.push(`## ${it.title}`, it.text.trim(), '');
    else out.push(`[이미지${it.name ? `: ${it.name}` : ''}]`, '');
  }
  if (doc.strokes.length) out.push(`[손글씨 필기 ${doc.strokes.length}획]`);
  const pages = canvasPageCount(doc);
  if (pages > 1) out.push(`[${pages}쪽]`);
  const text = out.join('\n').trim();
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/** 문서 메시지 content가 캔버스면 읽을 수 있는 글로, 아니면 그대로 */
export const docText = (session: Pick<Session, 'kind'> | undefined, content: string): string =>
  isCanvas(session) ? canvasText(parseCanvas(content), Infinity) : content;
