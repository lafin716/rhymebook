import { getStroke, type StrokeOptions } from 'perfect-freehand';
import type { CanvasPenNib, CanvasStroke } from '@branch/core';

/** 형광펜 색 투명도 */
export const MARKER_OPACITY = 0.35;

/** 펜 종류별 획 모양. 만년필은 필압에 따라 굵기가 변하고, 볼펜은 거의 일정, 붓펜은 크게 변하며 끝이 가늘고, 연필은 가늘게 변한다 */
const NIB: Record<CanvasPenNib, StrokeOptions> = {
  fountain: { thinning: 0.5, smoothing: 0.5, streamline: 0.5 },
  ballpoint: { thinning: 0.1, smoothing: 0.6, streamline: 0.6 },
  brush: { thinning: 0.8, smoothing: 0.6, streamline: 0.45, start: { taper: true }, end: { taper: true } },
  pencil: { thinning: 0.25, smoothing: 0.35, streamline: 0.3 },
};
const MARKER: StrokeOptions = { thinning: 0, smoothing: 0.5, streamline: 0.5 };

/** 필압이 없는 입력(마우스: 모두 0.5)인지 */
const flatPressure = (points: readonly number[]) => {
  for (let i = 2; i < points.length; i += 3) if (points[i] !== 0.5) return false;
  return true;
};

/** 획 → 외곽선 SVG path. 펜은 종류(nib)에 따라, 형광펜은 굵고 일정하다 */
export function strokePath(stroke: Pick<CanvasStroke, 'tool' | 'size' | 'points' | 'nib'>): string {
  const pts: number[][] = [];
  for (let i = 0; i + 2 < stroke.points.length; i += 3) pts.push([stroke.points[i]!, stroke.points[i + 1]!, stroke.points[i + 2]!]);
  const nib = stroke.tool === 'marker' ? MARKER : NIB[stroke.nib ?? 'fountain'];
  const outline = getStroke(pts, {
    ...nib,
    size: stroke.size,
    // 붓펜은 필압이 없으면 속도로 굵기를 흉내 낸다
    simulatePressure: stroke.tool === 'pen' && stroke.nib === 'brush' && flatPressure(stroke.points),
    last: true,
  });
  return outlineToPath(outline);
}

/** 획 투명도: 형광펜은 비치고, 연필은 조금 흐리다 */
export const strokeOpacity = (stroke: Pick<CanvasStroke, 'tool' | 'nib'>) =>
  stroke.tool === 'marker' ? MARKER_OPACITY : stroke.nib === 'pencil' ? 0.8 : 1;

/** 외곽선 점들을 중점 기준 2차 곡선으로 이어 부드럽게 만든다 */
function outlineToPath(outline: number[][]): string {
  if (outline.length < 2) return '';
  const f = (n: number) => n.toFixed(2);
  const d = ['M', f(outline[0]![0]!), f(outline[0]![1]!)];
  for (let i = 1; i < outline.length - 1; i++) {
    const a = outline[i]!;
    const b = outline[i + 1]!;
    d.push('Q', f(a[0]!), f(a[1]!), f((a[0]! + b[0]!) / 2), f((a[1]! + b[1]!) / 2));
  }
  return `${d.join(' ')} Z`;
}
