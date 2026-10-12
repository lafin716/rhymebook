import { MAX_NOTE_LENGTH, type Annotation } from '@branch/core';
import { Pencil, StickyNote, Trash2, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { actions } from '../app/store';

export interface AnnotationPopoverProps {
  annotation: Annotation;
  /** 클릭한 메모 텍스트 위치 (viewport) */
  rect: DOMRect;
  onClose: () => void;
}

/** 본문 메모 보기·수정·삭제 팝오버 (IMP-07) */
export function AnnotationPopover({ annotation, rect, onClose }: AnnotationPopoverProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(annotation.note ?? '');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const save = () => {
    // 빈 메모 저장 = 메모 삭제 (서식도 없으면 어노테이션 삭제)
    actions().updateAnnotation(annotation.id, { note: draft.trim() ? draft : null });
    setEditing(false);
    if (!draft.trim()) onClose();
  };

  const removeNote = () => {
    actions().updateAnnotation(annotation.id, { note: null });
    onClose();
  };

  const width = Math.min(320, window.innerWidth - 16);
  const left = Math.max(8, Math.min(window.innerWidth - width - 8, rect.left));
  const below = rect.bottom + 8 + 200 < window.innerHeight || rect.top < 220;
  const pos = below ? { top: rect.bottom + 8 } : { bottom: window.innerHeight - rect.top + 8 };

  return createPortal(
    <>
      <div className="fixed inset-0 z-[75]" onClick={onClose} aria-hidden />
      <div
        role="dialog"
        aria-label="메모"
        data-annotation-popover
        style={{ left, width, ...pos }}
        className="animate-pop-in fixed z-[76] rounded-xl border border-line bg-elev p-3 shadow-float"
      >
        <div className="mb-2 flex items-center gap-1.5 text-[12.5px] font-medium text-fg-2">
          <StickyNote size={14} className="text-anchor-line" />
          <span className="min-w-0 flex-1 truncate">“{annotation.anchor.text}”</span>
          <button
            type="button"
            aria-label="닫기"
            onClick={onClose}
            className="-mr-1 inline-flex size-7 items-center justify-center rounded-lg text-muted hover:bg-surface-2"
          >
            <X size={14} />
          </button>
        </div>
        {editing ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              save();
            }}
          >
            <textarea
              autoFocus
              value={draft}
              maxLength={MAX_NOTE_LENGTH}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) save();
              }}
              rows={4}
              placeholder="메모를 입력하세요"
              className="w-full resize-none rounded-lg border border-line bg-bg p-2 text-sm outline-none focus:border-accent"
            />
            <div className="mt-2 flex justify-end gap-1.5">
              <button
                type="button"
                onClick={() => {
                  setDraft(annotation.note ?? '');
                  setEditing(false);
                }}
                className="h-8 rounded-lg px-3 text-[13px] text-fg-2 hover:bg-surface-2"
              >
                취소
              </button>
              <button type="submit" className="h-8 rounded-lg bg-accent px-3 text-[13px] font-medium text-accent-fg">
                저장
              </button>
            </div>
          </form>
        ) : (
          <>
            <p className="max-h-60 overflow-y-auto whitespace-pre-wrap break-words text-sm text-fg">{annotation.note}</p>
            <div className="mt-3 flex justify-end gap-1.5">
              <button
                type="button"
                onClick={removeNote}
                className="inline-flex h-8 items-center gap-1 rounded-lg px-2.5 text-[13px] text-danger hover:bg-danger-soft"
              >
                <Trash2 size={14} /> 삭제
              </button>
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="inline-flex h-8 items-center gap-1 rounded-lg px-2.5 text-[13px] text-fg hover:bg-surface-2"
              >
                <Pencil size={14} /> 수정
              </button>
            </div>
          </>
        )}
      </div>
    </>,
    document.body,
  );
}
