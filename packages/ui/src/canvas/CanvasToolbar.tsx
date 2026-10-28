import type { CanvasPenNib } from '@branch/core';
import { Brush, Eraser, Highlighter, Import, MousePointer2, Maximize, Pen, Pencil, PenTool, Redo2, Settings2, Star, Trash2, Undo2 } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../lib/cn';
import { strokeOpacity, strokePath } from './strokePath';
import { clampStroke, isHex, MAX_FAVORITE_INKS, STROKE_RANGE, type StrokeKind } from './canvasPrefs';

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
}

type Pop = { kind: 'size'; tool: StrokeKind; el: HTMLElement } | { kind: 'color'; el: HTMLElement };

export function CanvasToolbar(p: CanvasToolbarProps) {
  const drawing = p.tool === 'pen' || p.tool === 'marker';
  const [pop, setPop] = useState<Pop | null>(null);
  const known = INK_COLORS.some((c) => c.hex === p.color) || p.favorites.includes(p.color);

  const penNib = PEN_NIBS.find((n) => n.nib === p.nib) ?? PEN_NIBS[0]!;

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
    <div role="toolbar" aria-label="캔버스 도구" className="flex items-center gap-0.5 overflow-x-auto border-b border-line bg-surface px-2 py-1 [scrollbar-width:none] md:flex-wrap md:overflow-visible [&>*]:shrink-0">
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
      <span className="mx-1 h-6 w-px bg-line" aria-hidden />
      <div className={cn('flex items-center gap-0.5', !drawing && 'opacity-40')} role="group" aria-label="색">
        {INK_COLORS.map((c) => (
          <Swatch key={c.hex} hex={c.hex} label={`${c.label} 색`} active={p.color === c.hex} onClick={() => p.onColor(c.hex)} />
        ))}
        {p.favorites
          .filter((hex) => !INK_COLORS.some((c) => c.hex === hex))
          .map((hex) => (
            <Swatch key={hex} hex={hex} label={`즐겨찾는 색 ${hex}`} active={p.color === hex} onClick={() => p.onColor(hex)} favorite />
          ))}
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
            className={cn('size-5 rounded-full border border-black/10', !known && 'ring-2 ring-accent ring-offset-2 ring-offset-surface')}
            style={{
              background: known ? 'conic-gradient(#ef4444, #f59e0b, #84cc16, #06b6d4, #6366f1, #d946ef, #ef4444)' : p.color,
            }}
          />
        </button>
      </div>
      <span className="mx-1 h-6 w-px bg-line" aria-hidden />
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
      <span className="ml-auto" />
      <button
        type="button"
        onClick={p.onImport}
        className="sticky right-0 inline-flex h-11 items-center gap-1.5 rounded-lg bg-surface px-2.5 text-[13px] text-fg-2 shadow-[-8px_0_8px_-4px_var(--color-surface)] hover:bg-surface-2 hover:text-fg md:static md:h-9 md:shadow-none"
        data-canvas-import=""
      >
        <Import size={17} />
        가져오기
      </button>
      {pop?.kind === 'size' && (
        <Popover anchor={pop.el} label={pop.tool === 'pen' ? '펜 설정' : '형광펜 굵기'} onClose={() => setPop(null)}>
          {pop.tool === 'pen' && <NibPicker nib={p.nib} onNib={p.onNib} />}
          <SizeEditor kind={pop.tool} size={p.sizes[pop.tool]} color={p.color} nib={pop.tool === 'pen' ? p.nib : undefined} onSize={(n) => p.onSize(pop.tool, n)} />
        </Popover>
      )}
      {pop?.kind === 'color' && (
        <Popover anchor={pop.el} label="색 고르기" onClose={() => setPop(null)}>
          <ColorEditor color={p.color} onColor={p.onColor} favorites={p.favorites} onToggleFavorite={p.onToggleFavorite} />
        </Popover>
      )}
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

/** 색 창: 아무 색이나 고르고, 즐겨찾기에 넣거나 뺀다 */
function ColorEditor({ color, onColor, favorites, onToggleFavorite }: { color: string; onColor(hex: string): void; favorites: string[]; onToggleFavorite(hex: string): void }) {
  const [hex, setHex] = useState(color);
  useEffect(() => setHex(color), [color]);
  const fav = favorites.includes(color);
  const preset = INK_COLORS.some((c) => c.hex === color);
  const full = !fav && favorites.length >= MAX_FAVORITE_INKS;
  const commitHex = (v: string) => {
    const t = v.trim().toLowerCase();
    const h = t.startsWith('#') ? t : `#${t}`;
    if (isHex(h)) onColor(h);
    else setHex(color);
  };
  return (
    <div className="flex w-60 flex-col gap-3" data-canvas-color-editor="">
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={color}
          aria-label="색 고르기"
          onChange={(e) => onColor(e.target.value.toLowerCase())}
          className="h-11 w-14 cursor-pointer rounded-md border border-line bg-bg p-0.5 md:h-9"
        />
        <input
          type="text"
          value={hex}
          aria-label="색 코드"
          maxLength={7}
          spellCheck={false}
          onChange={(e) => setHex(e.target.value)}
          onBlur={(e) => commitHex(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && commitHex(e.currentTarget.value)}
          className="h-11 min-w-0 flex-1 rounded-md border border-line bg-bg px-2 font-mono text-[13px] text-fg md:h-9"
        />
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
function Popover({ anchor, label, onClose, children }: { anchor: HTMLElement; label: string; onClose(): void; children: ReactNode }) {
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
      setPos({ left: Math.max(8, Math.min(window.innerWidth - w - 8, r.left + r.width / 2 - w / 2)), top: r.bottom + 6 });
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [anchor]);

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
