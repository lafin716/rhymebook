import {
  branchQuestion,
  findAnnotationsOverlapping,
  findExactAnnotation,
  MAX_NOTE_LENGTH,
  type AnnotationPatch,
  type AnnotationStyle,
  type MarkColor,
  type MarkFont,
} from '@branch/core';
import {
  Archive,
  Bold,
  Check,
  ChevronDown,
  Copy,
  CornerDownRight,
  Eraser,
  Highlighter,
  HelpCircle,
  Italic,
  MessageSquarePlus,
  Pencil,
  RotateCcw,
  Send,
  Square,
  StickyNote,
  TextQuote,
  Type,
  Underline,
  Volume2,
  X,
  ZoomIn,
} from 'lucide-react';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { caps } from '../app/capabilities';
import { actions, useApp } from '../app/store';
import { useUi } from '../app/uiState';
import { useBreakpoint } from '../app/useBreakpoint';
import { pushNotice } from '../app/sync';
import { cn } from '../lib/cn';
import { saveToVault } from '../vault/save';
import { speak, stopSpeaking, useSpeech } from '../voice/speak';
import { ColorPalette, COLOR_KIND_LABELS, colorLabel, swatchCss, type ColorKind } from './ColorPalette';
import { hasComposer, quoteToComposer, toQuote } from './composerBridge';
import { openBranch } from './open';
import { MENU_GAP, placeMenu, readSelection, type PendingBranch } from './selection';

/**
 * 전역 선택 컨트롤러.
 * assistant 메시지 안에서 텍스트를 선택하면 가지 액션을 띄운다.
 * - 데스크톱/태블릿: 선택 영역을 가리지 않는 위치(위 → 아래 → 옆)의 플로팅 메뉴.
 *   설정에서 "우클릭으로 열기"를 고르면 선택 후 우클릭할 때만 띄운다
 * - 모바일: 하단 액션바 (길게 눌러 선택 → OS 콜아웃과 겹치지 않게 아래쪽). 선택이 가려지면 위쪽으로
 */
export function SelectionMenu() {
  const bp = useBreakpoint();
  const mobile = bp === 'mobile';
  const trigger = useUi((s) => s.selectionTrigger);
  const onContextMenu = !mobile && caps.kind !== 'mobile' && trigger === 'contextmenu';
  const [pending, setPending] = useState<PendingBranch | null>(null);
  const [custom, setCustom] = useState(false);
  const [question, setQuestion] = useState('');
  const [memo, setMemo] = useState<string | null>(null);
  const [palette, setPalette] = useState<ColorKind | null>(null);
  const [copied, setCopied] = useState(false);
  /** 직접 고친 선택 글 (null = 선택 그대로). 질문·첨부·복사·듣기·보관에 쓴다. 서식·메모 범위는 원래 선택 그대로 */
  const [edited, setEdited] = useState<string | null>(null);
  /** 선택 글 고치는 중의 입력값 (null = 고치는 중 아님) */
  const [draft, setDraft] = useState<string | null>(null);
  const annotations = useApp((s) => s.annotations);
  // 페이지 읽기 화면에서는 글자 효과(색·굵게·기울임·글꼴)를 숨긴다 — 서식은 편집기에서 마크다운으로 (ADR-077)
  const onPage = useApp((s) => (pending ? s.sessions[pending.sessionId]?.kind === 'page' : false));
  const speaking = useSpeech((s) => s.status !== 'idle');
  const dragging = useRef(false);
  const touchingMenu = useRef(false);
  const menuRef = useRef<HTMLDivElement>(null);
  /** 입력 중(직접 질문·메모·색상표·글 고치기)이나 글을 고친 뒤에는 DOM 선택이 사라져도 메뉴를 유지한다 */
  const frozenRef = useRef(false);
  frozenRef.current = custom || memo !== null || palette !== null || draft !== null || edited !== null;
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);

  const dismiss = useCallback(() => {
    setPending(null);
    setCustom(false);
    setQuestion('');
    setMemo(null);
    setPalette(null);
    setCopied(false);
    setEdited(null);
    setDraft(null);
  }, []);

  useEffect(() => {
    let timer = 0;
    const evaluate = () => {
      if (frozenRef.current || touchingMenu.current) return;
      const next = readSelection();
      // 우클릭 모드: 선택만으로는 열지 않고, 선택이 사라지면 닫는다. 열려 있으면 선택 변화를 따라간다
      if (onContextMenu) setPending((cur) => (next && cur ? next : null));
      else setPending(next);
    };
    const schedule = (ms: number) => {
      window.clearTimeout(timer);
      timer = window.setTimeout(evaluate, ms);
    };
    const onDown = (e: MouseEvent) => {
      if ((e.target as Element).closest?.('[data-selection-menu]')) return;
      // 색상표가 열린 채 바깥을 누르면 색상표를 닫고 평소처럼 선택을 다시 읽는다. 고친 글도 새 선택에서는 버린다
      setPalette(null);
      if (draft === null) setEdited(null);
      frozenRef.current = custom || memo !== null || draft !== null;
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
    const onContext = (e: MouseEvent) => {
      if (!onContextMenu || (e.target as Element).closest?.('[data-selection-menu]')) return;
      const next = readSelection();
      if (!next) return;
      e.preventDefault();
      window.clearTimeout(timer);
      setPending(next);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('mouseup', onUp);
    document.addEventListener('touchend', onUp);
    document.addEventListener('selectionchange', onChange);
    document.addEventListener('contextmenu', onContext);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('mouseup', onUp);
      document.removeEventListener('touchend', onUp);
      document.removeEventListener('selectionchange', onChange);
      document.removeEventListener('contextmenu', onContext);
    };
  }, [mobile, onContextMenu, custom, memo, draft]);

  useEffect(() => {
    if (!pending) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (palette) {
        setPalette(null);
        return;
      }
      if (draft !== null) {
        setDraft(null);
        return;
      }
      window.getSelection()?.removeAllRanges();
      dismiss();
    };
    const onScroll = () => {
      if (!mobile && !frozenRef.current) setPending(readSelection());
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [pending, mobile, palette, draft, dismiss]);

  // 실제 메뉴 크기를 재서 위치를 정한다 (내용에 따라 높이가 달라짐)
  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      setSize((p) => (p && Math.abs(p.w - r.width) < 1 && Math.abs(p.h - r.height) < 1 ? p : { w: r.width, h: r.height }));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  });

  if (!pending) return null;

  /** 질문·첨부 등에 쓸 글: 고친 글이 있으면 그것, 아니면 지금 선택 */
  const textOf = () => edited ?? (window.getSelection()?.toString() || pending.anchor.text);

  const run = (kind: 'what' | 'detail' | 'custom') => {
    if (kind === 'custom' && !question.trim()) return;
    // 고친 글은 질문 문장에만 반영한다. 앵커(원문 위치·하이라이트)는 원래 선택 그대로
    const id =
      edited === null
        ? actions().createBranch(pending.sessionId, pending.anchor, kind, kind === 'custom' ? question.trim() : undefined)
        : actions().createBranch(
            pending.sessionId,
            pending.anchor,
            'custom',
            kind === 'custom' ? `${toQuote(edited)}\n\n${question.trim()}` : branchQuestion(kind, edited),
          );
    window.getSelection()?.removeAllRanges();
    dismiss();
    if (id) openBranch(id);
  };

  /** 선택한 글을 복사한다. 메뉴는 그대로 두어 이어서 가지를 칠 수 있다 */
  const copy = async () => {
    const text = textOf();
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // 클립보드 API가 막힌 환경: 아직 살아 있는 선택을 복사한다
      if (!document.execCommand('copy')) return;
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  /** 선택한 글을 이 세션 입력창에 인용으로 붙인다. 이어서 질문을 쓰면 함께 보낸다 */
  const attach = () => {
    const text = textOf();
    if (!quoteToComposer(pending.sessionId, text)) {
      pushNotice('이 세션의 입력창이 열려 있지 않아요.');
      return;
    }
    window.getSelection()?.removeAllRanges();
    dismiss();
  };

  /** 선택한 글을 보관함에 담는다 (ADR-055) */
  const keep = () => {
    saveToVault({ type: 'text', text: textOf() }, pending.anchor.messageId);
    window.getSelection()?.removeAllRanges();
    dismiss();
  };

  /** 선택한 글을 읽어 준다 (ADR-050). 읽는 중이면 멈춘다. 메뉴는 그대로 둔다 */
  const listen = () => {
    if (speaking) stopSpeaking();
    else speak(textOf());
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

  /** 색 서식 지정 (null = 해당 색 서식 지우기). 토글이 아니라 그 값으로 맞춘다 */
  const setColor = (kind: ColorKind, color: MarkColor | null) => {
    if (exact) actions().updateAnnotation(exact.id, { [kind]: color } as AnnotationPatch);
    else if (color) actions().addAnnotation(pending.sessionId, pending.anchor, { [kind]: color } as AnnotationStyle);
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
    onContextMenu: (e: ReactMouseEvent) => e.preventDefault(),
    onPointerDown: () => {
      touchingMenu.current = true;
      window.setTimeout(() => {
        touchingMenu.current = false;
        // 서식 버튼은 메뉴를 닫지 않으므로, 그 사이 선택이 바뀌었으면 다시 맞춘다 (데스크톱은 선택이 유지됨)
        if (!mobile && !frozenRef.current) {
          const next = readSelection();
          if (next) setPending(next);
        }
      }, 600);
    },
  };

  const shown = edited ?? pending.anchor.text;
  const quote = shown.length > 40 ? `${shown.slice(0, 40)}…` : shown;

  /** 선택 글 고치기 시작 (지금 선택 또는 이미 고친 글로) */
  const startEdit = () => setDraft(edited ?? (window.getSelection()?.toString() || pending.anchor.text));
  const applyEdit = () => {
    const t = (draft ?? '').trim();
    if (!t) return;
    // 원래 선택과 같으면 고치지 않은 것으로
    setEdited(t === pending.anchor.text.trim() ? null : t);
    setDraft(null);
  };

  const editForm = (
    <form
      className="flex flex-col gap-1.5"
      onSubmit={(e) => {
        e.preventDefault();
        applyEdit();
      }}
    >
      <textarea
        autoFocus
        value={draft ?? ''}
        maxLength={SELECTION_MAX}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            applyEdit();
          }
        }}
        onFocus={(e) => e.currentTarget.setSelectionRange(e.currentTarget.value.length, e.currentTarget.value.length)}
        rows={3}
        aria-label="선택한 글 고치기"
        className="w-full resize-none rounded-lg border border-line bg-bg p-2 text-sm outline-none focus:border-accent"
      />
      <div className="flex items-center justify-between gap-1.5">
        <span className="text-[12px] text-muted">질문·첨부·복사에 고친 글을 써요</span>
        <span className="flex gap-1.5">
          <button
            type="button"
            onClick={() => setDraft(null)}
            className="h-8 rounded-lg px-3 text-[13px] text-fg-2 hover:bg-surface-2"
          >
            취소
          </button>
          <button
            type="submit"
            disabled={!(draft ?? '').trim()}
            className="h-8 rounded-lg bg-accent px-3 text-[13px] font-medium text-accent-fg disabled:opacity-40"
          >
            적용
          </button>
        </span>
      </div>
    </form>
  );

  /** 고친 글 표시 (데스크톱 메뉴 위쪽) */
  const editedBar = edited !== null && (
    <div className="mb-1 flex w-0 min-w-full items-center gap-1.5 rounded-lg bg-surface-2 px-2 py-1 text-[12px] text-fg-2">
      <Pencil size={12} className="shrink-0 text-accent" />
      <span className="min-w-0 flex-1 truncate" data-testid="selection-edited">
        {quote}
      </span>
      <button type="button" onClick={startEdit} className="shrink-0 rounded px-1 text-accent hover:bg-surface">
        고치기
      </button>
      <button
        type="button"
        aria-label="원래 선택으로"
        title="원래 선택으로"
        onClick={() => setEdited(null)}
        className="inline-flex size-5 shrink-0 items-center justify-center rounded text-muted hover:bg-surface hover:text-fg"
      >
        <RotateCcw size={12} />
      </button>
    </div>
  );

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
      {!onPage && (
        <>
          {COLOR_KINDS.map(({ kind, Icon }) => {
            const cur = exact?.[kind];
            return (
              <button
                key={kind}
                type="button"
                aria-label={`${COLOR_KIND_LABELS[kind]} 색상표${cur ? ` (현재 ${colorLabel(cur)})` : ''}`}
                aria-haspopup="true"
                aria-expanded={palette === kind}
                title={COLOR_KIND_LABELS[kind]}
                onClick={() => setPalette(kind)}
                className={cn(
                  'inline-flex h-8 items-center gap-0.5 rounded-lg pr-1 pl-1.5 text-fg-2 transition-colors hover:bg-surface-2 hover:text-fg',
                  cur && 'text-fg',
                )}
              >
                <span className="flex flex-col items-center gap-[2px]">
                  <Icon size={15} />
                  <span
                    className="block h-[3px] w-4 rounded-full"
                    style={{ background: cur ? swatchCss(cur, kind) : 'var(--border-strong)' }}
                  />
                </span>
                <ChevronDown size={11} className="text-muted" />
              </button>
            );
          })}
          <span className="mx-0.5 h-5 w-px bg-line" aria-hidden />
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
        </>
      )}
      <ToolButton label="선택한 글 고치기" pressed={edited !== null} onClick={startEdit}>
        <Pencil size={15} />
      </ToolButton>
      <ToolButton label={exact?.note ? '메모 수정' : '메모'} pressed={!!exact?.note} onClick={() => setMemo(exact?.note ?? '')}>
        <StickyNote size={15} />
      </ToolButton>
    </div>
  );

  const paletteView = palette && (
    <ColorPalette
      key={palette}
      kind={palette}
      current={exact?.[palette]}
      mobile={mobile}
      onPick={(c) => setColor(palette, c)}
      onBack={() => setPalette(null)}
    />
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
      {hasComposer(pending.sessionId) && (
        <MenuButton size={size} icon={<TextQuote size={size === 'lg' ? 18 : 15} />} onClick={attach}>
          질문에 첨부
        </MenuButton>
      )}
      <MenuButton
        size={size}
        icon={copied ? <Check size={size === 'lg' ? 18 : 15} /> : <Copy size={size === 'lg' ? 18 : 15} />}
        onClick={() => void copy()}
      >
        {copied ? '복사됨' : '복사'}
      </MenuButton>
      <MenuButton
        size={size}
        icon={speaking ? <Square size={size === 'lg' ? 17 : 14} /> : <Volume2 size={size === 'lg' ? 18 : 15} />}
        onClick={listen}
      >
        {speaking ? '멈춤' : '듣기'}
      </MenuButton>
      <MenuButton size={size} icon={<Archive size={size === 'lg' ? 18 : 15} />} onClick={keep}>
        보관
      </MenuButton>
    </>
  );

  if (mobile) {
    // 하단 바가 선택을 가리면 위쪽으로 올린다
    const barH = size?.h ?? 170;
    const atTop = pending.rect.bottom > window.innerHeight - barH - MENU_GAP && pending.rect.top > barH + MENU_GAP;
    return createPortal(
      <div
        ref={menuRef}
        {...guard}
        data-placement={atTop ? 'top' : 'bottom'}
        className={cn(
          'fixed inset-x-0 z-[70] bg-elev shadow-float',
          atTop ? 'safe-top top-0 border-b border-line' : 'animate-sheet-up safe-bottom bottom-0 border-t border-line',
        )}
      >
        <div className="flex items-center gap-2 px-4 pt-3 text-[13px] text-fg-2">
          <CornerDownRight size={14} className="shrink-0 text-anchor-line" />
          <button
            type="button"
            onClick={startEdit}
            aria-label="선택한 글 고치기"
            className="min-w-0 flex-1 truncate text-left"
          >
            <span className="rounded bg-anchor px-1 text-fg" data-testid={edited !== null ? 'selection-edited' : undefined}>
              {quote}
            </span>{' '}
            로 가지 치기 <Pencil size={12} className="inline align-[-1px] text-accent" />
          </button>
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
          {draft !== null ? (
            editForm
          ) : memo !== null ? (
            memoForm
          ) : custom ? (
            customForm
          ) : palette ? (
            paletteView
          ) : (
            <>
              <div className="grid grid-cols-4 gap-1.5">{actionButtons('lg')}</div>
              <div className="mt-2 border-t border-line pt-2">{toolbar}</div>
            </>
          )}
        </div>
      </div>,
      document.body,
    );
  }

  // 기본 메뉴는 버튼 글자가 잘리지 않게 내용 너비에 맞춘다 (잰 너비로 배치)
  const width = draft !== null ? 360 : custom ? 340 : memo !== null ? 320 : palette ? 300 : undefined;
  const pos = placeMenu(pending.rect, {
    w: width ?? size?.w ?? 660,
    h: size?.h ?? (custom ? 46 : memo !== null || draft !== null ? 128 : 84),
  });
  return createPortal(
    <div
      ref={menuRef}
      {...guard}
      role="toolbar"
      aria-label="가지·서식"
      data-placement={pos.placement}
      style={{ top: pos.top, left: pos.left, width }}
      className={cn(
        'animate-pop-in fixed z-[70] max-w-[calc(100vw-16px)] rounded-xl border border-line bg-elev p-1 shadow-float',
        width === undefined && 'w-max',
      )}
    >
      {draft !== null ? (
        <div className="p-1">{editForm}</div>
      ) : memo !== null ? (
        <div className="p-1">{memoForm}</div>
      ) : custom ? (
        <>
          {editedBar}
          {customForm}
        </>
      ) : palette ? (
        paletteView
      ) : (
        <>
          {editedBar}
          <div className="flex flex-wrap items-center gap-0.5">{actionButtons('sm')}</div>
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
          ? 'h-9 flex-1 gap-1.5 rounded-lg px-2.5 text-[13px] whitespace-nowrap'
          : 'h-14 min-w-0 flex-col gap-1 rounded-xl border border-line bg-surface text-[13px] whitespace-nowrap active:bg-surface-2',
      )}
    >
      <span className="text-accent">{icon}</span>
      {children}
    </button>
  );
}

/** 고친 선택 글 최대 길이 (sync 앵커 글 한도와 같게) */
const SELECTION_MAX = 10_000;

const COLOR_KINDS: { kind: ColorKind; Icon: typeof Highlighter }[] = [
  { kind: 'highlight', Icon: Highlighter },
  { kind: 'underline', Icon: Underline },
  { kind: 'textColor', Icon: Type },
];

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
