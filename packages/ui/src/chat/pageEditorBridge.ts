import type { InlineFormat } from '@branch/core';
import type { EditorView } from '@codemirror/view';

/** 키보드 단축키 바가 넣는 줄 서식 (ADR-087) */
export type PageBlockKind = 'h1' | 'h2' | 'h3' | 'bullet' | 'ordered' | 'todo';

/**
 * 열린 페이지 편집기의 바깥 손잡이 — 선택 메뉴가 고른 글에 마크다운 서식을 넣거나(ADR-086)
 * AI 채우기 창을 열고, 모바일 키보드 바가 줄 서식·들여쓰기를 넣을 때(ADR-087) 쓴다.
 * 같은 페이지가 두 패널에 열릴 수 있어 세션이 아니라 편집기(view)로 찾는다.
 */
export interface PageEditorApi {
  /** 고른 글에 서식을 넣거나 뺀다 */
  format(kind: InlineFormat): boolean;
  /** 이 편집기에 AI 채우기가 있는가 (onFill이 있고 잠겨 있지 않음) */
  canFill(): boolean;
  /** 고른 글 끝(선택이 없으면 커서) 자리에 'AI로 내용 채우기' 입력 창을 연다 */
  openFill(): boolean;
  /** 커서 줄(들)을 제목·목록·번호·할 일로 바꾸거나, 이미 그 서식이면 푼다 */
  block(kind: PageBlockKind): boolean;
  /** 들여쓰기(1)·내어쓰기(-1) */
  indent(dir: 1 | -1): boolean;
}

const editors = new WeakMap<EditorView, PageEditorApi>();

export function registerPageEditor(view: EditorView, api: PageEditorApi): () => void {
  editors.set(view, api);
  return () => {
    if (editors.get(view) === api) editors.delete(view);
  };
}

export function formatPage(view: EditorView, kind: InlineFormat): boolean {
  return editors.get(view)?.format(kind) ?? false;
}

export function openPageFill(view: EditorView): boolean {
  return editors.get(view)?.openFill() ?? false;
}

/** 이 편집기에 AI 채우기가 있는지 (선택 메뉴가 버튼을 보일지 정한다) */
export const canFillPage = (view: EditorView): boolean => editors.get(view)?.canFill() ?? false;

export function pageBlock(view: EditorView, kind: PageBlockKind): boolean {
  return editors.get(view)?.block(kind) ?? false;
}

export function indentPage(view: EditorView, dir: 1 | -1): boolean {
  return editors.get(view)?.indent(dir) ?? false;
}
