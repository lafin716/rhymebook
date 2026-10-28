import { appendPageLink, MAX_SPLIT, NEW_CANVAS_TITLE, NEW_PAGE_TITLE, pageDoc, type ID } from '@branch/core';
import { AppWindow, Columns2, FileText, GitBranch, PenLine, Pencil, Rows2, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { desktop } from '../app/runtime';
import { openBranch } from '../chat/open';
import { flushPageDraft } from '../chat/PagePanel';
import { actions } from '../app/store';
import { pushNotice } from '../app/sync';
import { useUi } from '../app/uiState';
import { isMobileNow } from '../app/useBreakpoint';
import { cn } from '../lib/cn';

export interface MenuPoint {
  x: number;
  y: number;
}

/** 세션 행 우클릭 메뉴 (분할로 열기·새 창으로 열기·이름 변경·삭제) */
export function SessionMenu({
  at,
  sessionId,
  onRename,
  onDelete,
  onClose,
}: {
  at: MenuPoint;
  /** 있으면 '오른쪽·아래에 분할로 열기' 항목을 보인다 (모바일 제외) */
  sessionId?: ID;
  onRename(): void;
  onDelete?: () => void;
  onClose(): void;
}) {
  const split = sessionId && !isMobileNow() ? sessionId : null;
  const openSplit = (edge: 'right' | 'bottom') => {
    if (!split) return;
    const v = actions().view;
    const target = v.mode === 'split' ? (v.splitSessionIds[v.focusedSplitIndex] ?? null) : v.activeSessionId;
    if (!actions().dropToSplit(split, target, edge)) pushNotice(`분할은 최대 ${MAX_SPLIT}개까지예요.`);
    useUi.getState().setDrawer(false);
  };
  /** 데스크톱 앱: 별도 창으로 열기 (같은 세션 창이 있어도 새로 연다, ADR-036) */
  const win = sessionId && desktop?.windows ? sessionId : null;
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

  const w = 188;
  const h = (onDelete ? 84 : 44) + (split ? 72 : 0) + (win ? 36 : 0) + (split || win ? 9 : 0);
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
      {split && (
        <>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              onClose();
              openSplit('right');
            }}
            className={cn(item, 'text-fg hover:bg-surface-2 focus:bg-surface-2')}
          >
            <Columns2 size={14} className="text-muted" /> 오른쪽에 분할로 열기
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              onClose();
              openSplit('bottom');
            }}
            className={cn(item, 'text-fg hover:bg-surface-2 focus:bg-surface-2')}
          >
            <Rows2 size={14} className="text-muted" /> 아래에 분할로 열기
          </button>
        </>
      )}
      {win && (
        <button
          type="button"
          role="menuitem"
          onClick={() => {
            onClose();
            desktop?.windows?.openSession(win);
            useUi.getState().setDrawer(false);
          }}
          className={cn(item, 'text-fg hover:bg-surface-2 focus:bg-surface-2')}
        >
          <AppWindow size={14} className="text-muted" /> 새 창으로 열기
        </button>
      )}
      {(split || win) && <div className="my-1 h-px bg-line" />}
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

/**
 * 세션 행 [+] 드롭다운: 빈 하위 페이지·빈 하위 세션을 바로 만든다 (ADR-075).
 * 부모가 페이지면 본문 끝에 하위 페이지 링크도 붙인다.
 */
export function SubCreateMenu({ at, parentId, trigger, onClose }: { at: MenuPoint; parentId: ID; trigger?: HTMLElement | null; onClose(): void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!ref.current?.contains(t) && !trigger?.contains(t)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
        trigger?.focus();
      }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        const items = [...(ref.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
        if (!items.length) return;
        e.preventDefault();
        const i = items.indexOf(document.activeElement as HTMLElement);
        items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
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
  }, [onClose, trigger]);

  const done = () => {
    onClose();
    if (isMobileNow()) useUi.getState().setDrawer(false);
  };
  const addPage = () => {
    flushPageDraft(parentId);
    const a = actions();
    const parent = a.sessions[parentId];
    const id = a.newPage(undefined, { parentId });
    if (!id) return done();
    if (parent?.kind === 'page') a.updatePage(parentId, appendPageLink(pageDoc(a.messages[parentId])?.content ?? '', NEW_PAGE_TITLE, id));
    done();
  };
  const addCanvas = () => {
    flushPageDraft(parentId);
    const a = actions();
    const parent = a.sessions[parentId];
    const id = a.newPage(undefined, { parentId, kind: 'canvas' });
    if (!id) return done();
    if (parent?.kind === 'page') a.updatePage(parentId, appendPageLink(pageDoc(a.messages[parentId])?.content ?? '', NEW_CANVAS_TITLE, id));
    done();
  };
  // 세션은 질문 없이 빈 대화로 만들어 가지 자리(팝업·분할·시트)에 연다
  const addSession = () => {
    const id = actions().newSubSession(parentId, undefined, { focus: false });
    if (id) openBranch(id);
    done();
  };

  const w = 168;
  const h = 120;
  const item = 'flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-[13px] text-fg outline-none hover:bg-surface-2 focus:bg-surface-2';
  return createPortal(
    <div
      ref={ref}
      role="menu"
      aria-label="하위 항목 만들기"
      data-sub-create=""
      // 포털이라도 React 이벤트는 세션 행까지 올라가므로 여기서 끊는다
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      style={{ top: Math.min(at.y, window.innerHeight - h - 8), left: Math.max(8, Math.min(at.x, window.innerWidth - w - 8)), width: w }}
      className="animate-pop-in fixed z-[90] rounded-lg border border-line bg-elev p-1 shadow-float"
    >
      <button type="button" role="menuitem" onClick={addPage} className={item}>
        <FileText size={14} className="text-muted" /> 빈 페이지
      </button>
      <button type="button" role="menuitem" onClick={addCanvas} className={item}>
        <PenLine size={14} className="text-muted" /> 캔버스
      </button>
      <button type="button" role="menuitem" onClick={addSession} className={item}>
        <GitBranch size={14} className="text-muted" /> 세션
      </button>
    </div>,
    document.body,
  );
}
