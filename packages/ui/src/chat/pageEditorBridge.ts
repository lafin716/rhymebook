import type { InlineFormat } from '@branch/core';
import type { EditorView } from '@codemirror/view';

/**
 * 열린 페이지 편집기의 서식 넣기 — 선택 메뉴가 고른 글에 마크다운 서식을 넣을 때 쓴다 (ADR-086).
 * 같은 페이지가 두 패널에 열릴 수 있어 세션이 아니라 편집기(view)로 찾는다.
 */
const formatters = new WeakMap<EditorView, (kind: InlineFormat) => boolean>();

export function registerPageEditor(view: EditorView, format: (kind: InlineFormat) => boolean): () => void {
  formatters.set(view, format);
  return () => {
    if (formatters.get(view) === format) formatters.delete(view);
  };
}

export function formatPage(view: EditorView, kind: InlineFormat): boolean {
  return formatters.get(view)?.(kind) ?? false;
}
