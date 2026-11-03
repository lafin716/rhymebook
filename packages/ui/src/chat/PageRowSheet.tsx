/**
 * 모바일 행 시트 (ADR-095) — 행을 한 번 탭해 고르면 아래에 뜬다. 데스크톱 우클릭·핸들 메뉴를 모바일에 맞게 옮긴 것.
 * 편집·아래에 행 추가·위로·아래로·AI로 이어 쓰기·칸 풀기·삭제 + 블록 바꾸기 칩. 큰 터치 영역, 바깥 탭·Esc로 닫힌다.
 */
import { markdownBlocks } from '@branch/core';
import type { EditorView } from '@codemirror/view';
import { ArrowDown, ArrowUp, Columns2, PenLine, Plus, Sparkles, Trash2, X } from 'lucide-react';
import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../lib/cn';
import { t, type MessageKey } from '../i18n';
import type { RowKind } from './pageRowEditing';

/* 이름은 그릴 때 고른다 (언어 변경 반영) */
const KINDS: { kind: RowKind; labelKey: MessageKey }[] = [
  { kind: 'paragraph', labelKey: 'page.rowSheet.kind.paragraph' },
  { kind: 'h1', labelKey: 'page.rowSheet.kind.h1' },
  { kind: 'h2', labelKey: 'page.rowSheet.kind.h2' },
  { kind: 'h3', labelKey: 'page.rowSheet.kind.h3' },
  { kind: 'bullet', labelKey: 'page.rowSheet.kind.bullet' },
  { kind: 'ordered', labelKey: 'page.rowSheet.kind.ordered' },
  { kind: 'todo', labelKey: 'page.rowSheet.kind.todo' },
  { kind: 'quote', labelKey: 'page.rowSheet.kind.quote' },
];

/** 고른 블록의 지금 모양 — 칩에 표시 */
function currentKind(text: string): RowKind | null {
  const first = text.split('\n')[0] ?? '';
  const h = /^ {0,3}(#{1,3}) /.exec(first);
  if (h) return (['h1', 'h2', 'h3'] as const)[h[1]!.length - 1]!;
  if (/^\s*[-*+] \[[ xX]\] /.test(first)) return 'todo';
  if (/^\s*[-*+] /.test(first)) return 'bullet';
  if (/^\s*\d+[.)] /.test(first)) return 'ordered';
  if (/^ {0,3}> /.test(first)) return 'quote';
  if (/^ {0,3}#{4,6} /.test(first)) return null;
  return 'paragraph';
}

function SheetButton({ icon, children, onClick, danger, ...rest }: { icon: ReactNode; children: ReactNode; onClick: () => void; danger?: boolean; [k: `data-${string}`]: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      {...rest}
      className={cn(
        'flex min-h-[52px] min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-xl px-1 text-[12px] font-medium active:bg-surface disabled:opacity-40',
        danger ? 'text-danger' : 'text-fg-2',
      )}
    >
      {icon}
      {children}
    </button>
  );
}

export function PageRowSheet({
  view,
  row,
  canFill,
  onEdit,
  onAddBelow,
  onAction,
  onKind,
  onFill,
  onClose,
}: {
  view: EditorView;
  row: { from: number; to: number };
  canFill: boolean;
  onEdit: (pos: number) => void;
  onAddBelow: (index: number) => void;
  onAction: (index: number, action: 'up' | 'down' | 'unwrap' | 'delete') => void;
  onKind: (kind: RowKind, range: { from: number; to: number }) => void;
  onFill: (pos: number) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const text = view.state.doc.toString();
  const blocks = markdownBlocks(text);
  const index = blocks.findIndex((b) => b.from <= row.to && b.to >= row.from);
  const block = blocks[index];
  if (!block) return null;
  const kindable = ['paragraph', 'heading', 'bullet', 'ordered', 'todo', 'quote'].includes(block.kind);
  const now = kindable ? currentKind(text.slice(block.from, block.to)) : null;

  return createPortal(
    <div
      data-page-sheet=""
      role="dialog"
      aria-label={t('page.rowSheet.menu')}
      onPointerDown={(e) => e.preventDefault()}
      className="animate-sheet-up safe-bottom fixed inset-x-0 bottom-0 z-[65] border-t border-line bg-elev shadow-float"
    >
      <div className="flex items-center justify-between px-4 pt-2.5 text-[12.5px] text-muted">
        <span>{t('page.rowSheet.picked')}</span>
        <button type="button" aria-label={t('page.rowSheet.close')} onClick={onClose} className="-mr-1 inline-flex size-8 items-center justify-center rounded-lg">
          <X size={16} />
        </button>
      </div>
      <div className="flex gap-1 px-2 pt-1">
        <SheetButton data-row-action="edit" icon={<PenLine size={18} />} onClick={() => onEdit(block.to)}>
          {t('page.rowSheet.edit')}
        </SheetButton>
        <SheetButton data-row-action="add" icon={<Plus size={18} />} onClick={() => onAddBelow(index)}>
          {t('page.rowSheet.addBelow')}
        </SheetButton>
        <SheetButton data-row-action="up" icon={<ArrowUp size={18} />} onClick={() => index > 0 && onAction(index, 'up')}>
          {t('page.rowSheet.up')}
        </SheetButton>
        <SheetButton data-row-action="down" icon={<ArrowDown size={18} />} onClick={() => index < blocks.length - 1 && onAction(index, 'down')}>
          {t('page.rowSheet.down')}
        </SheetButton>
        {canFill && (
          <SheetButton data-row-action="fill" icon={<Sparkles size={18} />} onClick={() => onFill(block.to)}>
            {t('page.rowSheet.fill')}
          </SheetButton>
        )}
        {block.kind === 'columns' && (
          <SheetButton data-row-action="unwrap" icon={<Columns2 size={18} />} onClick={() => onAction(index, 'unwrap')}>
            {t('page.rowSheet.unwrap')}
          </SheetButton>
        )}
        <SheetButton data-row-action="delete" danger icon={<Trash2 size={18} />} onClick={() => onAction(index, 'delete')}>
          {t('page.rowSheet.delete')}
        </SheetButton>
      </div>
      {kindable && (
        <div className="flex gap-1.5 overflow-x-auto px-3 pt-1 pb-3 [scrollbar-width:none]" aria-label={t('page.rowSheet.changeBlock')}>
          {KINDS.map((k) => (
            <button
              key={k.kind}
              type="button"
              data-row-kind={k.kind}
              aria-pressed={now === k.kind}
              onClick={() => onKind(k.kind, { from: block.from, to: block.to })}
              className={cn(
                'h-9 shrink-0 rounded-full border px-3.5 text-[13px]',
                now === k.kind ? 'border-accent bg-accent/10 text-accent' : 'border-line text-fg-2 active:bg-surface',
              )}
            >
              {t(k.labelKey)}
            </button>
          ))}
        </div>
      )}
      {!kindable && <div className="pb-3" />}
    </div>,
    document.body,
  );
}
