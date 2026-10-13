import { formatBytes, textPreview, type Attachment } from '@branch/core';
import { ClipboardPaste, FileText, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../lib/cn';
import { dataUrl } from './attach';

/**
 * 첨부 미리보기 (IMP-09). 입력창 위(지울 수 있음)와 보낸 질문 위(읽기 전용)에서 같이 쓴다.
 * 사진은 썸네일, PDF·파일은 이름·크기 칩, 붙여넣은 긴 텍스트는 첫 줄 미리보기. 누르면 크게 본다.
 */
export function AttachmentList({ items, onRemove, align = 'start', className }: { items: readonly Attachment[]; onRemove?: (id: string) => void; align?: 'start' | 'end'; className?: string }) {
  const [viewing, setViewing] = useState<Attachment | null>(null);
  if (!items.length) return null;
  return (
    <>
      <ul
        aria-label="첨부"
        className={cn(
          'flex gap-1.5',
          // 입력창 위 미리보기는 한 줄로 두고 옆으로 넘긴다 (지우기 버튼이 잘리지 않게 위·오른쪽 여백)
          onRemove ? 'scroll-thin flex-nowrap overflow-x-auto pt-2 pr-2 pb-1' : 'flex-wrap',
          align === 'end' && 'justify-end',
          className,
        )}
      >
        {items.map((a) => (
          <li key={a.id} className="group/att relative shrink-0" data-attachment={a.kind}>
            {a.kind === 'image' ? (
              <button type="button" onClick={() => setViewing(a)} title={a.name} className="block overflow-hidden rounded-xl border border-line bg-surface-2">
                <img src={dataUrl(a)} alt={a.name} className={cn('object-cover', onRemove ? 'size-14' : 'h-28 w-auto max-w-[14rem] min-w-12')} />
              </button>
            ) : (
              <button
                type="button"
                onClick={() => a.kind === 'text' && setViewing(a)}
                title={a.name}
                className={cn(
                  'flex max-w-full items-center gap-2.5 rounded-xl border border-line bg-surface px-2.5 text-left',
                  onRemove ? 'h-14 w-48' : 'h-16 w-52',
                  a.kind === 'text' ? 'hover:bg-surface-2' : 'cursor-default',
                )}
              >
                <span className={cn('grid size-9 shrink-0 place-items-center rounded-lg', a.kind === 'pdf' ? 'bg-danger-soft text-danger' : 'bg-accent-soft text-accent')}>
                  {a.pasted ? <ClipboardPaste size={17} /> : <FileText size={17} />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium text-fg">{a.pasted ? textPreview(a.data, 40) || a.name : a.name}</span>
                  <span className="block truncate text-[11.5px] text-muted">
                    {a.pasted ? `${a.name} · ${a.data.length.toLocaleString()}자` : `${a.kind === 'pdf' ? 'PDF' : '텍스트'} · ${formatBytes(a.size)}`}
                  </span>
                </span>
              </button>
            )}
            {onRemove && (
              <button
                type="button"
                aria-label={`${a.name} 첨부 빼기`}
                onClick={() => onRemove(a.id)}
                className="absolute -top-1.5 -right-1.5 grid size-5 place-items-center rounded-full bg-fg text-bg shadow-pop"
              >
                <X size={12} />
              </button>
            )}
          </li>
        ))}
      </ul>
      {viewing && <AttachmentViewer attachment={viewing} onClose={() => setViewing(null)} />}
    </>
  );
}

function AttachmentViewer({ attachment: a, onClose }: { attachment: Attachment; onClose(): void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={a.name}
      className="animate-fade-in fixed inset-0 z-[85] flex items-center justify-center bg-black/60 p-4 md:p-10"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <button type="button" aria-label="닫기" onClick={onClose} className="absolute top-[max(1rem,env(safe-area-inset-top))] right-4 grid size-9 place-items-center rounded-full bg-black/50 text-white">
        <X size={18} />
      </button>
      {a.kind === 'image' ? (
        <img src={dataUrl(a)} alt={a.name} className="max-h-full max-w-full rounded-lg object-contain shadow-float" />
      ) : (
        <div className="flex max-h-full w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-surface shadow-float">
          <div className="border-b border-line px-4 py-3 text-[14px] font-semibold">
            {a.name} <span className="font-normal text-muted">· {a.data.length.toLocaleString()}자</span>
          </div>
          <pre className="scroll-thin min-h-0 flex-1 overflow-auto px-4 py-3 font-mono text-[12.5px] leading-relaxed whitespace-pre-wrap text-fg-2">{a.data}</pre>
        </div>
      )}
    </div>,
    document.body,
  );
}
