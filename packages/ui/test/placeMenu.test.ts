import { describe, expect, it } from 'vitest';
import { placeMenu } from '../src/chat/selection';

const view = { w: 1200, h: 800 };
const menu = { w: 400, h: 90 };

describe('placeMenu: 선택 영역을 가리지 않는 드래그 메뉴 위치', () => {
  it('위에 자리가 있으면 위', () => {
    const p = placeMenu({ top: 300, bottom: 320, left: 500, width: 100 }, menu, view);
    expect(p.placement).toBe('above');
    expect(p.top + menu.h).toBeLessThanOrEqual(300);
  });

  it('위가 좁으면 아래', () => {
    const p = placeMenu({ top: 40, bottom: 60, left: 500, width: 100 }, menu, view);
    expect(p.placement).toBe('below');
    expect(p.top).toBeGreaterThanOrEqual(60);
  });

  it('위아래 모두 막힌 긴 선택은 옆으로', () => {
    const p = placeMenu({ top: 50, bottom: 760, left: 100, width: 500 }, menu, view);
    expect(p.placement).toBe('right');
    expect(p.left).toBeGreaterThanOrEqual(600);
  });

  it('오른쪽이 막히면 왼쪽', () => {
    const p = placeMenu({ top: 50, bottom: 760, left: 650, width: 500 }, menu, view);
    expect(p.placement).toBe('left');
    expect(p.left + menu.w).toBeLessThanOrEqual(650);
  });

  it('어디에도 안 들어가면 화면 가장자리', () => {
    const p = placeMenu({ top: 20, bottom: 790, left: 20, width: 1160 }, menu, view);
    expect(p.placement).toBe('edge');
    expect(p.left).toBeGreaterThanOrEqual(8);
  });

  it('가로는 화면 안으로 맞춘다', () => {
    const p = placeMenu({ top: 300, bottom: 320, left: 1150, width: 40 }, menu, view);
    expect(p.left + menu.w).toBeLessThanOrEqual(view.w - 8);
  });
});
