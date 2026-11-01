import { useSyncExternalStore } from 'react';
import { mobile } from './runtime';

/**
 * 터치 기기 판별 (ADR-101) — 화면 너비만 보면 태블릿·펼친 폴드가 데스크톱처럼 동작하므로 기기 종류도 본다.
 * 모바일 앱이거나, 휴대 기기 UA(iPadOS는 Mac UA + 멀티터치)이면서 터치가 되면 터치 기기다.
 */
export function isTouchDevice(): boolean {
  if (mobile) return true;
  if (typeof navigator === 'undefined' || typeof window === 'undefined') return false;
  const ua = navigator.userAgent;
  const touch = navigator.maxTouchPoints > 0 || window.matchMedia('(pointer: coarse)').matches;
  if (!touch) return false;
  if (/Android|iPhone|iPad|iPod|Mobile|Tablet|Silk|Kindle/i.test(ua)) return true;
  return /Macintosh/.test(ua) && navigator.maxTouchPoints > 1;
}

/**
 * 하드웨어 키보드 연결 추정 (ADR-101) — 웹에는 직접 알려 주는 API가 없어 두 가지 신호로 추정한다.
 * - 화상 키보드가 안 뜬 채로 실제 키 입력(조합 중·229 아님)이 들어오면 연결됨
 * - 편집 칸에 포커스가 갔는데 화상 키보드가 안 뜨면 연결됨, 뜨면 연결 안 됨
 * 결과는 기억해 두었다가(다음 실행에도) 화상 키보드가 다시 뜨면 바로 푼다.
 */
const KEY = 'octobooks.hardwareKeyboard';
const SOFT_GAP = 120;
let present = readStored();
let maxInner = typeof window === 'undefined' ? 0 : window.innerHeight;
const listeners = new Set<() => void>();

function readStored(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

function set(next: boolean) {
  if (next === present) return;
  present = next;
  try {
    localStorage.setItem(KEY, next ? '1' : '0');
  } catch {
    /* 저장 못 해도 이번 실행에서는 쓴다 */
  }
  for (const l of listeners) l();
}

function softKeyboardOpen(): boolean {
  const vv = window.visualViewport;
  return window.innerHeight < maxInner - SOFT_GAP || (vv ? vv.height < window.innerHeight - SOFT_GAP : false);
}

function editableFocused(): boolean {
  const a = document.activeElement as HTMLElement | null;
  return !!a && (a.isContentEditable || a.tagName === 'INPUT' || a.tagName === 'TEXTAREA');
}

let started = false;
function start() {
  if (started || typeof window === 'undefined' || !isTouchDevice()) return;
  started = true;
  let probe = 0;
  window.addEventListener(
    'keydown',
    (e) => {
      if (e.isComposing || e.keyCode === 229 || e.key === 'Unidentified' || e.key === 'Process') return;
      // 화상 키보드도 Backspace·Enter·화살표는 진짜 키로 보낸다 — 떠 있을 땐 화상 키보드에 없는 조합만 믿는다
      if (softKeyboardOpen() && !(e.ctrlKey || e.metaKey || e.altKey || e.key === 'Tab' || e.key === 'Escape')) return;
      set(true);
    },
    true,
  );
  const onResize = () => {
    maxInner = Math.max(maxInner, window.innerHeight);
    if (softKeyboardOpen() && editableFocused()) set(false);
  };
  window.addEventListener('resize', onResize);
  // 돌리면 화면 높이 기준을 새로 잡는다 — 가로로 줄어든 높이를 화상 키보드로 오해하지 않게
  screen.orientation?.addEventListener('change', () => window.setTimeout(() => (maxInner = window.innerHeight), 400));
  window.visualViewport?.addEventListener('resize', onResize);
  // 손가락으로 편집 칸을 눌러 포커스가 갔는데 화상 키보드가 끝내 안 뜨면 하드웨어 키보드로 본다
  // (코드로 옮긴 포커스는 화상 키보드를 띄우지 않을 수 있어 터치 직후만 본다)
  let touchedAt = 0;
  window.addEventListener('pointerdown', (e) => e.pointerType === 'touch' && (touchedAt = Date.now()), true);
  document.addEventListener(
    'focusin',
    () => {
      window.clearTimeout(probe);
      if (!editableFocused() || Date.now() - touchedAt > 800) return;
      probe = window.setTimeout(() => {
        if (editableFocused() && !softKeyboardOpen()) set(true);
      }, 1200);
    },
    true,
  );
}

function subscribe(cb: () => void) {
  start();
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export const hardwareKeyboardNow = () => present;

export function useHardwareKeyboard(): boolean {
  return useSyncExternalStore(subscribe, hardwareKeyboardNow, () => false);
}
