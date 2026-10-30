import { markdownBlocks, moveMarkdownBlock, placeBlockBeside, type MarkdownBlock } from '@branch/core';
import type { EditorView } from '@codemirror/view';
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { minimalChange } from './pageText';
import { selectedRowField } from './pageRowEditing';

/** 끌어 놓을 자리 — 블록 사이(slot) 또는 어떤 블록 옆(beside) */
export type BlockDrop = { kind: 'slot'; slot: number } | { kind: 'beside'; target: number; side: 'left' | 'right' };

interface Box {
  block: MarkdownBlock;
  /** 클라이언트 좌표 */
  top: number;
  bottom: number;
}

export interface PageBlockHandlesProps {
  view: EditorView | null;
  /** 바깥 relative 상자 — 놓을 자리 표시의 기준, 버튼 누르기를 위임으로 받는다 */
  wrap: RefObject<HTMLDivElement | null>;
  /** 본문·배치가 바뀔 때마다 늘어나는 값 */
  tick: number;
  locked: boolean;
  /** 핸들을 눌렀다 떼면(끌지 않으면) 그 블록의 메뉴를 연다 */
  onMenu: (index: number, block: MarkdownBlock, at: { x: number; y: number }) => void;
  /** + — 그 블록 아래에 새 행 */
  onAdd: (index: number) => void;
  /** 끌어 옮긴 뒤 — 옮겨진 블록 구간 */
  onMoved?: (range: { from: number; to: number }) => void;
  /** 터치(모바일) — 고른 행·편집 중인 행에만 +·핸들을 보인다 */
  touch?: boolean;
}

/** 블록 옆 가장자리 이만큼(너비 비율)에 놓으면 나란히 배치 */
const SIDE = 0.25;
/** 끈 채로 화면 위아래 가장자리 이만큼 안에 오면 스크롤 */
const EDGE = 56;

function scrollParent(el: HTMLElement | null): HTMLElement | null {
  for (let n = el?.parentElement; n; n = n.parentElement) {
    const y = getComputedStyle(n).overflowY;
    if ((y === 'auto' || y === 'scroll') && n.scrollHeight > n.clientHeight) return n;
  }
  return null;
}

/**
 * 블록 상자 — 그려진 블록은 행 앞 자리(높이 0 위젯)의 실제 좌표로, 화면 밖이라 안 그려진 블록만 높이 지도로 어림한다.
 * 끝은 다음 블록의 시작 줄 위(사이 빈 줄 제외)까지가 아니라 마지막 줄 아래.
 */
function measure(view: EditorView): Box[] {
  const top = view.documentTop;
  const anchors = new Map<number, number>();
  for (const el of view.contentDOM.querySelectorAll<HTMLElement>('[data-row-anchor]')) {
    anchors.set(Number(el.dataset.rowAnchor), el.getBoundingClientRect().top);
  }
  return markdownBlocks(view.state.doc.toString()).map((block, i) => {
    const first = anchors.get(i) ?? top + view.lineBlockAt(block.from).top;
    const lastLine = view.lineBlockAt(block.to);
    const bottom = Math.max(first, top + lastLine.bottom);
    return { block, top: first, bottom };
  });
}

/** 마우스·손가락 위치에서 놓을 자리를 고른다 */
export function dropAt(boxes: Box[], from: number, x: number, y: number, left: number, right: number): BlockDrop | null {
  if (!boxes.length) return null;
  if (y < boxes[0]!.top) return { kind: 'slot', slot: 0 };
  let j = boxes.findIndex((b) => y >= b.top && y <= b.bottom);
  if (j < 0) {
    // 블록 사이 빈 줄 — 아래 블록 앞
    j = boxes.findIndex((b) => b.top > y);
    return { kind: 'slot', slot: j < 0 ? boxes.length : j };
  }
  const width = right - left;
  const source = boxes[from]!.block;
  if (j !== from && source.kind !== 'columns') {
    if (x < left + width * SIDE) return { kind: 'beside', target: j, side: 'left' };
    if (x > right - width * SIDE) return { kind: 'beside', target: j, side: 'right' };
  }
  const b = boxes[j]!;
  return { kind: 'slot', slot: y < (b.top + b.bottom) / 2 ? j : j + 1 };
}

/** 놓은 자리대로 본문을 바꾼다 — 되돌리기 한 번 */
export function applyDrop(view: EditorView, index: number, drop: BlockDrop): boolean {
  const before = view.state.doc.toString();
  const after =
    drop.kind === 'slot' ? moveMarkdownBlock(before, index, drop.slot) : placeBlockBeside(before, index, drop.target, drop.side);
  if (after === before) return false;
  // 나란히 놓았으면 커서를 묶음 뒤로 빼서 바로 칸 모양이 보이게 한다
  let selection: { anchor: number } | undefined;
  if (drop.kind === 'beside') {
    const cols = markdownBlocks(after)[drop.target > index ? drop.target - 1 : drop.target];
    if (cols?.kind === 'columns' && after[cols.to] === '\n') selection = { anchor: cols.to + 1 };
  }
  view.dispatch({ changes: minimalChange(before, after), selection, userEvent: 'move.block' });
  return true;
}

/** 놓은 뒤 옮겨진 블록의 자리 */
function movedIndex(index: number, drop: BlockDrop): number {
  if (drop.kind === 'slot') return drop.slot > index ? drop.slot - 1 : drop.slot;
  return drop.target > index ? drop.target - 1 : drop.target;
}

/** 지금 손대는 블록 — 고른 행(모바일), 아니면 커서가 있는 블록(포커스 중) */
function focusIndex(view: EditorView): number {
  const blocks = markdownBlocks(view.state.doc.toString());
  const row = view.state.field(selectedRowField, false);
  if (row) return blocks.findIndex((b) => b.from <= row.to && b.to >= row.from);
  if (!view.hasFocus) return -1;
  const head = view.state.selection.main.head;
  return blocks.findIndex((b) => head >= b.from && head <= b.to);
}

/**
 * 행 앞 +·핸들 (ADR-087 P7·P8 → ADR-095 → ADR-096). 버튼은 편집기 안 행 앞 자리(pageRowHandles)에 그려지고,
 * 여기서는 누르기·끌기를 위임으로 받고 보이기(data-active)·놓을 자리 표시를 맡는다.
 * + 는 그 블록 아래에 새 행을 넣고, 손잡이는 끌어서 위아래로 옮기거나 다른 블록 좌우 가장자리에 놓아 나란히(칸) 배치한다.
 * 손잡이를 누르기만 하면 블록 메뉴(모바일은 행 시트).
 * 데스크톱은 마우스가 지나는 블록·커서가 있는 블록에, 모바일은 고른 행·편집 중인 행에만 보인다.
 */
export function PageBlockHandles({ view, wrap, tick, locked, onMenu, onAdd, onMoved, touch = false }: PageBlockHandlesProps) {
  const [hover, setHover] = useState(-1);
  const [drag, setDrag] = useState<{ index: number; drop: BlockDrop | null; boxes: Box[] } | null>(null);
  const press = useRef<{ index: number; x: number; y: number; id: number; moved: boolean; touch: boolean } | null>(null);
  const scroll = useRef(0);
  const latest = useRef({ view, locked, onMenu, onAdd, onMoved, drag });
  latest.current = { view, locked, onMenu, onAdd, onMoved, drag };

  // 마우스가 지나는 블록의 +·핸들이 보인다
  useEffect(() => {
    const el = wrap.current;
    if (!el || !view) return;
    const move = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse' || press.current) return;
      const list = measure(view);
      // 행 앞 버튼 자리(왼쪽 여백)도 그 행으로 친다
      setHover(list.findIndex((b) => e.clientY >= b.top - 2 && e.clientY <= b.bottom));
    };
    const leave = () => setHover(-1);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerleave', leave);
    return () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerleave', leave);
    };
  }, [wrap, view]);

  useEffect(() => () => cancelAnimationFrame(scroll.current), []);

  // 누르기·끌기 — 버튼은 CodeMirror가 그리니 바깥 상자에서 위임으로 받는다
  useEffect(() => {
    const el = wrap.current;
    if (!el || !view) return;
    const target = (e: Event) => (e.target instanceof Element ? e.target.closest<HTMLButtonElement>('[data-page-handle], [data-page-row-add]') : null);
    const retarget = (x: number, y: number) => {
      const p = press.current;
      if (!p) return;
      const content = view.contentDOM.getBoundingClientRect();
      const list = measure(view);
      setDrag({ index: p.index, drop: dropAt(list, p.index, x, y, content.left, content.right), boxes: list });
    };
    // 손가락으로 끄는 동안 위아래 가장자리에 머물면 계속 스크롤
    const autoScroll = (x: number, y: number) => {
      cancelAnimationFrame(scroll.current);
      const scroller = scrollParent(el);
      if (!scroller) return;
      const step = () => {
        if (!press.current?.moved) return;
        const r = scroller.getBoundingClientRect();
        const top = Math.max(r.top, 0);
        const bottom = Math.min(r.bottom, window.visualViewport?.height ?? window.innerHeight);
        const dy = y < top + EDGE ? -(top + EDGE - y) / 4 : y > bottom - EDGE ? (y - bottom + EDGE) / 4 : 0;
        if (!dy) return;
        scroller.scrollTop += dy;
        retarget(x, y);
        scroll.current = requestAnimationFrame(step);
      };
      scroll.current = requestAnimationFrame(step);
    };
    const blockOf = (i: number) => markdownBlocks(view.state.doc.toString())[i];

    const mousedown = (e: MouseEvent) => {
      // 편집기 포커스·커서를 뺏지 않는다
      if (target(e)) e.preventDefault();
    };
    const down = (e: PointerEvent) => {
      const b = target(e);
      if (!b || !b.hasAttribute('data-page-handle') || latest.current.locked || e.button !== 0) return;
      e.preventDefault();
      b.setPointerCapture(e.pointerId);
      press.current = { index: Number(b.dataset.pageHandle), x: e.clientX, y: e.clientY, id: e.pointerId, moved: false, touch: e.pointerType !== 'mouse' };
    };
    const move = (e: PointerEvent) => {
      const p = press.current;
      if (!p || p.id !== e.pointerId) return;
      if (!p.moved && Math.hypot(e.clientX - p.x, e.clientY - p.y) < 5) return;
      p.moved = true;
      retarget(e.clientX, e.clientY);
      if (p.touch) autoScroll(e.clientX, e.clientY);
    };
    const up = (e: PointerEvent) => {
      const p = press.current;
      if (!p || p.id !== e.pointerId) return;
      press.current = null;
      cancelAnimationFrame(scroll.current);
      const d = latest.current.drag;
      setDrag(null);
      if (!p.moved) {
        const b = blockOf(p.index);
        if (b) latest.current.onMenu(p.index, b, { x: e.clientX, y: e.clientY });
        return;
      }
      if (d?.drop && applyDrop(view, d.index, d.drop)) {
        const b = blockOf(movedIndex(d.index, d.drop));
        if (b) latest.current.onMoved?.({ from: b.from, to: b.to });
      } else if (d) {
        const b = blockOf(d.index);
        if (b) latest.current.onMoved?.({ from: b.from, to: b.to });
      }
    };
    const cancel = () => {
      press.current = null;
      cancelAnimationFrame(scroll.current);
      setDrag(null);
    };
    const click = (e: MouseEvent) => {
      const b = target(e);
      if (!b || !b.hasAttribute('data-page-row-add') || latest.current.locked) return;
      e.preventDefault();
      latest.current.onAdd(Number(b.dataset.pageRowAdd));
    };
    const key = (e: KeyboardEvent) => {
      const b = target(e);
      if (!b || !b.hasAttribute('data-page-handle') || (e.key !== 'Enter' && e.key !== ' ')) return;
      e.preventDefault();
      e.stopPropagation();
      const i = Number(b.dataset.pageHandle);
      const blk = blockOf(i);
      const r = b.getBoundingClientRect();
      if (blk) latest.current.onMenu(i, blk, { x: r.right, y: r.bottom });
    };
    const menu = (e: Event) => {
      if (target(e)) e.preventDefault();
    };
    el.addEventListener('mousedown', mousedown);
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', cancel);
    el.addEventListener('click', click);
    el.addEventListener('keydown', key);
    el.addEventListener('contextmenu', menu);
    return () => {
      el.removeEventListener('mousedown', mousedown);
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', cancel);
      el.removeEventListener('click', click);
      el.removeEventListener('keydown', key);
      el.removeEventListener('contextmenu', menu);
    };
  }, [wrap, view]);

  // 보이기·잠금 — CodeMirror가 버튼을 새로 그릴 때마다(tick) 다시 단다
  const focused = view ? focusIndex(view) : -1;
  useLayoutEffect(() => {
    if (!view) return;
    for (const b of view.contentDOM.querySelectorAll<HTMLButtonElement>('[data-page-handle], [data-page-row-add]')) {
      const i = Number(b.dataset.pageHandle ?? b.dataset.pageRowAdd);
      const active = hover === i || focused === i || drag?.index === i;
      b.toggleAttribute('data-active', active);
      b.toggleAttribute('data-dragging', drag?.index === i && b.hasAttribute('data-page-handle'));
      b.disabled = locked;
    }
  });

  if (!view || !drag) return null;
  const origin = wrap.current?.getBoundingClientRect();
  if (!origin) return null;
  const boxes = drag.boxes;

  // 놓을 자리 표시
  let indicator: { left: number; top: number; width: number; height: number } | null = null;
  if (drag.drop) {
    const content = view.contentDOM.getBoundingClientRect();
    const d = drag.drop;
    if (d.kind === 'slot') {
      const prev = boxes[d.slot - 1];
      const next = boxes[d.slot];
      const y = next && prev ? (prev.bottom + next.top) / 2 : next ? next.top - 2 : (prev?.bottom ?? content.top) + 2;
      indicator = { left: content.left - origin.left, top: y - origin.top - 1, width: content.width, height: 3 };
    } else {
      const t = boxes[d.target];
      if (t) {
        const x = d.side === 'left' ? content.left - 4 : content.right + 1;
        indicator = { left: x - origin.left, top: t.top - origin.top, width: 3, height: Math.max(t.bottom - t.top, 20) };
      }
    }
  }

  const lifted = touch ? boxes[drag.index] : undefined;
  const liftedBox = lifted && view.contentDOM.getBoundingClientRect();
  void tick;

  return (
    <>
      {lifted && liftedBox && (
        <div
          data-page-lifted={drag.index}
          aria-hidden
          style={{
            left: liftedBox.left - origin.left - 4,
            top: lifted.top - origin.top - 2,
            width: liftedBox.width + 8,
            height: Math.max(lifted.bottom - lifted.top, 20) + 4,
          }}
          className="pointer-events-none absolute z-10 rounded-lg bg-accent/10 ring-2 ring-accent"
        />
      )}
      {indicator && (
        <div data-page-drop={drag.drop?.kind} aria-hidden style={indicator} className="pointer-events-none absolute z-20 rounded-full bg-accent" />
      )}
    </>
  );
}
