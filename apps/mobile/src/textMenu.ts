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

/** 페이지 편집기 내에서의 비어있지 않은 선택인지 */
function isPageEditorSelection(): boolean {
  const selection = document.getSelection();
  if (!selection || selection.isCollapsed) return false;

  // 선택이 [data-page-editor] 또는 .cm-content 안에 있는지 확인
  const anchorNode = selection.anchorNode;
  if (!anchorNode) return false;

  const pageEditor = (anchorNode as Node).parentElement?.closest('[data-page-editor]');
  return !!pageEditor;
}

/**
 * 본문 텍스트를 선택하면 시스템 메뉴(복사·공유…)를 숨기고 앱 선택 메뉴만 보인다.
 * 입력창을 편집할 때는 붙여넣기 등 시스템 메뉴를 그대로 쓴다.
 * 페이지 편집기 안 비어있지 않은 선택도 시스템 메뉴를 숨긴다.
 * 접힌 커서는 시스템 메뉴를 유지한다(붙여넣기).
 * 네이티브 기본값은 숨김.
 */
export function installTextMenuGuard() {
  if (!Capacitor.isNativePlatform()) return;
  let last: boolean | null = null;
  const sync = () => {
    // 선택이 비어있거나 입력창 안이면 시스템 메뉴 표시 (suppressed = false)
    // 선택이 있고 입력창 밖이면 숨김 (suppressed = true)
    // 페이지 편집기 안 비어있지 않은 선택도 숨김
    const suppressed = !editing() || isPageEditorSelection();
    if (suppressed === last) return;
    last = suppressed;
    void TextMenu.setSuppressed({ value: suppressed }).catch(() => undefined);
  };
  sync(); // 웹뷰만 다시 불러온 경우 네이티브 상태를 맞춘다
  document.addEventListener('focusin', sync);
  document.addEventListener('focusout', () => window.setTimeout(sync, 0));
  document.addEventListener('selectionchange', sync);
}
