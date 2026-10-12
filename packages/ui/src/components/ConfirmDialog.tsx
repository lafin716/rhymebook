import { AlertTriangle, HelpCircle } from 'lucide-react';
import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { create } from 'zustand';
import { cn } from '../lib/cn';
import { Button } from './Button';

export interface ConfirmOptions {
  title: string;
  message?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** danger: 되돌릴 수 없는 작업(삭제 등). 빨간 버튼 + 취소에 초기 포커스 */
  tone?: 'default' | 'danger';
}

interface Pending extends ConfirmOptions {
  resolve(ok: boolean): void;
}

const useConfirmState = create<{ pending: Pending | null }>(() => ({ pending: null }));

/** window.confirm 대체. 앱에 <ConfirmHost />가 마운트되어 있어야 한다 */
export function confirm(options: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    useConfirmState.getState().pending?.resolve(false);
    useConfirmState.setState({ pending: { ...options, resolve } });
  });
}

function settle(ok: boolean) {
  const { pending } = useConfirmState.getState();
  if (!pending) return;
  useConfirmState.setState({ pending: null });
  pending.resolve(ok);
}

/** 확인 창 렌더러. 모바일은 하단 시트, 데스크톱은 중앙 카드 */
export function ConfirmHost() {
  const pending = useConfirmState((s) => s.pending);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const okRef = useRef<HTMLButtonElement>(null);
  const danger = pending?.tone === 'danger';

  useEffect(() => {
    if (!pending) return;
    (danger ? cancelRef : okRef).current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        settle(false);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [pending, danger]);

  if (!pending) return null;
  const Icon = danger ? AlertTriangle : HelpCircle;
  return createPortal(
    <div
      className="animate-fade-in fixed inset-0 z-[70] flex items-end justify-center bg-black/40 md:items-center md:p-6"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) settle(false);
      }}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby={pending.message ? 'confirm-message' : undefined}
        className="animate-pop-in w-full border-line bg-surface px-5 pt-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-float max-md:rounded-t-3xl max-md:border-t md:max-w-[380px] md:rounded-2xl md:border md:pb-5"
      >
        <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-line-strong md:hidden" />
        <div className="flex gap-3.5">
          <div
            className={cn(
              'grid size-10 shrink-0 place-items-center rounded-full',
              danger ? 'bg-danger-soft text-danger' : 'bg-accent-soft text-accent',
            )}
          >
            <Icon size={20} />
          </div>
          <div className="min-w-0 flex-1 pt-0.5">
            <h2 id="confirm-title" className="text-[16px] leading-snug font-semibold text-fg">
              {pending.title}
            </h2>
            {pending.message && (
              <div id="confirm-message" className="mt-1.5 text-[14px] leading-relaxed break-words text-muted">
                {pending.message}
              </div>
            )}
          </div>
        </div>
        <div className="mt-5 flex gap-2 max-md:flex-col-reverse md:justify-end">
          <Button ref={cancelRef} variant="secondary" className="max-md:h-11 max-md:w-full" onClick={() => settle(false)}>
            {pending.cancelLabel ?? '취소'}
          </Button>
          <Button
            ref={okRef}
            variant={danger ? 'danger' : 'primary'}
            className="max-md:h-11 max-md:w-full"
            onClick={() => settle(true)}
          >
            {pending.confirmLabel ?? '확인'}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
