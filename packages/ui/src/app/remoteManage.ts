import { rpcErrorText, SyncRpcCallError } from '@branch/core';

/** 관리 호출 실패를 사용자 문구로 바꾼다. PC가 보낸 설명이 있으면 그것을 쓴다. */
export function rpcErrorMessage(cause: unknown): string {
  if (cause instanceof SyncRpcCallError) return rpcErrorText(cause.code, cause.message);
  return rpcErrorText('failed');
}

interface ZoneFields { year: number; month: number; day: number; hour: number; minute: number; second: number }

/** 주어진 순간의 PC 시간대 벽시계 값 */
function zoneFields(at: number, timeZone: string): ZoneFields {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(at);
  const read = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value);
  return { year: read('year'), month: read('month'), day: read('day'), hour: read('hour') % 24, minute: read('minute'), second: read('second') };
}

/** 순간의 PC 시간대 UTC 오프셋 (밀리초). 벽시계를 UTC처럼 읽은 값에서 실제 순간을 뺀다. */
function zoneOffsetMs(at: number, timeZone: string): number {
  const f = zoneFields(at, timeZone);
  const wallAsUtc = Date.UTC(f.year, f.month - 1, f.day, f.hour, f.minute, f.second);
  return wallAsUtc - Math.floor(at / 1000) * 1000;
}

/** 순간 → PC 시간대의 `YYYY-MM-DDTHH:mm` (datetime-local 값) */
export function instantToZonedWall(at: number, timeZone: string): string {
  const f = zoneFields(at, timeZone);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${f.year}-${pad(f.month)}-${pad(f.day)}T${pad(f.hour)}:${pad(f.minute)}`;
}

/**
 * PC 시간대의 `YYYY-MM-DDTHH:mm` → 순간(ms). 해석할 수 없거나 DST로 존재하지 않는 시각이면 NaN.
 * 원격 기기의 시간대와 무관하게 PC 시간대 기준으로 계산한다.
 */
export function zonedWallToMs(wall: string, timeZone: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(wall);
  if (!match) return NaN;
  const [year, month, day, hour, minute] = match.slice(1).map(Number) as [number, number, number, number, number];
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  if (!Number.isFinite(guess)) return NaN;
  // 오프셋이 바뀌는 경계를 위해 두 번 보정한다
  const first = guess - zoneOffsetMs(guess, timeZone);
  const at = guess - zoneOffsetMs(first, timeZone);
  // 왕복 검사: 벽시계가 그대로 나오지 않으면 존재하지 않는 시각(DST 공백)이거나 잘못된 날짜다
  return instantToZonedWall(at, timeZone) === wall ? at : NaN;
}
