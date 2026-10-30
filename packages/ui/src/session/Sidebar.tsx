import { OctoMark } from '../components/OctoMark';
import { childrenOf, listedRootSessions, type ID } from '@branch/core';
import { ChevronRight, ChevronsDownUp, FileText, Folder, FolderOpen, GitBranch, MessageSquareText, PenLine, Plus, Settings2, Sparkles, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type DragEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { actions, appStore, useApp, useAppShallow } from '../app/store';
import { remoteMode } from '../app/capabilities';
import { useSync } from '../app/sync';
import { SIDEBAR_WIDTH, useUi } from '../app/uiState';
import { isMobileNow, useBreakpoint } from '../app/useBreakpoint';
import { SESSION_DRAG_TYPE } from '../views/DropZone';
import { Button, IconButton } from '../components/Button';
import { StatusDot } from '../components/Badge';
import { confirm } from '../components/ConfirmDialog';
import { PC_STATUS_LABEL, usePcOnline } from '../components/PcStatus';
import { cn } from '../lib/cn';
import { isUsable, PROVIDER_ORDER, providerLabel, statusTone } from '../lib/connection';
import { relativeTime } from '../lib/time';
import { RenameInput, SessionMenu, SubCreateMenu, type MenuPoint } from './SessionMenu';
import { startNewSession } from './newSession';
import { renameSession } from '../chat/PagePanel';

const APP_VERSION = import.meta.env.VITE_APP_VERSION as string | undefined;

/** 세션 목록. 데스크톱(≥1024)은 고정 사이드바(접기 가능), 그 이하는 드로어 */
export function Sidebar() {
  const bp = useBreakpoint();
  const open = useUi((s) => s.drawerOpen);
  const setDrawer = useUi((s) => s.setDrawer);
  const collapsed = useUi((s) => s.sidebarCollapsed);
  const width = useUi((s) => s.sidebarWidth);
  const fixed = bp === 'desktop';
  useRevealActive();

  useEffect(() => {
    if (fixed) setDrawer(false);
  }, [fixed, setDrawer]);

  if (fixed) {
    if (collapsed) return null;
    return (
      <aside className="relative flex h-full shrink-0 flex-col border-r border-line bg-surface octo-sidebar" style={{ width }}>
        <SidebarBody />
        <SidebarResizer />
      </aside>
    );
  }
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[55]">
      <button type="button" aria-label="목록 닫기" className="animate-fade-in absolute inset-0 bg-black/35" onClick={() => setDrawer(false)} />
      <aside className="animate-pop-in absolute inset-y-0 left-0 flex w-[84vw] max-w-[320px] flex-col bg-surface octo-sidebar pt-[env(safe-area-inset-top)] shadow-float">
        <SidebarBody />
      </aside>
    </div>
  );
}

/**
 * 열린 세션이 바뀌면 그 세션까지의 트리를 펼친다. 사이드바가 닫혀 있어도 돌도록 항상 마운트된 Sidebar에서 쓰고,
 * 처음 값은 건너뛴다 — 사이드바를 다시 열거나 새로고침해도 사용자가 접어 둔 상태를 덮지 않는다 (ADR-078)
 */
function useRevealActive() {
  const activeId = useApp((st) => st.view.activeSessionId);
  const seen = useRef(activeId);
  useEffect(() => {
    if (seen.current === activeId) return;
    seen.current = activeId;
    const { sessions } = appStore.getState();
    const s = activeId ? sessions[activeId] : undefined;
    if (!s) return;
    const ui = useUi.getState();
    ui.setTreeOpen(s.rootId, true);
    for (let cur = s.parentId ? sessions[s.parentId] : undefined; cur; cur = cur.parentId ? sessions[cur.parentId] : undefined) {
      ui.setTreeOpen(cur.id, true);
    }
  }, [activeId]);
}

/** 사이드바 오른쪽 경계선: 끌어서 너비 조절, 두 번 눌러 기본 너비, 키보드 ←→ */
function SidebarResizer() {
  const width = useUi((s) => s.sidebarWidth);
  const [active, setActive] = useState(false);

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const startX = e.clientX;
    const startW = useUi.getState().sidebarWidth;
    setActive(true);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    // pointercancel의 clientX는 0일 수 있어 마지막으로 움직인 위치를 쓴다
    let lastX = startX;
    const onMove = (ev: PointerEvent) => {
      lastX = ev.clientX;
      useUi.getState().setSidebarWidth(startW + lastX - startX, false);
    };
    const onUp = (ev: PointerEvent) => {
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      setActive(false);
      if (ev.type === 'pointerup') lastX = ev.clientX;
      useUi.getState().setSidebarWidth(startW + lastX - startX);
    };
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="사이드바 너비 조절"
      aria-valuemin={SIDEBAR_WIDTH.min}
      aria-valuemax={SIDEBAR_WIDTH.max}
      aria-valuenow={width}
      tabIndex={0}
      title="끌어서 너비 조절 · 두 번 눌러 기본 너비"
      onPointerDown={onPointerDown}
      onDoubleClick={() => useUi.getState().setSidebarWidth(SIDEBAR_WIDTH.default)}
      onKeyDown={(e) => {
        const step = e.shiftKey ? 48 : 16;
        if (e.key === 'ArrowLeft') useUi.getState().setSidebarWidth(width - step);
        else if (e.key === 'ArrowRight') useUi.getState().setSidebarWidth(width + step);
        else return;
        e.preventDefault();
      }}
      // touch-none: 없으면 태블릿 브라우저가 손가락 끌기를 스크롤·뒤로 가기 몸짓으로 가로채 pointercancel로 끊는다
      className="group absolute inset-y-0 -right-1.5 z-20 w-3 cursor-col-resize touch-none outline-none pointer-coarse:-right-3 pointer-coarse:w-6"
    >
      <span
        className={cn(
          'absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 transition-colors group-hover:bg-accent group-focus-visible:bg-accent',
          active && 'bg-accent',
        )}
      />
    </div>
  );
}

function SidebarBody() {
  const roots = useAppShallow((s) => listedRootSessions(s.sessions, s.messages).map((r) => r.id));
  const close = () => useUi.getState().setDrawer(false);
  const pcOnline = usePcOnline();
  return (
    <>
      <div className="flex items-center gap-2.5 px-4 pt-4 pb-3">
        <OctoMark className="size-8 shrink-0" />
        <span className="text-[17px] font-semibold tracking-tight text-fg">OctoBooks</span>
      </div>
      <div className="px-3 pb-2">
        <Button
          variant="primary"
          className="w-full justify-center"
          icon={<Plus size={16} />}
          disabled={!pcOnline}
          title={pcOnline ? undefined : 'PC와 연결되면 새로 만들 수 있어요'}
          onClick={() => {
            startNewSession();
            close();
          }}
        >
          새로 만들기
        </Button>
      </div>
      {/* 목록 툴바: 왼쪽은 목록 이름·개수, 오른쪽은 목록 도구 (ADR-098) */}
      <div role="toolbar" aria-label="세션 목록 도구" className="flex items-center gap-2 px-4 pt-3 pb-1.5">
        <span className="min-w-0 flex-1 truncate text-[10px] font-semibold tracking-widest text-muted">
          나의 학습 바다 · {roots.length}개의 시작점
        </span>
        <IconButton size="sm" label="모두 접기" disabled={roots.length === 0} onClick={() => useUi.getState().collapseTrees(roots)}>
          <ChevronsDownUp size={15} />
        </IconButton>
      </div>
      <nav aria-label="학습 세션" className="scroll-thin min-h-0 flex-1 space-y-px overflow-y-auto px-2 pb-3">
        {roots.length === 0 ? (
          <p className="px-3 py-6 text-center text-[13px] text-muted">{remoteMode && !pcOnline ? 'PC와 연결되면 학습 목록이 보여요' : '세션이 없어요'}</p>
        ) : (
          roots.map((id) => <RootItem key={id} id={id} onPick={close} />)
        )}
      </nav>
      <div className="grid grid-cols-2 divide-x divide-line border-t border-line">
        <button
          type="button"
          onClick={() => {
            actions().setOverlay('prompts');
            close();
          }}
          className="flex min-w-0 items-center gap-2 px-4 py-2.5 text-left text-[13px] text-fg-2 hover:bg-surface-2/60"
        >
          <MessageSquareText size={15} className="shrink-0 text-accent" />
          <span className="truncate">프롬프트 관리</span>
        </button>
        <button
          type="button"
          onClick={() => {
            actions().setOverlay('skills');
            close();
          }}
          className="flex min-w-0 items-center gap-2 px-4 py-2.5 text-left text-[13px] text-fg-2 hover:bg-surface-2/60"
        >
          <Sparkles size={15} className="shrink-0 text-accent" />
          <span className="truncate">스킬 관리</span>
        </button>
      </div>
      <ConnectionFooter />
      <div className="flex items-center justify-between px-4 pb-3 pt-1 text-[10px] text-muted"><span>octobooks{APP_VERSION && <span className="ml-1.5 tabular-nums">v{APP_VERSION}</span>}</span><span className="rounded-full border border-line px-2 py-0.5 tracking-wider">PREVIEW BETA</span></div>
    </>
  );
}

/**
 * 세션 행 끌기 (데스크톱·태블릿): 메인 영역 패널 가장자리에 놓으면 그쪽으로 분할해 연다 (ADR-035).
 * 모바일은 분할 대신 탭이라 끌기를 쓰지 않는다.
 */
function dragProps(id: ID) {
  if (isMobileNow()) return {};
  return {
    draggable: true,
    onDragStart: (e: DragEvent<HTMLElement>) => {
      e.dataTransfer.setData(SESSION_DRAG_TYPE, id);
      e.dataTransfer.setData('text/plain', appStore.getState().sessions[id]?.title ?? '');
      e.dataTransfer.effectAllowed = 'copyMove';
      // 놓기 영역은 다음 프레임에 띄운다 (같은 프레임에 DOM이 바뀌면 끌기가 취소될 수 있다)
      requestAnimationFrame(() => useUi.getState().setDragSession(id));
    },
    onDragEnd: () => useUi.getState().setDragSession(null),
  };
}

/** 세션(학습·가지) 삭제: 확인 후 하위 가지까지 함께 지운다 */
function useRemoveSession(id: ID) {
  return useCallback(async () => {
    const st = appStore.getState();
    const s = st.sessions[id];
    if (!s) return;
    const kids = childrenOf(st.sessions, id).length;
    const ok = await confirm({
      title: s.parentId ? '가지를 삭제할까요?' : s.kind === 'page' ? '페이지를 삭제할까요?' : s.kind === 'canvas' ? '캔버스를 삭제할까요?' : '학습을 삭제할까요?',
      message: (
        <>
          <b className="font-medium text-fg-2">“{s.title}”</b>
          {kids > 0 ? '과(와) 모든 하위 가지가' : '이(가)'} 모두 삭제되며 되돌릴 수 없어요.
        </>
      ),
      confirmLabel: '삭제',
      tone: 'danger',
    });
    if (ok) actions().deleteSession(id);
  }, [id]);
}

/** 트리 행 아이콘: 학습은 폴더(펼치면 열린 폴더), 가지는 가지, 페이지·캔버스는 파일처럼 */
function KindIcon({ kind, root, open }: { kind: string | undefined; root?: boolean; open?: boolean }) {
  const cls = 'shrink-0';
  if (kind === 'page') return <FileText size={15} aria-label="페이지" className={cn(cls, 'text-muted')} />;
  if (kind === 'canvas') return <PenLine size={15} aria-label="캔버스" className={cn(cls, 'text-muted')} />;
  if (root) return open ? <FolderOpen size={15} className={cn(cls, 'text-accent')} /> : <Folder size={15} className={cn(cls, 'text-accent')} />;
  return <GitBranch size={14} className={cn(cls, 'text-muted')} />;
}

/** 펼침 화살표 칸. 하위가 없으면 자리만 차지해 아이콘 줄을 맞춘다 */
function TreeChevron({ open, show, label, onToggle }: { open: boolean; show: boolean; label: string; onToggle(): void }) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-expanded={show ? open : undefined}
      tabIndex={show ? undefined : -1}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      className={cn('grid h-7 w-4 shrink-0 place-items-center rounded text-muted hover:text-fg', !show && 'invisible')}
    >
      <ChevronRight size={13} className={cn('transition-transform duration-150', open && 'rotate-90')} />
    </button>
  );
}

/** 파일 트리 행 공통 모양: 한 줄 높이, 둥근 사각 강조 */
const rowCls = (active: boolean) =>
  cn('group flex h-7 items-center gap-1 rounded-md pl-1 pr-0.5', active ? 'bg-accent-soft text-fg' : 'text-fg-2 hover:bg-surface-2/70');

function RootItem({ id, onPick }: { id: ID; onPick(): void }) {
  const s = useApp((st) => st.sessions[id]);
  const active = useApp((st) => st.view.activeSessionId === id);
  const containsActive = useApp((st) => {
    const a = st.view.activeSessionId;
    return !!a && a !== id && st.sessions[a]?.rootId === id;
  });
  const childCount = useApp((st) => childrenOf(st.sessions, id).length);
  // 펼침 상태는 기기별 스토어에 둔다 — 사이드바를 닫았다 열어도(언마운트) 유지 (ADR-078).
  // 기본은 접힘: 펼친 트리만 기록이 남는다 (ADR-098)
  const open = useUi((u) => u.treeOpen[id] ?? false);
  const setOpen = (v: boolean) => useUi.getState().setTreeOpen(id, v);
  const [menu, setMenu] = useState<MenuPoint | null>(null);
  const [renaming, setRenaming] = useState(false);
  const closeMenu = useCallback(() => setMenu(null), []);
  const remove = useRemoveSession(id);
  if (!s) return null;
  return (
    <div>
      <div
        data-session-row={id}
        onContextMenu={(e) => {
          e.preventDefault();
          setMenu({ x: e.clientX, y: e.clientY });
        }}
        className={rowCls(active)}
      >
        <TreeChevron open={open} show={childCount > 0} label={open ? '가지 접기' : '가지 펼치기'} onToggle={() => setOpen(!open)} />
        {renaming ? (
          <div className="flex min-w-0 flex-1 items-center gap-1.5 pr-1">
            <KindIcon kind={s.kind} root open={open && childCount > 0} />
            <RenameInput
              value={s.title}
              className="h-6 text-[13px]"
              onDone={(next) => {
                setRenaming(false);
                if (next) renameSession(id, next);
              }}
            />
          </div>
        ) : (
          <button
            type="button"
            {...dragProps(id)}
            title={`${s.title} · ${relativeTime(s.updatedAt)}${childCount > 0 ? ` · 가지 ${childCount}` : ''}`}
            onClick={() => {
              actions().openSession(id, 'main');
              onPick();
            }}
            className="flex h-full min-w-0 flex-1 items-center gap-1.5 pr-1 text-left text-[13px]"
          >
            <KindIcon kind={s.kind} root open={open && childCount > 0} />
            <span data-tree-title className={cn('truncate', (active || containsActive) && 'font-medium', containsActive ? 'text-accent' : 'text-fg')}>{s.title}</span>
            {childCount > 0 && !open && <span className="shrink-0 text-[11px] text-muted tabular-nums">+{childCount}</span>}
          </button>
        )}
        <IconButton
          size="sm"
          label="세션 삭제"
          className="!size-6 shrink-0 !rounded-md opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
          onClick={() => void remove()}
        >
          <Trash2 size={13} />
        </IconButton>
        <SubSessionButton parentId={id} className="!size-6 !rounded-md" />
      </div>
      {menu && <SessionMenu at={menu} sessionId={id} onClose={closeMenu} onRename={() => setRenaming(true)} onDelete={() => void remove()} />}
      {open && childCount > 0 && <BranchTree parentId={id} depth={1} onPick={onPick} />}
    </div>
  );
}

/** 하위 목록: 부모 화살표 가운데를 지나는 세로 안내선으로 깊이를 보여 준다 */
function BranchTree({ parentId, depth, onPick }: { parentId: ID; depth: number; onPick(): void }) {
  const kids = useAppShallow((st) => childrenOf(st.sessions, parentId).map((c) => c.id));
  return (
    <ul className="ml-3 border-l border-line pl-0.5">
      {kids.map((id) => (
        <BranchRow key={id} id={id} depth={depth} onPick={onPick} />
      ))}
    </ul>
  );
}

function BranchRow({ id, depth, onPick }: { id: ID; depth: number; onPick(): void }) {
  const s = useApp((st) => st.sessions[id]);
  const active = useApp((st) => st.view.activeSessionId === id);
  const kidCount = useApp((st) => childrenOf(st.sessions, id).length);
  const hasKids = kidCount > 0;
  const open = useUi((u) => u.treeOpen[id] ?? true);
  const setOpen = (v: boolean) => useUi.getState().setTreeOpen(id, v);
  const [menu, setMenu] = useState<MenuPoint | null>(null);
  const [renaming, setRenaming] = useState(false);
  const closeMenu = useCallback(() => setMenu(null), []);
  const remove = useRemoveSession(id);
  if (!s) return null;
  return (
    <li>
      {renaming ? (
        <div className={rowCls(false)}>
          <TreeChevron open={open} show={false} label="하위 세션 펼치기" onToggle={() => {}} />
          <div className="flex min-w-0 flex-1 items-center gap-1.5 pr-1">
            <KindIcon kind={s.kind} />
            <RenameInput
              value={s.title}
              className="h-6 text-[13px]"
              onDone={(next) => {
                setRenaming(false);
                if (next) renameSession(id, next);
              }}
            />
          </div>
        </div>
      ) : (
        <div className={rowCls(active)}>
          <TreeChevron open={open} show={hasKids} label={open ? '하위 세션 접기' : '하위 세션 펼치기'} onToggle={() => setOpen(!open)} />
          <button
            type="button"
            data-session-row={id}
            {...dragProps(id)}
            title={s.title}
            onClick={() => {
              actions().openSession(id, 'main');
              onPick();
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              setMenu({ x: e.clientX, y: e.clientY });
            }}
            className={cn('flex h-full min-w-0 flex-1 items-center gap-1.5 pr-1 text-left text-[13px]', active && 'font-medium')}
          >
            <KindIcon kind={s.kind} />
            <span className="truncate">{s.title}</span>
            {hasKids && !open && <span className="shrink-0 text-[11px] text-muted tabular-nums">+{kidCount}</span>}
            {s.summary && <span title="요약됨" className="ml-auto h-1.5 w-1.5 shrink-0 rounded-full bg-anchor-line" />}
          </button>
          <SubSessionButton parentId={id} className="!size-6 !rounded-md" />
        </div>
      )}
      {menu && <SessionMenu at={menu} sessionId={id} onClose={closeMenu} onRename={() => setRenaming(true)} onDelete={() => void remove()} />}
      {hasKids && open && <BranchTree parentId={id} depth={depth + 1} onPick={onPick} />}
    </li>
  );
}

/** 세션 오른쪽 [+]: 빈 하위 페이지나 빈 하위 세션을 바로 만든다 (ADR-075). 터치 기기는 항상 보인다 */
function SubSessionButton({ parentId, className }: { parentId: ID; className?: string }) {
  const [at, setAt] = useState<MenuPoint | null>(null);
  const [trigger, setTrigger] = useState<HTMLButtonElement | null>(null);
  const close = useCallback(() => setAt(null), []);
  return (
    <>
      <IconButton
        ref={setTrigger}
        size="sm"
        label="하위 항목 만들기"
        aria-haspopup="menu"
        aria-expanded={!!at}
        className={cn('shrink-0 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100', at && 'opacity-100', className)}
        onClick={(e) => {
          e.stopPropagation();
          if (at) return close();
          const r = e.currentTarget.getBoundingClientRect();
          setAt({ x: r.left, y: r.bottom + 4 });
        }}
      >
        <Plus size={13} />
      </IconButton>
      {at && <SubCreateMenu at={at} parentId={parentId} trigger={trigger} onClose={close} />}
    </>
  );
}
const PC_TONE = { online: 'ok', connecting: 'warn', offline: 'danger', unpaired: 'neutral', unsupported: 'danger' } as const;

function ConnectionFooter() {
  return remoteMode ? <PcFooter /> : <ProviderFooter />;
}

/** 원격 모드: 연결된 PC 상태 */
function PcFooter() {
  const status = useSync((s) => s.status);
  const hostName = useSync((s) => s.hostName);
  return (
    <button
      type="button"
      onClick={() => actions().setOverlay('settings')}
      className="flex items-center gap-2 border-t border-line px-4 py-3 text-left text-[12.5px] text-fg-2 hover:bg-surface-2/60"
    >
      <StatusDot tone={PC_TONE[status]} className={status === 'connecting' ? 'animate-pulse' : undefined} />
      <span className="min-w-0 flex-1 truncate">
        {status === 'online' && hostName ? `${hostName} · ${PC_STATUS_LABEL[status]}` : `PC ${PC_STATUS_LABEL[status]}`}
      </span>
      <Settings2 size={15} className="text-muted" />
    </button>
  );
}

function ProviderFooter() {
  const conns = useApp((s) => s.connections);
  const def = useApp((s) => s.settings.defaultProviderId);
  const usable = PROVIDER_ORDER.filter((p) => isUsable(conns[p]));
  return (
    <button
      type="button"
      onClick={() => actions().setOverlay('settings')}
      className="flex items-center gap-2 border-t border-line px-4 py-3 text-left text-[12.5px] text-fg-2 hover:bg-surface-2/60"
    >
      <StatusDot tone={statusTone(conns[def])} />
      <span className="min-w-0 flex-1 truncate">
        기본: {providerLabel(def)} · 사용 가능 {usable.length}개
      </span>
      <Settings2 size={15} className="text-muted" />
    </button>
  );
}
