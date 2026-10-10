import { childrenOf, rootSessions, type ID } from '@branch/core';
import { ChevronRight, GitBranch, Plus, Settings2, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { actions, useApp, useAppShallow } from '../app/store';
import { useUi } from '../app/uiState';
import { useBreakpoint } from '../app/useBreakpoint';
import { Button, IconButton } from '../components/Button';
import { StatusDot } from '../components/Badge';
import { cn } from '../lib/cn';
import { isUsable, PROVIDER_ORDER, providerLabel, statusTone } from '../lib/connection';
import { relativeTime } from '../lib/time';

/** 세션 목록. 데스크톱(≥1024)은 고정 사이드바, 그 이하는 드로어 */
export function Sidebar() {
  const bp = useBreakpoint();
  const open = useUi((s) => s.drawerOpen);
  const setDrawer = useUi((s) => s.setDrawer);
  const fixed = bp === 'desktop';

  useEffect(() => {
    if (fixed) setDrawer(false);
  }, [fixed, setDrawer]);

  if (fixed) {
    return (
      <aside className="flex h-full w-[272px] shrink-0 flex-col border-r border-line bg-surface">
        <SidebarBody />
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

function SidebarBody() {
  const roots = useAppShallow((s) => rootSessions(s.sessions).map((r) => r.id));
  const close = () => useUi.getState().setDrawer(false);
  return (
    <>
      <div className="flex items-center gap-2 px-3 pt-3 pb-2">
        <div className="flex flex-1 items-center gap-2 px-1 text-[15px] font-bold tracking-tight">
          <span className="grid h-7 w-7 place-items-center rounded-lg bg-accent text-accent-fg">
            <GitBranch size={16} />
          </span>
          Branch Learn
        </div>
      </div>
      <div className="px-3 pb-2">
        <Button
          variant="primary"
          className="w-full justify-center"
          icon={<Plus size={16} />}
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
          <p className="px-3 py-6 text-center text-[13px] text-muted">세션이 없어요</p>
        ) : (
          roots.map((id) => <RootItem key={id} id={id} onPick={close} />)
        )}
      </nav>
      <ConnectionFooter />
    </>
  );
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
  useEffect(() => {
    if (isActiveRoot) setOpen(true);
  }, [isActiveRoot]);
  if (!s) return null;
  return (
    <div className="mb-0.5">
      <div className={cn('group flex items-center rounded-lg', isActiveRoot ? 'bg-surface-2' : 'hover:bg-surface-2/70')}>
        <button
          type="button"
          aria-label={open ? '가지 접기' : '가지 펼치기'}
          onClick={() => setOpen(!open)}
          className={cn('grid h-8 w-6 shrink-0 place-items-center text-muted', !childCount && 'invisible')}
        >
          <ChevronRight size={14} className={cn('transition-transform', open && 'rotate-90')} />
        </button>
        <button
          type="button"
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
        <IconButton
          size="sm"
          label="세션 삭제"
          className="mr-1 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
          onClick={() => {
            if (window.confirm(`"${s.title}"과(와) 모든 가지를 삭제할까요?`)) actions().deleteSession(id);
          }}
        >
          <Trash2 size={14} />
        </IconButton>
      </div>
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
  if (!s) return null;
  return (
    <li>
      <button
        type="button"
        onClick={() => {
          actions().openSession(id, 'main');
          onPick();
        }}
        className={cn(
          'flex w-full items-center gap-1.5 rounded-r-lg py-1.5 pr-2 pl-3 text-left text-[13px]',
          active ? 'bg-accent-soft font-medium text-fg' : 'text-fg-2 hover:bg-surface-2/70',
        )}
      >
        <GitBranch size={12} className="shrink-0 text-muted" />
        <span className="truncate">{s.title}</span>
        {s.summary && <span title="요약됨" className="ml-auto h-1.5 w-1.5 shrink-0 rounded-full bg-anchor-line" />}
      </button>
      {hasKids && <BranchTree parentId={id} depth={depth + 1} onPick={onPick} />}
    </li>
  );
}

function ConnectionFooter() {
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
