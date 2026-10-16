import { useEffect, useRef, type ReactNode } from 'react';
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
  /** 태블릿 이상 높이: 내용만큼(auto), 화면 80%(tall), 화면 전체(full) */
  size?: 'auto' | 'tall' | 'full';
}

/** 열린 모달 순서. Esc는 맨 위 모달만 닫는다 (보관함 위 폴더 선택 창 등) */
const stack: symbol[] = [];

/** 오버레이 모달. 모바일(<768)에서는 전체 화면 */
export function Modal({ open, onClose, children, placement = 'center', className, label, size = 'auto' }: ModalProps) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    const me = Symbol();
    stack.push(me);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && stack[stack.length - 1] === me) closeRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      stack.splice(stack.indexOf(me), 1);
    };
  }, [open]);

  if (!open) return null;
  return createPortal(
    <div
      className={cn(
        'animate-fade-in fixed inset-0 z-[60] flex justify-center bg-black/35 max-md:pt-[env(safe-area-inset-top)]',
        size !== 'full' && 'md:p-6',
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
          'animate-pop-in flex h-full w-full flex-col overflow-hidden bg-surface',
          size === 'auto' && 'md:h-auto md:max-h-[84vh]',
          size === 'tall' && 'md:h-[80vh]',
          size !== 'full' && 'md:rounded-2xl md:border md:border-line md:shadow-float',
          size === 'full' ? 'md:pt-[env(safe-area-inset-top)]' : className,
        )}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}
