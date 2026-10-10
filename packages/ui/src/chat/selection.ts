import { selectionToAnchor, type Anchor, type ID } from '@branch/core';
import { getSegmentMap } from './segmentRegistry';

export interface PendingBranch {
  sessionId: ID;
  anchor: Anchor;
  rect: { top: number; left: number; bottom: number; width: number };
}

/** 컨테이너 시작부터 (node, offset)까지의 렌더 텍스트 길이 */
function offsetIn(container: HTMLElement, node: Node, offset: number): number {
  const r = document.createRange();
  r.selectNodeContents(container);
  r.setEnd(node, offset);
  return r.toString().length;
}

/**
 * 현재 DOM 선택을 앵커로 변환한다.
 * 같은 assistant 메시지(data-anchorable) 안의 선택만 허용하며, 끝이 메시지 밖이면 메시지 끝으로 자른다.
 */
export function readSelection(): PendingBranch | null {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
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
    : (startEl.textContent ?? '').length;
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

/** 데모용: 메시지 안의 literal을 프로그램으로 선택한다 */
export function selectText(messageId: ID, literal: string): boolean {
  const root = document.querySelector<HTMLElement>(`[data-anchorable][data-message-id="${messageId}"]`);
  if (!root) return false;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let acc = '';
  const nodes: { node: Text; start: number }[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    nodes.push({ node: n as Text, start: acc.length });
    acc += (n as Text).data;
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
