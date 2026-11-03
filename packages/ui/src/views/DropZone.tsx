import { MAX_SPLIT, type DropEdge, type ID } from '@branch/core';
import { useState, type DragEvent } from 'react';
import { actions, useApp } from '../app/store';
import { pushNotice } from '../app/sync';
import { useUi } from '../app/uiState';
import { cn } from '../lib/cn';
import { t } from '../i18n';

/** 사이드바 세션을 끌 때 dataTransfer에 싣는 형식 */
export const SESSION_DRAG_TYPE = 'application/x-rhymebook-session';

/** 가장자리에서 이 비율 안쪽이면 그 방향으로 나눈다 */
const EDGE_BAND = 0.28;

const PREVIEW: Record<DropEdge, string> = {
  left: 'inset-y-1 left-1 w-[calc(50%-0.25rem)]',
  right: 'inset-y-1 right-1 w-[calc(50%-0.25rem)]',
  top: 'inset-x-1 top-1 h-[calc(50%-0.25rem)]',
  bottom: 'inset-x-1 bottom-1 h-[calc(50%-0.25rem)]',
  center: 'inset-1',
};

function openLabels(): Record<DropEdge, string> {
  return {
    left: t('views.drop.open.left'),
    right: t('views.drop.open.right'),
    top: t('views.drop.open.top'),
    bottom: t('views.drop.open.bottom'),
    center: t('views.drop.open.center'),
  };
}

/** 분할 안의 패널을 옮길 때 (패널 헤더 이동 버튼 끌기) */
function moveLabels(): Record<DropEdge, string> {
  return {
    left: t('views.drop.move.left'),
    right: t('views.drop.move.right'),
    top: t('views.drop.move.top'),
    bottom: t('views.drop.move.bottom'),
    center: t('views.drop.move.center'),
  };
}

/** 포인터 위치로 놓을 자리를 고른다 (순수 함수, 테스트용 export) */
export function edgeAt(x: number, y: number, allowSplit: boolean): DropEdge {
  if (!allowSplit) return 'center';
  const d: [DropEdge, number][] = [
    ['left', x],
    ['right', 1 - x],
    ['top', y],
    ['bottom', 1 - y],
  ];
  const [edge, dist] = d.reduce((a, b) => (b[1] < a[1] ? b : a));
  return dist < EDGE_BAND ? edge : 'center';
}

/**
 * 패널 위 놓기 영역 (ADR-035). 사이드바에서 세션을 끄는 동안이나 분할 패널의 이동 버튼을 끄는 동안만 보인다.
 * 가장자리 → 그쪽으로 나눠 열기, 가운데 → 이 패널을 그 세션으로 바꾸기.
 */
export function DropZone({ targetId }: { targetId: ID }) {
  const dragId = useUi((s) => s.dragSessionId);
  const full = useApp((s) => s.view.mode === 'split' && s.view.splitSessionIds.length >= MAX_SPLIT);
  const inSplit = useApp((s) => (dragId ? s.view.mode === 'split' && s.view.splitSessionIds.includes(dragId) : false));
  const [edge, setEdge] = useState<DropEdge | null>(null);
  // 자기 패널 위에는 놓을 곳이 없다
  if (!dragId || (inSplit && dragId === targetId)) return null;
  const allowSplit = !full || inSplit;

  const pick = (e: DragEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return edgeAt((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height, allowSplit);
  };

  return (
    <div
      data-drop-zone={targetId}
      className="absolute inset-0 z-30"
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes(SESSION_DRAG_TYPE)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        const next = pick(e);
        if (next !== edge) setEdge(next);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setEdge(null);
      }}
      onDrop={(e) => {
        e.preventDefault();
        const id = e.dataTransfer.getData(SESSION_DRAG_TYPE) || dragId;
        const where = pick(e);
        setEdge(null);
        useUi.getState().setDragSession(null);
        if (!actions().dropToSplit(id, targetId, where)) {
          pushNotice(t('views.drop.maxSplit', { max: MAX_SPLIT }));
        }
      }}
    >
      {edge && (
        <div
          className={cn(
            'pointer-events-none absolute flex items-center justify-center rounded-xl border-2 border-dashed border-accent bg-accent/12 transition-all duration-100',
            PREVIEW[edge],
          )}
        >
          <span className="rounded-lg bg-accent px-2.5 py-1 text-[12.5px] font-medium text-accent-fg shadow-pop">{(inSplit ? moveLabels() : openLabels())[edge]}</span>
        </div>
      )}
    </div>
  );
}
