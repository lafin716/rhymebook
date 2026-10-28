import { markdownBlocks, moveMarkdownBlock, placeBlockBeside, type MarkdownBlock } from '@branch/core';
import type { EditorView } from '@codemirror/view';
import { GripVertical } from 'lucide-react';
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';
import { cn } from '../lib/cn';
import { minimalChange } from './pageText';

/** 끌어 놓을 자리 — 블록 사이(slot) 또는 어떤 블록 옆(beside) */
export type BlockDrop = { kind: 'slot'; slot: number } | { kind: 'beside'; target: number; side: 'left' | 'right' };

interface Box {
  block: MarkdownBlock;
  /** 클라이언트 좌표 */
  top: number;
  bottom: number;
  head: number;
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
}

/** 블록 옆 가장자리 이만큼(너비 비율)에 놓으면 나란히 배치 */
const SIDE = 0.25;

function measure(view: EditorView): Box[] {
  const top = view.documentTop;
  return markdownBlocks(view.state.doc.toString()).map((block) => {
    const first = view.lineBlockAt(block.from);
    const last = view.lineBlockAt(block.to);
    return { block, top: top + first.top, bottom: top + last.bottom, head: Math.min(first.height, 28) };
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

/**
 * 블록 핸들 (ADR-087 P7·P8). 블록마다 앞에 손잡이를 두고, 끌어서 위아래로 옮기거나
 * 다른 블록 좌우 가장자리에 놓아 나란히(칸) 배치한다. 누르기만 하면 블록 메뉴.
 */
export function PageBlockHandles({ view, wrap, tick, locked, onMenu }: PageBlockHandlesProps) {
  const [boxes, setBoxes] = useState<Box[]>([]);
  const [hover, setHover] = useState(-1);
  const [drag, setDrag] = useState<{ index: number; drop: BlockDrop | null } | null>(null);
  const press = useRef<{ index: number; x: number; y: number; id: number; moved: boolean } | null>(null);

  useEffect(() => {
    if (!view) return;
    // 측정은 CodeMirror가 그린 뒤에
    const id = requestAnimationFrame(() => setBoxes(measure(view)));
    return () => cancelAnimationFrame(id);
  }, [view, tick]);

  // 마우스가 지나는 블록의 핸들만 보인다 (터치 기기는 늘 흐리게)
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

  if (!view) return null;
  const origin = wrap.current?.getBoundingClientRect();
  if (!origin) return null;

  const onDown = (i: number) => (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (locked || e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    press.current = { index: i, x: e.clientX, y: e.clientY, id: e.pointerId, moved: false };
  };
  const onMove = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const p = press.current;
    if (!p || p.id !== e.pointerId) return;
    if (!p.moved && Math.hypot(e.clientX - p.x, e.clientY - p.y) < 5) return;
    p.moved = true;
    const content = view.contentDOM.getBoundingClientRect();
    const list = measure(view);
    setDrag({ index: p.index, drop: dropAt(list, p.index, e.clientX, e.clientY, content.left, content.right) });
  };
  const onUp = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const p = press.current;
    if (!p || p.id !== e.pointerId) return;
    press.current = null;
    const d = drag;
    setDrag(null);
    if (!p.moved) {
      const b = boxes[p.index];
      if (b) onMenu(p.index, b.block, { x: e.clientX, y: e.clientY });
      return;
    }
    if (d?.drop) {
      applyDrop(view, d.index, d.drop);
      view.focus();
    }
  };
  const onCancel = () => {
    press.current = null;
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

  return (
    <>
      {boxes.map((b, i) => (
        <button
          key={`${i}-${b.block.from}`}
          type="button"
          aria-label={`블록 ${i + 1} 옮기기·메뉴`}
          data-page-handle={i}
          data-block-kind={b.block.kind}
          data-active={hover === i || drag?.index === i ? '' : undefined}
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
          style={{ top: b.top - origin.top + Math.max(0, (b.head - 24) / 2), height: 24 }}
          className={cn(
            'page-handle absolute left-0 z-10 grid w-5 cursor-grab place-items-center rounded text-muted hover:bg-surface-2 hover:text-fg-2 active:cursor-grabbing',
            drag?.index === i && 'bg-accent-soft text-accent',
          )}
        >
          <GripVertical size={14} />
        </button>
      ))}
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
