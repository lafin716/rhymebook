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

/** 두 손가락 손동작에 붙일 일 (ADR-092, ADR-104) */
export type GestureAction = 'off' | 'select-pen' | 'eraser-pen' | 'pen-marker' | 'undo' | 'redo' | 'prev-page' | 'next-page';
export const GESTURE_ACTIONS: readonly GestureAction[] = ['off', 'select-pen', 'eraser-pen', 'pen-marker', 'undo', 'redo', 'prev-page', 'next-page'];

/** 두 손가락 손동작 — 두 번 톡, 위·아래·왼쪽·오른쪽으로 밀기 */
export type GestureKey = 'double-tap' | 'swipe-up' | 'swipe-down' | 'swipe-left' | 'swipe-right';
export const GESTURE_KEYS: readonly GestureKey[] = ['double-tap', 'swipe-up', 'swipe-down', 'swipe-left', 'swipe-right'];
export type GestureMap = Record<GestureKey, GestureAction>;

/** 밀기는 기본으로 꺼 두어 두 손가락으로 화면 옮기기·쪽 넘김이 예전처럼 동작한다 */
export const DEFAULT_GESTURES: GestureMap = {
  'double-tap': 'select-pen',
  'swipe-up': 'off',
  'swipe-down': 'off',
  'swipe-left': 'off',
  'swipe-right': 'off',
};

const GESTURES_KEY = 'octobooks.canvas.gestures';
/** 예전(v0.37~) 두 번 톡 설정 — 새 설정이 없을 때만 읽어 옮긴다 */
const LEGACY_TWO_FINGER_KEY = 'octobooks.canvas.twoFingerDoubleTap';

const isAction = (v: unknown): v is GestureAction => GESTURE_ACTIONS.includes(v as GestureAction);

export function loadGestures(): GestureMap {
  const v = load(GESTURES_KEY);
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return Object.fromEntries(GESTURE_KEYS.map((k) => [k, isAction(o[k]) ? o[k] : DEFAULT_GESTURES[k]])) as GestureMap;
  }
  const legacy = load(LEGACY_TWO_FINGER_KEY);
  return { ...DEFAULT_GESTURES, ...(isAction(legacy) ? { 'double-tap': legacy } : {}) };
}

export const saveGestures = (g: GestureMap) => save(GESTURES_KEY, g);
