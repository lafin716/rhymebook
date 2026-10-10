import type { ID } from '@branch/core';
import { X } from 'lucide-react';
import { Fragment } from 'react';
import { Group, Panel, Separator } from 'react-resizable-panels';
import { actions, useApp, useAppShallow } from '../app/store';
import { useBreakpoint } from '../app/useBreakpoint';
import { ChatPanel } from '../chat/ChatPanel';
import { IconButton } from '../components/Button';
import { cn } from '../lib/cn';

/** 분할 보기: 데스크톱/태블릿은 크기 조절 패널(최대 3), 모바일은 탭 전환 */
export function SplitView() {
  const ids = useAppShallow((s) => s.view.splitSessionIds);
  const focused = useApp((s) => s.view.focusedSplitIndex);
  const sizes = useAppShallow((s) => s.view.splitSizes);
  const bp = useBreakpoint();

  if (bp === 'mobile') return <SplitTabs ids={ids} focused={focused} />;

  const defaultLayout = sizes && sizes.length === ids.length
    ? Object.fromEntries(ids.map((id, i) => [`p-${i}-${id}`, sizes[i]!]))
    : undefined;

  return (
    <Group
      key={ids.join('|')}
      orientation="horizontal"
      className="h-full"
      defaultLayout={defaultLayout}
      onLayoutChanged={(layout) => actions().setSplitSizes(ids.map((id, i) => layout[`p-${i}-${id}`] ?? 100 / ids.length))}
    >
      {ids.map((id, i) => (
        <Fragment key={`${i}-${id}`}>
          {i > 0 && (
            <Separator className="group relative w-px bg-line outline-none data-[separator=active]:bg-accent data-[separator=hover]:bg-accent">
              <span className="absolute inset-y-0 -left-1.5 -right-1.5" />
            </Separator>
          )}
          <Panel id={`p-${i}-${id}`} minSize="22%" className="min-w-0">
            <div
              className={cn('relative h-full', i === focused && ids.length > 1 && 'shadow-[inset_0_2px_0_var(--accent)]')}
              onMouseDownCapture={() => i !== focused && actions().focusSplit(i)}
            >
              <ChatPanel
                sessionId={id}
                variant="pane"
                headerActions={
                  <IconButton size="sm" label="패널 닫기" onClick={() => actions().closeSplit(i)}>
                    <X size={16} />
                  </IconButton>
                }
              />
            </div>
          </Panel>
        </Fragment>
      ))}
    </Group>
  );
}

function SplitTabs({ ids, focused }: { ids: ID[]; focused: number }) {
  const titles = useAppShallow((s) => ids.map((id) => s.sessions[id]?.title ?? ''));
  const current = ids[focused] ?? ids[0];
  return (
    <div className="flex h-full flex-col">
      <div role="tablist" aria-label="분할 탭" className="flex shrink-0 gap-1 overflow-x-auto border-b border-line bg-surface px-2 pt-1.5">
        {ids.map((id, i) => (
          <div
            key={`${i}-${id}`}
            className={cn(
              'flex max-w-[45%] shrink-0 items-center rounded-t-lg border border-b-0 text-[13px]',
              i === focused ? 'border-line bg-bg font-medium text-fg' : 'border-transparent text-muted',
            )}
          >
            <button role="tab" aria-selected={i === focused} type="button" onClick={() => actions().focusSplit(i)} className="min-w-0 truncate py-2 pr-1 pl-3">
              {titles[i]}
            </button>
            <button type="button" aria-label="탭 닫기" onClick={() => actions().closeSplit(i)} className="p-1.5 pr-2 text-muted">
              <X size={13} />
            </button>
          </div>
        ))}
      </div>
      {current && <ChatPanel key={current} sessionId={current} variant="main" className="min-h-0 flex-1" />}
    </div>
  );
}
