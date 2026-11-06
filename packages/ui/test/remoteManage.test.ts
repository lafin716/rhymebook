import { describe, expect, it } from 'vitest';
import { instantToZonedWall, zonedWallToMs } from '../src/app/remoteManage';

describe('PC 시간대 벽시계 변환', () => {
  it('서울(오프셋 고정) 왕복', () => {
    const at = Date.UTC(2026, 10, 6, 0, 30);
    expect(instantToZonedWall(at, 'Asia/Seoul')).toBe('2026-11-06T09:30');
    expect(zonedWallToMs('2026-11-06T09:30', 'Asia/Seoul')).toBe(at);
  });

  it('원격 기기 시간대와 무관하게 PC 시간대 기준으로 계산', () => {
    expect(zonedWallToMs('2026-07-01T12:00', 'America/New_York')).toBe(Date.UTC(2026, 6, 1, 16, 0));
    expect(zonedWallToMs('2026-01-15T12:00', 'America/New_York')).toBe(Date.UTC(2026, 0, 15, 17, 0));
    expect(zonedWallToMs('2026-01-15T12:00', 'UTC')).toBe(Date.UTC(2026, 0, 15, 12, 0));
  });

  it('DST 공백 시각은 NaN, 잘못된 형식·날짜도 NaN', () => {
    // 2026-03-08 02:30은 뉴욕에 존재하지 않는다
    expect(zonedWallToMs('2026-03-08T02:30', 'America/New_York')).toBeNaN();
    expect(zonedWallToMs('2026-02-30T10:00', 'Asia/Seoul')).toBeNaN();
    expect(zonedWallToMs('2026-11-06 09:30', 'Asia/Seoul')).toBeNaN();
  });

  it('DST 겹침 시각은 유효한 순간 하나로 왕복', () => {
    const at = zonedWallToMs('2026-11-01T01:30', 'America/New_York');
    expect(Number.isFinite(at)).toBe(true);
    expect(instantToZonedWall(at, 'America/New_York')).toBe('2026-11-01T01:30');
  });

  it('자정은 00시로 표시', () => {
    expect(instantToZonedWall(Date.UTC(2026, 0, 1, 15, 0), 'Asia/Seoul')).toBe('2026-01-02T00:00');
  });
});
