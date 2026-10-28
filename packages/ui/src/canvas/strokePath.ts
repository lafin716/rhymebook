import { getStroke } from 'perfect-freehand';
import type { CanvasStroke } from '@branch/core';

/** 획 → 외곽선 SVG path. 펜은 필압에 따라 굵기가 변하고, 형광펜은 굵고 일정하다 */
export function strokePath(stroke: Pick<CanvasStroke, 'tool' | 'size' | 'points'>): string {
  const pts: number[][] = [];
  for (let i = 0; i + 2 < stroke.points.length; i += 3) pts.push([stroke.points[i]!, stroke.points[i + 1]!, stroke.points[i + 2]!]);
  const outline = getStroke(pts, {
    size: stroke.size,
    thinning: stroke.tool === 'marker' ? 0 : 0.5,
    smoothing: 0.5,
    streamline: 0.5,
    simulatePressure: false,
    last: true,
  });
  return outlineToPath(outline);
}

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
