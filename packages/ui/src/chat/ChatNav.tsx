import { buildTurns, type ID, type Turn } from '@branch/core';
import { ChevronDown, ChevronUp, GitBranch, ListOrdered, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { useApp } from '../app/store';
import { useBreakpoint } from '../app/useBreakpoint';
import { IconButton } from '../components/Button';
import { cn } from '../lib/cn';
import { isMac } from '../lib/platform';

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
  const turns = useMemo(() => buildTurns(messages ?? []), [messages]);
  const mobile = useBreakpoint() === 'mobile';
  const [nav, setNav] = useState<NavState>({ active: -1, prev: -1, overflow: false });
  const [open, setOpen] = useState(false);
  const lockUntil = useRef(0);
  /** 버튼으로 이동한 질문. 바닥 근처라 질문을 맨 위로 올릴 수 없어도 사용자가 직접 스크롤하기 전까지 유지 */
  const pin = useRef<{ index: number; top: number | null } | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);

  // 답변 id → 그 답변에서 뻗은 가지 수
  const branchCount = useMemo(() => {
    const map = new Map<ID, number>();
    for (const s of Object.values(sessions)) {
      if (s.parentId !== sessionId || !s.anchor) continue;
      map.set(s.anchor.messageId, (map.get(s.anchor.messageId) ?? 0) + 1);
    }
    return map;
  }, [sessions, sessionId]);

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
    if (!open) return;
    panelRef.current?.querySelector<HTMLElement>('[aria-current="true"]')?.scrollIntoView({ block: 'nearest' });
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (panelRef.current?.contains(t) || toggleRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
        toggleRef.current?.focus();
      }
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  if (!turns.length || (!nav.overflow && turns.length < 2)) return null;

  const alt = isMac ? '⌥' : 'Alt+';
  const btnSize = mobile ? 'md' : 'sm';
  const position = nav.active >= 0 ? `${nav.active + 1}/${turns.length}` : `–/${turns.length}`;

  return (
    <>
      {rail && !mobile && turns.length >= 2 && <TurnRail turns={turns} active={nav.active} onJump={jump} />}

      <div
        className="absolute right-2.5 bottom-2.5 z-10 flex flex-col items-center rounded-xl border border-line bg-surface/95 p-0.5 shadow-pop backdrop-blur"
        role="toolbar"
        aria-label="질문 이동"
      >
        <IconButton
          ref={toggleRef}
          size={btnSize}
          label="대화 목차"
          active={open}
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
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
      </div>

      {open && (
        <div
          ref={panelRef}
          role="dialog"
          aria-label="대화 목차"
          className={cn(
            'animate-pop-in absolute z-20 flex flex-col overflow-hidden rounded-xl border border-line bg-elev shadow-float',
            'inset-x-2 bottom-2 max-h-[72%]',
            '@md:inset-x-auto @md:right-15 @md:bottom-2.5 @md:max-h-[min(72%,520px)] @md:w-[340px]',
          )}
        >
          <div className="flex h-11 shrink-0 items-center gap-2 border-b border-line pr-1 pl-3.5">
            <ListOrdered size={15} className="text-muted" />
            <span className="flex-1 text-[14px] font-semibold">대화 목차</span>
            <span className="text-[12px] text-muted">질문 {turns.length}개</span>
            <IconButton size="sm" label="목차 닫기" onClick={() => setOpen(false)}>
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
                    if (mobile) setOpen(false);
                  }}
                />
              </li>
            ))}
          </ol>
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

function TurnItem({ turn, active, branches, onClick }: { turn: Turn; active: boolean; branches: number; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'true' : undefined}
      className={cn(
        'flex w-full gap-2.5 rounded-lg px-2 py-2 text-left transition-colors',
        active ? 'bg-accent-soft' : 'hover:bg-surface-2',
      )}
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
