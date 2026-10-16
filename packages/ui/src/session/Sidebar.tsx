import { childrenOf, rootSessions, type ID } from '@branch/core';
import { ChevronRight, GitBranch, Plus, Settings2, Sparkles, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState, type DragEvent, type PointerEvent as ReactPointerEvent } from 'react';
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
import { RenameInput, SessionMenu, type MenuPoint } from './SessionMenu';
import { openSubSessionDialog } from './SubSessionDialog';

/** 세션 목록. 데스크톱(≥1024)은 고정 사이드바(접기 가능), 그 이하는 드로어 */
export function Sidebar() {
  const bp = useBreakpoint();
  const open = useUi((s) => s.drawerOpen);
  const setDrawer = useUi((s) => s.setDrawer);
  const collapsed = useUi((s) => s.sidebarCollapsed);
  const width = useUi((s) => s.sidebarWidth);
  const fixed = bp === 'desktop';

  useEffect(() => {
    if (fixed) setDrawer(false);
  }, [fixed, setDrawer]);

  if (fixed) {
    if (collapsed) return null;
    return (
      <aside className="relative flex h-full shrink-0 flex-col border-r border-line bg-surface" style={{ width }}>
        <SidebarBody />
        <SidebarResizer />
      </aside>
    );
  }
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[55]">
      <button type="button" aria-label="목록 닫기" className="animate-fade-in absolute inset-0 bg-black/35" onClick={() => setDrawer(false)} />
      <aside className="animate-pop-in absolute inset-y-0 left-0 flex w-[84vw] max-w-[320px] flex-col bg-surface pt-[env(safe-area-inset-top)] shadow-float">
        <SidebarBody />
      </aside>
    </div>
  );
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
    const onMove = (ev: PointerEvent) => useUi.getState().setSidebarWidth(startW + ev.clientX - startX, false);
    const onUp = (ev: PointerEvent) => {
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      setActive(false);
      useUi.getState().setSidebarWidth(startW + ev.clientX - startX);
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
      className="group absolute inset-y-0 -right-1.5 z-20 w-3 cursor-col-resize outline-none"
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
  const roots = useAppShallow((s) => rootSessions(s.sessions).map((r) => r.id));
  const close = () => useUi.getState().setDrawer(false);
  const pcOnline = usePcOnline();
  return (
    <>
      <div className="flex items-center gap-2 px-3 pt-3 pb-2">
        <div className="flex flex-1 items-center gap-2 px-1 text-[15px] font-bold tracking-tight">
          <span className="grid h-7 w-7 place-items-center rounded-lg bg-accent text-accent-fg">
            <GitBranch size={16} />
          </span>
          rhymebook
        </div>
      </div>
      <div className="px-3 pb-2">
        <Button
          variant="primary"
          className="w-full justify-center"
          icon={<Plus size={16} />}
          disabled={!pcOnline}
          title={pcOnline ? undefined : 'PC와 연결되면 새 학습을 시작할 수 있어요'}
          onClick={() => {
            actions().newRootSession();
            close();
          }}
        >
          새 학습
        </Button>
      </div>
      <nav aria-label="학습 세션" className="scroll-thin min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {roots.length === 0 ? (
          <p className="px-3 py-6 text-center text-[13px] text-muted">{remoteMode && !pcOnline ? 'PC와 연결되면 학습 목록이 보여요' : '세션이 없어요'}</p>
        ) : (
          roots.map((id) => <RootItem key={id} id={id} onPick={close} />)
        )}
      </nav>
      <button
        type="button"
        onClick={() => {
          actions().setOverlay('skills');
          close();
        }}
        className="flex items-center gap-2 border-t border-line px-4 py-2.5 text-left text-[13px] text-fg-2 hover:bg-surface-2/60"
      >
        <Sparkles size={15} className="text-accent" />
        <span className="flex-1">스킬 관리</span>
      </button>
      <ConnectionFooter />
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
      title: s.parentId ? '가지를 삭제할까요?' : '학습을 삭제할까요?',
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

function RootItem({ id, onPick }: { id: ID; onPick(): void }) {
  const s = useApp((st) => st.sessions[id]);
  const activeRoot = useApp((st) => {
    const a = st.view.activeSessionId;
    return a ? st.sessions[a]?.rootId : undefined;
  });
  const isActiveRoot = activeRoot === id;
  const childCount = useApp((st) => childrenOf(st.sessions, id).length);
  const [open, setOpen] = useState(isActiveRoot);
  const [menu, setMenu] = useState<MenuPoint | null>(null);
  const [renaming, setRenaming] = useState(false);
  const closeMenu = useCallback(() => setMenu(null), []);
  const remove = useRemoveSession(id);
  useEffect(() => {
    if (isActiveRoot) setOpen(true);
  }, [isActiveRoot]);
  if (!s) return null;
  return (
    <div className="mb-0.5">
      <div
        data-session-row={id}
        onContextMenu={(e) => {
          e.preventDefault();
          setMenu({ x: e.clientX, y: e.clientY });
        }}
        className={cn('group flex items-center rounded-lg', isActiveRoot ? 'bg-surface-2' : 'hover:bg-surface-2/70')}
      >
        <button
          type="button"
          aria-label={open ? '가지 접기' : '가지 펼치기'}
          onClick={() => setOpen(!open)}
          className={cn('grid h-8 w-6 shrink-0 place-items-center text-muted', !childCount && 'invisible')}
        >
          <ChevronRight size={14} className={cn('transition-transform', open && 'rotate-90')} />
        </button>
        {renaming ? (
          <div className="min-w-0 flex-1 py-1.5 pr-1">
            <RenameInput
              value={s.title}
              onDone={(next) => {
                setRenaming(false);
                if (next) actions().renameSession(id, next);
              }}
            />
          </div>
        ) : (
          <button
            type="button"
            {...dragProps(id)}
            onClick={() => {
              actions().openSession(id, 'main');
              onPick();
            }}
            className="min-w-0 flex-1 py-2 pr-1 text-left"
          >
            <div className="truncate text-[14px] font-medium text-fg">{s.title}</div>
            <div className="text-[11.5px] text-muted">
              {relativeTime(s.updatedAt)}
              {childCount > 0 && ` · 가지 ${childCount}`}
            </div>
          </button>
        )}
        <IconButton
          size="sm"
          label="세션 삭제"
          className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
          onClick={() => void remove()}
        >
          <Trash2 size={14} />
        </IconButton>
        <SubSessionButton parentId={id} className="mr-1" />
      </div>
      {menu && <SessionMenu at={menu} sessionId={id} onClose={closeMenu} onRename={() => setRenaming(true)} onDelete={() => void remove()} />}
      {open && childCount > 0 && <BranchTree parentId={id} depth={1} onPick={onPick} />}
    </div>
  );
}

function BranchTree({ parentId, depth, onPick }: { parentId: ID; depth: number; onPick(): void }) {
  const kids = useAppShallow((st) => childrenOf(st.sessions, parentId).map((c) => c.id));
  return (
    <ul className="ml-3 border-l border-line">
      {kids.map((id) => (
        <BranchRow key={id} id={id} depth={depth} onPick={onPick} />
      ))}
    </ul>
  );
}

function BranchRow({ id, depth, onPick }: { id: ID; depth: number; onPick(): void }) {
  const s = useApp((st) => st.sessions[id]);
  const active = useApp((st) => st.view.activeSessionId === id);
  const hasKids = useApp((st) => childrenOf(st.sessions, id).length > 0);
  const [menu, setMenu] = useState<MenuPoint | null>(null);
  const [renaming, setRenaming] = useState(false);
  const closeMenu = useCallback(() => setMenu(null), []);
  const remove = useRemoveSession(id);
  if (!s) return null;
  return (
    <li>
      {renaming ? (
        <div className="flex items-center gap-1.5 py-1 pr-2 pl-3">
          <GitBranch size={12} className="shrink-0 text-muted" />
          <RenameInput
            value={s.title}
            className="h-6 text-[13px]"
            onDone={(next) => {
              setRenaming(false);
              if (next) actions().renameSession(id, next);
            }}
          />
        </div>
      ) : (
        <div className="group flex items-center">
          <button
            type="button"
            data-session-row={id}
            {...dragProps(id)}
            onClick={() => {
              actions().openSession(id, 'main');
              onPick();
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              setMenu({ x: e.clientX, y: e.clientY });
            }}
            className={cn(
              'flex min-w-0 flex-1 items-center gap-1.5 rounded-r-lg py-1.5 pr-2 pl-3 text-left text-[13px]',
              active ? 'bg-accent-soft font-medium text-fg' : 'text-fg-2 hover:bg-surface-2/70',
            )}
          >
            <GitBranch size={12} className="shrink-0 text-muted" />
            <span className="truncate">{s.title}</span>
            {s.summary && <span title="요약됨" className="ml-auto h-1.5 w-1.5 shrink-0 rounded-full bg-anchor-line" />}
          </button>
          <SubSessionButton parentId={id} className="mr-1" />
        </div>
      )}
      {menu && <SessionMenu at={menu} sessionId={id} onClose={closeMenu} onRename={() => setRenaming(true)} onDelete={() => void remove()} />}
      {hasKids && <BranchTree parentId={id} depth={depth + 1} onPick={onPick} />}
    </li>
  );
}

/** 세션 오른쪽 [+]: 직접 입력한 질문으로 하위 세션을 만든다 (ADR-054). 터치 기기는 항상 보인다 */
function SubSessionButton({ parentId, className }: { parentId: ID; className?: string }) {
  return (
    <IconButton
      size="sm"
      label="하위 세션 만들기"
      className={cn('shrink-0 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100', className)}
      onClick={() => openSubSessionDialog(parentId)}
    >
      <Plus size={14} />
    </IconButton>
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
