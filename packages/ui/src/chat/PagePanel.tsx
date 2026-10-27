import { applyPageBlock, filterPageBlocks, pageDoc, pageSlashQuery, type ID, type PageBlock, type Session } from '@branch/core';
import {
  Check,
  FileText,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  ListTodo,
  Minus,
  Pencil,
  Quote,
  Sigma,
  SquareCode,
  Table,
  type LucideIcon,
} from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { actions, useApp } from '../app/store';
import { Button } from '../components/Button';
import { caretOffset } from '../lib/caret';
import { cn } from '../lib/cn';
import type { PanelVariant } from './ChatPanel';
import { FootnoteList } from './Footnotes';
import { AssistantMessage } from './MessageItem';
import { SessionHeader } from './SessionHeader';

const SAVE_DELAY = 500;
const MENU_H = 320;

const BLOCK_ICONS: Record<string, LucideIcon> = {
  h1: Heading1,
  h2: Heading2,
  h3: Heading3,
  bullet: List,
  number: ListOrdered,
  todo: ListTodo,
  quote: Quote,
  code: SquareCode,
  divider: Minus,
  table: Table,
  math: Sigma,
};

/** `/` 블록 메뉴 상태 — start는 `/` 위치 */
interface Slash {
  start: number;
  query: string;
  left: number;
  top: number;
  up: boolean;
}

export interface PagePanelProps {
  sessionId: ID;
  variant?: PanelVariant;
  headerActions?: ReactNode;
  handleClassName?: string;
  className?: string;
}

/**
 * 마크다운 페이지 세션 (ADR-072). 본문은 문서 메시지 하나라 대화 답변과 똑같이
 * 글을 골라 묻기·하이라이트·메모가 되고, 편집 모드에서는 마크다운 원문을 고친다.
 */
export function PagePanel({ sessionId, variant = 'main', headerActions, handleClassName, className }: PagePanelProps) {
  const doc = useApp((s) => pageDoc(s.messages[sessionId]));
  const sessions = useApp((s) => s.sessions);
  const compact = variant !== 'main';
  const content = doc?.content ?? '';
  const [editing, setEditing] = useState(() => !content.trim());
  const [draft, setDraft] = useState(content);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pending = useRef<string | null>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const [slash, setSlash] = useState<Slash | null>(null);
  const [slashIndex, setSlashIndex] = useState(0);
  /** Esc로 닫은 `/` 위치 — 그 자리에선 다시 열지 않는다 */
  const closedAt = useRef<number | null>(null);
  const pendingSel = useRef<[number, number] | null>(null);
  const items = useMemo(() => (slash ? filterPageBlocks(slash.query) : []), [slash]);
  const slashOpen = items.length > 0;

  const flush = useCallback(() => {
    clearTimeout(timer.current);
    if (pending.current === null) return;
    const next = pending.current;
    pending.current = null;
    actions().updatePage(sessionId, next);
  }, [sessionId]);

  // 다른 세션으로 바뀌거나 닫힐 때 쓰던 글을 저장한다
  useEffect(() => flush, [flush]);

  // 편집 중이 아니면 바깥(원격·다른 창) 변경을 그대로 따른다
  useEffect(() => {
    if (!editing) setDraft(content);
  }, [content, editing]);

  // 다른 페이지로 바뀌면 그 페이지 상태로 다시 시작
  const [shown, setShown] = useState(sessionId);
  if (shown !== sessionId) {
    setShown(sessionId);
    setEditing(!content.trim());
    setDraft(content);
    setSlash(null);
    closedAt.current = null;
  }

  useLayoutEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
    // 블록을 넣은 뒤 커서·선택을 옮긴다
    if (pendingSel.current) {
      el.setSelectionRange(...pendingSel.current);
      pendingSel.current = null;
    }
  }, [draft, editing]);

  /** 커서 앞이 `/검색어`면 그 아래(공간이 없으면 위)에 블록 메뉴를 연다 */
  const syncSlash = () => {
    const el = area.current;
    if (!el || el.selectionStart !== el.selectionEnd) return setSlash(null);
    const q = pageSlashQuery(el.value, el.selectionStart);
    if (!q || closedAt.current === q.start) {
      if (!q) closedAt.current = null;
      return setSlash(null);
    }
    const c = caretOffset(el, q.start);
    const box = el.getBoundingClientRect();
    // 스크롤 영역과 (모바일 키보드가 줄인) 보이는 화면 안에서 아래 공간이 모자라면 위로 연다
    const view = el.closest('[data-scroll]')?.getBoundingClientRect();
    const vv = window.visualViewport;
    const bottom = Math.min(view?.bottom ?? Infinity, vv ? vv.offsetTop + vv.height : window.innerHeight);
    const lineTop = box.top + c.top;
    const up = lineTop + c.height + MENU_H > bottom && lineTop - MENU_H > (view?.top ?? 0);
    setSlash({ start: q.start, query: q.query, left: Math.min(c.left, Math.max(0, el.clientWidth - 256)), top: up ? c.top : c.top + c.height, up });
  };
  useEffect(() => setSlashIndex(0), [slash?.start, slash?.query]);
  const menu = useRef<HTMLDivElement>(null);
  useEffect(() => {
    menu.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [slashIndex, slashOpen]);
  useEffect(() => {
    if (!editing) setSlash(null);
  }, [editing]);

  const pickBlock = (block: PageBlock) => {
    const el = area.current;
    if (!el || !slash) return;
    const r = applyPageBlock(el.value, slash.start, el.selectionStart, block);
    pendingSel.current = [r.selStart, r.selEnd];
    setSlash(null);
    onChange(r.text);
  };

  useEffect(() => {
    if (editing) area.current?.focus({ preventScroll: true });
  }, [editing, sessionId]);

  const onChange = (next: string) => {
    setDraft(next);
    pending.current = next;
    clearTimeout(timer.current);
    timer.current = setTimeout(flush, SAVE_DELAY);
  };
  const startEdit = () => {
    setDraft(content);
    setEditing(true);
  };
  const finish = () => {
    flush();
    setEditing(false);
  };

  // 이 문서에 앵커를 둔 가지 (위치 → 생성 순)와 직접 만든 하위 세션(각주)
  const branches = useMemo(
    () =>
      Object.values(sessions)
        .filter((s): s is Session => s.parentId === sessionId && !!s.anchor && s.anchor.messageId === doc?.id)
        .sort((a, b) => a.anchor!.startOffset - b.anchor!.startOffset || a.createdAt - b.createdAt),
    [sessions, sessionId, doc?.id],
  );
  const notes = useMemo(
    () => Object.values(sessions).filter((s) => s.parentId === sessionId && !s.anchor).sort((a, b) => a.createdAt - b.createdAt),
    [sessions, sessionId],
  );

  const toggle = editing ? (
    <Button size="sm" variant="primary" icon={<Check size={14} />} data-page-done="" onClick={finish}>
      완료
    </Button>
  ) : (
    <Button size="sm" icon={<Pencil size={14} />} data-page-edit="" onClick={startEdit}>
      편집
    </Button>
  );

  return (
    <section className={cn('flex h-full min-h-0 min-w-0 flex-col bg-bg', className)} data-panel={variant} data-page="" aria-label="페이지">
      <SessionHeader
        sessionId={sessionId}
        compact={compact}
        handleClassName={handleClassName}
        actions={
          <>
            {toggle}
            {headerActions}
          </>
        }
      />
      <div
        data-scroll=""
        className={cn('scroll-thin min-h-0 flex-1 overflow-y-auto overscroll-contain', compact ? 'px-3.5 py-4' : 'px-4 py-6 md:px-6')}
      >
        <div className="relative mx-auto max-w-3xl">
          {editing ? (
            <>
            <textarea
              ref={area}
              aria-label="페이지 본문 (마크다운)"
              value={draft}
              onChange={(e) => {
                onChange(e.target.value);
                syncSlash();
              }}
              onSelect={syncSlash}
              onBlur={() => {
                setSlash(null);
                flush();
              }}
              aria-controls={slashOpen ? `page-blocks-${sessionId}` : undefined}
              aria-activedescendant={slashOpen ? `page-block-${sessionId}-${slashIndex}` : undefined}
              onKeyDown={(e) => {
                // 한글 조합 중 Enter·Esc는 조합만 끝낸다 (Safari·Android는 keyCode 229)
                if (e.nativeEvent.isComposing || e.keyCode === 229) return;
                if (slashOpen) {
                  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                    e.preventDefault();
                    const n = items.length;
                    setSlashIndex((i) => (i + (e.key === 'ArrowDown' ? 1 : n - 1)) % n);
                    return;
                  }
                  if ((e.key === 'Enter' || e.key === 'Tab') && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
                    e.preventDefault();
                    pickBlock(items[slashIndex] ?? items[0]!);
                    return;
                  }
                  if (e.key === 'Escape') {
                    // 메뉴만 닫고 편집은 이어간다
                    e.preventDefault();
                    closedAt.current = slash!.start;
                    setSlash(null);
                    return;
                  }
                }
                if (e.key === 'Escape' || ((e.metaKey || e.ctrlKey) && e.key === 'Enter')) {
                  e.preventDefault();
                  finish();
                }
              }}
              placeholder={'마크다운으로 자유롭게 적어 보세요.\n\n# 제목\n- 목록\n**굵게**, `코드`\n\n다 쓰면 완료를 누르고, 글을 골라 물어보거나 표시할 수 있어요.'}
              spellCheck={false}
              className="block min-h-[50vh] w-full resize-none overflow-hidden bg-transparent font-mono text-[14.5px] leading-relaxed text-fg outline-none placeholder:text-muted"
            />
            {slashOpen && slash && (
              <div
                data-page-blocks=""
                // 메뉴를 눌러도 본문 포커스(커서)를 잃지 않게
                onMouseDown={(e) => e.preventDefault()}
                style={{ left: slash.left, top: slash.top }}
                className={cn(
                  'animate-pop-in absolute z-20 flex w-64 max-w-full flex-col rounded-xl border border-line bg-elev p-1 shadow-float',
                  slash.up ? '-mt-1 -translate-y-full' : 'mt-1',
                )}
              >
                <div id={`page-blocks-${sessionId}-label`} className="px-2.5 pt-1 pb-1.5 text-[11.5px] font-medium text-muted">
                  블록 넣기 · ↑↓ 선택 · Enter
                </div>
                <div
                  id={`page-blocks-${sessionId}`}
                  ref={menu}
                  role="listbox"
                  aria-label="블록 넣기"
                  style={{ maxHeight: MENU_H - 40 }}
                  className="scroll-thin overflow-y-auto"
                >
                  {items.map((b, i) => {
                    const Icon = BLOCK_ICONS[b.id] ?? FileText;
                    return (
                      <button
                        key={b.id}
                        id={`page-block-${sessionId}-${i}`}
                        type="button"
                        role="option"
                        tabIndex={-1}
                        aria-selected={i === slashIndex}
                        data-block={b.id}
                        onMouseDown={(e) => e.preventDefault()}
                        onMouseEnter={() => setSlashIndex(i)}
                        onClick={() => pickBlock(b)}
                        className={cn('flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left', i === slashIndex && 'bg-surface-2')}
                      >
                        <span className="grid size-7 shrink-0 place-items-center rounded-md border border-line bg-surface text-fg-2">
                          <Icon size={15} />
                        </span>
                        <span className="min-w-0 flex-1 truncate text-[13.5px] text-fg">{b.label}</span>
                        <code className="shrink-0 text-[12px] text-muted">{b.hint}</code>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
            </>
          ) : content.trim() && doc ? (
            <div className="space-y-6">
              <AssistantMessage message={doc} branches={branches} isLast={false} />
              <FootnoteList notes={notes} />
            </div>
          ) : (
            <button
              type="button"
              onClick={startEdit}
              className="flex w-full flex-col items-center gap-2 rounded-xl border border-dashed border-line py-16 text-[14px] text-muted hover:bg-surface-2/60"
            >
              <FileText size={22} />
              빈 페이지예요. 눌러서 쓰기 시작
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
