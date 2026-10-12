import {
  findAnnotationsOverlapping,
  findExactAnnotation,
  MARK_COLORS,
  MAX_NOTE_LENGTH,
  type AnnotationPatch,
  type AnnotationStyle,
  type MarkColor,
  type MarkFont,
} from '@branch/core';
import {
  Bold,
  CornerDownRight,
  Eraser,
  Highlighter,
  HelpCircle,
  Italic,
  MessageSquarePlus,
  Send,
  StickyNote,
  Type,
  Underline,
  X,
  ZoomIn,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { actions, useApp } from '../app/store';
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
  const [memo, setMemo] = useState<string | null>(null);
  const [colorKind, setColorKind] = useState<ColorKind>('highlight');
  const annotations = useApp((s) => s.annotations);
  const dragging = useRef(false);
  const touchingMenu = useRef(false);
  const customRef = useRef(false);
  customRef.current = custom || memo !== null;

  const dismiss = useCallback(() => {
    setPending(null);
    setCustom(false);
    setQuestion('');
    setMemo(null);
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
    if (id) openBranch(id);
  };

  const { messageId, startOffset, endOffset } = pending.anchor;
  const exact = findExactAnnotation(annotations, messageId, startOffset, endOffset);

  /** 선택과 같은 범위의 서식에 적용 (같은 값이면 해제). 범위가 다르면 새로 만든다 */
  const applyStyle = (style: AnnotationStyle) => {
    const a = actions();
    if (exact) {
      const patch: AnnotationPatch = {};
      for (const [k, v] of Object.entries(style) as [keyof AnnotationStyle, AnnotationStyle[keyof AnnotationStyle]][]) {
        (patch as Record<string, unknown>)[k] = exact[k] === v ? null : v;
      }
      a.updateAnnotation(exact.id, patch);
    } else {
      a.addAnnotation(pending.sessionId, pending.anchor, style);
    }
  };

  /** 선택과 겹치는 서식을 지운다 (메모는 남김) */
  const clearStyle = () => {
    const clear: AnnotationPatch = { highlight: null, underline: null, textColor: null, font: null, bold: null, italic: null };
    for (const x of findAnnotationsOverlapping(annotations, messageId, startOffset, endOffset)) {
      actions().updateAnnotation(x.id, clear);
    }
  };

  const saveMemo = () => {
    const text = (memo ?? '').trim();
    if (exact) actions().updateAnnotation(exact.id, { note: text ? text : null });
    else if (text) actions().addAnnotation(pending.sessionId, pending.anchor, { note: text });
    window.getSelection()?.removeAllRanges();
    dismiss();
  };

  const guard = {
    'data-selection-menu': true,
    onMouseDown: (e: ReactMouseEvent) => {
      if (!(e.target as Element).closest('input, textarea')) e.preventDefault();
    },
    onPointerDown: () => {
      touchingMenu.current = true;
      window.setTimeout(() => {
        touchingMenu.current = false;
        // 서식 버튼은 메뉴를 닫지 않으므로, 그 사이 선택이 바뀌었으면 다시 맞춘다 (데스크톱은 선택이 유지됨)
        if (!mobile && !customRef.current) setPending(readSelection());
      }, 600);
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

  const memoForm = (
    <form
      className="flex flex-col gap-1.5"
      onSubmit={(e) => {
        e.preventDefault();
        saveMemo();
      }}
    >
      <textarea
        autoFocus
        value={memo ?? ''}
        maxLength={MAX_NOTE_LENGTH}
        onChange={(e) => setMemo(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) saveMemo();
        }}
        rows={3}
        placeholder={`"${quote}"에 메모…`}
        aria-label="메모"
        className="w-full resize-none rounded-lg border border-line bg-bg p-2 text-sm outline-none focus:border-accent"
      />
      <div className="flex justify-end gap-1.5">
        <button
          type="button"
          onClick={() => setMemo(null)}
          className="h-8 rounded-lg px-3 text-[13px] text-fg-2 hover:bg-surface-2"
        >
          취소
        </button>
        <button type="submit" className="h-8 rounded-lg bg-accent px-3 text-[13px] font-medium text-accent-fg">
          메모 저장
        </button>
      </div>
    </form>
  );

  const fontBtn = (font: MarkFont, label: string, sample: string) => (
    <ToolButton label={label} pressed={exact?.font === font} onClick={() => applyStyle({ font })}>
      <span className={cn('text-[13px] leading-none', font === 'mono' ? 'font-mono' : 'font-serif')}>{sample}</span>
    </ToolButton>
  );

  const toolbar = (
    <div className={cn('flex flex-wrap items-center gap-0.5', mobile && 'justify-between')} aria-label="서식">
      {COLOR_KINDS.map(({ kind, label, Icon }) => (
        <ToolButton key={kind} label={label} pressed={colorKind === kind} onClick={() => setColorKind(kind)}>
          <Icon size={15} />
        </ToolButton>
      ))}
      <span className="mx-0.5 flex items-center gap-0.5">
        {MARK_COLORS.map((c) => (
          <button
            key={c}
            type="button"
            aria-label={`${COLOR_KINDS.find((k) => k.kind === colorKind)!.label} ${COLOR_LABELS[c]}`}
            aria-pressed={exact?.[colorKind] === c}
            title={COLOR_LABELS[c]}
            data-color={c}
            onClick={() => applyStyle({ [colorKind]: c })}
            className={cn(
              'inline-flex items-center justify-center rounded-full',
              mobile ? 'size-8' : 'size-6',
            )}
          >
            <span
              className={cn(
                'block rounded-full ring-offset-1 ring-offset-elev',
                mobile ? 'size-5' : 'size-4',
                exact?.[colorKind] === c && 'ring-2 ring-fg',
              )}
              style={{ background: `var(--mark-${c})` }}
            />
          </button>
        ))}
      </span>
      <ToolButton label="굵게" pressed={!!exact?.bold} onClick={() => applyStyle({ bold: true })}>
        <Bold size={15} />
      </ToolButton>
      <ToolButton label="기울임" pressed={!!exact?.italic} onClick={() => applyStyle({ italic: true })}>
        <Italic size={15} />
      </ToolButton>
      {fontBtn('serif', '명조체', '가')}
      {fontBtn('mono', '고정폭', 'Aa')}
      <ToolButton label="서식 지우기" onClick={clearStyle}>
        <Eraser size={15} />
      </ToolButton>
      <ToolButton label={exact?.note ? '메모 수정' : '메모'} pressed={!!exact?.note} onClick={() => setMemo(exact?.note ?? '')}>
        <StickyNote size={15} />
      </ToolButton>
    </div>
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
          {memo !== null ? (
            memoForm
          ) : custom ? (
            customForm
          ) : (
            <>
              <div className="grid grid-cols-3 gap-2">{actionButtons('lg')}</div>
              <div className="mt-2 border-t border-line pt-2">{toolbar}</div>
            </>
          )}
        </div>
      </div>,
      document.body,
    );
  }

  const width = custom ? 340 : memo !== null ? 320 : 400;
  const height = custom ? 46 : memo !== null ? 128 : 84;
  const above = pending.rect.top > height + 24;
  const top = above ? pending.rect.top - height - 8 : pending.rect.bottom + 8;
  const left = Math.max(8, Math.min(window.innerWidth - width - 8, pending.rect.left + pending.rect.width / 2 - width / 2));
  return createPortal(
    <div
      {...guard}
      role="toolbar"
      aria-label="가지·서식"
      style={{ top, left, width }}
      className={cn('animate-pop-in fixed z-[70] rounded-xl border border-line bg-elev p-1 shadow-float')}
    >
      {memo !== null ? (
        <div className="p-1">{memoForm}</div>
      ) : custom ? (
        customForm
      ) : (
        <>
          <div className="flex items-center gap-0.5">{actionButtons('sm')}</div>
          <div className="mt-1 border-t border-line px-0.5 pt-1">{toolbar}</div>
        </>
      )}
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

type ColorKind = 'highlight' | 'underline' | 'textColor';

const COLOR_KINDS: { kind: ColorKind; label: string; Icon: typeof Highlighter }[] = [
  { kind: 'highlight', label: '형광펜', Icon: Highlighter },
  { kind: 'underline', label: '밑줄', Icon: Underline },
  { kind: 'textColor', label: '글자색', Icon: Type },
];

const COLOR_LABELS: Record<MarkColor, string> = {
  yellow: '노랑',
  green: '초록',
  blue: '파랑',
  purple: '보라',
  red: '빨강',
  orange: '주황',
};

function ToolButton({
  label,
  pressed,
  onClick,
  children,
}: {
  label: string;
  pressed?: boolean;
  onClick(): void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={pressed}
      title={label}
      onClick={onClick}
      className={cn(
        'inline-flex size-8 items-center justify-center rounded-lg text-fg-2 transition-colors hover:bg-surface-2 hover:text-fg',
        pressed && 'bg-accent-soft text-accent',
      )}
    >
      {children}
    </button>
  );
}
