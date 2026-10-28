import { CANVAS_PAPER, CANVAS_PATTERN_STEP, type CanvasBackground } from '@branch/core';
import type { CSSProperties } from 'react';

/** 바탕색 고르기 기본값 */
export const BG_COLORS: { label: string; hex: string }[] = [
  { label: '종이', hex: CANVAS_PAPER },
  { label: '흰색', hex: '#ffffff' },
  { label: '크림', hex: '#fdf3d8' },
  { label: '연두', hex: '#e9f5e1' },
  { label: '하늘', hex: '#e3f0fb' },
  { label: '회색', hex: '#eceef1' },
  { label: '칠판', hex: '#24332b' },
];

/** 어두운 색인가 (상대 휘도) — 무늬 선을 밝게 그린다 */
export function isDark(hex: string): boolean {
  const n = parseInt(hex.slice(1), 16);
  if (!Number.isFinite(n)) return false;
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const l = 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  return l < 0.2;
}

/**
 * 바탕색·무늬를 CSS 배경으로. scale·ox·oy는 화면 배율과 원점 위치(자유 판은 보드에 그리므로 화면 이동을 따라간다).
 * 쪽 나눔 판의 쪽은 이미 확대된 좌표계 안이라 기본값(1, 0, 0)을 쓴다.
 */
export function backgroundStyle(bg: CanvasBackground | undefined, scale = 1, ox = 0, oy = 0): CSSProperties {
  const color = bg?.color ?? CANVAS_PAPER;
  const pattern = bg?.pattern;
  if (!pattern) return { backgroundColor: color };
  const line = isDark(color) ? 'rgba(255,255,255,0.16)' : 'rgba(31,41,55,0.11)';
  const step = CANVAS_PATTERN_STEP[pattern] * scale;
  const pos = `${ox}px ${oy}px`;
  if (pattern === 'lines') {
    return {
      backgroundColor: color,
      backgroundImage: `linear-gradient(to bottom, ${line} 1px, transparent 1px)`,
      backgroundSize: `100% ${step}px`,
      backgroundPosition: pos,
    };
  }
  return {
    backgroundColor: color,
    backgroundImage: `linear-gradient(to right, ${line} 1px, transparent 1px), linear-gradient(to bottom, ${line} 1px, transparent 1px)`,
    backgroundSize: `${step}px ${step}px`,
    backgroundPosition: `${pos}, ${pos}`,
  };
}
