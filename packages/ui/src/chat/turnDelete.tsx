import { descendantIds, turnMessageIds, type ID } from '@branch/core';
import { Trash2 } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { actions, appStore } from '../app/store';
import { pushNotice } from '../app/sync';
import { confirm } from '../components/ConfirmDialog';
import { cn } from '../lib/cn';
import type { MenuPoint } from '../session/SessionMenu';

/** 질문(과 답변) 삭제: 확인 후 그 답변의 가지까지 함께 지운다. 첫 질문은 지울 수 없다 */
export async function removeTurn(sessionId: ID, questionId: ID) {
  const st = appStore.getState();
  const list = st.messages[sessionId] ?? [];
  const ids = turnMessageIds(list, questionId);
  if (!ids) {
    pushNotice('첫 질문은 삭제할 수 없어요.');
    return;
  }
  if (st.streaming[sessionId]) {
    pushNotice('답변이 끝난 뒤 삭제할 수 있어요.');
    return;
  }
  const gone = new Set(ids);
  const branches = Object.values(st.sessions)
    .filter((s) => s.parentId === sessionId && s.anchor && gone.has(s.anchor.messageId))
    .reduce((n, s) => n + descendantIds(st.sessions, s.id).length, 0);
  const q = list.find((m) => m.id === questionId)?.content.replace(/\s+/g, ' ').trim() ?? '';
  const ok = await confirm({
    title: '질문을 삭제할까요?',
    message: (
      <>
        {q && <b className="font-medium text-fg-2">“{q.length > 60 ? `${q.slice(0, 59)}…` : q}”</b>}
        {q && ' '}질문과 답변{branches > 0 ? `, 답변에서 뻗은 가지 ${branches}개가` : '이'} 삭제되며 되돌릴 수 없어요.
      </>
    ),
    confirmLabel: '삭제',
    tone: 'danger',
  });
  if (ok && !actions().deleteTurn(sessionId, questionId) && !appStore.getState().streaming[sessionId]) {
    pushNotice('질문을 삭제하지 못했어요.');
  }
}

/** 세션 본문 우클릭 메뉴 (질문 삭제) */
export function TurnMenu({
  at,
  sessionId,
  questionId,
  first,
  onClose,
}: {
  at: MenuPoint;
  sessionId: ID;
  questionId: ID;
  /** 첫 질문: 삭제 항목을 비활성으로 보이고 이유를 적는다 */
  first: boolean;
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

  const w = first ? 212 : 168;
  const h = first ? 62 : 44;
  return createPortal(
    <div
      ref={ref}
      role="menu"
      aria-label="질문 메뉴"
      onContextMenu={(e) => e.preventDefault()}
      style={{ top: Math.min(at.y, window.innerHeight - h - 8), left: Math.min(at.x, window.innerWidth - w - 8), width: w }}
      className="animate-pop-in fixed z-[90] rounded-lg border border-line bg-elev p-1 shadow-float"
    >
      <button
        type="button"
        role="menuitem"
        disabled={first}
        aria-disabled={first}
        onClick={() => {
          onClose();
          void removeTurn(sessionId, questionId);
        }}
        className={cn(
          'flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-[13px] outline-none',
          first ? 'cursor-not-allowed text-muted' : 'text-danger hover:bg-danger-soft focus:bg-danger-soft',
        )}
      >
        <Trash2 size={14} /> 질문 삭제
      </button>
      {first && <p className="px-2.5 pb-1.5 text-[11.5px] text-muted">첫 질문은 삭제할 수 없어요.</p>}
    </div>,
    document.body,
  );
}
