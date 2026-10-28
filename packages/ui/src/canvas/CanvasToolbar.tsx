import { Eraser, Highlighter, ImagePlus, MousePointer2, Maximize, Pen, Redo2, Trash2, Undo2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '../lib/cn';

export type CanvasToolId = 'select' | 'pen' | 'marker' | 'eraser';
export type StrokeSizeKey = 'S' | 'M' | 'L';

/** 굵기 단계 — 펜은 가늘게, 형광펜은 굵게 (캔버스 px) */
export const STROKE_SIZES: Record<StrokeSizeKey, { label: string; pen: number; marker: number }> = {
  S: { label: '가늘게', pen: 2, marker: 10 },
  M: { label: '보통', pen: 4, marker: 18 },
  L: { label: '굵게', pen: 8, marker: 30 },
};

export const INK_COLORS: { label: string; hex: string }[] = [
  { label: '검정', hex: '#1f2937' },
  { label: '빨강', hex: '#dc2626' },
  { label: '파랑', hex: '#2563eb' },
  { label: '초록', hex: '#16a34a' },
  { label: '노랑', hex: '#facc15' },
  { label: '보라', hex: '#7c3aed' },
];

const TOOLS: { id: CanvasToolId; label: string; icon: ReactNode }[] = [
  { id: 'select', label: '선택/이동', icon: <MousePointer2 size={18} /> },
  { id: 'pen', label: '펜', icon: <Pen size={18} /> },
  { id: 'marker', label: '형광펜', icon: <Highlighter size={18} /> },
  { id: 'eraser', label: '지우개', icon: <Eraser size={18} /> },
];

/** 터치 기준 44px, 태블릿 이상은 36px */
const BTN = 'grid size-11 shrink-0 place-items-center rounded-lg text-fg-2 hover:bg-surface-2 hover:text-fg disabled:opacity-40 md:size-9';

export interface CanvasToolbarProps {
  tool: CanvasToolId;
  onTool(tool: CanvasToolId): void;
  color: string;
  onColor(hex: string): void;
  size: StrokeSizeKey;
  onSize(size: StrokeSizeKey): void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo(): void;
  onRedo(): void;
  onFit(): void;
  onImport(): void;
  hasSelection: boolean;
  onDeleteSelected(): void;
}

export function CanvasToolbar(p: CanvasToolbarProps) {
  const drawing = p.tool === 'pen' || p.tool === 'marker';
  return (
    <div role="toolbar" aria-label="캔버스 도구" className="flex items-center gap-0.5 overflow-x-auto border-b border-line bg-surface px-2 py-1 [scrollbar-width:none] md:flex-wrap md:overflow-visible [&>*]:shrink-0">
      {TOOLS.map((t) => (
        <button
          key={t.id}
          type="button"
          aria-label={t.label}
          aria-pressed={p.tool === t.id}
          title={t.label}
          onClick={() => p.onTool(t.id)}
          className={cn(BTN, p.tool === t.id && 'bg-accent-soft text-accent hover:bg-accent-soft hover:text-accent')}
        >
          {t.icon}
        </button>
      ))}
      <span className="mx-1 h-6 w-px bg-line" aria-hidden />
      <div className={cn('flex items-center gap-0.5', !drawing && 'opacity-40')} role="group" aria-label="색">
        {INK_COLORS.map((c) => (
          <button
            key={c.hex}
            type="button"
            aria-label={`${c.label} 색`}
            aria-pressed={p.color === c.hex}
            title={c.label}
            onClick={() => p.onColor(c.hex)}
            className="grid size-11 shrink-0 place-items-center md:size-8"
          >
            <span
              className={cn('size-5 rounded-full border border-black/10', p.color === c.hex && 'ring-2 ring-accent ring-offset-2 ring-offset-surface')}
              style={{ backgroundColor: c.hex }}
            />
          </button>
        ))}
      </div>
      <span className="mx-1 h-6 w-px bg-line" aria-hidden />
      <div className="flex items-center gap-0.5" role="group" aria-label="굵기">
        {(Object.keys(STROKE_SIZES) as StrokeSizeKey[]).map((k) => (
          <button
            key={k}
            type="button"
            aria-label={STROKE_SIZES[k].label}
            aria-pressed={p.size === k}
            onClick={() => p.onSize(k)}
            className={cn('h-11 rounded-lg px-2.5 text-[13px] text-fg-2 hover:bg-surface-2 md:h-9', p.size === k && 'bg-accent-soft text-accent')}
          >
            {STROKE_SIZES[k].label}
          </button>
        ))}
      </div>
      <span className="mx-1 h-6 w-px bg-line" aria-hidden />
      <button type="button" aria-label="실행 취소" title="실행 취소 (⌘Z)" disabled={!p.canUndo} onClick={p.onUndo} className={BTN}>
        <Undo2 size={18} />
      </button>
      <button type="button" aria-label="다시 실행" title="다시 실행 (⌘⇧Z)" disabled={!p.canRedo} onClick={p.onRedo} className={BTN}>
        <Redo2 size={18} />
      </button>
      <button type="button" aria-label="전체 보기" title="전체 보기" onClick={p.onFit} className={BTN}>
        <Maximize size={18} />
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
        <ImagePlus size={17} />
        가져오기
      </button>
    </div>
  );
}

