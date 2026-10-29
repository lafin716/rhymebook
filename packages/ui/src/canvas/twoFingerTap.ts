/**
 * 두 손가락 두 번 톡 알아채기. 손가락이 닿고 떼는 순서만 받는 순수 상태 기계라 DOM 없이 시험한다.
 * 한 번의 톡 = 두 손가락이 닿았다가 모두 떨어지기까지 TAP_MS 안, 손가락마다 SLOP_PX 넘게 움직이지 않음, 세 손가락 이상 없음.
 * 두 번째 톡이 첫 톡 뒤 DOUBLE_MS 안에 끝나면 두 번 톡이다.
 */

export const TAP_MS = 300;
export const DOUBLE_MS = 400;
export const SLOP_PX = 12;

export interface TwoFingerTap {
  down(id: number, x: number, y: number, t: number): void;
  move(id: number, x: number, y: number): void;
  /** 마지막 손가락이 떨어져 두 번 톡이 끝났으면 true */
  up(id: number, t: number): boolean;
  /** 펜이 닿는 등 다른 손동작으로 바뀌면 지금 톡은 무효 */
  cancel(): void;
}

export function createTwoFingerTap(): TwoFingerTap {
  const touches = new Map<number, { x: number; y: number }>();
  let start = 0;
  let most = 0;
  let spoiled = false;
  let lastTap: number | null = null;

  return {
    down(id, x, y, t) {
      if (!touches.size) {
        start = t;
        most = 0;
        spoiled = false;
      }
      touches.set(id, { x, y });
      most = Math.max(most, touches.size);
      if (most > 2) spoiled = true;
    },
    move(id, x, y) {
      const p = touches.get(id);
      if (p && Math.hypot(x - p.x, y - p.y) > SLOP_PX) spoiled = true;
    },
    up(id, t) {
      if (!touches.delete(id) || touches.size) return false;
      const tap = !spoiled && most === 2 && t - start <= TAP_MS;
      if (!tap) {
        lastTap = null;
        return false;
      }
      if (lastTap !== null && t - lastTap <= DOUBLE_MS) {
        lastTap = null;
        return true;
      }
      lastTap = t;
      return false;
    },
    cancel() {
      spoiled = true;
      lastTap = null;
    },
  };
}
