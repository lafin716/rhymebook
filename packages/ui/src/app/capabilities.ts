import { orderForPlatform, platformCaps, type PlatformKind, type Settings } from '@branch/core';
import { desktop, mobile } from './runtime';

/**
 * 이 기기의 연결 능력 (ADR-025).
 * PC(데스크톱)는 CLI 직접 실행·페어링 열기/연결, 웹·모바일은 API 키와 PC 페어링 연결만.
 * 개발 서버에서는 `?platform=desktop|web|mobile`로 화면만 바꿔 볼 수 있다(CLI 실행은 데스크톱에서만 가능).
 */
function detectKind(): PlatformKind {
  if (desktop) return 'desktop';
  if (mobile) return 'mobile';
  if (import.meta.env.DEV && typeof window !== 'undefined') {
    const forced = new URLSearchParams(window.location.search).get('platform');
    if (forced === 'desktop' || forced === 'mobile') return forced;
  }
  return 'web';
}

export const caps = platformCaps(detectKind(), { hostPairing: !!desktop?.host });

/** 이 플랫폼에 없는 provider를 가리키는 저장 설정을 정리한다 (예: 웹에서 열린 CLI 기본값) */
export function sanitizeSettings(s: Settings): Partial<Settings> | null {
  const patch: Partial<Settings> = {};
  if (!caps.providers.includes(s.defaultProviderId)) patch.defaultProviderId = caps.providers[0]!;
  const order = orderForPlatform(s.fallbackOrder, caps);
  if (order.join() !== s.fallbackOrder.join()) patch.fallbackOrder = order;
  return Object.keys(patch).length ? patch : null;
}
