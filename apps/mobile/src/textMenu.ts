import { Capacitor, registerPlugin } from '@capacitor/core';

interface TextMenuPlugin {
  setSuppressed(options: { value: boolean }): Promise<void>;
}

const TextMenu = registerPlugin<TextMenuPlugin>('TextMenu');

const EDITABLE = 'input, textarea, [contenteditable]:not([contenteditable="false"])';

/** 지금 선택이 입력창 안에 있는지 (입력창 밖 본문을 선택했으면 false) */
function editing(): boolean {
  const active = document.activeElement;
  if (!active?.matches(EDITABLE)) return false;
  const sel = document.getSelection();
  const node = sel?.anchorNode;
  if (!sel || sel.isCollapsed || !node) return true;
  // input/textarea 안의 선택은 부모 요소를 anchor로 가진다
  return node.contains(active) || active.contains(node);
}

/**
 * 본문 텍스트를 선택하면 시스템 메뉴(복사·공유…)를 숨기고 앱 선택 메뉴만 보인다.
 * 입력창을 편집할 때는 붙여넣기 등 시스템 메뉴를 그대로 쓴다. 네이티브 기본값은 숨김.
 */
export function installTextMenuGuard() {
  if (!Capacitor.isNativePlatform()) return;
  let last: boolean | null = null;
  const sync = () => {
    const suppressed = !editing();
    if (suppressed === last) return;
    last = suppressed;
    void TextMenu.setSuppressed({ value: suppressed }).catch(() => undefined);
  };
  sync(); // 웹뷰만 다시 불러온 경우 네이티브 상태를 맞춘다
  document.addEventListener('focusin', sync);
  document.addEventListener('focusout', () => window.setTimeout(sync, 0));
  document.addEventListener('selectionchange', sync);
}
