import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../lib/cn';

export interface ModalProps {
  open: boolean;
  onClose(): void;
  children: ReactNode;
  /** 데스크톱 위치: 화면 중앙 또는 상단(명령 팔레트) */
  placement?: 'center' | 'top';
  className?: string;
  label: string;
}

/** 오버레이 모달. 모바일(<768)에서는 전체 화면 */
export function Modal({ open, onClose, children, placement = 'center', className, label }: ModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return createPortal(
    <div
      className={cn(
        'animate-fade-in fixed inset-0 z-[60] flex justify-center bg-black/35 max-md:pt-[env(safe-area-inset-top)] md:p-6',
        placement === 'top' ? 'items-start md:pt-[12vh]' : 'items-center',
      )}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={label}
        className={cn(
          'animate-pop-in flex h-full w-full flex-col overflow-hidden bg-surface md:h-auto md:max-h-[84vh] md:rounded-2xl md:border md:border-line md:shadow-float',
          className,
        )}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}
