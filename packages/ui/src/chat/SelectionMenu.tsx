import { CornerDownRight, HelpCircle, MessageSquarePlus, Send, X, ZoomIn } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { actions } from '../app/store';
import { useBreakpoint } from '../app/useBreakpoint';
import { cn } from '../lib/cn';
import { openBranch } from './open';
import { readSelection, type PendingBranch } from './selection';

/**
 * 전역 선택 컨트롤러.
 * assistant 메시지 안에서 텍스트를 선택하면 가지 액션을 띄운다.
 * - 데스크톱/태블릿: 선택 영역 위 플로팅 메뉴
 * - 모바일: 하단 액션바 (길게 눌러 선택 → OS 콜아웃과 겹치지 않게 아래쪽)
 */
export function SelectionMenu() {
  const bp = useBreakpoint();
  const mobile = bp === 'mobile';
  const [pending, setPending] = useState<PendingBranch | null>(null);
  const [custom, setCustom] = useState(false);
  const [question, setQuestion] = useState('');
  const dragging = useRef(false);
  const touchingMenu = useRef(false);
  const customRef = useRef(false);
  customRef.current = custom;

  const dismiss = useCallback(() => {
    setPending(null);
    setCustom(false);
    setQuestion('');
  }, []);

  useEffect(() => {
    let timer = 0;
    const evaluate = () => {
      if (customRef.current || touchingMenu.current) return;
      setPending(readSelection());
    };
    const schedule = (ms: number) => {
      window.clearTimeout(timer);
      timer = window.setTimeout(evaluate, ms);
    };
    const onDown = (e: MouseEvent) => {
      if ((e.target as Element).closest?.('[data-selection-menu]')) return;
      dragging.current = true;
    };
    const onUp = () => {
      dragging.current = false;
      schedule(10);
    };
    const onChange = () => {
      if (dragging.current) return;
      schedule(mobile ? 280 : 120);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('mouseup', onUp);
    document.addEventListener('touchend', onUp);
    document.addEventListener('selectionchange', onChange);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('mouseup', onUp);
      document.removeEventListener('touchend', onUp);
      document.removeEventListener('selectionchange', onChange);
    };
  }, [mobile]);

  useEffect(() => {
    if (!pending) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        window.getSelection()?.removeAllRanges();
        dismiss();
      }
    };
    const onScroll = () => {
      if (!mobile && !customRef.current) setPending(readSelection());
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [pending, mobile, dismiss]);

  if (!pending) return null;

  const run = (kind: 'what' | 'detail' | 'custom') => {
    if (kind === 'custom' && !question.trim()) return;
    const id = actions().createBranch(pending.sessionId, pending.anchor, kind, kind === 'custom' ? question.trim() : undefined);
    window.getSelection()?.removeAllRanges();
    dismiss();
    openBranch(id);
  };

  const guard = {
    'data-selection-menu': true,
    onMouseDown: (e: ReactMouseEvent) => {
      if (!(e.target as Element).closest('input')) e.preventDefault();
    },
    onPointerDown: () => {
      touchingMenu.current = true;
      window.setTimeout(() => (touchingMenu.current = false), 600);
    },
  };

  const quote = pending.anchor.text.length > 40 ? `${pending.anchor.text.slice(0, 40)}…` : pending.anchor.text;

  const customForm = (
    <form
      className="flex items-center gap-1.5"
      onSubmit={(e) => {
        e.preventDefault();
        run('custom');
      }}
    >
      <input
        autoFocus
        value={question}
        onChange={(e) => setQuestion(e.target.value)}
        placeholder={`"${quote}"에 대해 질문…`}
        className="h-9 min-w-0 flex-1 rounded-lg border border-line bg-bg px-2.5 text-sm outline-none focus:border-accent"
      />
      <button
        type="submit"
        disabled={!question.trim()}
        aria-label="질문 보내기"
        className="inline-flex size-9 items-center justify-center rounded-lg bg-accent text-accent-fg disabled:opacity-40"
      >
        <Send size={16} />
      </button>
      <button
        type="button"
        aria-label="취소"
        onClick={() => setCustom(false)}
        className="inline-flex size-9 items-center justify-center rounded-lg text-fg-2 hover:bg-surface-2"
      >
        <X size={16} />
      </button>
    </form>
  );

  const actionButtons = (size: 'sm' | 'lg') => (
    <>
      <MenuButton size={size} icon={<HelpCircle size={size === 'lg' ? 18 : 15} />} onClick={() => run('what')}>
        이게 뭐야?
      </MenuButton>
      <MenuButton size={size} icon={<ZoomIn size={size === 'lg' ? 18 : 15} />} onClick={() => run('detail')}>
        더 자세히
      </MenuButton>
      <MenuButton size={size} icon={<MessageSquarePlus size={size === 'lg' ? 18 : 15} />} onClick={() => setCustom(true)}>
        직접 질문
      </MenuButton>
    </>
  );

  if (mobile) {
    return createPortal(
      <div
        {...guard}
        className="animate-sheet-up safe-bottom fixed inset-x-0 bottom-0 z-[70] border-t border-line bg-elev shadow-float"
      >
        <div className="flex items-center gap-2 px-4 pt-3 text-[13px] text-fg-2">
          <CornerDownRight size={14} className="shrink-0 text-anchor-line" />
          <span className="min-w-0 flex-1 truncate">
            <span className="rounded bg-anchor px-1 text-fg">{quote}</span> 로 가지 치기
          </span>
          <button
            aria-label="닫기"
            onClick={() => {
              window.getSelection()?.removeAllRanges();
              dismiss();
            }}
            className="-mr-1 inline-flex size-8 items-center justify-center rounded-lg text-muted"
          >
            <X size={16} />
          </button>
        </div>
        <div className="px-3 pt-2 pb-3">
          {custom ? customForm : <div className="grid grid-cols-3 gap-2">{actionButtons('lg')}</div>}
        </div>
      </div>,
      document.body,
    );
  }

  const width = custom ? 340 : 300;
  const above = pending.rect.top > 72;
  const top = above ? pending.rect.top - 48 : pending.rect.bottom + 8;
  const left = Math.max(8, Math.min(window.innerWidth - width - 8, pending.rect.left + pending.rect.width / 2 - width / 2));
  return createPortal(
    <div
      {...guard}
      role="toolbar"
      aria-label="가지 만들기"
      style={{ top, left, width }}
      className={cn('animate-pop-in fixed z-[70] rounded-xl border border-line bg-elev p-1 shadow-float')}
    >
      {custom ? customForm : <div className="flex items-center gap-0.5">{actionButtons('sm')}</div>}
    </div>,
    document.body,
  );
}

function MenuButton({
  icon,
  children,
  onClick,
  size,
}: {
  icon: ReactNode;
  children: ReactNode;
  onClick(): void;
  size: 'sm' | 'lg';
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex items-center justify-center font-medium text-fg transition-colors hover:bg-surface-2',
        size === 'sm'
          ? 'h-9 flex-1 gap-1.5 rounded-lg px-2 text-[13px]'
          : 'h-14 flex-col gap-1 rounded-xl border border-line bg-surface text-[13px] active:bg-surface-2',
      )}
    >
      <span className="text-accent">{icon}</span>
      {children}
    </button>
  );
}
