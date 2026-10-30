import { markdownBlocks, moveMarkdownBlock, placeBlockBeside, type MarkdownBlock } from '@branch/core';
import type { EditorView } from '@codemirror/view';
import { GripVertical, Plus } from 'lucide-react';
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';
import { cn } from '../lib/cn';
import { minimalChange } from './pageText';
import { selectedRowField } from './pageRowEditing';

/** 끌어 놓을 자리 — 블록 사이(slot) 또는 어떤 블록 옆(beside) */
export type BlockDrop = { kind: 'slot'; slot: number } | { kind: 'beside'; target: number; side: 'left' | 'right' };

interface Box {
  block: MarkdownBlock;
  /** 클라이언트 좌표 */
  top: number;
  bottom: number;
  /** 첫 줄 글자의 세로 가운데 (클라이언트 좌표) — 핸들을 여기에 맞춘다 */
  mid: number;
}

export interface PageBlockHandlesProps {
  view: EditorView | null;
  /** 바깥 relative 상자 — 핸들 좌표의 기준 */
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

function measure(view: EditorView): Box[] {
  const top = view.documentTop;
  return markdownBlocks(view.state.doc.toString()).map((block) => {
    const first = view.lineBlockAt(block.from);
    const last = view.lineBlockAt(block.to);
    const box = { block, top: top + first.top, bottom: top + last.bottom };
    return { ...box, mid: textMid(view, block, box.top, box.bottom) };
  });
}

/**
 * 첫 줄 글자의 세로 가운데. 제목처럼 줄 위쪽에 여백이 있는 블록도 글자 옆에 핸들이 오게
 * 줄 상자가 아니라 실제 글자 좌표로 잰다. 그림으로 바뀐 블록(나란히·이미지 등)은 첫 줄 높이로 어림한다.
 */
function textMid(view: EditorView, block: MarkdownBlock, top: number, bottom: number): number {
  const line = view.state.doc.lineAt(block.from);
  // 숨긴 머리 기호(`# `) 뒤 첫 글자에서 잰다
  const lead = /^\s*(#{1,6}\s+|[-*+]\s\[[xX ]\]\s+|[-*+]\s+|\d+[.)]\s+|>\s?)?/.exec(line.text)?.[0].length ?? 0;
  const at = Math.min(line.from + lead, line.to);
  const c = block.kind === 'columns' || block.kind === 'image' ? null : view.coordsAtPos(at, 1);
  if (c && c.bottom > c.top && c.top >= top - 1 && c.bottom <= bottom + 1) return (c.top + c.bottom) / 2;
  return top + Math.min(bottom - top, 28) / 2;
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
function focusIndex(view: EditorView, boxes: Box[]): number {
  const row = view.state.field(selectedRowField, false);
  if (row) return boxes.findIndex((b) => b.block.from <= row.to && b.block.to >= row.from);
  if (!view.hasFocus) return -1;
  const head = view.state.selection.main.head;
  return boxes.findIndex((b) => head >= b.block.from && head <= b.block.to);
}

/**
 * 행 앞 +·핸들 (ADR-087 P7·P8 → ADR-095). 글이 있는 블록마다 앞에 + 와 손잡이를 둔다.
 * + 는 그 블록 아래에 새 행을 넣고, 손잡이는 끌어서 위아래로 옮기거나 다른 블록 좌우 가장자리에 놓아 나란히(칸) 배치한다.
 * 손잡이를 누르기만 하면 블록 메뉴(모바일은 행 시트).
 * 데스크톱은 마우스가 지나는 블록·커서가 있는 블록에, 모바일은 고른 행·편집 중인 행에만 보인다.
 */
export function PageBlockHandles({ view, wrap, tick, locked, onMenu, onAdd, onMoved, touch = false }: PageBlockHandlesProps) {
  const [boxes, setBoxes] = useState<Box[]>([]);
  const [hover, setHover] = useState(-1);
  const [drag, setDrag] = useState<{ index: number; drop: BlockDrop | null } | null>(null);
  const press = useRef<{ index: number; x: number; y: number; id: number; moved: boolean; touch: boolean } | null>(null);
  const scroll = useRef(0);

  useEffect(() => {
    if (!view) return;
    // 측정은 CodeMirror가 그린 뒤에
    const id = requestAnimationFrame(() => setBoxes(measure(view)));
    return () => cancelAnimationFrame(id);
  }, [view, tick]);

  // 마우스가 지나는 블록의 +·핸들이 보인다
  useEffect(() => {
    const el = wrap.current;
    if (!el || !view) return;
    const move = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return;
      const list = measure(view);
      setHover(list.findIndex((b) => e.clientY >= b.top && e.clientY <= b.bottom));
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

  if (!view) return null;
  const origin = wrap.current?.getBoundingClientRect();
  if (!origin) return null;
  const focused = focusIndex(view, boxes);

  const retarget = (x: number, y: number) => {
    const p = press.current;
    if (!p) return;
    const content = view.contentDOM.getBoundingClientRect();
    const list = measure(view);
    setBoxes(list);
    setDrag({ index: p.index, drop: dropAt(list, p.index, x, y, content.left, content.right) });
  };
  // 손가락으로 끄는 동안 위아래 가장자리에 머물면 계속 스크롤
  const autoScroll = (x: number, y: number) => {
    cancelAnimationFrame(scroll.current);
    const scroller = scrollParent(wrap.current);
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

  const onDown = (i: number) => (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (locked || e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    press.current = { index: i, x: e.clientX, y: e.clientY, id: e.pointerId, moved: false, touch: e.pointerType !== 'mouse' };
  };
  const onMove = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const p = press.current;
    if (!p || p.id !== e.pointerId) return;
    if (!p.moved && Math.hypot(e.clientX - p.x, e.clientY - p.y) < 5) return;
    p.moved = true;
    retarget(e.clientX, e.clientY);
    if (p.touch) autoScroll(e.clientX, e.clientY);
  };
  const onUp = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const p = press.current;
    if (!p || p.id !== e.pointerId) return;
    press.current = null;
    cancelAnimationFrame(scroll.current);
    const d = drag;
    setDrag(null);
    if (!p.moved) {
      const b = boxes[p.index];
      if (b) onMenu(p.index, b.block, { x: e.clientX, y: e.clientY });
      return;
    }
    if (d?.drop && applyDrop(view, d.index, d.drop)) {
      const b = markdownBlocks(view.state.doc.toString())[movedIndex(d.index, d.drop)];
      if (b) onMoved?.({ from: b.from, to: b.to });
    } else if (d) {
      const b = boxes[d.index];
      if (b) onMoved?.({ from: b.block.from, to: b.block.to });
    }
  };
  const onCancel = () => {
    press.current = null;
    cancelAnimationFrame(scroll.current);
    setDrag(null);
  };

  // 놓을 자리 표시
  let indicator: { left: number; top: number; width: number; height: number } | null = null;
  if (drag?.drop) {
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

  const lifted = touch && drag ? boxes[drag.index] : undefined;
  const liftedBox = lifted && view.contentDOM.getBoundingClientRect();
  const w = touch ? 22 : 20;
  const h = touch ? 32 : 24;

  return (
    <>
      {lifted && liftedBox && (
        <div
          data-page-lifted={drag?.index}
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
      {boxes.map((b, i) => {
        const active = hover === i || focused === i || drag?.index === i;
        // 모바일은 고른 행·편집 중인 행만 그린다(손가락이 엉뚱한 버튼을 누르지 않게)
        if (touch && !active) return null;
        const top = b.mid - origin.top - h / 2;
        return (
          <div key={`${i}-${b.block.from}`} className="contents">
            <button
              type="button"
              aria-label={`블록 ${i + 1} 아래에 행 추가`}
              data-page-row-add={i}
              data-active={active ? '' : undefined}
              disabled={locked}
              tabIndex={-1}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onAdd(i)}
              style={{ top, height: h, width: w, left: 0 }}
              className="page-handle page-row-add absolute z-10 grid place-items-center rounded text-muted hover:bg-surface-2 hover:text-fg-2"
            >
              <Plus size={touch ? 16 : 14} />
            </button>
            <button
              type="button"
              aria-label={`블록 ${i + 1} 옮기기·메뉴`}
              data-page-handle={i}
              data-block-kind={b.block.kind}
              data-active={active ? '' : undefined}
              disabled={locked}
              onMouseDown={(e) => e.preventDefault()}
              onPointerDown={onDown(i)}
              onPointerMove={onMove}
              onPointerUp={onUp}
              onPointerCancel={onCancel}
              onContextMenu={(e) => e.preventDefault()}
              onKeyDown={(e) => {
                if (e.key !== 'Enter' && e.key !== ' ') return;
                e.preventDefault();
                const r = e.currentTarget.getBoundingClientRect();
                onMenu(i, b.block, { x: r.right, y: r.bottom });
              }}
              style={{ top, height: h, width: w, left: w }}
              className={cn(
                'page-handle absolute z-10 grid cursor-grab place-items-center rounded text-muted hover:bg-surface-2 hover:text-fg-2 active:cursor-grabbing',
                drag?.index === i && 'bg-accent-soft text-accent',
              )}
            >
              <GripVertical size={touch ? 16 : 14} />
            </button>
          </div>
        );
      })}
      {indicator && (
        <div
          data-page-drop={drag?.drop?.kind}
          aria-hidden
          style={indicator}
          className="pointer-events-none absolute z-20 rounded-full bg-accent"
        />
      )}
    </>
  );
}
