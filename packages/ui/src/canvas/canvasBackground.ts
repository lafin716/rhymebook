import { CANVAS_PAPER, CANVAS_PATTERN_STEP, type CanvasBackground } from '@branch/core';
import type { CSSProperties } from 'react';
import { t } from '../i18n';

/** 바탕색 고르기 기본값 (이름은 렌더 시점에 번역한다) */
export function getBgColors(): { label: string; hex: string }[] {
  return [
    { label: t('canvas.bg.paper'), hex: CANVAS_PAPER },
    { label: t('canvas.bg.white'), hex: '#ffffff' },
    { label: t('canvas.bg.cream'), hex: '#fdf3d8' },
    { label: t('canvas.bg.lightGreen'), hex: '#e9f5e1' },
    { label: t('canvas.bg.sky'), hex: '#e3f0fb' },
    { label: t('canvas.bg.gray'), hex: '#eceef1' },
    { label: t('canvas.bg.chalkboard'), hex: '#24332b' },
  ];
}

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
