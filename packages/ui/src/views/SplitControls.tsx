import { neighborOf, normalizeLayout, type ID, type SplitMoveDir } from '@branch/core';
import { ArrowDown, ArrowLeft, ArrowLeftRight, ArrowRight, ArrowUp, ArrowUpDown, Columns2, Ellipsis, EllipsisVertical, Move, Rows2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { actions } from '../app/store';
import { IconButton } from '../components/Button';
import { cn } from '../lib/cn';

/* 분할창 이동·스왑 조작 (IMP-10): 패널 헤더의 이동 메뉴, 경계선 가운데 ⋯ 팝업 */

const ITEM = 'flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-[13px] outline-none';

/** 기준 요소 근처에 뜨는 작은 메뉴. 바깥 클릭·Esc·창 크기 변경 시 닫힌다 (기준 요소 클릭은 토글에 맡긴다) */
function FloatingMenu({
  anchor,
  label,
  width,
  height,
  center,
  onClose,
  children,
}: {
  anchor: RefObject<HTMLElement | null>;
  label: string;
  width: number;
  height: number;
  /** 기준 요소 가운데 아래에 맞춘다 (아니면 오른쪽 끝 맞춤) */
  center?: boolean;
  onClose(): void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('[role="menuitem"]:not(:disabled)')?.focus();
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!ref.current?.contains(t) && !anchor.current?.contains(t)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('blur', onClose);
    window.addEventListener('resize', onClose);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('blur', onClose);
      window.removeEventListener('resize', onClose);
    };
  }, [anchor, onClose]);

  const r = anchor.current?.getBoundingClientRect();
  if (!r) return null;
  const left = center ? r.left + r.width / 2 - width / 2 : r.right - width;
  const below = r.bottom + 6;
  const top = below + height > window.innerHeight - 8 ? r.top - height - 6 : below;
  return createPortal(
    <div
      ref={ref}
      role="menu"
      aria-label={label}
      onContextMenu={(e) => e.preventDefault()}
      style={{ top: Math.max(8, top), left: Math.max(8, Math.min(left, window.innerWidth - width - 8)), width }}
      className="animate-pop-in fixed z-[90] rounded-lg border border-line bg-elev p-1 shadow-float"
    >
      {children}
    </div>,
    document.body,
  );
}

const MOVES: { dir: SplitMoveDir; label: string; icon: ReactNode }[] = [
  { dir: 'left', label: '왼쪽과 바꾸기', icon: <ArrowLeft size={14} /> },
  { dir: 'right', label: '오른쪽과 바꾸기', icon: <ArrowRight size={14} /> },
  { dir: 'up', label: '위와 바꾸기', icon: <ArrowUp size={14} /> },
  { dir: 'down', label: '아래와 바꾸기', icon: <ArrowDown size={14} /> },
];

/** 현재 화면 배치 기준 이웃 (SplitView와 같은 정리된 배치) */
function neighbors(sessionId: ID): Record<SplitMoveDir, ID | null> {
  const v = actions().view;
  const layout = normalizeLayout(v.splitLayout, v.splitSessionIds);
  return {
    left: neighborOf(layout, sessionId, 'left'),
    right: neighborOf(layout, sessionId, 'right'),
    up: neighborOf(layout, sessionId, 'up'),
    down: neighborOf(layout, sessionId, 'down'),
  };
}

/** 패널 헤더의 이동 버튼: 왼/오/위/아래 이웃과 자리를 바꾼다 (이웃이 없는 방향은 비활성) */
export function PaneMoveButton({ sessionId }: { sessionId: ID }) {
  const btn = useRef<HTMLButtonElement>(null);
  const [near, setNear] = useState<Record<SplitMoveDir, ID | null> | null>(null);
  const close = useCallback(() => setNear(null), []);
  return (
    <>
      <IconButton
        ref={btn}
        size="sm"
        label="자리 이동"
        aria-haspopup="menu"
        aria-expanded={!!near}
        active={!!near}
        onClick={() => setNear((cur) => (cur ? null : neighbors(sessionId)))}
      >
        <Move size={15} />
      </IconButton>
      {near && (
        <FloatingMenu anchor={btn} label="자리 이동" width={168} height={4 * 36 + 8} onClose={close}>
          {MOVES.map((m) => {
            const target = near[m.dir];
            return (
              <button
                key={m.dir}
                type="button"
                role="menuitem"
                disabled={!target}
                onClick={() => {
                  close();
                  if (target) actions().swapSplit(sessionId, target);
                }}
                className={cn(ITEM, 'text-fg enabled:hover:bg-surface-2 enabled:focus:bg-surface-2 disabled:text-muted disabled:opacity-50')}
              >
                <span className="text-muted">{m.icon}</span> {m.label}
              </button>
            );
          })}
        </FloatingMenu>
      )}
    </>
  );
}

/**
 * 경계선 가운데 ⋯ 버튼과 팝업 (갤럭시 탭 화면 분할 참고): 양쪽 자리 바꾸기, 좌우↔상하 방향 전환.
 * path 그룹의 index-1번과 index번 자식 사이 경계선이다.
 */
export function SeparatorMenuButton({ path, index, row }: { path: number[]; index: number; row: boolean }) {
  const btn = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    // react-resizable-panels는 document 캡처 단계 pointerdown으로 끌기를 시작한다(위치 기반 판정).
    // 버튼에서 누른 경우엔 그보다 먼저(window 캡처) 기본 동작을 막아 끌기 대신 클릭만 되게 한다.
    // 버튼 밖 경계선 부분은 그대로 끌 수 있다. 두 번 클릭(비율 초기화)도 같은 방식으로 막는다.
    const onDown = (e: Event) => {
      if (btn.current?.contains(e.target as Node)) e.preventDefault();
    };
    // 경계선 요소의 키보드 조절(화살표·Enter)이 버튼 키 입력을 가로채지 않게 한다
    const el = btn.current;
    const onKey = (e: KeyboardEvent) => e.stopPropagation();
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('dblclick', onDown, true);
    el?.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('dblclick', onDown, true);
      el?.removeEventListener('keydown', onKey);
    };
  }, []);

  return (
    <>
      <button
        ref={btn}
        type="button"
        aria-label="분할 메뉴"
        title="분할 메뉴"
        aria-haspopup="menu"
        aria-expanded={open}
        data-split-sep-menu=""
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        className={cn(
          'absolute top-1/2 left-1/2 z-10 flex -translate-x-1/2 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full border shadow-sm transition-colors',
          row ? 'h-7 w-4' : 'h-4 w-7',
          open
            ? 'border-accent bg-accent text-accent-fg'
            : 'border-line bg-surface text-muted opacity-70 hover:border-accent hover:bg-accent-soft hover:text-accent hover:opacity-100',
        )}
      >
        {row ? <EllipsisVertical size={12} /> : <Ellipsis size={12} />}
      </button>
      {open && (
        <FloatingMenu anchor={btn} label="분할 메뉴" width={176} height={2 * 36 + 8} center onClose={close}>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              close();
              actions().swapSplitChildren(path, index - 1, index);
            }}
            className={cn(ITEM, 'text-fg hover:bg-surface-2 focus:bg-surface-2')}
          >
            <span className="text-muted">{row ? <ArrowLeftRight size={14} /> : <ArrowUpDown size={14} />}</span> 자리 바꾸기
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              close();
              actions().flipSplitGroup(path);
            }}
            className={cn(ITEM, 'text-fg hover:bg-surface-2 focus:bg-surface-2')}
          >
            <span className="text-muted">{row ? <Rows2 size={14} /> : <Columns2 size={14} />}</span> 방향 전환
            <span className="ml-auto text-[11.5px] text-muted">{row ? '상하로' : '좌우로'}</span>
          </button>
        </FloatingMenu>
      )}
    </>
  );
}
