import { describe, expect, it } from 'vitest';
import { DEFAULT_NAV_DOCK, parseNavDock, snapDock } from '../src/chat/navDock';

describe('mobile nav dock', () => {
  it('snaps to the nearest edge and keeps the vertical ratio inside the area', () => {
    expect(snapDock(10, 100, 40, 200, 390, 600)).toEqual({ side: 'left', y: 0.25 });
    expect(snapDock(200, 100, 40, 200, 390, 600)).toEqual({ side: 'right', y: 0.25 });
    // 정확히 가운데 → 오른쪽, 위·아래 밖으로 끌어도 0..1
    expect(snapDock(175, -50, 40, 200, 390, 600)).toEqual({ side: 'right', y: 0 });
    expect(snapDock(0, 900, 40, 200, 390, 600).y).toBe(1);
    expect(snapDock(0, 10, 40, 700, 390, 600).y).toBe(0);
  });

  it('parses stored values defensively', () => {
    expect(parseNavDock(null)).toEqual(DEFAULT_NAV_DOCK);
    expect(parseNavDock({ side: 'left', y: 0.3, hidden: true })).toEqual({ side: 'left', y: 0.3, hidden: true });
    expect(parseNavDock({ side: 'up', y: 5, hidden: 'yes' })).toEqual({ side: 'right', y: 1, hidden: false });
  });
});
