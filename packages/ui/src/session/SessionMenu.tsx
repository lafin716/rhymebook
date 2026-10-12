import { Pencil, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../lib/cn';

export interface MenuPoint {
  x: number;
  y: number;
}

/** 세션 행 우클릭 메뉴 (이름 변경·삭제) */
export function SessionMenu({
  at,
  onRename,
  onDelete,
  onClose,
}: {
  at: MenuPoint;
  onRename(): void;
  onDelete?: () => void;
  onClose(): void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('blur', onClose);
    window.addEventListener('resize', onClose);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('blur', onClose);
      window.removeEventListener('resize', onClose);
    };
  }, [onClose]);

  const w = 168;
  const h = onDelete ? 84 : 44;
  const item = 'flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-[13px] outline-none';
  return createPortal(
    <div
      ref={ref}
      role="menu"
      aria-label="세션 메뉴"
      onContextMenu={(e) => e.preventDefault()}
      style={{ top: Math.min(at.y, window.innerHeight - h - 8), left: Math.min(at.x, window.innerWidth - w - 8), width: w }}
      className="animate-pop-in fixed z-[90] rounded-lg border border-line bg-elev p-1 shadow-float"
    >
      <button
        type="button"
        role="menuitem"
        onClick={() => {
          onClose();
          onRename();
        }}
        className={cn(item, 'text-fg hover:bg-surface-2 focus:bg-surface-2')}
      >
        <Pencil size={14} className="text-muted" /> 이름 변경
      </button>
      {onDelete && (
        <button
          type="button"
          role="menuitem"
          onClick={() => {
            onClose();
            onDelete();
          }}
          className={cn(item, 'text-danger hover:bg-danger-soft focus:bg-danger-soft')}
        >
          <Trash2 size={14} /> 삭제
        </button>
      )}
    </div>,
    document.body,
  );
}

/** 세션 이름 인라인 편집. Enter·바깥 클릭 저장, Esc 취소 */
export function RenameInput({ value, onDone, className }: { value: string; onDone(next: string | null): void; className?: string }) {
  const [text, setText] = useState(value);
  const done = useRef(false);
  const finish = (next: string | null) => {
    if (done.current) return;
    done.current = true;
    onDone(next);
  };
  return (
    <input
      autoFocus
      aria-label="세션 이름"
      value={text}
      maxLength={200}
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => setText(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !e.nativeEvent.isComposing) finish(text.trim() && text.trim() !== value ? text.trim() : null);
        if (e.key === 'Escape') {
          e.stopPropagation();
          finish(null);
        }
      }}
      onBlur={() => finish(text.trim() && text.trim() !== value ? text.trim() : null)}
      onClick={(e) => e.stopPropagation()}
      className={cn('h-7 w-full min-w-0 rounded-md border border-accent bg-bg px-1.5 text-[13.5px] text-fg outline-none', className)}
    />
  );
}
