import { Keyboard, Redo2, Undo2, List, ListOrdered, CheckSquare, Bold, Heading3, ChevronDown, Pilcrow, Quote } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { EditorView } from '@codemirror/view';
import { undo, redo } from '@codemirror/commands';
import { caps } from '../app/capabilities';
import { cn } from '../lib/cn';
import { formatPage, indentPage, pageBlock } from './pageEditorBridge';
import type { PageBlockKind } from './pageEditorBridge';

interface PageKeyboardBarProps {
  /** CodeMirror 에디터 뷰 */
  view: EditorView | null;
  /** 실행 취소·다시 실행 상태: {undo, redo} 깊이 */
  history?: { undo: number; redo: number };
}

/** 모바일 앱 키보드 위 단축키 바 (ADR-087 P4) */
export function PageKeyboardBar({ view, history }: PageKeyboardBarProps) {
  const [enabled, setEnabled] = useState(() => {
    try {
      return localStorage.getItem('octobooks.page.keyboardBar') !== 'false';
    } catch {
      return true;
    }
  });
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const [barPosition, setBarPosition] = useState<number | null>(null);
  /** 글을 고른 동안은 숨긴다 — 선택 메뉴(가지·서식)가 키보드 위를 쓴다 (ADR-095) */
  const [selecting, setSelecting] = useState(false);
  useEffect(() => {
    if (!view) return;
    const onSel = () => {
      const sel = document.getSelection();
      setSelecting(!!sel && !sel.isCollapsed && !!sel.anchorNode && view.contentDOM.contains(sel.anchorNode));
    };
    document.addEventListener('selectionchange', onSel);
    return () => document.removeEventListener('selectionchange', onSel);
  }, [view]);
  const barPositionRef = useRef<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const maxInnerHeightRef = useRef(window.innerHeight);

  // 키보드 바 설정 변경 감시
  useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === 'octobooks.page.keyboardBar') {
        setEnabled(e.newValue !== 'false');
      }
    };
    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, []);

  // 키보드 감지 effect
  useEffect(() => {
    if (!view) return;

    maxInnerHeightRef.current = window.innerHeight;

    // 키보드 감지: innerHeight 120px 이상 감소 (Android) 또는 visualViewport.height 체크 (iOS)
    const detectKeyboard = () => {
      const isOpen =
        window.innerHeight < maxInnerHeightRef.current - 120 ||
        (window.visualViewport ? window.visualViewport.height < window.innerHeight - 120 : false);
      setKeyboardOpen(isOpen);

      let pos: number | null = null;
      if (isOpen && window.visualViewport) {
        // 키보드 바 위치: visualViewport 하단 바로 위
        pos = window.visualViewport.offsetTop + window.visualViewport.height;
      }
      barPositionRef.current = pos;
      setBarPosition(pos);
    };

    const onResize = () => {
      // 최대 높이 업데이트 (화면 회전 등)
      if (window.innerHeight > maxInnerHeightRef.current) {
        maxInnerHeightRef.current = window.innerHeight;
      }
      detectKeyboard();
    };

    window.addEventListener('resize', onResize);
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', onResize);
    }

    return () => {
      window.removeEventListener('resize', onResize);
      if (window.visualViewport) {
        window.visualViewport.removeEventListener('resize', onResize);
      }
    };
  }, [view]);

  // 모바일 기기가 아니거나 설정이 끌려 있으면 렌더하지 않음
  if (caps.kind !== 'mobile' || !enabled || !view || !keyboardOpen || barPosition === null || selecting) return null;

  const handleIndent = (dir: 1 | -1) => {
    if (view && indentPage(view, dir)) {
      view.focus();
    }
  };

  const handleBlock = (kind: PageBlockKind) => {
    if (view && pageBlock(view, kind)) {
      view.focus();
    }
  };

  const handleFormat = () => {
    if (view && formatPage(view, 'bold')) view.focus();
  };

  const handleUndo = () => {
    if (view) {
      undo({ state: view.state, dispatch: view.dispatch });
      view.focus();
    }
  };

  const handleRedo = () => {
    if (view) {
      redo({ state: view.state, dispatch: view.dispatch });
      view.focus();
    }
  };

  const handleCloseKeyboard = () => {
    const contentDOM = view?.contentDOM;
    if (contentDOM) {
      contentDOM.blur();
    }
  };

  return createPortal(
    <div
      ref={containerRef}
      style={{
        position: 'fixed',
        // 보이는 화면(키보드 위) 아래 끝에 바의 아래 끝을 맞춘다
        top: `${barPosition}px`,
        transform: 'translateY(-100%)',
        left: 0,
        right: 0,
        zIndex: 50,
      }}
      className="bg-surface border-t border-line shadow-float safe-bottom"
    >
      <div className="flex items-center gap-1 px-2 py-2 max-w-full overflow-x-auto scrollbar-hide">
        <KeyboardBarButton label="내어쓰기" icon={ChevronDown} rotate onClick={() => handleIndent(-1)} />
        <KeyboardBarButton label="들여쓰기" icon={ChevronDown} onClick={() => handleIndent(1)} />
        <span className="w-px h-6 bg-line mx-1 shrink-0" />

        <KeyboardBarButton label="본문" icon={Pilcrow} onClick={() => handleBlock('paragraph')} />
        <KeyboardBarButton label="글머리 목록" icon={List} onClick={() => handleBlock('bullet')} />
        <KeyboardBarButton label="번호 목록" icon={ListOrdered} onClick={() => handleBlock('ordered')} />
        <KeyboardBarButton label="할 일" icon={CheckSquare} onClick={() => handleBlock('todo')} />
        <KeyboardBarButton label="인용" icon={Quote} onClick={() => handleBlock('quote')} />
        <span className="w-px h-6 bg-line mx-1 shrink-0" />

        <KeyboardBarButton label="제목" icon={Heading3} onClick={() => handleBlock('h3')} />
        <KeyboardBarButton label="굵게" icon={Bold} onClick={handleFormat} />
        <span className="w-px h-6 bg-line mx-1 shrink-0" />

        <KeyboardBarButton label="실행 취소" icon={Undo2} disabled={!history || history.undo === 0} onClick={handleUndo} />
        <KeyboardBarButton label="다시 실행" icon={Redo2} disabled={!history || history.redo === 0} onClick={handleRedo} />
        <span className="w-px h-6 bg-line mx-1 shrink-0" />

        <KeyboardBarButton label="키보드 닫기" icon={Keyboard} onClick={handleCloseKeyboard} />
      </div>
    </div>,
    document.body,
  );
}

interface KeyboardBarButtonProps {
  label: string;
  icon: LucideIcon;
  disabled?: boolean;
  rotate?: boolean;
  onClick(): void;
}

function KeyboardBarButton({ label, icon: Icon, disabled, rotate, onClick }: KeyboardBarButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onPointerDown={(e) => {
        // editor가 focus를 잃지 않도록 preventDefault
        e.preventDefault();
        onClick();
      }}
      className={cn(
        'inline-flex size-9 shrink-0 items-center justify-center rounded-lg text-fg-2 hover:bg-surface-2 hover:text-fg transition-colors disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-fg-2',
        rotate && 'rotate-90',
      )}
    >
      <Icon size={18} />
    </button>
  );
}
