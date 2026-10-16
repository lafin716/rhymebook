import type { ID } from '@branch/core';
import { CornerDownRight } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { create } from 'zustand';
import { actions, useApp } from '../app/store';
import { useUi } from '../app/uiState';
import { isMobileNow } from '../app/useBreakpoint';
import { Button } from '../components/Button';
import { openBranch } from '../chat/open';

const useSubDialog = create<{ parentId: ID | null }>(() => ({ parentId: null }));

/** 직접 입력한 질문으로 하위 세션(각주)을 만드는 창을 연다 (ADR-054) */
export function openSubSessionDialog(parentId: ID) {
  useSubDialog.setState({ parentId });
}

const close = () => useSubDialog.setState({ parentId: null });

/** 하위 세션 만들기 창. 모바일은 하단 시트, 데스크톱은 중앙 카드 */
export function SubSessionDialog() {
  const parentId = useSubDialog((s) => s.parentId);
  const parentTitle = useApp((s) => (parentId ? s.sessions[parentId]?.title : undefined));
  const [question, setQuestion] = useState('');
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!parentId) return;
    setQuestion('');
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [parentId]);

  if (!parentId || !parentTitle) return null;

  const submit = () => {
    const q = question.trim();
    if (!q) return;
    const id = actions().createSubSession(parentId, q);
    close();
    if (!id) return;
    if (isMobileNow()) useUi.getState().setDrawer(false);
    openBranch(id);
  };

  return createPortal(
    <div
      className="animate-fade-in fixed inset-0 z-[70] flex items-end justify-center bg-black/40 md:items-center md:p-6"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="하위 세션 만들기"
        className="animate-pop-in w-full border-line bg-surface px-5 pt-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-float max-md:rounded-t-3xl max-md:border-t md:max-w-[440px] md:rounded-2xl md:border md:pb-5"
      >
        <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-line-strong md:hidden" />
        <h2 className="text-[16px] font-semibold text-fg">하위 세션 만들기</h2>
        <p className="mt-1 flex min-w-0 items-center gap-1 text-[13px] text-muted">
          <CornerDownRight size={13} className="shrink-0" />
          <span className="truncate">{parentTitle}</span>
          <span className="shrink-0">의 맥락을 이어받아요</span>
        </p>
        <textarea
          ref={ref}
          value={question}
          rows={4}
          maxLength={4000}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit();
          }}
          placeholder="이 세션에서 이어서 묻고 싶은 질문을 적어 주세요"
          className="mt-3 w-full resize-none rounded-xl border border-line bg-bg px-3 py-2.5 text-[15px] leading-relaxed outline-none focus:border-accent md:text-sm"
        />
        <div className="mt-4 flex gap-2 max-md:flex-col-reverse md:justify-end">
          <Button variant="secondary" className="max-md:h-11 max-md:w-full" onClick={close}>
            취소
          </Button>
          <Button variant="primary" className="max-md:h-11 max-md:w-full" disabled={!question.trim()} onClick={submit}>
            만들기
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
