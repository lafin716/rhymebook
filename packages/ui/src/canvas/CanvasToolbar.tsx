import type { CanvasPenNib } from '@branch/core';
import { Brush, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Eraser, GripVertical, Highlighter, Import, Maximize2, Minimize2, MousePointer2, Maximize, Pen, Pencil, PenTool, Pipette, Presentation, Redo2, Settings2, Star, Trash2, Undo2 } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../lib/cn';
import { strokeOpacity, strokePath } from './strokePath';
import { hexToRgb, hsvToHex, rgbToHex, rgbToHsv, type Hsv } from './colorMath';
import { clampStroke, isHex, MAX_FAVORITE_INKS, STROKE_RANGE, type StrokeKind, type ToolbarDock } from './canvasPrefs';

export type CanvasToolId = 'select' | 'pen' | 'marker' | 'eraser';

export const INK_COLORS: { label: string; hex: string }[] = [
  { label: '검정', hex: '#1f2937' },
  { label: '흰색', hex: '#ffffff' },
  { label: '빨강', hex: '#dc2626' },
  { label: '파랑', hex: '#2563eb' },
  { label: '초록', hex: '#16a34a' },
  { label: '노랑', hex: '#facc15' },
  { label: '보라', hex: '#7c3aed' },
];

export const PEN_NIBS: { nib: CanvasPenNib; label: string; hint: string; icon: (size: number) => ReactNode }[] = [
  { nib: 'fountain', label: '만년필', hint: '누르는 힘에 따라 굵기가 변해요', icon: (n) => <PenTool size={n} /> },
  { nib: 'ballpoint', label: '볼펜', hint: '고른 굵기로 또박또박', icon: (n) => <Pen size={n} /> },
  { nib: 'brush', label: '붓펜', hint: '굵기가 크게 변하고 끝이 가늘어요', icon: (n) => <Brush size={n} /> },
  { nib: 'pencil', label: '연필', hint: '가늘고 조금 흐리게', icon: (n) => <Pencil size={n} /> },
];

const TOOLS: { id: CanvasToolId; label: string; icon: ReactNode }[] = [
  { id: 'select', label: '선택/이동', icon: <MousePointer2 size={18} /> },
  { id: 'pen', label: '펜', icon: <PenTool size={18} /> },
  { id: 'marker', label: '형광펜', icon: <Highlighter size={18} /> },
  { id: 'eraser', label: '지우개', icon: <Eraser size={18} /> },
];

/** 터치 기준 44px, 태블릿 이상은 36px */
const BTN = 'grid size-11 shrink-0 place-items-center rounded-lg text-fg-2 hover:bg-surface-2 hover:text-fg disabled:opacity-40 md:size-9';
const SMALL_BTN = 'h-11 rounded-lg px-3 text-[13px] md:h-8';

export interface CanvasToolbarProps {
  tool: CanvasToolId;
  onTool(tool: CanvasToolId): void;
  color: string;
  onColor(hex: string): void;
  /** 펜·형광펜 굵기 (캔버스 px) */
  sizes: Record<StrokeKind, number>;
  onSize(kind: StrokeKind, size: number): void;
  /** 펜 종류 */
  nib: CanvasPenNib;
  onNib(nib: CanvasPenNib): void;
  favorites: string[];
  onToggleFavorite(hex: string): void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo(): void;
  onRedo(): void;
  onFit(): void;
  /** 자유 판은 '전체 보기', 쪽 나눔은 '쪽 맞춤' */
  fitLabel: string;
  onSettings(): void;
  onImport(): void;
  hasSelection: boolean;
  onDeleteSelected(): void;
  /** 전체 화면 상태 */
  panelFull: boolean;
  onPanelFull(full: boolean): void;
  /** 발표 중 상태 */
  presenting: boolean;
  onPresent(): void;
  /** 팔레트 펼침 상태 */
  paletteOpen: boolean;
  onPaletteOpen(open: boolean): void;
  /** 팔레트에 한 번에 보일 색 개수 (null = 모두) */
  paletteCount: number | null;
  /** 도구 막대 도킹 위치 */
  toolbarDock: ToolbarDock;
  onToolbarDock(dock: ToolbarDock): void;
  /** 브라우저 스포이드(EyeDropper)가 없을 때: 판을 한 번 눌러 그 자리 색을 따오는 모드로 */
  onEyeDropBoard(): void;
}

type Pop = { kind: 'size'; tool: StrokeKind; el: HTMLElement } | { kind: 'color'; el: HTMLElement } | { kind: 'overflow'; el: HTMLElement };

export function CanvasToolbar(p: CanvasToolbarProps) {
  const drawing = p.tool === 'pen' || p.tool === 'marker';
  const [pop, setPop] = useState<Pop | null>(null);
  const [dragHandle, setDragHandle] = useState(false);
  const [dockPreview, setDockPreview] = useState<{ dock: ToolbarDock; rect: DOMRect } | null>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);
  const known = INK_COLORS.some((c) => c.hex === p.color) || p.favorites.includes(p.color);
  const isVertical = p.toolbarDock === 'left' || p.toolbarDock === 'right';

  const penNib = PEN_NIBS.find((n) => n.nib === p.nib) ?? PEN_NIBS[0]!;

  // 팔레트: 기본 색 다음에 즐겨찾는 색. 개수를 넘는 색은 '더 많은 색'에 넣되, 지금 고른 색은 늘 보인다
  const swatches = [
    ...INK_COLORS.map((c) => ({ hex: c.hex, label: `${c.label} 색`, favorite: false })),
    ...p.favorites.filter((hex) => !INK_COLORS.some((c) => c.hex === hex)).map((hex) => ({ hex, label: `즐겨찾는 색 ${hex}`, favorite: true })),
  ];
  const limit = Math.min(p.paletteCount ?? swatches.length, swatches.length);
  const shownSwatches = swatches.filter((s, i) => i < limit || s.hex === p.color);
  const moreSwatches = swatches.filter((s, i) => i >= limit && s.hex !== p.color);

  // C4: 도킹 핸들 끌기 — 가장 가까운 가장자리에 도킹
  useEffect(() => {
    if (!dragHandle || !dragStartRef.current) return;

    const startPos = dragStartRef.current;

    const nearestDock = (e: PointerEvent) => {
      const panel = toolbarRef.current?.closest('[data-canvas]') as HTMLElement | null;
      if (!panel) return null;
      const r = panel.getBoundingClientRect();
      const d: [ToolbarDock, number][] = [
        ['top', Math.abs(e.clientY - r.top)],
        ['bottom', Math.abs(r.bottom - e.clientY)],
        ['left', Math.abs(e.clientX - r.left)],
        ['right', Math.abs(r.right - e.clientX)],
      ];
      return { dock: d.sort((a, b) => a[1] - b[1])[0]![0], rect: r };
    };

    const onPointerMove = (e: PointerEvent) => {
      const dx = e.clientX - startPos.x;
      const dy = e.clientY - startPos.y;
      setDockPreview(Math.hypot(dx, dy) > 20 ? nearestDock(e) : null);
    };

    const onPointerUp = (e: PointerEvent) => {
      if (!toolbarRef.current) return;
      const dx = e.clientX - startPos.x;
      const dy = e.clientY - startPos.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      // 20px 넘게 끌었으면 손을 뗀 자리에서 가장 가까운 가장자리에 붙인다
      if (dist > 20) {
        const near = nearestDock(e);
        if (near) p.onToolbarDock(near.dock);
      }

      setDragHandle(false);
      setDockPreview(null);
      dragStartRef.current = null;
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
    return () => {
      window.removeEventListener('pointercancel', onPointerUp);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
    };
  }, [dragHandle, p]);

  /** 처음 누르면 도구만 고른다. 이미 고른 펜·형광펜을 다시 누르면 세부 조정 창을 열고 닫는다 */
  const pickTool = (id: CanvasToolId, el: HTMLElement) => {
    if ((id === 'pen' || id === 'marker') && p.tool === id) {
      const open = pop?.kind === 'size' && pop.tool === id;
      setPop(open ? null : { kind: 'size', tool: id, el });
      return;
    }
    setPop(null);
    p.onTool(id);
  };

  return (
    <div
      ref={toolbarRef}
      role="toolbar"
      aria-label="캔버스 도구"
      data-canvas-toolbar=""
      data-dock={p.toolbarDock}
      className={cn(
        'flex items-center gap-0.5 bg-surface px-2 py-1 [scrollbar-width:none] [&>*]:shrink-0',
        isVertical
          ? cn('flex-col justify-center-safe overflow-y-auto', p.toolbarDock === 'left' ? 'border-r border-line' : 'border-l border-line')
          : cn('flex-row overflow-x-auto md:flex-wrap md:overflow-visible', p.toolbarDock === 'bottom' ? 'border-t border-line pb-[max(0.25rem,env(safe-area-inset-bottom))]' : 'border-b border-line')
      )}
    >
      {/* 도킹 핸들 */}
      <button
        type="button"
        aria-label="도구 막대 위치 변경"
        title="끌어서 도구 막대를 다시 배치하세요"
        onPointerDown={(e) => {
          dragStartRef.current = { x: e.clientX, y: e.clientY };
          setDragHandle(true);
        }}
        className={cn(BTN, dragHandle && 'bg-surface-2')}
        data-canvas-dock-handle=""
        style={{ touchAction: 'none' }}
      >
        <GripVertical size={18} />
      </button>

      {TOOLS.map((t) => (
        <button
          key={t.id}
          type="button"
          aria-label={t.label}
          aria-pressed={p.tool === t.id}
          aria-haspopup={t.id === 'pen' || t.id === 'marker' ? 'dialog' : undefined}
          title={
            t.id === 'pen' ? `펜 (${penNib.label}) · 다시 누르면 종류·굵기` : t.id === 'marker' ? '형광펜 · 다시 누르면 굵기' : t.label
          }
          onClick={(e) => pickTool(t.id, e.currentTarget)}
          className={cn(BTN, 'relative', p.tool === t.id && 'bg-accent-soft text-accent hover:bg-accent-soft hover:text-accent')}
          data-canvas-tool={t.id}
          data-canvas-nib={t.id === 'pen' ? p.nib : undefined}
        >
          {t.id === 'pen' ? penNib.icon(18) : t.icon}
          {(t.id === 'pen' || t.id === 'marker') && (
            <span className="absolute right-1 bottom-1 text-[9px] leading-none tabular-nums opacity-70" aria-hidden>
              {p.sizes[t.id]}
            </span>
          )}
        </button>
      ))}
      <span className={cn('shrink-0 self-center bg-line', isVertical ? 'my-1 h-px w-6' : 'mx-1 h-6 w-px')} aria-hidden />

      {/* 팔레트: 색들(밀려 열리고 닫힘) · 직접 고르기 · 접기/펼치기 토글. 세로 막대에서는 위아래로 쌓고 토글은 맨 아래 */}
      <div className={cn('flex items-center gap-0.5', isVertical && 'flex-col', !drawing && 'opacity-40')} role="group" aria-label="색" data-canvas-palette="">
        <Slide open={p.paletteOpen} vertical={isVertical}>
          {shownSwatches.map((c) => (
            <Swatch key={c.hex} hex={c.hex} label={c.label} active={p.color === c.hex} onClick={() => p.onColor(c.hex)} favorite={c.favorite} />
          ))}
          {/* 더 보기: 초과된 색들을 위한 버튼 */}
          {moreSwatches.length > 0 && (
            <button
              type="button"
              aria-label="더 많은 색"
              title="더 많은 색"
              onClick={(e) => setPop(pop?.kind === 'overflow' ? null : { kind: 'overflow', el: e.currentTarget })}
              className={cn(BTN, 'text-fg-2')}
              data-canvas-overflow-colors=""
            >
              ⋯
            </button>
          )}
        </Slide>

        {/* 직접 고르기: 무지개 테두리 안에 지금 색 — 팔레트를 접어도 지금 색이 보인다 */}
        <button
          type="button"
          aria-label="색 직접 고르기"
          title="색 직접 고르기 · 즐겨찾기"
          aria-haspopup="dialog"
          aria-expanded={pop?.kind === 'color'}
          onClick={(e) => setPop(pop?.kind === 'color' ? null : { kind: 'color', el: e.currentTarget })}
          className="grid size-11 shrink-0 place-items-center md:size-8"
          data-canvas-color-custom=""
        >
          <span
            className={cn('grid size-6 place-items-center rounded-full', !known && 'ring-2 ring-accent ring-offset-2 ring-offset-surface')}
            style={{ background: 'conic-gradient(#ef4444, #f59e0b, #84cc16, #06b6d4, #6366f1, #d946ef, #ef4444)' }}
          >
            <span className="size-3.5 rounded-full border border-surface" style={{ backgroundColor: p.color }} />
          </span>
        </button>

        <button
          type="button"
          aria-label={p.paletteOpen ? '색 팔레트 접기' : '색 팔레트 펼치기'}
          title={p.paletteOpen ? '색 팔레트 접기' : '색 팔레트 펼치기'}
          aria-expanded={p.paletteOpen}
          onClick={() => p.onPaletteOpen(!p.paletteOpen)}
          className={cn(BTN, 'md:h-8 md:w-6', isVertical && 'md:h-6 md:w-9')}
          data-canvas-palette-toggle=""
        >
          {isVertical ? (
            p.paletteOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />
          ) : p.paletteOpen ? (
            <ChevronLeft size={16} />
          ) : (
            <ChevronRight size={16} />
          )}
        </button>
      </div>

      <span className={cn('shrink-0 self-center bg-line', isVertical ? 'my-1 h-px w-6' : 'mx-1 h-6 w-px')} aria-hidden />
      <button type="button" aria-label="실행 취소" title="실행 취소 (⌘Z)" disabled={!p.canUndo} onClick={p.onUndo} className={BTN}>
        <Undo2 size={18} />
      </button>
      <button type="button" aria-label="다시 실행" title="다시 실행 (⌘⇧Z)" disabled={!p.canRedo} onClick={p.onRedo} className={BTN}>
        <Redo2 size={18} />
      </button>
      <button type="button" aria-label={p.fitLabel} title={p.fitLabel} onClick={p.onFit} className={BTN}>
        <Maximize size={18} />
      </button>
      <button type="button" aria-label="캔버스 설정" title="캔버스 설정" onClick={p.onSettings} className={BTN} data-canvas-settings-open="">
        <Settings2 size={18} />
      </button>
      {p.hasSelection && (
        <button type="button" aria-label="선택 항목 지우기" title="선택 항목 지우기 (Delete)" onClick={p.onDeleteSelected} className={cn(BTN, 'text-danger hover:text-danger')}>
          <Trash2 size={18} />
        </button>
      )}

      {/* 발표 · 전체 화면 · 가져오기는 한 묶음으로 끝에 (줄이 넘쳐도 함께 다닌다) */}
      <div
        className={cn(
          'flex shrink-0 items-center gap-0.5',
          isVertical
            ? 'flex-col'
            : 'sticky right-0 ml-auto bg-surface shadow-[-8px_0_8px_-4px_var(--color-surface)] md:static md:shadow-none',
        )}
      >
        <span className={cn('shrink-0 self-center bg-line', isVertical ? 'my-1 h-px w-6' : 'mx-1 h-6 w-px')} aria-hidden />
        <button type="button" aria-label="발표" title="발표" onClick={p.onPresent} className={BTN} data-canvas-present="">
          <Presentation size={18} />
        </button>
        <button
          type="button"
          aria-label={p.panelFull ? '전체 화면 끝내기' : '전체 화면'}
          title={p.panelFull ? '전체 화면 끝내기' : '전체 화면'}
          onClick={() => p.onPanelFull(!p.panelFull)}
          className={BTN}
          data-panel-full=""
        >
          {p.panelFull ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
        </button>
        <button type="button" aria-label="가져오기" title="가져오기" onClick={p.onImport} className={BTN} data-canvas-import="">
          <Import size={18} />
        </button>
      </div>
      {pop?.kind === 'size' && (
        <Popover anchor={pop.el} label={pop.tool === 'pen' ? '펜 설정' : '형광펜 굵기'} onClose={() => setPop(null)} isVertical={isVertical}>
          {pop.tool === 'pen' && <NibPicker nib={p.nib} onNib={p.onNib} />}
          <SizeEditor kind={pop.tool} size={p.sizes[pop.tool]} color={p.color} nib={pop.tool === 'pen' ? p.nib : undefined} onSize={(n) => p.onSize(pop.tool, n)} />
        </Popover>
      )}
      {pop?.kind === 'color' && (
        <Popover anchor={pop.el} label="색 고르기" onClose={() => setPop(null)} isVertical={isVertical}>
          <ColorEditor
            color={p.color}
            onColor={p.onColor}
            favorites={p.favorites}
            onToggleFavorite={p.onToggleFavorite}
            onEyeDropBoard={() => {
              setPop(null);
              p.onEyeDropBoard();
            }}
          />
        </Popover>
      )}
      {pop?.kind === 'overflow' && (
        <Popover anchor={pop.el} label="더 많은 색" onClose={() => setPop(null)} isVertical={isVertical}>
          <div className="flex flex-wrap gap-1" role="group" aria-label="더 많은 색">
            {moreSwatches.map((c) => (
              <button
                key={c.hex}
                type="button"
                aria-label={c.label}
                title={c.label}
                onClick={() => {
                  p.onColor(c.hex);
                  setPop(null);
                }}
                className="relative size-9 rounded-full border border-black/15"
                style={{ backgroundColor: c.hex }}
                data-canvas-ink={c.hex}
              >
                {c.favorite && <Star size={8} className="absolute top-0.5 right-0.5 fill-current text-amber-500" aria-hidden />}
              </button>
            ))}
          </div>
        </Popover>
      )}
      {dockPreview &&
        createPortal(
          <div
            aria-hidden
            data-canvas-dock-preview={dockPreview.dock}
            className="pointer-events-none fixed z-50 rounded-lg bg-accent/25 ring-2 ring-accent"
            style={dockPreviewStyle(dockPreview.dock, dockPreview.rect)}
          />,
          document.body,
        )}
    </div>
  );
}

/** 끌고 있는 도구 막대가 붙을 가장자리 미리보기 */
function dockPreviewStyle(dock: ToolbarDock, r: DOMRect): CSSProperties {
  const t = 48;
  if (dock === 'top') return { left: r.left, top: r.top, width: r.width, height: t };
  if (dock === 'bottom') return { left: r.left, top: r.bottom - t, width: r.width, height: t };
  if (dock === 'left') return { left: r.left, top: r.top, width: t, height: r.height };
  return { left: r.right - t, top: r.top, width: t, height: r.height };
}

const SLIDE_MS = 200;

/**
 * 팔레트 색들을 토글 쪽으로 밀어 넣고 꺼내는 칸. grid 0fr↔1fr 전환으로 실제 크기까지 함께 줄어든다.
 * 다 닫히면 내용을 빼서(접힌 팔레트에는 색 버튼이 없다) 탭 이동·읽기 대상에서도 빠진다.
 */
function Slide({ open, vertical, children }: { open: boolean; vertical: boolean; children: ReactNode }) {
  const [mounted, setMounted] = useState(open);
  const [shown, setShown] = useState(open);
  useEffect(() => {
    if (open) {
      setMounted(true);
      // 0fr로 한 번 그린 다음 펼쳐야 전환이 보인다
      let inner = 0;
      const outer = requestAnimationFrame(() => {
        inner = requestAnimationFrame(() => setShown(true));
      });
      return () => {
        cancelAnimationFrame(outer);
        cancelAnimationFrame(inner);
      };
    }
    setShown(false);
    const t = setTimeout(() => setMounted(false), SLIDE_MS);
    return () => clearTimeout(t);
  }, [open]);
  if (!mounted) return null;
  return (
    <div
      className={cn(
        'grid ease-out motion-reduce:transition-none',
        vertical
          ? cn('transition-[grid-template-rows]', shown ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]')
          : cn('transition-[grid-template-columns]', shown ? 'grid-cols-[1fr]' : 'grid-cols-[0fr]'),
      )}
      style={{ transitionDuration: `${SLIDE_MS}ms` }}
      inert={!open}
      data-canvas-palette-slide={shown ? 'open' : 'closed'}
    >
      <div className={cn('flex items-center gap-0.5 overflow-hidden', vertical ? 'min-h-0 flex-col' : 'min-w-0')}>{children}</div>
    </div>
  );
}

function Swatch({ hex, label, active, onClick, favorite }: { hex: string; label: string; active: boolean; onClick(): void; favorite?: boolean }) {
  return (
    <button type="button" aria-label={label} aria-pressed={active} title={label} onClick={onClick} className="relative grid size-11 shrink-0 place-items-center md:size-8" data-canvas-ink={hex}>
      <span
        className={cn('size-5 rounded-full border border-black/15', active && 'ring-2 ring-accent ring-offset-2 ring-offset-surface')}
        style={{ backgroundColor: hex }}
      />
      {favorite && <Star size={8} className="absolute top-1.5 right-1.5 fill-current text-amber-500 md:top-0.5 md:right-0.5" aria-hidden />}
    </button>
  );
}

/** 미리보기 획: 완만한 물결, 가운데로 갈수록 세게 누른다 */
const PREVIEW_POINTS = Array.from({ length: 41 }, (_, i) => {
  const t = i / 40;
  return [20 + t * 160, 32 + Math.sin(t * Math.PI * 2) * 12, Math.round((0.25 + Math.sin(t * Math.PI) * 0.65) * 100) / 100];
}).flat();

/** 펜 종류 고르기 */
function NibPicker({ nib, onNib }: { nib: CanvasPenNib; onNib(nib: CanvasPenNib): void }) {
  return (
    <div role="radiogroup" aria-label="펜 종류" className="mb-3 grid w-60 grid-cols-4 gap-1" data-canvas-nib-picker="">
      {PEN_NIBS.map((n) => (
        <button
          key={n.nib}
          type="button"
          role="radio"
          aria-checked={nib === n.nib}
          title={n.hint}
          onClick={() => onNib(n.nib)}
          className={cn(
            'flex h-14 flex-col items-center justify-center gap-1 rounded-lg text-[12px] text-fg-2 hover:bg-surface-2 hover:text-fg',
            nib === n.nib && 'bg-accent-soft text-accent hover:bg-accent-soft hover:text-accent',
          )}
          data-canvas-nib-option={n.nib}
        >
          {n.icon(18)}
          {n.label}
        </button>
      ))}
    </div>
  );
}

/** 굵기 창: 끌개 + 숫자 + 미리보기 (펜은 고른 종류의 획 모양으로) */
function SizeEditor({ kind, size, color, nib, onSize }: { kind: StrokeKind; size: number; color: string; nib?: CanvasPenNib; onSize(n: number): void }) {
  const r = STROKE_RANGE[kind];
  return (
    <div className="flex w-60 flex-col gap-3" data-canvas-size-editor={kind}>
      <div className="flex items-center justify-between text-[13px] text-fg-2">
        <span>{kind === 'pen' ? '펜 굵기' : '형광펜 굵기'}</span>
        <label className="flex items-center gap-1">
          <input
            type="number"
            min={r.min}
            max={r.max}
            value={size}
            aria-label="굵기 숫자"
            onChange={(e) => onSize(clampStroke(kind, e.target.valueAsNumber))}
            className="h-8 w-14 rounded-md border border-line bg-bg px-1.5 text-right text-[13px] text-fg tabular-nums"
          />
          px
        </label>
      </div>
      <input
        type="range"
        min={r.min}
        max={r.max}
        step={1}
        value={size}
        aria-label="굵기"
        onChange={(e) => onSize(clampStroke(kind, e.target.valueAsNumber))}
        className="h-8 w-full accent-[var(--accent)]"
      />
      <div className="grid h-16 place-items-center rounded-lg border border-line bg-[#fbf9f4]" aria-hidden>
        <svg width={200} height={64} viewBox="0 0 200 64" className="overflow-visible">
          <path
            d={strokePath({ tool: kind, nib, size: Math.min(size, 48), points: PREVIEW_POINTS })}
            fill={color}
            opacity={strokeOpacity({ tool: kind, nib })}
            stroke={color === '#ffffff' ? '#0003' : undefined}
            strokeWidth={color === '#ffffff' ? 1 : undefined}
          />
        </svg>
      </div>
    </div>
  );
}

const HUE_GRADIENT = 'linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)';

/** 판·띠 위 포인터 위치 → 0~1 비율. 누른 채 밖으로 나가도 끝에 붙는다 */
const ratio = (e: ReactPointerEvent<HTMLElement>) => {
  const r = e.currentTarget.getBoundingClientRect();
  return {
    x: Math.max(0, Math.min(1, (e.clientX - r.left) / Math.max(1, r.width))),
    y: Math.max(0, Math.min(1, (e.clientY - r.top) / Math.max(1, r.height))),
  };
};

/** 누르고 끄는 동안 계속 받는 포인터 핸들러 묶음 */
const dragHandlers = (apply: (e: ReactPointerEvent<HTMLElement>) => void) => ({
  onPointerDown: (e: ReactPointerEvent<HTMLElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    apply(e);
  },
  onPointerMove: (e: ReactPointerEvent<HTMLElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) apply(e);
  },
});

/** 화살표 키 한 번에 움직일 양 (Shift는 10배) */
const arrowStep = (e: ReactKeyboardEvent, unit: number) => (e.shiftKey ? unit * 10 : unit);

declare global {
  interface Window {
    EyeDropper?: new () => { open(): Promise<{ sRGBHex: string }> };
  }
}

/**
 * 색 창 (포토샵식): 채도·명도 판, 색상 띠, 처음 색/새 색 비교, HEX·RGB 입력, 스포이드(되는 곳에서만), 즐겨찾기.
 * 회색·검정처럼 색상이 없는 색에서도 고르던 색상이 사라지지 않게 HSV를 따로 들고 있는다.
 */
function ColorEditor({
  color,
  onColor,
  favorites,
  onToggleFavorite,
  onEyeDropBoard,
}: {
  color: string;
  onColor(hex: string): void;
  favorites: string[];
  onToggleFavorite(hex: string): void;
  onEyeDropBoard(): void;
}) {
  const [original] = useState(color);
  const [hsv, setHsv] = useState<Hsv>(() => rgbToHsv(hexToRgb(color) ?? { r: 0, g: 0, b: 0 }));
  const [hex, setHex] = useState(color);
  const emitted = useRef(color);
  // 바깥(팔레트·즐겨찾기)에서 색이 바뀌면 판을 맞춘다. 우리가 보낸 색이면 HSV를 그대로 둔다
  useEffect(() => {
    setHex(color);
    if (color === emitted.current) return;
    emitted.current = color;
    const rgb = hexToRgb(color);
    if (rgb) setHsv(rgbToHsv(rgb));
  }, [color]);

  const pickHsv = (next: Hsv) => {
    setHsv(next);
    const h = hsvToHex(next);
    emitted.current = h;
    if (h !== color) onColor(h);
  };
  const pickHex = (h: string) => {
    const rgb = hexToRgb(h);
    if (!rgb) return;
    const next = rgbToHex(rgb);
    emitted.current = next;
    setHsv(rgbToHsv(rgb));
    if (next !== color) onColor(next);
  };

  const rgb = hexToRgb(color) ?? { r: 0, g: 0, b: 0 };
  const fav = favorites.includes(color);
  const preset = INK_COLORS.some((c) => c.hex === color);
  const full = !fav && favorites.length >= MAX_FAVORITE_INKS;
  const commitHex = (v: string) => {
    const t = v.trim().toLowerCase();
    const h = t.startsWith('#') ? t : `#${t}`;
    if (isHex(h)) pickHex(h);
    else setHex(color);
  };
  const eyeDrop = async () => {
    // 안드로이드·사파리처럼 화면 스포이드가 없으면 판을 눌러 따온다
    if (typeof window === 'undefined' || !window.EyeDropper) return onEyeDropBoard();
    try {
      const r = await new window.EyeDropper!().open();
      pickHex(r.sRGBHex.toLowerCase());
    } catch {
      // 스포이드를 Esc로 그만두면 아무것도 바꾸지 않는다
    }
  };

  return (
    <div className="flex w-60 flex-col gap-3" data-canvas-color-editor="">
      {/* 채도(가로) · 명도(세로) 판 */}
      <div
        role="slider"
        tabIndex={0}
        aria-label="채도·명도"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(hsv.s * 100)}
        aria-valuetext={`채도 ${Math.round(hsv.s * 100)}%, 명도 ${Math.round(hsv.v * 100)}%`}
        data-canvas-color-sv=""
        className="relative h-36 w-full cursor-crosshair touch-none rounded-lg outline-offset-2"
        style={{
          backgroundColor: `hsl(${hsv.h} 100% 50%)`,
          backgroundImage: 'linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, transparent)',
        }}
        {...dragHandlers((e) => {
          const r = ratio(e);
          pickHsv({ ...hsv, s: r.x, v: 1 - r.y });
        })}
        onKeyDown={(e) => {
          const d = arrowStep(e, 0.01);
          const move = { ArrowLeft: [-d, 0], ArrowRight: [d, 0], ArrowUp: [0, d], ArrowDown: [0, -d] }[e.key];
          if (!move) return;
          e.preventDefault();
          pickHsv({ ...hsv, s: Math.max(0, Math.min(1, hsv.s + move[0]!)), v: Math.max(0, Math.min(1, hsv.v + move[1]!)) });
        }}
      >
        <span
          aria-hidden
          className="pointer-events-none absolute size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.4)]"
          style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%`, backgroundColor: color }}
        />
      </div>

      {/* 색상 띠 */}
      <div
        role="slider"
        tabIndex={0}
        aria-label="색상"
        aria-valuemin={0}
        aria-valuemax={360}
        aria-valuenow={Math.round(hsv.h)}
        data-canvas-color-hue=""
        className="relative h-4 w-full cursor-pointer touch-none rounded-full outline-offset-2"
        style={{ background: HUE_GRADIENT }}
        {...dragHandlers((e) => pickHsv({ ...hsv, h: ratio(e).x * 360 }))}
        onKeyDown={(e) => {
          const d = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -1 : 0;
          if (!d) return;
          e.preventDefault();
          pickHsv({ ...hsv, h: Math.max(0, Math.min(360, hsv.h + d * arrowStep(e, 1))) });
        }}
      >
        <span
          aria-hidden
          className="pointer-events-none absolute top-1/2 h-5 w-2 -translate-x-1/2 -translate-y-1/2 rounded-sm border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.4)]"
          style={{ left: `${(hsv.h / 360) * 100}%` }}
        />
      </div>

      {/* 새 색 / 처음 색 · 스포이드 */}
      <div className="flex items-center gap-2">
        <div className="flex h-11 flex-1 overflow-hidden rounded-lg border border-line md:h-9">
          <span className="flex-1" style={{ backgroundColor: color }} title="새 색" data-canvas-color-new="" />
          <button
            type="button"
            aria-label={`처음 색 ${original}로 되돌리기`}
            title="처음 색으로 되돌리기"
            onClick={() => pickHex(original)}
            className="flex-1"
            style={{ backgroundColor: original }}
          />
        </div>
        <button type="button" aria-label="화면에서 색 따오기" title="스포이드 · 화면에서 색 따오기" onClick={() => void eyeDrop()} className={cn(BTN, 'border border-line')} data-canvas-eyedrop="">
          <Pipette size={18} />
        </button>
      </div>

      {/* HEX 한 줄, 그 아래 R·G·B 세 칸 — 한 줄에 다 넣으면 창 밖으로 넘친다 */}
      <div className="grid grid-cols-3 gap-1.5" data-canvas-color-fields="">
        <label className="col-span-3 flex flex-col gap-0.5 text-[11px] text-muted">
          HEX
          <input
            type="text"
            value={hex}
            aria-label="색 코드"
            maxLength={7}
            spellCheck={false}
            onChange={(e) => setHex(e.target.value)}
            onBlur={(e) => commitHex(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && commitHex(e.currentTarget.value)}
            className="h-11 min-w-0 rounded-md border border-line bg-bg px-2 font-mono text-[13px] text-fg md:h-8"
          />
        </label>
        {(['r', 'g', 'b'] as const).map((k) => (
          <label key={k} className="flex flex-col gap-0.5 text-[11px] text-muted">
            {k.toUpperCase()}
            <input
              type="number"
              min={0}
              max={255}
              value={rgb[k]}
              aria-label={`${k.toUpperCase()} 값`}
              onChange={(e) => {
                if (Number.isFinite(e.target.valueAsNumber)) pickHex(rgbToHex({ ...rgb, [k]: e.target.valueAsNumber }));
              }}
              className="h-11 w-full min-w-0 rounded-md border border-line bg-bg px-2 text-right text-[13px] text-fg tabular-nums md:h-8"
            />
          </label>
        ))}
      </div>

      {favorites.length > 0 && (
        <div className="flex flex-wrap gap-1" role="group" aria-label="즐겨찾는 색">
          {favorites.map((h) => (
            <button
              key={h}
              type="button"
              aria-label={`즐겨찾는 색 ${h} 쓰기`}
              title={h}
              onClick={() => onColor(h)}
              className={cn('size-7 rounded-full border border-black/15', h === color && 'ring-2 ring-accent ring-offset-1 ring-offset-surface')}
              style={{ backgroundColor: h }}
            />
          ))}
        </div>
      )}
      <button
        type="button"
        disabled={preset || full}
        onClick={() => onToggleFavorite(color)}
        className={cn(SMALL_BTN, 'inline-flex items-center justify-center gap-1.5 border border-line text-fg-2 hover:bg-surface-2 hover:text-fg disabled:opacity-40')}
        data-canvas-favorite=""
      >
        <Star size={14} className={cn(fav && 'fill-current text-amber-500')} />
        {preset ? '기본 색이에요' : fav ? '즐겨찾기에서 빼기' : full ? `즐겨찾기는 ${MAX_FAVORITE_INKS}개까지` : '즐겨찾기에 넣기'}
      </button>
    </div>
  );
}

/** 도구 막대 아래 떠 있는 작은 창. 도구 막대가 가로로 스크롤되어도 잘리지 않게 body에 띄운다 */
function Popover({ anchor, label, onClose, children, isVertical }: { anchor: HTMLElement; label: string; onClose(): void; children: ReactNode; isVertical?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    const place = () => {
      const r = anchor.getBoundingClientRect();
      const w = ref.current?.offsetWidth ?? 264;
      const h = ref.current?.offsetHeight ?? 200;

      if (isVertical) {
        // 수직 도킹: 옆에 열기 (오른쪽 또는 왼쪽)
        const isRightOfAnchor = r.right + 6 + w <= window.innerWidth;
        const left = isRightOfAnchor ? r.right + 6 : Math.max(8, r.left - w - 6);
        const top = Math.max(8, Math.min(window.innerHeight - h - 8, r.top + r.height / 2 - h / 2));
        setPos({ left, top });
      } else {
        // 수평 도킹: 아래에 열기
        // 수평 도킹: 아래에, 자리가 없으면(아래 도킹) 위에 열기
        const below = r.bottom + 6 + h <= window.innerHeight - 8;
        setPos({ left: Math.max(8, Math.min(window.innerWidth - w - 8, r.left + r.width / 2 - w / 2)), top: below ? r.bottom + 6 : Math.max(8, r.top - h - 6) });
      }
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [anchor, isVertical]);

  useEffect(() => {
    const down = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!ref.current?.contains(t) && !anchor.contains(t)) closeRef.current();
    };
    const key = (e: KeyboardEvent) => e.key === 'Escape' && closeRef.current();
    window.addEventListener('pointerdown', down, true);
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('pointerdown', down, true);
      window.removeEventListener('keydown', key);
    };
  }, [anchor]);

  return createPortal(
    <div
      ref={ref}
      role="dialog"
      aria-label={label}
      style={pos ? { left: pos.left, top: pos.top } : { visibility: 'hidden', left: 0, top: 0 }}
      className="fixed z-50 rounded-xl border border-line bg-surface p-3 shadow-lg"
      data-canvas-popover=""
    >
      {children}
    </div>,
    document.body,
  );
}
