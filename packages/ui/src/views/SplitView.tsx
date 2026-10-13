import { leafIds, normalizeLayout, type ID, type SplitNode } from '@branch/core';
import { X } from 'lucide-react';
import { Fragment } from 'react';
import { Group, Panel, Separator } from 'react-resizable-panels';
import { actions, useApp, useAppShallow } from '../app/store';
import { useBreakpoint } from '../app/useBreakpoint';
import { ChatPanel } from '../chat/ChatPanel';
import { IconButton } from '../components/Button';
import { cn } from '../lib/cn';
import { DropZone } from './DropZone';
import { PaneMoveButton, SeparatorMenuButton } from './SplitControls';

/** 분할 보기: 데스크톱/태블릿은 좌우·상하 크기 조절 패널(최대 4), 모바일은 탭 전환 */
export function SplitView() {
  const ids = useAppShallow((s) => s.view.splitSessionIds);
  const focused = useApp((s) => s.view.focusedSplitIndex);
  const saved = useApp((s) => s.view.splitLayout);
  const bp = useBreakpoint();

  if (bp === 'mobile') return <SplitTabs ids={ids} focused={focused} />;
  const layout = normalizeLayout(saved, ids);
  if (!layout) return null;
  return (
    <div className="h-full" data-split-root="">
      <SplitTree node={layout} path={[]} />
    </div>
  );
}

const nodeKey = (n: SplitNode) => (n.kind === 'leaf' ? `l-${n.sessionId}` : `g-${n.dir}-${leafIds(n).join('_')}`);

function SplitTree({ node, path }: { node: SplitNode; path: number[] }) {
  if (node.kind === 'leaf') return <Pane sessionId={node.sessionId} />;
  const row = node.dir === 'row';
  const keys = node.children.map(nodeKey);
  const defaultLayout = node.sizes && node.sizes.length === keys.length ? Object.fromEntries(keys.map((k, i) => [k, node.sizes![i]!])) : undefined;
  return (
    <Group
      // 방향도 키에 넣어 방향 전환·자리 바꾸기 뒤 새 비율(defaultLayout)로 다시 배치한다
      key={`${node.dir}:${keys.join('|')}`}
      orientation={row ? 'horizontal' : 'vertical'}
      className="h-full"
      defaultLayout={defaultLayout}
      onLayoutChanged={(l) => actions().setSplitGroupSizes(path, keys.map((k) => l[k] ?? 100 / keys.length))}
    >
      {node.children.map((child, i) => (
        <Fragment key={keys[i]}>
          {i > 0 && (
            <Separator
              className={cn(
                'group relative bg-line outline-none data-[separator=active]:bg-accent data-[separator=hover]:bg-accent',
                row ? 'w-px' : 'h-px',
              )}
            >
              <span className={cn('absolute', row ? 'inset-y-0 -right-1.5 -left-1.5' : 'inset-x-0 -top-1.5 -bottom-1.5')} />
              <SeparatorMenuButton path={path} index={i} row={row} />
            </Separator>
          )}
          <Panel id={keys[i]} minSize="18%" className="min-h-0 min-w-0">
            <SplitTree node={child} path={[...path, i]} />
          </Panel>
        </Fragment>
      ))}
    </Group>
  );
}

function Pane({ sessionId }: { sessionId: ID }) {
  const index = useApp((s) => s.view.splitSessionIds.indexOf(sessionId));
  const focused = useApp((s) => s.view.focusedSplitIndex === index);
  return (
    <div
      data-split-pane={sessionId}
      className={cn('relative h-full', focused && 'shadow-[inset_0_2px_0_var(--accent)]')}
      onMouseDownCapture={() => !focused && index >= 0 && actions().focusSplit(index)}
    >
      <ChatPanel
        sessionId={sessionId}
        variant="pane"
        headerActions={
          <>
            <PaneMoveButton sessionId={sessionId} />
            <IconButton size="sm" label="패널 닫기" onClick={() => actions().closeSplit(index)}>
              <X size={16} />
            </IconButton>
          </>
        }
      />
      <DropZone targetId={sessionId} />
    </div>
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
