import { CANVAS_PEN_NIBS, type CanvasPenNib } from '@branch/core';

/** 캔버스 도구 설정 (기기별, localStorage): 즐겨찾기 잉크 색, 펜·형광펜 굵기, 펜 종류 */

const FAVORITES_KEY = 'octobooks.canvas.favoriteInks';
const SIZES_KEY = 'octobooks.canvas.strokeSizes';
const NIB_KEY = 'octobooks.canvas.penNib';
const PALETTE_COUNT_KEY = 'octobooks.canvas.paletteCount';
const PALETTE_OPEN_KEY = 'octobooks.canvas.paletteOpen';
const TOOLBAR_DOCK_KEY = 'octobooks.canvas.toolbarDock';

/** 즐겨찾기 잉크 색은 최대 이만큼 */
export const MAX_FAVORITE_INKS = 8;

export type StrokeKind = 'pen' | 'marker';

/** 굵기 범위와 기본값 (캔버스 px) */
export const STROKE_RANGE: Record<StrokeKind, { min: number; max: number; def: number }> = {
  pen: { min: 1, max: 30, def: 4 },
  marker: { min: 4, max: 60, def: 18 },
};

const HEX_RE = /^#[0-9a-f]{6}$/;
export const isHex = (v: unknown): v is string => typeof v === 'string' && HEX_RE.test(v);

export const clampStroke = (kind: StrokeKind, n: number) => {
  const r = STROKE_RANGE[kind];
  return Number.isFinite(n) ? Math.round(Math.max(r.min, Math.min(r.max, n))) : r.def;
};

export type ToolbarDock = 'top' | 'right' | 'bottom' | 'left';

function load(key: string): unknown {
  try {
    return JSON.parse(localStorage.getItem(key) ?? 'null');
  } catch {
    return null;
  }
}

function save(key: string, v: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    // 저장 공간이 없거나 막혀 있으면 이번 실행에서만 기억한다
  }
}

export function loadFavoriteInks(): string[] {
  const v = load(FAVORITES_KEY);
  return Array.isArray(v) ? [...new Set(v.filter(isHex))].slice(0, MAX_FAVORITE_INKS) : [];
}

export const saveFavoriteInks = (list: string[]) => save(FAVORITES_KEY, list);

export function loadStrokeSizes(): Record<StrokeKind, number> {
  const v = (load(SIZES_KEY) ?? {}) as Record<string, unknown>;
  return {
    pen: clampStroke('pen', typeof v.pen === 'number' ? v.pen : STROKE_RANGE.pen.def),
    marker: clampStroke('marker', typeof v.marker === 'number' ? v.marker : STROKE_RANGE.marker.def),
  };
}

export const saveStrokeSizes = (s: Record<StrokeKind, number>) => save(SIZES_KEY, s);

export function loadPenNib(): CanvasPenNib {
  const v = load(NIB_KEY);
  return CANVAS_PEN_NIBS.includes(v as CanvasPenNib) ? (v as CanvasPenNib) : 'fountain';
}

export const savePenNib = (nib: CanvasPenNib) => save(NIB_KEY, nib);

/** 팔레트에 한 번에 보일 색 개수 (null = 모두). 넘치는 색은 '더 많은 색'에 들어간다 (ADR-088) */
export function loadPaletteCount(): number | null {
  const v = load(PALETTE_COUNT_KEY);
  return typeof v === 'number' && Number.isInteger(v) && v >= 1 ? v : null;
}

export const savePaletteCount = (n: number | null) => save(PALETTE_COUNT_KEY, n);

export function loadPaletteOpen(): boolean {
  const v = load(PALETTE_OPEN_KEY);
  return v === null || v === '1';
}

export const savePaletteOpen = (open: boolean) => save(PALETTE_OPEN_KEY, open ? '1' : '0');

export function loadToolbarDock(): ToolbarDock {
  const v = load(TOOLBAR_DOCK_KEY);
  return v === 'right' || v === 'bottom' || v === 'left' ? v : 'top';
}

export const saveToolbarDock = (dock: ToolbarDock) => save(TOOLBAR_DOCK_KEY, dock);

/** 두 손가락으로 두 번 톡 쳤을 때 할 일 (ADR-092) */
export type TwoFingerDoubleTap = 'off' | 'select-pen' | 'eraser-pen' | 'undo';
const TWO_FINGER_KEY = 'octobooks.canvas.twoFingerDoubleTap';
const TWO_FINGER_ACTIONS: readonly TwoFingerDoubleTap[] = ['off', 'select-pen', 'eraser-pen', 'undo'];

export function loadTwoFingerDoubleTap(): TwoFingerDoubleTap {
  const v = load(TWO_FINGER_KEY);
  return TWO_FINGER_ACTIONS.includes(v as TwoFingerDoubleTap) ? (v as TwoFingerDoubleTap) : 'select-pen';
}

export const saveTwoFingerDoubleTap = (a: TwoFingerDoubleTap) => save(TWO_FINGER_KEY, a);
