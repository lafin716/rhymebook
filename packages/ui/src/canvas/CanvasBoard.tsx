import {
  addStroke,
  compactPoints,
  eraseStrokesAt,
  newId,
  raiseCanvasItem,
  updateCanvasItem,
  type CanvasDoc,
  type CanvasItem,
  type CanvasRect,
  type CanvasTool,
  type ID,
} from '@branch/core';
import { memo, useEffect, useMemo, useRef, useState, type PointerEvent, type RefObject } from 'react';
import { Markdown } from '../chat/Markdown';
import { cn } from '../lib/cn';
import type { CanvasToolId } from './CanvasToolbar';
import { strokePath } from './strokePath';
import { clampZoom, toWorld, zoomAt, type CanvasView } from './view';

/** 지우개 반경 (캔버스 px) */
const ERASER_RADIUS = 12;
/** 항목 크기 조절 최소·형광펜 색 투명도 */
const MARKER_OPACITY = 0.35;
/** 휠·트랙패드 스크롤이 멈추고 이만큼 지나면 쪽에 맞춘다 (ms) */
const WHEEL_SETTLE_MS = 160;

/**
 * 진행 중인 손동작. 움직이는 동안은 `doc`(미리보기)만 바뀌고, 손을 떼면 한 번에 `onCommit`한다.
 * 펜·지우개·항목 이동을 한 동작마다 실행 취소 한 칸으로 묶는다.
 */
type Gesture =
  | { kind: 'draw'; pointerId: number; origin: CanvasDoc; tool: CanvasTool; color: string; size: number; points: number[] }
  | { kind: 'erase'; pointerId: number; origin: CanvasDoc; doc: CanvasDoc }
  | { kind: 'move' | 'resize'; pointerId: number; origin: CanvasDoc; doc: CanvasDoc; item: CanvasItem; startX: number; startY: number }
  | { kind: 'pan'; pointerId: number; lastX: number; lastY: number }
  | { kind: 'pinch'; startView: CanvasView; startDist: number; startMid: { x: number; y: number } };

interface Live {
  tool: CanvasTool;
  color: string;
  size: number;
  points: number[];
}

export interface CanvasBoardProps {
  doc: CanvasDoc;
  view: CanvasView;
  onView(next: (v: CanvasView) => CanvasView): void;
  tool: CanvasToolId;
  color: string;
  /** 현재 굵기 (펜·형광펜 단계에 따른 px) */
  size: number;
  selectedId: ID | null;
  onSelect(id: ID | null): void;
  onCommit(next: CanvasDoc): void;
  boardRef: RefObject<HTMLDivElement | null>;
  /** 쪽 나눔 판의 쪽 사각형들 (자유 판이면 빈 배열) */
  pages: readonly CanvasRect[];
  /** 화면 이동·확대·스크롤이 끝났을 때 — 쪽 나눔 판은 여기서 쪽을 넘기거나 제자리에 맞춘다 */
  onSettle?(): void;
  /** 쪽 넘김처럼 화면을 부드럽게 옮길 때 */
  animate?: boolean;
}

const CURSOR: Record<CanvasToolId, string> = { select: 'cursor-default', pen: 'cursor-crosshair', marker: 'cursor-crosshair', eraser: 'cursor-cell' };

const local = (el: HTMLDivElement | null, clientX: number, clientY: number) => {
  const r = el?.getBoundingClientRect();
  return { x: clientX - (r?.left ?? 0), y: clientY - (r?.top ?? 0) };
};

/** 빠르게 움직일 때 브라우저가 합친 중간 점까지 받는다 */
const coalesced = (e: PointerEvent<HTMLDivElement>): globalThis.PointerEvent[] => {
  const list = e.nativeEvent.getCoalescedEvents?.() ?? [];
  return list.length ? list : [e.nativeEvent];
};

/**
 * 캔버스 판. 펜·형광펜·지우개·선택(이동·크기·앞으로)·화면 이동·확대를 포인터 이벤트로 처리한다.
 * 손바닥 거부: 펜이 닿아 있으면 터치는 무시하고, 펜을 한 번이라도 쓴 뒤에는 터치가 화면을 옮긴다.
 */
export function CanvasBoard({ doc, view, onView, tool, color, size, selectedId, onSelect, onCommit, boardRef, pages, onSettle, animate }: CanvasBoardProps) {
  const [preview, setPreview] = useState<CanvasDoc | null>(null);
  const [live, setLive] = useState<Live | null>(null);
  const [gesture, setGesture] = useState<Gesture | null>(null);
  const shown = preview ?? doc;

  // 다른 손동작 상태는 ref로 두고, 렌더에 필요한 것만 state로 둔다
  const pointers = useMemo(() => new Map<number, { type: string; x: number; y: number }>(), []);
  const penSeen = useMemo(() => ({ current: false }), []);
  const gestureRef = useMemo<{ current: Gesture | null }>(() => ({ current: null }), []);
  const setG = (g: Gesture | null) => {
    gestureRef.current = g;
    setGesture(g);
  };
  const liveFrame = useRef(0);
  const cancelLive = () => {
    if (liveFrame.current) cancelAnimationFrame(liveFrame.current);
    liveFrame.current = 0;
  };
  useEffect(() => () => cancelAnimationFrame(liveFrame.current), []);
  const settleRef = useRef(onSettle);
  useEffect(() => {
    settleRef.current = onSettle;
  });

  // 휠: 그냥 굴리면 화면 이동, Ctrl/⌘+휠(트랙패드 핀치 포함)은 확대·축소. 브라우저 확대는 막는다
  useEffect(() => {
    const el = boardRef.current;
    if (!el) return;
    let settle: ReturnType<typeof setTimeout> | undefined;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const sx = e.clientX - r.left;
      const sy = e.clientY - r.top;
      if (e.ctrlKey || e.metaKey) {
        const f = Math.exp(-e.deltaY * 0.01);
        onView((v) => zoomAt(v, sx, sy, v.k * f));
      } else {
        onView((v) => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }));
      }
      clearTimeout(settle);
      settle = setTimeout(() => settleRef.current?.(), WHEEL_SETTLE_MS);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      clearTimeout(settle);
      el.removeEventListener('wheel', onWheel);
    };
  }, [boardRef, onView]);

  const startPinch = () => {
    const touches = [...pointers.values()].filter((q) => q.type === 'touch');
    const [a, b] = touches;
    if (!a || !b) return;
    setLive(null);
    setPreview(null);
    setG({
      kind: 'pinch',
      startView: view,
      startDist: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
      startMid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
    });
  };

  const onDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 && e.button !== 1) return;
    if (e.pointerType === 'pen') {
      penSeen.current = true;
      // 펜보다 먼저 닿은 손바닥의 획·확대는 버리고 펜이 이어받는다
      const g0 = gestureRef.current;
      if (g0 && (g0.kind === 'pinch' || pointers.get(g0.pointerId)?.type === 'touch')) {
        for (const [id, q] of pointers) if (q.type === 'touch') pointers.delete(id);
        cancelLive();
        setG(null);
        setLive(null);
        setPreview(null);
      }
    }
    const penDown = [...pointers.values()].some((q) => q.type === 'pen');
    // 손바닥 거부: 펜이 닿아 있는 동안 들어온 터치는 버린다
    if (e.pointerType === 'touch' && penDown) return;
    const p = local(boardRef.current, e.clientX, e.clientY);
    pointers.set(e.pointerId, { type: e.pointerType, x: p.x, y: p.y });
    e.currentTarget.setPointerCapture(e.pointerId);

    if (e.pointerType === 'touch' && [...pointers.values()].filter((q) => q.type === 'touch').length === 2) {
      startPinch();
      return;
    }
    if (gestureRef.current) return;

    const w = toWorld(view, p.x, p.y);
    const panHere = e.button === 1 || (e.pointerType === 'touch' && penSeen.current && tool !== 'select');
    if (panHere) {
      setG({ kind: 'pan', pointerId: e.pointerId, lastX: p.x, lastY: p.y });
      return;
    }

    if (tool === 'select') {
      const target = e.target as HTMLElement;
      const id = target.closest<HTMLElement>('[data-canvas-item]')?.dataset.canvasItem;
      const item = id ? doc.items.find((it) => it.id === id) : undefined;
      if (!item) {
        onSelect(null);
        setG({ kind: 'pan', pointerId: e.pointerId, lastX: p.x, lastY: p.y });
        return;
      }
      // 고른 항목은 맨 위로 올린다 (실행 취소 한 칸에 포함)
      const raised = raiseCanvasItem(doc, item.id);
      onSelect(item.id);
      setPreview(raised === doc ? null : raised);
      setG({
        kind: target.closest('[data-canvas-resize]') ? 'resize' : 'move',
        pointerId: e.pointerId,
        origin: doc,
        doc: raised,
        item,
        startX: w.x,
        startY: w.y,
      });
      return;
    }

    if (tool === 'eraser') {
      const next = eraseStrokesAt(doc, w.x, w.y, ERASER_RADIUS);
      setPreview(next === doc ? null : next);
      setG({ kind: 'erase', pointerId: e.pointerId, origin: doc, doc: next });
      return;
    }

    setLive({ tool, color, size, points: [w.x, w.y, e.pressure || 0.5] });
    setG({ kind: 'draw', pointerId: e.pointerId, origin: doc, tool, color, size, points: [w.x, w.y, e.pressure || 0.5] });
  };

  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    const q = pointers.get(e.pointerId);
    if (!q) return;
    const p = local(boardRef.current, e.clientX, e.clientY);
    q.x = p.x;
    q.y = p.y;
    const g = gestureRef.current;
    if (!g) return;

    if (g.kind === 'pinch') {
      const [a, b] = [...pointers.values()].filter((t) => t.type === 'touch');
      if (!a || !b) return;
      const dist = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const k = clampZoom(g.startView.k * (dist / g.startDist));
      // 처음 두 손가락 가운데의 캔버스 점을 지금 가운데에 붙인다 — 확대와 이동을 같이 한다
      const wm = toWorld(g.startView, g.startMid.x, g.startMid.y);
      onView(() => ({ k, x: mid.x - wm.x * k, y: mid.y - wm.y * k }));
      return;
    }
    if (g.pointerId !== e.pointerId) return;

    if (g.kind === 'pan') {
      const dx = p.x - g.lastX;
      const dy = p.y - g.lastY;
      g.lastX = p.x;
      g.lastY = p.y;
      onView((v) => ({ ...v, x: v.x + dx, y: v.y + dy }));
    } else if (g.kind === 'draw') {
      for (const ev of coalesced(e)) {
        const r = boardRef.current?.getBoundingClientRect();
        if (!r) continue;
        const w = toWorld(view, ev.clientX - r.left, ev.clientY - r.top);
        g.points.push(w.x, w.y, ev.pressure || 0.5);
      }
      // 그리는 중 획은 화면 한 장(rAF)에 한 번만 다시 그린다
      if (!liveFrame.current) {
        liveFrame.current = requestAnimationFrame(() => {
          liveFrame.current = 0;
          const cur = gestureRef.current;
          if (cur?.kind === 'draw') setLive({ tool: cur.tool, color: cur.color, size: cur.size, points: cur.points.slice() });
        });
      }
    } else if (g.kind === 'erase') {
      const w = toWorld(view, p.x, p.y);
      const next = eraseStrokesAt(g.doc, w.x, w.y, ERASER_RADIUS);
      if (next !== g.doc) {
        g.doc = next;
        setPreview(next);
      }
    } else {
      const w = toWorld(view, p.x, p.y);
      const dx = w.x - g.startX;
      const dy = w.y - g.startY;
      const patch =
        g.kind === 'move'
          ? { x: g.item.x + dx, y: g.item.y + dy }
          : g.item.type === 'image'
            ? // 그림은 가로세로 비율을 지킨다
              (() => {
                const s = Math.max((g.item.w + dx) / g.item.w, 0.01);
                return { w: g.item.w * s, h: g.item.h * s };
              })()
            : { w: g.item.w + dx, h: g.item.h + dy };
      g.doc = updateCanvasItem(g.doc, g.item.id, patch);
      setPreview(g.doc);
    }
  };

  const onUp = (e: PointerEvent<HTMLDivElement>) => {
    pointers.delete(e.pointerId);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    const g = gestureRef.current;
    if (!g) return;
    if (g.kind === 'pinch') {
      // 두 손가락 중 하나라도 떼면 확대 동작은 끝난다
      if ([...pointers.values()].filter((t) => t.type === 'touch').length < 2) {
        setG(null);
        onSettle?.();
      }
      return;
    }
    if (g.pointerId !== e.pointerId) return;
    cancelLive();
    setG(null);
    setLive(null);
    setPreview(null);
    if (g.kind === 'pan') {
      onSettle?.();
      return;
    }
    if (g.kind === 'draw') {
      if (g.points.length >= 6) {
        onCommit(addStroke(g.origin, { id: newId('s'), tool: g.tool, color: g.color, size: g.size, points: compactPoints(g.points) }));
      }
      return;
    }
    if (g.doc !== g.origin) onCommit(g.doc);
  };

  const cursor = CURSOR[tool];
  const strokeNodes = useMemo(
    () =>
      shown.strokes.map((s) => (
        <path
          key={s.id}
          d={strokePath(s)}
          fill={s.color}
          opacity={s.tool === 'marker' ? MARKER_OPACITY : 1}
          style={s.tool === 'marker' ? { mixBlendMode: 'multiply' } : undefined}
        />
      )),
    [shown.strokes],
  );

  return (
    <div
      ref={boardRef}
      data-canvas-board=""
      data-tool={tool}
      role="application"
      aria-label="캔버스 그림판"
      data-paged={pages.length ? '' : undefined}
      className={cn('relative min-h-0 flex-1 touch-none select-none overflow-hidden', pages.length ? 'bg-[#e6e2d9]' : 'bg-[#fbf9f4]', cursor)}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
    >
      <div
        className={cn('absolute top-0 left-0 origin-top-left', animate && 'transition-transform duration-200 ease-out')}
        style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})` }}
      >
        {pages.map((r, i) => (
          <div
            key={i}
            data-canvas-page={i}
            aria-hidden
            className="absolute bg-[#fbf9f4] shadow-[0_1px_6px_rgba(0,0,0,0.18)]"
            style={{ left: r.x, top: r.y, width: r.w, height: r.h }}
          />
        ))}
        {shown.items.map((item) => (
          <ItemView key={item.id} item={item} selected={item.id === selectedId} movable={tool === 'select'} k={view.k} />
        ))}
        <svg aria-hidden className="pointer-events-none absolute top-0 left-0 overflow-visible" width={1} height={1}>
          {strokeNodes}
          {live && (
            <path
              d={strokePath({ tool: live.tool, size: live.size, points: live.points })}
              fill={live.color}
              opacity={live.tool === 'marker' ? MARKER_OPACITY : 1}
              style={live.tool === 'marker' ? { mixBlendMode: 'multiply' } : undefined}
            />
          )}
        </svg>
      </div>
      {gesture?.kind === 'pinch' && <span className="sr-only">확대·이동 중</span>}
    </div>
  );
}

/** 항목 한 장: 그림은 이미지, 글 카드는 제목과 마크다운 본문. 선택하면 테두리와 크기 조절 손잡이가 보인다 */
const ItemView = memo(function ItemView({ item, selected, movable, k }: { item: CanvasItem; selected: boolean; movable: boolean; k: number }) {
  const box = { left: item.x, top: item.y, width: item.w, height: item.h };
  const handle = selected && (
    <span
      data-canvas-resize=""
      aria-label="크기 조절"
      className="absolute cursor-nwse-resize rounded-full bg-accent"
      style={{ width: 12 / k, height: 12 / k, right: -6 / k, bottom: -6 / k }}
    />
  );
  const frame = cn('absolute', movable && 'cursor-move', selected && 'outline-2 outline-offset-2 outline-accent outline-solid');
  if (item.type === 'image') {
    return (
      <div data-canvas-item={item.id} data-selected={selected || undefined} role="img" aria-label={item.name ?? '가져온 이미지'} className={frame} style={box}>
        <img src={item.src} alt="" draggable={false} className="pointer-events-none size-full object-contain" />
        {handle}
      </div>
    );
  }
  return (
    <div data-canvas-item={item.id} data-selected={selected || undefined} role="article" aria-label={item.title} className={frame} style={box}>
      <div className="flex size-full flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-sm">
        <div className="shrink-0 truncate border-b border-line px-3 py-1.5 text-[13px] font-semibold">{item.title}</div>
        <div className="min-h-0 flex-1 overflow-hidden px-3 py-2 text-[14px]">
          <Markdown content={item.text} />
        </div>
      </div>
      {handle}
    </div>
  );
});
