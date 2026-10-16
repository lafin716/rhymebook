import { buildTurns, type ID, type Session, type Turn } from '@branch/core';
import { ChevronDown, ChevronUp, EyeOff, GitBranch, GripHorizontal, ListOrdered, LocateFixed, NotebookPen, Sparkles, Trash2, X } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';
import { useApp } from '../app/store';
import { useUi } from '../app/uiState';
import { useBreakpoint } from '../app/useBreakpoint';
import { IconButton } from '../components/Button';
import { cn } from '../lib/cn';
import { isMac } from '../lib/platform';
import { snapDock } from './navDock';
import { openBranch } from './open';
import { removeTurn } from './turnDelete';

export interface ChatNavProps {
  sessionId: ID;
  scrollRef: RefObject<HTMLDivElement | null>;
  /** 단일 보기 메인 패널에서만 Alt+↑/↓ 단축키를 받는다 */
  keyboard?: boolean;
  /** 레일(우측 눈금)을 보여줄 패널인지 (팝업·시트는 좁아서 숨김) */
  rail?: boolean;
}

/** 질문 상단을 스크롤 영역 위에서 이만큼 띄워 맞춘다 */
const TOP_GAP = 12;
/** 이 비율 위치(읽는 줄)를 지난 마지막 질문을 "현재 질문"으로 본다 */
const READING_LINE = 0.35;

interface NavState {
  active: number;
  /** ↑ 대상: 현재 질문의 상단이 화면 위로 지나갔으면 현재 질문, 아니면 이전 질문 */
  prev: number;
  overflow: boolean;
}

const turnEl = (root: HTMLElement, id: ID) => root.querySelector<HTMLElement>(`[data-turn="${CSS.escape(id)}"]`);

function topOf(root: HTMLElement, el: HTMLElement) {
  return el.getBoundingClientRect().top - root.getBoundingClientRect().top + root.scrollTop;
}

/** 세션 대화 내비게이션: 질문 목차, 우측 레일, 이전/다음 질문 이동 */
export function ChatNav({ sessionId, scrollRef, keyboard = false, rail = true }: ChatNavProps) {
  const messages = useApp((s) => s.messages[sessionId]);
  const sessions = useApp((s) => s.sessions);
  const busy = useApp((s) => !!s.streaming[sessionId]);
  const turns = useMemo(() => buildTurns(messages ?? []), [messages]);
  const mobile = useBreakpoint() === 'mobile';
  const [nav, setNav] = useState<NavState>({ active: -1, prev: -1, overflow: false });
  const [panel, setPanel] = useState<'toc' | 'branches' | null>(null);
  const lockUntil = useRef(0);
  /** 버튼으로 이동한 질문. 바닥 근처라 질문을 맨 위로 올릴 수 없어도 사용자가 직접 스크롤하기 전까지 유지 */
  const pin = useRef<{ index: number; top: number | null } | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const branchToggleRef = useRef<HTMLButtonElement>(null);
  // 모바일: 끌어서 옮기는 핸들 (좌·우 가장자리에 붙고 세로는 자유, ADR-056)
  const dock = useUi((s) => s.navDock);
  const setDock = useUi((s) => s.setNavDock);
  const areaRef = useRef<HTMLDivElement>(null);
  const [tbSize, setTbSize] = useState({ w: 0, h: 0 });
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null);
  const [handleMenu, setHandleMenu] = useState(false);
  const [snapping, setSnapping] = useState(false);
  const dragStart = useRef<{ px: number; py: number; ox: number; oy: number; x: number; y: number; moved: boolean } | null>(null);

  // 답변 id → 그 답변에서 뻗은 가지 수
  const branchCount = useMemo(() => {
    const map = new Map<ID, number>();
    for (const s of Object.values(sessions)) {
      if (s.parentId !== sessionId || !s.anchor) continue;
      map.set(s.anchor.messageId, (map.get(s.anchor.messageId) ?? 0) + 1);
    }
    return map;
  }, [sessions, sessionId]);

  // 이 세션에서 뻗은 가지: 답변 순서 → 답변 안 위치 순
  const branches = useMemo(() => {
    const order = new Map((messages ?? []).map((m, i) => [m.id, i]));
    const turnOf = new Map<ID, number>();
    for (const t of turns) if (t.answerId) turnOf.set(t.answerId, t.index);
    const subCount = new Map<ID, number>();
    for (const s of Object.values(sessions)) if (s.parentId) subCount.set(s.parentId, (subCount.get(s.parentId) ?? 0) + 1);
    return Object.values(sessions)
      .filter((s) => s.parentId === sessionId && s.anchor)
      .sort(
        (a, b) =>
          (order.get(a.anchor!.messageId) ?? Infinity) - (order.get(b.anchor!.messageId) ?? Infinity) ||
          a.anchor!.startOffset - b.anchor!.startOffset,
      )
      .map((s) => ({ session: s, turn: turnOf.get(s.anchor!.messageId), sub: subCount.get(s.id) ?? 0 }));
  }, [sessions, sessionId, messages, turns]);

  // 직접 만든 하위 세션(각주): 생성 순. 가지 목록 아래에 고정해 보여준다 (ADR-054)
  const notes = useMemo(
    () => Object.values(sessions).filter((s) => s.parentId === sessionId && !s.anchor).sort((a, b) => a.createdAt - b.createdAt),
    [sessions, sessionId],
  );
  const linked = branches.length + notes.length;

  const measure = useCallback(() => {
    const root = scrollRef.current;
    if (!root) return;
    const overflow = root.scrollHeight - root.clientHeight > 40;
    const tops = turns.map((t) => {
      const el = turnEl(root, t.questionId);
      return el ? topOf(root, el) : Infinity;
    });
    const atBottom = root.scrollHeight - root.scrollTop - root.clientHeight < 4;
    const line = atBottom ? root.scrollTop + root.clientHeight - 40 : root.scrollTop + root.clientHeight * READING_LINE;
    let active = -1;
    tops.forEach((top, i) => {
      if (top <= line) active = i;
    });
    if (active < 0 && tops.length) active = 0;
    const p = pin.current;
    if (p && p.index < tops.length && (p.top === null || Math.abs(root.scrollTop - p.top) < 2)) active = p.index;
    else pin.current = null;
    const passed = active >= 0 && tops[active]! - TOP_GAP < root.scrollTop - 8;
    const next: NavState = { active, prev: passed ? active : active - 1, overflow };
    setNav((p) => (p.active === next.active && p.prev === next.prev && p.overflow === next.overflow ? p : next));
  }, [scrollRef, turns]);

  // 스크롤·크기 변화에 따라 현재 질문을 갱신
  useEffect(() => {
    const root = scrollRef.current;
    if (!root) return;
    let raf = 0;
    const schedule = () => {
      if (Date.now() < lockUntil.current) return;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(measure);
    };
    schedule();
    root.addEventListener('scroll', schedule, { passive: true });
    const ro = new ResizeObserver(schedule);
    ro.observe(root);
    if (root.firstElementChild) ro.observe(root.firstElementChild);
    return () => {
      cancelAnimationFrame(raf);
      root.removeEventListener('scroll', schedule);
      ro.disconnect();
    };
  }, [scrollRef, measure]);

  const jump = useCallback(
    (i: number) => {
      const root = scrollRef.current;
      const turn = turns[i];
      if (!root || !turn) return;
      const el = turnEl(root, turn.questionId);
      if (!el) return;
      const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      root.scrollTo({ top: Math.max(0, topOf(root, el) - TOP_GAP), behavior: reduce ? 'auto' : 'smooth' });
      lockUntil.current = Date.now() + 700;
      pin.current = { index: i, top: null };
      window.setTimeout(() => {
        if (pin.current?.index === i) pin.current.top = root.scrollTop;
        measure();
      }, 720);
      setNav((p) => ({ ...p, active: i, prev: i - 1 }));
      el.focus({ preventScroll: true });
      el.classList.remove('turn-flash');
      void el.offsetWidth;
      el.classList.add('turn-flash');
    },
    [scrollRef, turns, measure],
  );

  const canPrev = nav.prev >= 0;
  const canNext = nav.active + 1 < turns.length;
  const goPrev = useCallback(() => canPrev && jump(nav.prev), [canPrev, jump, nav.prev]);
  const goNext = useCallback(() => canNext && jump(nav.active + 1), [canNext, jump, nav.active]);

  // Alt+↑/↓ (입력 중이면 빈 입력창에서만)
  useEffect(() => {
    if (!keyboard) return;
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || e.metaKey || e.ctrlKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
      const t = e.target as HTMLElement | null;
      if (t?.isContentEditable) return;
      if (t instanceof HTMLInputElement) return;
      if (t instanceof HTMLTextAreaElement && t.value) return;
      e.preventDefault();
      if (e.key === 'ArrowUp') goPrev();
      else goNext();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [keyboard, goPrev, goNext]);

  // 목차: 바깥 클릭·Esc로 닫고, 열 때 현재 질문을 보이게
  useEffect(() => {
    if (!panel) return;
    panelRef.current?.querySelector<HTMLElement>('[aria-current="true"]')?.scrollIntoView({ block: 'nearest' });
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (panelRef.current?.contains(t) || toolbarRef.current?.contains(t)) return;
      setPanel(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setPanel(null);
        (panel === 'branches' ? branchToggleRef : toggleRef).current?.focus();
      }
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [panel]);

  // 핸들 메뉴: 바깥을 누르면 닫는다
  useEffect(() => {
    if (!handleMenu) return;
    const onDown = (e: PointerEvent) => {
      if (!toolbarRef.current?.contains(e.target as Node)) setHandleMenu(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [handleMenu]);

  // 모바일 툴바 크기 (붙을 위치 계산용)
  const docked = mobile && !dock.hidden;
  const showTurnsEarly = turns.length > 0 && (nav.overflow || turns.length >= 2);
  const visible = showTurnsEarly || linked > 0;
  useLayoutEffect(() => {
    const el = toolbarRef.current;
    if (!docked || !visible || !el) return;
    const read = () => setTbSize((p) => (p.w === el.offsetWidth && p.h === el.offsetHeight ? p : { w: el.offsetWidth, h: el.offsetHeight }));
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, [docked, visible]);

  const onHandleDown = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const area = areaRef.current?.getBoundingClientRect();
    const tb = toolbarRef.current?.getBoundingClientRect();
    if (!area || !tb) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const ox = tb.left - area.left;
    const oy = tb.top - area.top;
    dragStart.current = { px: e.clientX, py: e.clientY, ox, oy, x: ox, y: oy, moved: false };
  };
  const onHandleMove = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const d = dragStart.current;
    const area = areaRef.current;
    if (!d || !area) return;
    const dx = e.clientX - d.px;
    const dy = e.clientY - d.py;
    if (!d.moved && Math.hypot(dx, dy) < 6) return;
    if (!d.moved) {
      d.moved = true;
      setHandleMenu(false);
      setPanel(null);
    }
    d.x = Math.min(Math.max(0, d.ox + dx), Math.max(0, area.clientWidth - tbSize.w));
    d.y = Math.min(Math.max(0, d.oy + dy), Math.max(0, area.clientHeight - tbSize.h));
    setDrag({ x: d.x, y: d.y });
  };
  const onHandleUp = (cancel: boolean) => {
    const d = dragStart.current;
    const area = areaRef.current;
    dragStart.current = null;
    if (!d) return;
    if (!d.moved) {
      if (!cancel) setHandleMenu((v) => !v);
      return;
    }
    if (area) setDock(snapDock(d.x, d.y, tbSize.w, tbSize.h, area.clientWidth, area.clientHeight));
    setSnapping(true);
    setDrag(null);
  };

  /** 이 패널 본문에서 가지 앵커로 스크롤하고 깜빡인다 */
  const revealHere = (id: ID) => {
    const el = scrollRef.current?.querySelector<HTMLElement>(`mark.anchor[data-session-ids~="${CSS.escape(id)}"]`);
    if (!el) return;
    el.scrollIntoView({ block: 'center', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    el.classList.remove('anchor-flash');
    void el.offsetWidth;
    el.classList.add('anchor-flash');
  };

  const showTurns = showTurnsEarly;
  if (!visible) return null;

  const alt = isMac ? '⌥' : 'Alt+';
  const btnSize = mobile ? 'md' : 'sm';
  const dockStyle: CSSProperties = drag
    ? { left: drag.x, top: drag.y }
    : {
        left: dock.side === 'left' ? 0 : `calc(100% - ${tbSize.w}px)`,
        top: `calc((100% - ${tbSize.h}px) * ${dock.y})`,
      };
  const position = nav.active >= 0 ? `${nav.active + 1}/${turns.length}` : `–/${turns.length}`;

  return (
    <>
      {rail && !mobile && turns.length >= 2 && <TurnRail turns={turns} active={nav.active} onJump={jump} />}

      {mobile && dock.hidden ? null : (
      <div ref={areaRef} className={cn(mobile ? 'pointer-events-none absolute inset-2.5 z-10' : 'contents')}>
      <div
        ref={toolbarRef}
        className={cn(
          'flex flex-col items-center rounded-xl border border-line bg-surface/95 p-0.5 shadow-pop backdrop-blur',
          mobile
            ? cn(
                'pointer-events-auto absolute',
                // 손을 뗀 뒤 가장자리로 달라붙는 동안만 애니메이션 (첫 배치·크기 변화는 즉시)
                snapping && 'transition-[left,top] duration-300 ease-[cubic-bezier(0.25,1.3,0.5,1)] motion-reduce:transition-none',
                drag && 'shadow-float',
                !tbSize.w && 'invisible',
              )
            : 'absolute right-2.5 bottom-2.5 z-10',
        )}
        style={mobile ? dockStyle : undefined}
        onTransitionEnd={(e) => {
          if (e.target === e.currentTarget) setSnapping(false);
        }}
        role="toolbar"
        aria-label="질문 이동"
        data-nav-dock={mobile ? dock.side : undefined}
      >
        {mobile && (
          <button
            type="button"
            aria-label="내비게이션 핸들 (끌어서 옮기기, 눌러서 메뉴)"
            aria-haspopup="menu"
            aria-expanded={handleMenu}
            data-nav-handle=""
            onPointerDown={onHandleDown}
            onPointerMove={onHandleMove}
            onPointerUp={() => onHandleUp(false)}
            onPointerCancel={() => onHandleUp(true)}
            className={cn('flex h-6 w-10 touch-none items-center justify-center rounded-lg text-muted active:bg-surface-2', drag ? 'cursor-grabbing' : 'cursor-grab')}
          >
            <GripHorizontal size={16} />
          </button>
        )}
        {mobile && handleMenu && (
          <div
            role="menu"
            className={cn(
              'animate-pop-in absolute top-0 w-max rounded-xl border border-line bg-elev p-1 shadow-float',
              dock.side === 'left' ? 'left-full ml-1.5' : 'right-full mr-1.5',
            )}
          >
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setHandleMenu(false);
                setPanel(null);
                setDock({ hidden: true });
              }}
              className="flex h-10 items-center gap-2 rounded-lg px-3 text-[14px] text-fg hover:bg-surface-2"
            >
              <EyeOff size={15} className="text-muted" /> 숨기기
            </button>
          </div>
        )}
        {linked > 0 && (
          <>
            <span className="relative">
              <IconButton
                ref={branchToggleRef}
                size={btnSize}
                label={`이 페이지의 가지 ${linked}개`}
                active={panel === 'branches'}
                aria-expanded={panel === 'branches'}
                onClick={() => setPanel((p) => (p === 'branches' ? null : 'branches'))}
              >
                <GitBranch size={16} className="text-anchor-line" />
              </IconButton>
              <span className="pointer-events-none absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-anchor-line px-1 text-[10px] leading-none font-semibold text-accent-fg tabular-nums">
                {linked}
              </span>
            </span>
            {showTurns && <div className="my-0.5 h-px w-5 bg-line" />}
          </>
        )}
        {showTurns && (
          <>
            <IconButton
              ref={toggleRef}
              size={btnSize}
              label="대화 목차"
              active={panel === 'toc'}
              aria-expanded={panel === 'toc'}
              onClick={() => setPanel((p) => (p === 'toc' ? null : 'toc'))}
            >
              <ListOrdered size={16} />
            </IconButton>
            <div className="my-0.5 h-px w-5 bg-line" />
            <IconButton size={btnSize} label={`이전 질문 (${alt}↑)`} disabled={!canPrev} onClick={goPrev}>
              <ChevronUp size={18} />
            </IconButton>
            <span className="py-0.5 text-[11px] leading-none text-muted tabular-nums" aria-live="polite">
              {position}
            </span>
            <IconButton size={btnSize} label={`다음 질문 (${alt}↓)`} disabled={!canNext} onClick={goNext}>
              <ChevronDown size={18} />
            </IconButton>
          </>
        )}
      </div>
      </div>
      )}

      {panel && (
        <div
          ref={panelRef}
          role="dialog"
          aria-label={panel === 'toc' ? '대화 목차' : '가지 목록'}
          className={cn(
            'animate-pop-in absolute z-20 flex flex-col overflow-hidden rounded-xl border border-line bg-elev shadow-float',
            'inset-x-2 bottom-2 max-h-[72%]',
            '@md:inset-x-auto @md:right-15 @md:bottom-2.5 @md:max-h-[min(72%,520px)] @md:w-[340px]',
          )}
        >
          {panel === 'toc' ? (
            <>
              <div className="flex h-11 shrink-0 items-center gap-2 border-b border-line pr-1 pl-3.5">
                <ListOrdered size={15} className="text-muted" />
                <span className="flex-1 text-[14px] font-semibold">대화 목차</span>
                <span className="text-[12px] text-muted">질문 {turns.length}개</span>
                <IconButton size="sm" label="목차 닫기" onClick={() => setPanel(null)}>
                  <X size={16} />
                </IconButton>
              </div>
              <ol className="scroll-thin min-h-0 flex-1 overflow-y-auto p-1.5">
                {turns.map((t) => (
                  <li key={t.questionId}>
                    <TurnItem
                      turn={t}
                      active={t.index === nav.active}
                      branches={t.answerId ? (branchCount.get(t.answerId) ?? 0) : 0}
                      onClick={() => {
                        jump(t.index);
                        if (mobile) setPanel(null);
                      }}
                      // 첫 질문은 삭제 불가 (세션 제목·가지 맥락의 기준)
                      onDelete={t.index > 0 ? () => void removeTurn(sessionId, t.questionId) : undefined}
                      deleteDisabled={busy}
                    />
                  </li>
                ))}
              </ol>
            </>
          ) : (
            <>
              <div className="flex h-11 shrink-0 items-center gap-2 border-b border-line pr-1 pl-3.5">
                <GitBranch size={15} className="text-anchor-line" />
                <span className="flex-1 text-[14px] font-semibold">이 페이지의 가지</span>
                <span className="text-[12px] text-muted">{linked}개</span>
                <IconButton size="sm" label="가지 목록 닫기" onClick={() => setPanel(null)}>
                  <X size={16} />
                </IconButton>
              </div>
              {branches.length > 0 && (
              <ul className="scroll-thin min-h-0 flex-1 overflow-y-auto p-1.5">
                {branches.map((b) => (
                  <li key={b.session.id}>
                    <BranchItem
                      session={b.session}
                      turn={b.turn}
                      sub={b.sub}
                      onOpen={() => {
                        setPanel(null);
                        openBranch(b.session.id);
                      }}
                      onReveal={() => {
                        if (mobile) setPanel(null);
                        revealHere(b.session.id);
                      }}
                    />
                  </li>
                ))}
              </ul>
              )}
              {notes.length > 0 && (
                <div
                  data-nav-footnotes=""
                  className={cn('flex min-h-0 flex-col', branches.length > 0 ? 'max-h-[45%] shrink-0 border-t border-line' : 'flex-1')}
                >
                  <div className="flex h-9 shrink-0 items-center gap-1.5 px-3.5 text-[12.5px] font-semibold text-muted">
                    <NotebookPen size={13} /> 각주 {notes.length}
                  </div>
                  <ol className="scroll-thin min-h-0 flex-1 overflow-y-auto px-1.5 pb-1.5">
                    {notes.map((n, i) => (
                      <li key={n.id}>
                        <button
                          type="button"
                          onClick={() => {
                            setPanel(null);
                            openBranch(n.id);
                          }}
                          className="flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-surface-2"
                        >
                          <span className="shrink-0 pt-px text-[12.5px] font-semibold text-accent tabular-nums">[{i + 1}]</span>
                          <span className="min-w-0 flex-1">
                            <span className="line-clamp-1 text-[13.5px] leading-snug font-medium text-fg">{n.title}</span>
                            {n.summary && (
                              <span className="mt-0.5 inline-flex items-center gap-0.5 text-[11.5px] text-anchor-line">
                                <Sparkles size={11} /> 요약됨
                              </span>
                            )}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ol>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </>
  );
}

function answerLine(t: Turn): string {
  if (t.answerStatus === 'streaming') return '응답 생성 중…';
  if (!t.answerId) return '답변 없음';
  if (t.answerStatus === 'error') return t.answerPreview || '응답 오류';
  return t.answerPreview || '(빈 답변)';
}

function TurnItem({
  turn,
  active,
  branches,
  onClick,
  onDelete,
  deleteDisabled,
}: {
  turn: Turn;
  active: boolean;
  branches: number;
  onClick: () => void;
  /** 없으면 삭제 버튼을 숨긴다 (첫 질문) */
  onDelete?: (() => void) | undefined;
  deleteDisabled?: boolean;
}) {
  return (
    <div className={cn('group/t flex items-stretch rounded-lg transition-colors', active ? 'bg-accent-soft' : 'hover:bg-surface-2')}>
      <TurnButton turn={turn} active={active} branches={branches} onClick={onClick} />
      {onDelete && (
        <button
          type="button"
          onClick={onDelete}
          disabled={deleteDisabled}
          aria-label={`Q${turn.index + 1} 질문 삭제`}
          title={deleteDisabled ? '답변이 끝난 뒤 삭제할 수 있어요' : '질문 삭제'}
          className={cn(
            'my-1.5 mr-1 inline-flex w-8 shrink-0 items-center justify-center rounded-md text-muted hover:bg-danger-soft hover:text-danger disabled:pointer-events-none disabled:opacity-40',
            'opacity-100 @md:opacity-0 @md:group-hover/t:opacity-100 @md:focus-visible:opacity-100',
          )}
        >
          <Trash2 size={14} />
        </button>
      )}
    </div>
  );
}

function TurnButton({ turn, active, branches, onClick }: { turn: Turn; active: boolean; branches: number; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'true' : undefined}
      className="flex min-w-0 flex-1 gap-2.5 px-2 py-2 text-left"
    >
      <span
        className={cn(
          'mt-0.5 flex h-5 min-w-7 shrink-0 items-center justify-center rounded-md px-1 text-[11px] font-semibold tabular-nums',
          active ? 'bg-accent text-accent-fg' : 'bg-surface-2 text-muted',
        )}
      >
        Q{turn.index + 1}
      </span>
      <span className="min-w-0 flex-1">
        <span className="line-clamp-2 text-[13.5px] leading-snug font-medium text-fg">{turn.question}</span>
        <span
          className={cn(
            'mt-0.5 line-clamp-1 text-[12.5px] leading-snug',
            turn.answerStatus === 'error' ? 'text-danger' : 'text-muted',
          )}
        >
          {answerLine(turn)}
        </span>
      </span>
      {branches > 0 && (
        <span title={`가지 ${branches}개`} className="mt-0.5 flex h-5 shrink-0 items-center gap-0.5 text-[11.5px] text-anchor-line">
          <GitBranch size={12} />
          {branches}
        </span>
      )}
    </button>
  );
}

function BranchItem({
  session,
  turn,
  sub,
  onOpen,
  onReveal,
}: {
  session: Session;
  turn: number | undefined;
  sub: number;
  onOpen: () => void;
  onReveal: () => void;
}) {
  const quote = session.anchor!.text.replace(/\s+/g, ' ');
  return (
    <div className="group/b flex items-stretch gap-1 rounded-lg transition-colors hover:bg-surface-2">
      <button type="button" onClick={onOpen} className="flex min-w-0 flex-1 gap-2.5 px-2 py-2 text-left">
        <span className="mt-0.5 flex h-5 shrink-0 items-center text-anchor-line">
          <GitBranch size={14} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="line-clamp-1 text-[13.5px] leading-snug font-medium text-fg">{session.title}</span>
          <span className="mt-0.5 line-clamp-2 text-[12.5px] leading-snug text-muted">
            <mark className="rounded bg-anchor px-0.5 text-fg-2">{quote}</mark>
          </span>
          <span className="mt-1 flex flex-wrap items-center gap-x-2 text-[11.5px] text-muted">
            {turn !== undefined && <span className="tabular-nums">Q{turn + 1} 답변</span>}
            {sub > 0 && <span>하위 가지 {sub}</span>}
            {session.summary && (
              <span className="inline-flex items-center gap-0.5 text-anchor-line">
                <Sparkles size={11} /> 요약됨
              </span>
            )}
          </span>
        </span>
      </button>
      <button
        type="button"
        onClick={onReveal}
        aria-label={`"${session.title}" 원문 위치로 이동`}
        title="본문에서 위치 보기"
        className="my-1.5 mr-1 inline-flex w-8 shrink-0 items-center justify-center rounded-md text-muted hover:bg-surface hover:text-fg"
      >
        <LocateFixed size={15} />
      </button>
    </div>
  );
}

/** 우측 눈금 레일: 질문마다 눈금 하나, hover 시 질문 미리보기 */
function TurnRail({ turns, active, onJump }: { turns: Turn[]; active: number; onJump: (i: number) => void }) {
  return (
    <nav
      aria-label="질문 레일"
      className="absolute top-1/2 right-1 z-10 hidden max-h-[calc(100%-180px)] @3xl:flex -translate-y-1/2 flex-col items-end overflow-hidden py-1"
    >
      {turns.map((t) => {
        const on = t.index === active;
        return (
          <button
            key={t.questionId}
            type="button"
            onClick={() => onJump(t.index)}
            aria-label={`Q${t.index + 1}. ${t.question}`}
            aria-current={on ? 'true' : undefined}
            className="group/tick relative flex h-4 w-7 shrink-0 items-center justify-end pr-1"
          >
            <span
              className={cn(
                'h-[3px] rounded-full transition-all',
                on ? 'w-5 bg-accent' : 'w-3 bg-line-strong group-hover/tick:w-4 group-hover/tick:bg-fg-2',
              )}
            />
            <span className="pointer-events-none absolute top-1/2 right-full mr-1.5 hidden w-max max-w-[260px] -translate-y-1/2 truncate rounded-md border border-line bg-elev px-2 py-1 text-[12px] text-fg shadow-pop group-hover/tick:block group-focus-visible/tick:block">
              <span className="mr-1 font-semibold text-muted">Q{t.index + 1}</span>
              {t.question}
            </span>
          </button>
        );
      })}
    </nav>
  );
}
