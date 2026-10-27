import { Graph, layout } from '@dagrejs/dagre';
import { buildTurns, descendantIds, type ID, type Message, type Session } from '@branch/core';
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
import { CheckCircle2, ChevronDown, FileText, X } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { actions, useApp } from '../app/store';
import { syncClient } from '../app/sync';
import { revealTurn } from '../chat/open';
import { useBreakpoint } from '../app/useBreakpoint';
import { IconButton } from '../components/Button';
import { cn } from '../lib/cn';
import { isMac } from '../lib/platform';

const NODE_W = 220;
const NODE_H = 84;
/** 모바일은 위→아래 배치 + 좁은 노드로 화면 폭에 맞춘다 */
const NODE_W_COMPACT = 156;
/** 펼친 질문 목록: 한 줄 높이·최대 표시 줄(넘치면 노드 안에서 스크롤) */
const TURN_H = 28;
const TURN_MAX = 8;

const turnsOf = (list: readonly Message[] | undefined) => (list ? buildTurns(list) : []);
const listHeight = (n: number) => (n ? Math.min(n, TURN_MAX) * TURN_H + 10 : 34);

interface MindData extends Record<string, unknown> {
  session: Session;
  active: boolean;
  depth: number;
  vertical: boolean;
  expanded: boolean;
  toggle(id: ID): void;
  openTurn(sessionId: ID, questionId: ID): void;
}
type MindNode = Node<MindData, 'session'>;

function SessionNode({ data }: NodeProps<MindNode>) {
  const { session, active, depth, vertical, expanded, toggle, openTurn } = data;
  const list = useApp((s) => s.messages[session.id]);
  const turns = useMemo(() => turnsOf(list), [list]);
  const label = expanded ? '질문 목록 접기' : '질문 목록 펼치기';
  // 페이지는 질문이 없으니 문서 아이콘만 (ADR-072)
  const page = session.kind === 'page';
  return (
    <div
      data-mind-node={session.id}
      className={cn(
        vertical ? 'w-[156px]' : 'w-[220px]',
        'rounded-xl border bg-surface px-3 py-2.5 text-left shadow-pop transition-colors',
        active ? 'border-accent ring-2 ring-accent/30' : 'border-line hover:border-line-strong',
        depth === 0 && 'bg-accent-soft',
      )}
    >
      <Handle type="target" position={vertical ? Position.Top : Position.Left} className="!h-1.5 !w-1.5 !border-0 !bg-line-strong" />
      <div className="flex items-start gap-1.5">
        {page && <FileText size={14} aria-label="페이지" className="mt-0.5 shrink-0 text-muted" />}
        <span className="line-clamp-2 flex-1 text-[13.5px] leading-snug font-semibold text-fg">{session.title}</span>
        {session.summary && (
          <span title="요약 있음" className="mt-0.5 shrink-0 text-anchor-line">
            <CheckCircle2 size={14} />
          </span>
        )}
        {!page && <button
          type="button"
          aria-label={label}
          title={label}
          aria-expanded={expanded}
          data-mind-toggle={session.id}
          onClick={(e) => {
            e.stopPropagation();
            toggle(session.id);
          }}
          onDoubleClick={(e) => e.stopPropagation()}
          className="nodrag -mt-0.5 -mr-1.5 grid size-6 shrink-0 place-items-center rounded-md text-muted hover:bg-surface-2 hover:text-fg"
        >
          <ChevronDown size={14} className={cn('transition-transform', expanded && 'rotate-180')} />
        </button>}
      </div>
      {session.anchor ? (
        <div className="mt-1 truncate text-[11.5px] text-muted">
          <span className="rounded bg-anchor/70 px-1 text-fg-2">“{session.anchor.text}”</span>
        </div>
      ) : (
        <div className="mt-1 text-[11.5px] text-muted">{session.parentId ? '각주 세션' : page ? '페이지' : '루트 세션'}</div>
      )}
      {expanded && !page && (
        <ul
          aria-label={`${session.title} 질문 목록`}
          style={{ maxHeight: TURN_MAX * TURN_H }}
          className="nowheel nodrag scroll-thin mt-2 -mx-1 overflow-y-auto border-t border-line pt-1"
        >
          {turns.length ? (
            turns.map((t) => (
              <li key={t.questionId}>
                <button
                  type="button"
                  data-mind-turn={t.questionId}
                  title={t.question}
                  onClick={(e) => {
                    e.stopPropagation();
                    openTurn(session.id, t.questionId);
                  }}
                  onDoubleClick={(e) => e.stopPropagation()}
                  style={{ height: TURN_H }}
                  className="flex w-full items-center gap-1.5 rounded-md px-1 text-left text-[12px] text-fg-2 hover:bg-surface-2 hover:text-fg"
                >
                  <span className="w-4 shrink-0 text-right text-[11px] text-muted tabular-nums">{t.index + 1}</span>
                  <span className="min-w-0 flex-1 truncate">{t.question || '(빈 질문)'}</span>
                </button>
              </li>
            ))
          ) : (
            <li className="px-1 py-1.5 text-[12px] text-muted">{list ? '아직 질문이 없어요.' : '불러오는 중…'}</li>
          )}
        </ul>
      )}
      <Handle type="source" position={vertical ? Position.Bottom : Position.Right} className="!h-1.5 !w-1.5 !border-0 !bg-line-strong" />
    </div>
  );
}

const nodeTypes = { session: SessionNode };

/** 현재 루트의 세션 트리를 dagre로 자동 배치 (데스크톱 좌→우, 모바일 위→아래) */
function useTree(
  rootId: ID | undefined,
  vertical: boolean,
  expanded: ReadonlySet<ID>,
  toggle: (id: ID) => void,
  openTurn: (sessionId: ID, questionId: ID) => void,
) {
  const sessions = useApp((s) => s.sessions);
  const messages = useApp((s) => s.messages);
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
    const height = (id: ID) => (expanded.has(id) ? NODE_H + listHeight(turnsOf(messages[id]).length) : NODE_H);
    for (const id of ids) {
      g.setNode(id, { width: w, height: height(id) });
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
        position: { x: n.x - w / 2, y: n.y - height(id) / 2 },
        data: {
          session: sessions[id]!,
          active: id === activeId,
          depth: depth[id] ?? 0,
          vertical,
          expanded: expanded.has(id),
          toggle,
          openTurn,
        },
        draggable: false,
        connectable: false,
      };
    });
    const edges: Edge[] = ids
      .filter((id) => id !== rootId && sessions[id]!.parentId)
      .map((id) => ({ id: `e-${id}`, source: sessions[id]!.parentId!, target: id, type: 'smoothstep' }));
    return { nodes, edges };
  }, [sessions, messages, rootId, activeId, vertical, expanded, toggle, openTurn]);
}

/** 마인드맵 보기. 클릭: 팝업(모바일 시트), Shift+클릭: 분할 추가, 더블클릭: 메인으로 */
export function MindmapView() {
  const activeId = useApp((s) => s.view.activeSessionId);
  const rootId = useApp((s) => (activeId ? s.sessions[activeId]?.rootId : undefined));
  const bp = useBreakpoint();
  const mobile = bp === 'mobile';
  const [expanded, setExpanded] = useState<ReadonlySet<ID>>(() => new Set());
  const toggle = useCallback((id: ID) => {
    syncClient?.ensureMessages(id);
    setExpanded((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }, []);
  const openTurn = useCallback((sessionId: ID, questionId: ID) => revealTurn(sessionId, questionId, mobile ? 'sheet' : 'popup'), [mobile]);
  const { nodes, edges } = useTree(rootId, mobile, expanded, toggle, openTurn);

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
        {mobile ? '탭: 시트로 열기 · 두 번 탭: 전체 화면 · ▾: 질문 목록' : `클릭: 팝업 · ${isMac ? '⇧' : 'Shift'}+클릭: 분할에 추가 · 더블클릭: 메인 · ▾: 질문 목록`}
      </div>
    </div>
  );

  if (!mobile) return body;
  return (
    <div className="fixed inset-0 z-30 flex flex-col bg-bg pt-[env(safe-area-inset-top)]">
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-line px-3">
        <span className="flex-1 truncate text-[15px] font-semibold">마인드맵</span>
        <IconButton label="마인드맵 닫기" onClick={() => actions().closeMindmap()}>
          <X size={18} />
        </IconButton>
      </div>
      <div className="min-h-0 flex-1">{body}</div>
    </div>
  );
}
