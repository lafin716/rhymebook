import { describe, expect, it } from 'vitest';
import { hexToRgb, hsvToHex, hsvToRgb, rgbToHex, rgbToHsv } from '../src/canvas/colorMath';
import { createTwoFingerTap, DOUBLE_MS, SLOP_PX, TAP_MS } from '../src/canvas/twoFingerTap';

describe('color math (photoshop-style picker)', () => {
  it('parses and formats hex', () => {
    expect(hexToRgb('#ff8800')).toEqual({ r: 255, g: 136, b: 0 });
    expect(hexToRgb('FF8800')).toEqual({ r: 255, g: 136, b: 0 });
    expect(hexToRgb('#ff88')).toBeNull();
    expect(hexToRgb('#gg0000')).toBeNull();
    expect(rgbToHex({ r: 255, g: 136, b: 0 })).toBe('#ff8800');
    expect(rgbToHex({ r: 300, g: -4, b: Number.NaN })).toBe('#ff0000');
  });

  it('round-trips through hsv', () => {
    for (const hex of ['#000000', '#ffffff', '#dc2626', '#2563eb', '#16a34a', '#facc15', '#7c3aed', '#808080']) {
      expect(hsvToHex(rgbToHsv(hexToRgb(hex)!))).toBe(hex);
    }
  });

  it('maps pure hues and greys', () => {
    expect(rgbToHsv({ r: 255, g: 0, b: 0 })).toEqual({ h: 0, s: 1, v: 1 });
    expect(rgbToHsv({ r: 0, g: 0, b: 255 }).h).toBe(240);
    expect(rgbToHsv({ r: 128, g: 128, b: 128 }).s).toBe(0);
    expect(hsvToRgb({ h: 120, s: 1, v: 1 })).toEqual({ r: 0, g: 255, b: 0 });
    expect(hsvToRgb({ h: 360, s: 1, v: 1 })).toEqual({ r: 255, g: 0, b: 0 });
  });
});

describe('two-finger double tap', () => {
  const tap = (d: ReturnType<typeof createTwoFingerTap>, t: number, len = 80) => {
    d.down(1, 10, 10, t);
    d.down(2, 60, 10, t + 10);
    const a = d.up(1, t + len);
    return d.up(2, t + len + 5) || a;
  };

  it('fires on the second quick two-finger tap', () => {
    const d = createTwoFingerTap();
    expect(tap(d, 0)).toBe(false);
    expect(tap(d, 200)).toBe(true);
    // 세 번째 톡은 새로 센다
    expect(tap(d, 400)).toBe(false);
  });

  it('ignores slow taps, long gaps, movement, single fingers and three fingers', () => {
    const slow = createTwoFingerTap();
    tap(slow, 0);
    expect(tap(slow, 200, TAP_MS + 50)).toBe(false);

    const gap = createTwoFingerTap();
    tap(gap, 0);
    expect(tap(gap, 100 + DOUBLE_MS + 50)).toBe(false);

    const moved = createTwoFingerTap();
    tap(moved, 0);
    moved.down(1, 10, 10, 200);
    moved.down(2, 60, 10, 205);
    moved.move(2, 60 + SLOP_PX + 1, 10);
    moved.up(1, 250);
    expect(moved.up(2, 255)).toBe(false);

    const one = createTwoFingerTap();
    tap(one, 0);
    one.down(1, 10, 10, 200);
    expect(one.up(1, 250)).toBe(false);

    const three = createTwoFingerTap();
    tap(three, 0);
    three.down(1, 10, 10, 200);
    three.down(2, 40, 10, 202);
    three.down(3, 70, 10, 204);
    three.up(1, 250);
    three.up(2, 251);
    expect(three.up(3, 252)).toBe(false);
  });

  it('cancel spoils the pending tap', () => {
    const d = createTwoFingerTap();
    tap(d, 0);
    d.cancel();
    expect(tap(d, 200)).toBe(false);
  });
});
