import type { ID, SegmentMap } from '@branch/core';

/** 메시지별 최신 렌더 세그먼트 맵 (선택 → 앵커 변환에 사용) */
const maps = new Map<ID, SegmentMap>();

export function setSegmentMap(messageId: ID, map: SegmentMap) {
  maps.set(messageId, map);
}

export function getSegmentMap(messageId: ID): SegmentMap | undefined {
  return maps.get(messageId);
}
