import { describe, expect, it } from 'vitest';
import { hexToRgb, hsvToHex, hsvToRgb, rgbToHex, rgbToHsv } from '../src/canvas/colorMath';
import { createTouchGestures, DOUBLE_GAP_MS, HOLD_MS, SLOP_PX, SWIPE_MIN_PX, TAP_MS, type TouchGestures } from '../src/canvas/touchGestures';
import { DEFAULT_GESTURES, loadGestures } from '../src/canvas/canvasPrefs';

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

describe('two-finger gestures', () => {
  /** 두 손가락으로 t에 닿아 len ms 뒤 뗀다. 둘째 손가락을 뗄 때의 결과 */
  const tap = (d: TouchGestures, t: number, len = 80, ids: [number, number] = [1, 2]) => {
    d.down(ids[0], 10, 10, t);
    d.down(ids[1], 60, 10, t + 10);
    const a = d.up(ids[0], t + len);
    return d.up(ids[1], t + len + 5) ?? a;
  };
  /** 두 손가락으로 (dx, dy)만큼 steps번에 나눠 민다 */
  const swipe = (d: TouchGestures, dx: number, dy: number, len = 200, spread = 0) => {
    d.down(1, 100, 100, 0);
    d.down(2, 160, 100, 10);
    for (let i = 1; i <= 5; i++) {
      d.move(1, 100 + (dx * i) / 5 - (spread * i) / 5, 100 + (dy * i) / 5);
      d.move(2, 160 + (dx * i) / 5 + (spread * i) / 5, 100 + (dy * i) / 5);
    }
    const a = d.up(1, len);
    return d.up(2, len + 5) ?? a;
  };

  it('fires on the second quick two-finger tap', () => {
    const d = createTouchGestures();
    expect(tap(d, 0)).toBeNull();
    expect(tap(d, 200)).toEqual({ kind: 'double-tap' });
    // 세 번째 톡은 새로 센다
    expect(tap(d, 400)).toBeNull();
  });

  it('measures the double-tap gap from first tap end to second tap start (slower tablet taps)', () => {
    const d = createTouchGestures();
    // 톡 하나가 250ms, 사이가 300ms — 예전 기준(끝↔끝 400ms)으로는 놓쳤다
    expect(tap(d, 0, 250)).toBeNull();
    expect(tap(d, 255 + 300, 250)).toEqual({ kind: 'double-tap' });
  });

  it('tolerates finger drift within the slop', () => {
    const d = createTouchGestures();
    tap(d, 0);
    d.down(1, 10, 10, 200);
    d.down(2, 60, 10, 205);
    d.move(1, 10 + SLOP_PX - 2, 10);
    d.up(1, 260);
    expect(d.up(2, 265)).toEqual({ kind: 'double-tap' });
  });

  it('ignores a thumb resting on the screen edge (tablet grip)', () => {
    const d = createTouchGestures();
    d.down(9, 0, 500, 0);
    const t = HOLD_MS + 100;
    expect(tap(d, t)).toBeNull();
    expect(tap(d, t + 200)).toEqual({ kind: 'double-tap' });
    expect(d.up(9, t + 1000)).toBeNull();
  });

  it('ignores slow taps, long gaps, movement, single fingers and three fingers', () => {
    const slow = createTouchGestures();
    tap(slow, 0);
    expect(tap(slow, 200, TAP_MS + 50)).toBeNull();

    const gap = createTouchGestures();
    tap(gap, 0);
    expect(tap(gap, 85 + DOUBLE_GAP_MS + 50)).toBeNull();

    const moved = createTouchGestures();
    tap(moved, 0);
    moved.down(1, 10, 10, 200);
    moved.down(2, 60, 10, 205);
    moved.move(2, 60 + SLOP_PX + 1, 10);
    moved.up(1, 250);
    expect(moved.up(2, 255)).toBeNull();

    const one = createTouchGestures();
    tap(one, 0);
    one.down(1, 10, 10, 200);
    expect(one.up(1, 250)).toBeNull();

    const three = createTouchGestures();
    tap(three, 0);
    three.down(1, 10, 10, 200);
    three.down(2, 40, 10, 202);
    three.down(3, 70, 10, 204);
    three.up(1, 250);
    three.up(2, 251);
    expect(three.up(3, 252)).toBeNull();
  });

  it('cancel spoils the pending tap', () => {
    const d = createTouchGestures();
    tap(d, 0);
    d.cancel();
    expect(tap(d, 200)).toBeNull();
  });

  it('recognizes two-finger swipes in four directions', () => {
    const far = SWIPE_MIN_PX + 40;
    expect(swipe(createTouchGestures(), -far, 10)).toEqual({ kind: 'swipe', dir: 'left' });
    expect(swipe(createTouchGestures(), far, -10)).toEqual({ kind: 'swipe', dir: 'right' });
    expect(swipe(createTouchGestures(), 5, -far)).toEqual({ kind: 'swipe', dir: 'up' });
    expect(swipe(createTouchGestures(), 0, far)).toEqual({ kind: 'swipe', dir: 'down' });
  });

  it('does not treat short, slow, diagonal or pinching moves as swipes', () => {
    expect(swipe(createTouchGestures(), SWIPE_MIN_PX - 10, 0)).toBeNull();
    expect(swipe(createTouchGestures(), 150, 0, 1500)).toBeNull();
    expect(swipe(createTouchGestures(), 100, 90)).toBeNull();
    // 두 손가락이 벌어지며 움직임 = 확대
    expect(swipe(createTouchGestures(), 80, 0, 200, 80)).toBeNull();
    // 한 손가락만 민다
    const d = createTouchGestures();
    d.down(1, 100, 100, 0);
    d.down(2, 160, 100, 10);
    d.move(1, 250, 100);
    d.up(1, 150);
    expect(d.up(2, 155)).toBeNull();
  });

  it('a swipe clears a pending tap', () => {
    const d = createTouchGestures();
    tap(d, 0);
    expect(swipe(d, 120, 0)).toEqual({ kind: 'swipe', dir: 'right' });
    expect(tap(d, 400)).toBeNull();
  });
});

describe('gesture prefs', () => {
  it('defaults and migrates the old two-finger double-tap setting', () => {
    const store = new Map<string, string>();
    const ls = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
    const prev = (globalThis as { localStorage?: unknown }).localStorage;
    (globalThis as { localStorage?: unknown }).localStorage = ls;
    try {
      expect(loadGestures()).toEqual(DEFAULT_GESTURES);
      store.set('octobooks.canvas.twoFingerDoubleTap', JSON.stringify('undo'));
      expect(loadGestures()['double-tap']).toBe('undo');
      store.set('octobooks.canvas.gestures', JSON.stringify({ 'double-tap': 'redo', 'swipe-left': 'next-page', 'swipe-up': 'nope' }));
      expect(loadGestures()).toEqual({ ...DEFAULT_GESTURES, 'double-tap': 'redo', 'swipe-left': 'next-page' });
    } finally {
      (globalThis as { localStorage?: unknown }).localStorage = prev;
    }
  });
});
