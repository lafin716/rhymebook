import { descendantIds, turnMessageIds, type ID } from '@branch/core';
import { FolderInput, GitBranchPlus, Split, Trash2 } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { actions, appStore } from '../app/store';
import { pushNotice } from '../app/sync';
import { confirm } from '../components/ConfirmDialog';
import { cn } from '../lib/cn';
import type { MenuPoint } from '../session/SessionMenu';
import { pickMoveTarget, splitTurnSibling } from './turnActions';

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

/** 질문(과 답변)을 하위 세션으로 분리: 부모에는 그 자리에 각주 표식이 남는다. 첫 질문은 분리할 수 없다 */
export function splitTurnOut(sessionId: ID, questionId: ID) {
  const st = appStore.getState();
  if (!turnMessageIds(st.messages[sessionId] ?? [], questionId)) {
    pushNotice('첫 질문은 분리할 수 없어요.');
    return;
  }
  if (st.streaming[sessionId]) {
    pushNotice('답변이 끝난 뒤 분리할 수 있어요.');
    return;
  }
  if (!actions().splitTurn(sessionId, questionId)) pushNotice('질문을 분리하지 못했어요.');
}

/** 세션 본문 우클릭 메뉴 (하위/별도 세션으로 분리 · 다른 세션으로 옮기기 · 질문 삭제) */
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
  /** 첫 질문: 분리·삭제 항목을 비활성으로 보이고 이유를 적는다 */
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

  const items: { label: string; icon: typeof Trash2; run(): void; danger?: boolean }[] = [
    { label: '하위 세션으로 분리', icon: GitBranchPlus, run: () => splitTurnOut(sessionId, questionId) },
    { label: '별도 세션으로 분리', icon: Split, run: () => splitTurnSibling(sessionId, questionId) },
    { label: '다른 세션으로 옮기기', icon: FolderInput, run: () => pickMoveTarget(sessionId, questionId) },
    { label: '질문 삭제', icon: Trash2, run: () => void removeTurn(sessionId, questionId), danger: true },
  ];
  const w = first ? 228 : 196;
  const h = items.length * 34 + 8 + (first ? 22 : 0);
  return createPortal(
    <div
      ref={ref}
      role="menu"
      aria-label="질문 메뉴"
      onContextMenu={(e) => e.preventDefault()}
      style={{ top: Math.max(8, Math.min(at.y, window.innerHeight - h - 8)), left: Math.min(at.x, window.innerWidth - w - 8), width: w }}
      className="animate-pop-in fixed z-[90] rounded-lg border border-line bg-elev p-1 shadow-float"
    >
      {items.map(({ label, icon: Icon, run, danger }) => (
        <button
          key={label}
          type="button"
          role="menuitem"
          disabled={first}
          aria-disabled={first}
          onClick={() => {
            onClose();
            run();
          }}
          className={cn(
            'flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-[13px] outline-none',
            first
              ? 'cursor-not-allowed text-muted'
              : danger
                ? 'text-danger hover:bg-danger-soft focus:bg-danger-soft'
                : 'text-fg hover:bg-surface-2 focus:bg-surface-2',
          )}
        >
          <Icon size={14} /> {label}
        </button>
      ))}
      {first && <p className="px-2.5 pb-1.5 text-[11.5px] text-muted">첫 질문은 분리·옮기기·삭제할 수 없어요.</p>}
    </div>,
    document.body,
  );
}
