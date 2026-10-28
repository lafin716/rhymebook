import type { CanvasRect } from '@branch/core';

/** 화면 = 캔버스 좌표 × k + (x, y) */
export interface CanvasView {
  x: number;
  y: number;
  k: number;
}

export const VIEW_MIN_K = 0.1;
export const VIEW_MAX_K = 6;
/** 맞춤 보기는 작은 그림을 지나치게 키우지 않는다 */
const FIT_MAX_K = 2;

export const clampZoom = (k: number): number => Math.min(VIEW_MAX_K, Math.max(VIEW_MIN_K, k));

/** 화면 좌표 → 캔버스 좌표 */
export const toWorld = (v: CanvasView, sx: number, sy: number) => ({ x: (sx - v.x) / v.k, y: (sy - v.y) / v.k });

/** (sx, sy) 자리를 고정한 채 k배율로 바꾼다 */
export function zoomAt(v: CanvasView, sx: number, sy: number, k: number): CanvasView {
  const nk = clampZoom(k);
  const w = toWorld(v, sx, sy);
  return { k: nk, x: sx - w.x * nk, y: sy - w.y * nk };
}

/** 사각형이 화면 안에 다 들어오도록 맞춘다 */
export function fitView(rect: CanvasRect, vw: number, vh: number, pad = 40): CanvasView {
  const k = Math.min(FIT_MAX_K, clampZoom(Math.min((vw - pad * 2) / Math.max(rect.w, 1), (vh - pad * 2) / Math.max(rect.h, 1))));
  return { k, x: vw / 2 - (rect.x + rect.w / 2) * k, y: vh / 2 - (rect.y + rect.h / 2) * k };
}

/** 내용이 없을 때: 캔버스 원점을 화면 가운데에 둔다 */
export const centerView = (vw: number, vh: number): CanvasView => ({ x: vw / 2, y: vh / 2, k: 1 });
