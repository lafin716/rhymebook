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
  /** 터치(모바일 앱) — 핸들 대신 블록을 길게 눌러 든다 */
  touch?: boolean;
}

/** 블록 옆 가장자리 이만큼(너비 비율)에 놓으면 나란히 배치 */
const SIDE = 0.25;
/** 이만큼 누르고 있으면 블록이 들린다 */
const LIFT_MS = 450;
/** 들리기 전에 이만큼 움직이면 스크롤로 본다 */
const SLOP = 8;
/** 든 채로 화면 위아래 가장자리 이만큼 안에 오면 스크롤 */
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

/**
 * 블록 핸들 (ADR-087 P7·P8). 블록마다 앞에 손잡이를 두고, 끌어서 위아래로 옮기거나
 * 다른 블록 좌우 가장자리에 놓아 나란히(칸) 배치한다. 누르기만 하면 블록 메뉴.
 * 터치(ADR-091)는 핸들 없이 커서가 없는 블록을 길게 눌러 들고, 끌지 않고 떼면 블록 메뉴.
 * 커서가 있는 블록을 길게 누르면 평소처럼 글자 선택이다.
 */
export function PageBlockHandles({ view, wrap, tick, locked, onMenu, touch = false }: PageBlockHandlesProps) {
  const [boxes, setBoxes] = useState<Box[]>([]);
  const [hover, setHover] = useState(-1);
  const [drag, setDrag] = useState<{ index: number; drop: BlockDrop | null } | null>(null);
  const press = useRef<{ index: number; x: number; y: number; id: number; moved: boolean } | null>(null);
  const menu = useRef(onMenu);
  menu.current = onMenu;

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

  // 터치: 길게 눌러 들고 끌어 놓기
  useEffect(() => {
    const root = wrap.current;
    if (!touch || locked || !view || !root) return;
    const el = view.contentDOM;
    let t: {
      index: number;
      x: number;
      y: number;
      /** 누른 자리, 들린 뒤에는 들린 자리 — 여기서 SLOP 넘게 움직이면 스크롤(들리기 전)·끌기(들린 뒤) */
      lx: number;
      ly: number;
      timer: number;
      lifted: boolean;
      moved: boolean;
      drop: BlockDrop | null;
    } | null = null;
    let frame = 0;
    let scroller: HTMLElement | null = null;

    const reset = () => {
      if (t) clearTimeout(t.timer);
      t = null;
      cancelAnimationFrame(frame);
      root.removeAttribute('data-page-lift');
      setDrag(null);
    };
    const update = () => {
      if (!t?.lifted) return;
      const list = measure(view);
      const content = el.getBoundingClientRect();
      t.drop = t.moved ? dropAt(list, t.index, t.x, t.y, content.left, content.right) : null;
      setBoxes(list);
      setDrag({ index: t.index, drop: t.drop });
    };
    // 든 채로 가장자리에 머물면 계속 스크롤
    const tickScroll = () => {
      frame = requestAnimationFrame(tickScroll);
      if (!t?.lifted || !scroller) return;
      const r = scroller.getBoundingClientRect();
      const top = Math.max(r.top, 0);
      const bottom = Math.min(r.bottom, window.innerHeight);
      const dy = t.y < top + EDGE ? -(top + EDGE - t.y) / 4 : t.y > bottom - EDGE ? (t.y - bottom + EDGE) / 4 : 0;
      if (!dy) return;
      scroller.scrollTop += dy;
      update();
    };

    const start = (e: TouchEvent) => {
      reset();
      const p = e.touches[0];
      if (e.touches.length !== 1 || !p) return;
      const list = measure(view);
      const index = list.findIndex((b) => p.clientY >= b.top && p.clientY <= b.bottom);
      const block = list[index]?.block;
      if (!block) return;
      // 커서가 있는 블록은 길게 눌러 글자를 고른다
      const sel = view.state.selection.main;
      if (view.hasFocus && sel.to >= block.from && sel.from <= block.to) return;
      root.setAttribute('data-page-lift', 'armed');
      const timer = window.setTimeout(() => {
        if (!t) return;
        t.lifted = true;
        t.lx = t.x;
        t.ly = t.y;
        root.setAttribute('data-page-lift', 'lifted');
        scroller = scrollParent(root);
        navigator.vibrate?.(10);
        update();
        frame = requestAnimationFrame(tickScroll);
      }, LIFT_MS);
      t = { index, x: p.clientX, y: p.clientY, lx: p.clientX, ly: p.clientY, timer, lifted: false, moved: false, drop: null };
    };
    const move = (e: TouchEvent) => {
      const p = e.touches[0];
      if (!t || !p) return;
      t.x = p.clientX;
      t.y = p.clientY;
      if (!t.lifted) {
        if (Math.hypot(t.x - t.lx, t.y - t.ly) > SLOP) reset();
        return;
      }
      e.preventDefault();
      if (!t.moved && Math.hypot(t.x - t.lx, t.y - t.ly) < SLOP) return;
      t.moved = true;
      update();
    };
    const end = (e: TouchEvent) => {
      const cur = t;
      if (!cur?.lifted) {
        reset();
        return;
      }
      // 손을 뗀 뒤 커서가 생기거나 키보드가 뜨지 않게
      if (e.cancelable) e.preventDefault();
      reset();
      if (e.type === 'touchcancel') return;
      if (cur.moved) {
        if (cur.drop) applyDrop(view, cur.index, cur.drop);
        return;
      }
      const b = measure(view)[cur.index];
      if (b) menu.current(cur.index, b.block, { x: cur.x, y: cur.y });
    };
    // 누르고 있는 동안 기본 길게 누르기(글자 선택·메뉴)를 막는다
    const block = (e: Event) => {
      if (t) e.preventDefault();
    };
    el.addEventListener('touchstart', start, { passive: true });
    el.addEventListener('touchmove', move, { passive: false });
    el.addEventListener('touchend', end);
    el.addEventListener('touchcancel', end);
    el.addEventListener('contextmenu', block, true);
    el.addEventListener('selectstart', block);
    return () => {
      reset();
      el.removeEventListener('touchstart', start);
      el.removeEventListener('touchmove', move);
      el.removeEventListener('touchend', end);
      el.removeEventListener('touchcancel', end);
      el.removeEventListener('contextmenu', block, true);
      el.removeEventListener('selectstart', block);
    };
  }, [touch, locked, view, wrap]);

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

  const lifted = touch && drag ? boxes[drag.index] : undefined;
  const liftedBox = lifted && view.contentDOM.getBoundingClientRect();

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
      {!touch && boxes.map((b, i) => (
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
          style={{ top: b.mid - origin.top - 12, height: 24 }}
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
