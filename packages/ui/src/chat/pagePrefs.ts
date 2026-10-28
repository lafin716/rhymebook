/** 페이지 편집기 설정 (기기별, localStorage): 키보드 단축키 바, 이모지 미리보기 */

const KEYBOARD_BAR_KEY = 'octobooks.page.keyboardBar';
const EMOJI_KEY = 'octobooks.page.emoji';

function load(key: string): unknown {
  try {
    return JSON.parse(localStorage.getItem(key) ?? 'null');
  } catch {
    return null;
  }
}

function save(key: string, v: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    // 저장 공간이 없거나 막혀 있으면 이번 실행에서만 기억한다
  }
}

export function loadKeyboardBar(): boolean {
  const v = load(KEYBOARD_BAR_KEY);
  return typeof v === 'boolean' ? v : true; // 기본값: on
}

export const saveKeyboardBar = (value: boolean) => save(KEYBOARD_BAR_KEY, value);

export function loadEmoji(): boolean {
  const v = load(EMOJI_KEY);
  return typeof v === 'boolean' ? v : true; // 기본값: on
}

export const saveEmoji = (value: boolean) => save(EMOJI_KEY, value);
