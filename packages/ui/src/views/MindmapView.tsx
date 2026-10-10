import { Graph, layout } from '@dagrejs/dagre';
import { descendantIds, type ID, type Session } from '@branch/core';
import {
  Background,
  Controls,
  Handle,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { CheckCircle2, X } from 'lucide-react';
import { useMemo } from 'react';
import { actions, useApp } from '../app/store';
import { useBreakpoint } from '../app/useBreakpoint';
import { IconButton } from '../components/Button';
import { cn } from '../lib/cn';
import { isMac } from '../lib/platform';

const NODE_W = 220;
const NODE_H = 84;
/** 모바일은 위→아래 배치 + 좁은 노드로 화면 폭에 맞춘다 */
const NODE_W_COMPACT = 156;

interface MindData extends Record<string, unknown> {
  session: Session;
  active: boolean;
  depth: number;
  vertical: boolean;
}
type MindNode = Node<MindData, 'session'>;

function SessionNode({ data }: NodeProps<MindNode>) {
  const { session, active, depth, vertical } = data;
  return (
    <div
      className={cn(
        vertical ? 'w-[156px]' : 'w-[220px]',
        'rounded-xl border bg-surface px-3 py-2.5 text-left shadow-pop transition-colors',
        active ? 'border-accent ring-2 ring-accent/30' : 'border-line hover:border-line-strong',
        depth === 0 && 'bg-accent-soft',
      )}
    >
      <Handle type="target" position={vertical ? Position.Top : Position.Left} className="!h-1.5 !w-1.5 !border-0 !bg-line-strong" />
      <div className="flex items-start gap-1.5">
        <span className="line-clamp-2 flex-1 text-[13.5px] leading-snug font-semibold text-fg">{session.title}</span>
        {session.summary && (
          <span title="요약 있음" className="mt-0.5 shrink-0 text-anchor-line">
            <CheckCircle2 size={14} />
          </span>
        )}
      </div>
      {session.anchor ? (
        <div className="mt-1 truncate text-[11.5px] text-muted">
          <span className="rounded bg-anchor/70 px-1 text-fg-2">“{session.anchor.text}”</span>
        </div>
      ) : (
        <div className="mt-1 text-[11.5px] text-muted">루트 세션</div>
      )}
      <Handle type="source" position={vertical ? Position.Bottom : Position.Right} className="!h-1.5 !w-1.5 !border-0 !bg-line-strong" />
    </div>
  );
}

const nodeTypes = { session: SessionNode };

/** 현재 루트의 세션 트리를 dagre로 자동 배치 (데스크톱 좌→우, 모바일 위→아래) */
function useTree(rootId: ID | undefined, vertical: boolean) {
  const sessions = useApp((s) => s.sessions);
  const activeId = useApp((s) => s.view.activeSessionId);
  return useMemo(() => {
    if (!rootId || !sessions[rootId]) return { nodes: [], edges: [] };
    const ids = [rootId, ...descendantIds(sessions, rootId)];
    const g = new Graph();
    const w = vertical ? NODE_W_COMPACT : NODE_W;
    g.setGraph({
      rankdir: vertical ? 'TB' : 'LR',
      nodesep: vertical ? 14 : 26,
      ranksep: vertical ? 44 : 70,
      marginx: 20,
      marginy: 20,
    });
    g.setDefaultEdgeLabel(() => ({}));
    const depth: Record<ID, number> = { [rootId]: 0 };
    for (const id of ids) {
      g.setNode(id, { width: w, height: NODE_H });
      const p = sessions[id]!.parentId;
      if (p && id !== rootId) {
        g.setEdge(p, id);
        depth[id] = (depth[p] ?? 0) + 1;
      }
    }
    layout(g);
    const nodes: MindNode[] = ids.map((id) => {
      const n = g.node(id);
      return {
        id,
        type: 'session',
        position: { x: n.x - w / 2, y: n.y - NODE_H / 2 },
        data: { session: sessions[id]!, active: id === activeId, depth: depth[id] ?? 0, vertical },
        draggable: false,
        connectable: false,
      };
    });
    const edges: Edge[] = ids
      .filter((id) => id !== rootId && sessions[id]!.parentId)
      .map((id) => ({ id: `e-${id}`, source: sessions[id]!.parentId!, target: id, type: 'smoothstep' }));
    return { nodes, edges };
  }, [sessions, rootId, activeId, vertical]);
}

/** 마인드맵 보기. 클릭: 팝업(모바일 시트), Shift+클릭: 분할 추가, 더블클릭: 메인으로 */
export function MindmapView() {
  const activeId = useApp((s) => s.view.activeSessionId);
  const rootId = useApp((s) => (activeId ? s.sessions[activeId]?.rootId : undefined));
  const bp = useBreakpoint();
  const mobile = bp === 'mobile';
  const { nodes, edges } = useTree(rootId, mobile);

  const body = (
    <div className="relative h-full w-full">
      <ReactFlow
        key={`${rootId}-${mobile ? 'v' : 'h'}`}
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.15, maxZoom: 1.1 }}
        minZoom={0.3}
        nodesDraggable={false}
        nodesConnectable={false}
        proOptions={{ hideAttribution: true }}
        onNodeClick={(e, n) => {
          if (e.shiftKey && !mobile) actions().openSession(n.id, 'split');
          else actions().openSession(n.id, mobile ? 'sheet' : 'popup');
        }}
        onNodeDoubleClick={(_, n) => actions().openSession(n.id, 'main')}
      >
        <Background gap={20} size={1} color="var(--border)" />
        <Controls showInteractive={false} position="bottom-right" />
      </ReactFlow>
      <div className="pointer-events-none absolute top-3 left-3 max-w-[70%] rounded-lg bg-surface/90 px-3 py-2 text-[12px] text-muted shadow-pop">
        {mobile ? '탭: 시트로 열기 · 두 번 탭: 전체 화면' : `클릭: 팝업 · ${isMac ? '⇧' : 'Shift'}+클릭: 분할에 추가 · 더블클릭: 메인`}
      </div>
    </div>
  );

  if (!mobile) return body;
  return (
    <div className="fixed inset-0 z-30 flex flex-col bg-bg pt-[env(safe-area-inset-top)]">
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-line px-3">
        <span className="flex-1 truncate text-[15px] font-semibold">마인드맵</span>
        <IconButton label="마인드맵 닫기" onClick={() => actions().setMode('single')}>
          <X size={18} />
        </IconButton>
      </div>
      <div className="min-h-0 flex-1">{body}</div>
    </div>
  );
}
