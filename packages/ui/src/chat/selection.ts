import { markdownPlainText, pageDoc, selectionToAnchor, type Anchor, type ID } from '@branch/core';
import { EditorView } from '@codemirror/view';
import { actions } from '../app/store';
import { selectedImage } from './livePreview';
import { flushPageDraft } from './PagePanel';
import { getSegmentMap } from './segmentRegistry';

/** 선택 영역의 화면 좌표 (top = 첫 줄 위, bottom = 전체 아래) */
export interface SelectionRect {
  top: number;
  left: number;
  bottom: number;
  width: number;
}

export interface PendingBranch {
  sessionId: ID;
  anchor: Anchor;
  rect: SelectionRect;
  /** 페이지 편집기 안의 선택 — 앵커는 원문 범위이고, 서식 버튼으로 마크다운을 넣을 수 있다 (ADR-086) */
  editor?: EditorView;
}

/** 메뉴와 선택 영역 사이 간격 */
export const MENU_GAP = 8;
/** 메뉴와 화면 가장자리 사이 최소 여백 */
const EDGE = 8;

export type MenuPlacement = 'above' | 'below' | 'right' | 'left' | 'edge';

/**
 * 선택 영역을 가리지 않는 메뉴 위치: 위 → 아래 → 오른쪽 → 왼쪽.
 * 어디에도 들어가지 않으면(화면을 거의 채운 선택) 화면 위·아래 중 선택이 덜 걸친 쪽 가장자리에 붙인다.
 */
export function placeMenu(
  sel: SelectionRect,
  menu: { w: number; h: number },
  view = { w: window.innerWidth, h: window.innerHeight },
): { top: number; left: number; placement: MenuPlacement } {
  const clampX = (x: number) => Math.max(EDGE, Math.min(view.w - menu.w - EDGE, x));
  const clampY = (y: number) => Math.max(EDGE, Math.min(view.h - menu.h - EDGE, y));
  const centerX = clampX(sel.left + sel.width / 2 - menu.w / 2);
  if (sel.top - MENU_GAP - menu.h >= EDGE) return { top: sel.top - MENU_GAP - menu.h, left: centerX, placement: 'above' };
  if (sel.bottom + MENU_GAP + menu.h <= view.h - EDGE) return { top: sel.bottom + MENU_GAP, left: centerX, placement: 'below' };
  const midY = clampY((Math.max(sel.top, 0) + Math.min(sel.bottom, view.h)) / 2 - menu.h / 2);
  const right = sel.left + sel.width;
  if (right + MENU_GAP + menu.w <= view.w - EDGE) return { top: midY, left: right + MENU_GAP, placement: 'right' };
  if (sel.left - MENU_GAP - menu.w >= EDGE) return { top: midY, left: sel.left - MENU_GAP - menu.w, placement: 'left' };
  const top = sel.top > view.h - sel.bottom ? EDGE : view.h - menu.h - EDGE;
  return { top, left: centerX, placement: 'edge' };
}

/**
 * 렌더 텍스트를 이루는 텍스트 노드 (문서 순서).
 * KaTeX 숨김 MathML과 렌더러가 추가한 조작 문구는 anchorPlugin의 renderText에 없으므로 뺀다.
 */
function renderTextNodes(container: HTMLElement): Text[] {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.parentElement?.closest('.katex-mathml, [data-anchor-ignore]') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  const out: Text[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) out.push(n as Text);
  return out;
}

/** 컨테이너 시작부터 (node, offset)까지의 렌더 텍스트 길이 */
function offsetIn(container: HTMLElement, node: Node, offset: number): number {
  const r = document.createRange();
  r.selectNodeContents(container);
  r.setEnd(node, offset);
  let n = 0;
  for (const t of renderTextNodes(container)) {
    if (t === node) return n + Math.min(offset, t.length);
    // 텍스트 노드 끝이 경계 안이면 통째로 포함, 아니면 경계를 지났다
    if (r.comparePoint(t, t.length) !== 0) break;
    n += t.length;
  }
  return n;
}

/**
 * 현재 DOM 선택을 앵커로 변환한다.
 * 같은 assistant 메시지(data-anchorable) 안의 선택만 허용하며, 끝이 메시지 밖이면 메시지 끝으로 자른다.
 */
export function readSelection(): PendingBranch | null {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
  const editorHost = (range.startContainer instanceof Element ? range.startContainer : range.startContainer.parentElement)
    ?.closest<HTMLElement>('[data-page-editor]');
  if (editorHost) return readEditorSelection(editorHost, range);
  const startEl = (range.startContainer instanceof Element ? range.startContainer : range.startContainer.parentElement)
    ?.closest<HTMLElement>('[data-anchorable]');
  if (!startEl) return null;
  const messageId = startEl.dataset.messageId;
  const sessionId = startEl.dataset.sessionId;
  if (!messageId || !sessionId) return null;
  const map = getSegmentMap(messageId);
  if (!map) return null;

  const rs = offsetIn(startEl, range.startContainer, range.startOffset);
  const re = startEl.contains(range.endContainer)
    ? offsetIn(startEl, range.endContainer, range.endOffset)
    : renderTextNodes(startEl).reduce((n, t) => n + t.length, 0);
  const anchor = selectionToAnchor(messageId, map, rs, re);
  if (!anchor) return null;

  const rects = range.getClientRects();
  const first = rects[0] ?? range.getBoundingClientRect();
  const box = range.getBoundingClientRect();
  return {
    sessionId,
    anchor,
    rect: { top: first.top, left: box.left, bottom: box.bottom, width: box.width },
  };
}

/**
 * 페이지 편집기 안의 선택을 앵커로 바꾼다. 편집기 원문이 곧 문서 content라
 * 선택 범위가 그대로 원문 offset이 된다 (쓰던 글은 먼저 저장해 저장본과 맞춘다).
 */
function readEditorSelection(host: HTMLElement, range: Range): PendingBranch | null {
  const sessionId = host.dataset.sessionId;
  const cm = host.querySelector<HTMLElement>('.cm-editor');
  const view = cm ? EditorView.findFromDOM(cm) : null;
  if (!sessionId || !view) return null;
  const { state } = view;
  // 이미지를 고른 상태는 글 선택이 아니다 — 선택 메뉴 대신 이미지 지우기 버튼만 보인다
  if (selectedImage(state)) return null;
  let { from, to } = state.selection.main;
  const doc = state.doc;
  while (from < to && /\s/.test(doc.sliceString(from, from + 1))) from++;
  while (to > from && /\s/.test(doc.sliceString(to - 1, to))) to--;
  if (from >= to) return null;
  const slice = doc.sliceString(from, to);
  flushPageDraft(sessionId);
  // 첫 저장에서 문서 메시지가 생기므로 저장 뒤에 id를 읽는다
  const messageId = pageDoc(actions().messages[sessionId])?.id;
  if (!messageId) return null;
  const anchor: Anchor = { messageId, text: markdownPlainText(slice) || slice, startOffset: from, endOffset: to };
  const start = view.coordsAtPos(from, 1);
  const end = view.coordsAtPos(to, -1);
  const box = range.getBoundingClientRect();
  const top = start?.top ?? box.top;
  return {
    sessionId,
    anchor,
    rect: { top, left: box.width ? box.left : (start?.left ?? 0), bottom: Math.max(end?.bottom ?? box.bottom, top), width: box.width },
    editor: view,
  };
}

/** 데모용: 메시지 안의 literal을 프로그램으로 선택한다 */
export function selectText(messageId: ID, literal: string): boolean {
  const root = document.querySelector<HTMLElement>(`[data-anchorable][data-message-id="${messageId}"]`);
  if (!root) return false;
  let acc = '';
  const nodes: { node: Text; start: number }[] = [];
  for (const n of renderTextNodes(root)) {
    nodes.push({ node: n, start: acc.length });
    acc += n.data;
  }
  const at = acc.indexOf(literal);
  if (at < 0) return false;
  const find = (pos: number) => {
    for (let i = nodes.length - 1; i >= 0; i--) if (nodes[i]!.start <= pos) return nodes[i]!;
    return nodes[0]!;
  };
  const a = find(at);
  const b = find(at + literal.length - 1);
  const range = document.createRange();
  range.setStart(a.node, at - a.start);
  range.setEnd(b.node, at + literal.length - b.start);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
  root.closest('[data-scroll]')?.scrollTo?.({ top: 0 });
  return true;
}
