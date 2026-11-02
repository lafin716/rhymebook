import { orderForPlatform, platformCaps, resolveProfile, type AppProfile, type PlatformKind, type Settings } from '@branch/core';
import { desktop, mobile, sessionWindowId } from './runtime';

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

const PROFILE_KEY = 'branch.profile';

function storedProfile(): string | null {
  try {
    return localStorage.getItem(PROFILE_KEY);
  } catch {
    return null;
  }
}

/** 이 기기의 종류 (화면 문구: 데스크톱은 '이 PC', 웹·모바일은 '이 기기') */
export const kind = detectKind();

/**
 * 이 기기의 프로필 (ADR-103). 시작할 때 정해지고, 바꾸면 앱을 다시 시작한다.
 * 세션 창은 늘 메인 창을 미러링하므로 저장값과 상관없다.
 */
export const profile: AppProfile = resolveProfile(kind, storedProfile());

export const caps = platformCaps(kind, { hostPairing: !!desktop?.host, profile });

/** 이 플랫폼에 없는 provider를 가리키는 저장 설정을 정리한다 (예: 웹에서 열린 CLI 기본값) */
export function sanitizeSettings(s: Settings): Partial<Settings> | null {
  const patch: Partial<Settings> = {};
  if (!caps.providers.includes(s.defaultProviderId)) patch.defaultProviderId = caps.providers[0]!;
  const order = orderForPlatform(s.fallbackOrder, caps);
  if (order.join() !== s.fallbackOrder.join()) patch.fallbackOrder = order;
  return Object.keys(patch).length ? patch : null;
}

/**
 * 원격(미러링) 모드 (ADR-026·103): 이 기기에 데이터를 두지 않고 저장한 PC 하나를 미러링한다.
 * PC 프로필을 고른 기기(웹·모바일 기본값, 데스크톱에서 다른 PC를 고른 경우)와
 * 데스크톱 세션 창(ADR-036, 같은 PC의 메인 창을 미러링)이 여기에 해당한다.
 */
export const remoteMode = profile === 'remote' || !!sessionWindowId;

/** 답변을 PC가 만든다: 웹·모바일의 PC 프로필. 에이전트는 PC의 CLI, 모델·노력치는 PC가 정한다 */
export const answersViaPc = remoteMode && !caps.localCli;

/**
 * 프로필을 저장하고 앱을 다시 시작한다. 데이터 저장소·동기화 엔진이 시작 시 정해지므로 화면만 바꾸지 않는다.
 * `beforeReload`에서 동기화·호스트를 멈춘다.
 */
export function switchProfile(next: AppProfile, beforeReload?: () => void) {
  try {
    localStorage.setItem(PROFILE_KEY, next);
  } catch {
    /* 저장소 접근 불가: 이번 실행만 */
  }
  beforeReload?.();
  window.location.reload();
}
