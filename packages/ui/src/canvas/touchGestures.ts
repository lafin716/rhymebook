/**
 * 두 손가락 손동작 알아채기 — 두 번 톡, 위·아래·왼쪽·오른쪽 밀기 (ADR-104).
 * 손가락이 닿고·움직이고·떼는 것만 받는 순수 상태 기계라 DOM 없이 시험한다.
 *
 * 함께 닿았다 떨어진 손가락들을 한 '묶음'으로 본다. 묶음은 모든 손가락이 떨어지면 끝나고, 그때 판정한다.
 * 오래 대고 있는 손가락(태블릿을 쥔 엄지·쉬는 손바닥)은 HOLD_MS가 지나면 묶음에서 빼고 무시한다 —
 * 그래야 화면 가장자리에 엄지가 닿아 있어도 두 손가락 손동작이 된다.
 *
 * - 톡: 손가락 둘, 처음 닿고 마지막을 떼기까지 TAP_MS 안, 손가락마다 SLOP_PX 넘게 움직이지 않음.
 *   두 번째 톡이 첫 톡이 끝난 뒤 DOUBLE_GAP_MS 안에 시작하면 두 번 톡이다.
 * - 밀기: 손가락 둘, SWIPE_MS 안, 두 손가락이 같은 쪽으로 SWIPE_MIN_PX 넘게, 한 축이 다른 축의 AXIS_RATIO배 넘게,
 *   두 손가락 사이 거리 변화(확대)는 움직인 거리의 PINCH_RATIO 이하.
 */

export const TAP_MS = 350;
export const DOUBLE_GAP_MS = 350;
export const SLOP_PX = 20;
export const SWIPE_MS = 600;
export const SWIPE_MIN_PX = 60;
export const AXIS_RATIO = 1.5;
export const PINCH_RATIO = 0.5;
/** 이보다 오래 대고 있는 손가락은 손동작이 아니라 쥐고 있는 손가락으로 본다 */
export const HOLD_MS = SWIPE_MS;

export type SwipeDir = 'up' | 'down' | 'left' | 'right';
export type TouchGesture = { kind: 'double-tap' } | { kind: 'swipe'; dir: SwipeDir };

export interface TouchGestures {
  down(id: number, x: number, y: number, t: number): void;
  move(id: number, x: number, y: number): void;
  /** 마지막 손가락이 떨어져 손동작이 끝났으면 그 손동작 */
  up(id: number, t: number): TouchGesture | null;
  /** 펜이 닿거나 브라우저가 터치를 끊는 등 다른 동작으로 바뀌면 지금 묶음과 기다리던 톡은 무효 */
  cancel(): void;
}

interface Finger {
  t0: number;
  x0: number;
  y0: number;
  x: number;
  y: number;
  /** 처음 자리에서 가장 멀리 간 거리 */
  far: number;
  up: number | null;
}

interface Group {
  fingers: Map<number, Finger>;
  spoiled: boolean;
}

export function createTouchGestures(): TouchGestures {
  let group: Group | null = null;
  let lastTapEnd: number | null = null;

  const active = (g: Group) => [...g.fingers.values()].some((f) => f.up === null);

  /** 오래 대고 있는(아직 떼지 않은) 손가락은 묶음에서 뺀다 */
  const dropHolds = (g: Group, t: number) => {
    for (const [id, f] of g.fingers) if (f.up === null && t - f.t0 > HOLD_MS) g.fingers.delete(id);
  };

  const judge = (g: Group): TouchGesture | 'tap' | null => {
    const fs = [...g.fingers.values()];
    if (g.spoiled || fs.length !== 2) return null;
    const [a, b] = fs as [Finger, Finger];
    const start = Math.min(a.t0, b.t0);
    const end = Math.max(a.up ?? 0, b.up ?? 0);
    const dur = end - start;
    if (dur <= TAP_MS && a.far <= SLOP_PX && b.far <= SLOP_PX) return 'tap';
    if (dur > SWIPE_MS) return null;
    const dax = a.x - a.x0;
    const day = a.y - a.y0;
    const dbx = b.x - b.x0;
    const dby = b.y - b.y0;
    const dx = (dax + dbx) / 2;
    const dy = (day + dby) / 2;
    const horizontal = Math.abs(dx) >= Math.abs(dy);
    const major = horizontal ? dx : dy;
    const minor = horizontal ? dy : dx;
    if (Math.abs(major) < SWIPE_MIN_PX || Math.abs(major) < Math.abs(minor) * AXIS_RATIO) return null;
    // 두 손가락 모두 같은 쪽으로 충분히
    const am = horizontal ? dax : day;
    const bm = horizontal ? dbx : dby;
    if (Math.sign(am) !== Math.sign(major) || Math.sign(bm) !== Math.sign(major)) return null;
    if (Math.abs(am) < SWIPE_MIN_PX / 2 || Math.abs(bm) < SWIPE_MIN_PX / 2) return null;
    // 확대·축소가 아니다
    const d0 = Math.hypot(a.x0 - b.x0, a.y0 - b.y0);
    const d1 = Math.hypot(a.x - b.x, a.y - b.y);
    if (Math.abs(d1 - d0) > Math.abs(major) * PINCH_RATIO) return null;
    const dir: SwipeDir = horizontal ? (major > 0 ? 'right' : 'left') : major > 0 ? 'down' : 'up';
    return { kind: 'swipe', dir };
  };

  return {
    down(id, x, y, t) {
      if (group) dropHolds(group, t);
      if (!group || !active(group)) group = { fingers: new Map(), spoiled: false };
      group.fingers.set(id, { t0: t, x0: x, y0: y, x, y, far: 0, up: null });
      if (group.fingers.size > 2) group.spoiled = true;
    },
    move(id, x, y) {
      const f = group?.fingers.get(id);
      if (!f || f.up !== null) return;
      f.x = x;
      f.y = y;
      f.far = Math.max(f.far, Math.hypot(x - f.x0, y - f.y0));
    },
    up(id, t) {
      const g = group;
      const f = g?.fingers.get(id);
      if (!g || !f || f.up !== null) return null;
      f.up = t;
      dropHolds(g, t);
      if (active(g)) return null;
      group = null;
      const r = judge(g);
      if (r !== 'tap') {
        // 다른 손동작이나 실패는 기다리던 톡을 지운다
        lastTapEnd = null;
        return r;
      }
      const start = Math.min(...[...g.fingers.values()].map((x) => x.t0));
      if (lastTapEnd !== null && start - lastTapEnd <= DOUBLE_GAP_MS) {
        lastTapEnd = null;
        return { kind: 'double-tap' };
      }
      lastTapEnd = t;
      return null;
    },
    cancel() {
      if (group) group.spoiled = true;
      lastTapEnd = null;
    },
  };
}
