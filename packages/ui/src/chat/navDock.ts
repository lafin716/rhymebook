/** 모바일 세션 내비게이션 핸들의 위치·숨김 (기기별, 모든 패널 공통, ADR-056) */
export interface NavDock {
  side: 'left' | 'right';
  /** 세로 위치: 0 = 맨 위, 1 = 맨 아래 (패널 높이 기준 비율) */
  y: number;
  hidden: boolean;
}

export const NAV_DOCK_KEY = 'branch.navDock';
export const DEFAULT_NAV_DOCK: NavDock = { side: 'right', y: 1, hidden: false };

const clamp01 = (v: number) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 1);

export function parseNavDock(raw: unknown): NavDock {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_NAV_DOCK };
  const r = raw as Record<string, unknown>;
  return {
    side: r.side === 'left' ? 'left' : 'right',
    y: typeof r.y === 'number' ? clamp01(r.y) : DEFAULT_NAV_DOCK.y,
    hidden: r.hidden === true,
  };
}

/**
 * 끌기를 놓은 위치 → 붙을 쪽과 세로 비율. 가운데에는 머물지 않고 가까운 가장자리로 붙는다.
 * x·y: 툴바 왼쪽 위(영역 기준 px), w·h: 툴바 크기, areaW·areaH: 움직일 수 있는 영역 크기
 */
export function snapDock(x: number, y: number, w: number, h: number, areaW: number, areaH: number): Pick<NavDock, 'side' | 'y'> {
  const side = x + w / 2 < areaW / 2 ? 'left' : 'right';
  const room = areaH - h;
  return { side, y: room > 0 ? clamp01(y / room) : 0 };
}
