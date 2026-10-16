import {
  movePageBlock,
  newId,
  pageRows,
  PAGE_ROW_MAX,
  placePageBlock,
  removePageBlock,
  setPageBlockBeside,
  VAULT_LIMITS,
  type ID,
  type VaultNode,
  type VaultPage,
  type VaultPageBlock,
} from '@branch/core';
import { ArrowDown, ArrowUp, Columns2, FileText, GripVertical, Plus, Rows2, Type, X } from 'lucide-react';
import { useRef, useState, type PointerEvent } from 'react';
import { useBreakpoint } from '../app/useBreakpoint';
import { Markdown } from '../chat/Markdown';
import { Button, IconButton } from '../components/Button';
import { cn } from '../lib/cn';
import { beginDrag, edgeScroller, pointTarget } from './drag';
import { ItemPicker } from './pickers';
import { DragGhost, ItemContent, NodeIcon } from './shared';

type Where = 'before' | 'after' | 'left' | 'right';
interface BlockDrag {
  id: ID;
  x: number;
  y: number;
  target: { id: ID; where: Where } | null;
}

/** 줄 모양까지 같은지 비교하는 열쇠 */
const layoutKey = (blocks: VaultPageBlock[]) => blocks.map((b) => (b.beside ? `+${b.id}` : b.id)).join(',');

/** 페이지를 Markdown 한 편으로 (나란히 놓인 블록은 읽는 순서대로, 이미지는 data URL로 넣는다) */
export function pageMarkdown(page: VaultPage, vault: Record<ID, VaultNode>): string {
  const parts = [`# ${page.name}`];
  for (const b of page.blocks) {
    if ('text' in b) {
      if (b.text.trim()) parts.push(b.text);
      continue;
    }
    const n = vault[b.itemId];
    if (n?.kind !== 'item') continue;
    const c = n.item;
    parts.push(c.type === 'image' ? `![${c.attachment.name}](data:${c.attachment.mime};base64,${c.attachment.data})` : c.text);
  }
  return parts.join('\n\n') + '\n';
}

/**
 * 페이지 보기·편집 (ADR-058). 편집은 상위(Detail)가 가진 초안 blocks를 바꾸고 [저장]에서만 반영된다.
 * 블록은 줄 단위로 놓이고(태블릿 이상에서 나란히, 모바일은 세로로 쌓음), 손잡이를 끌어 옮긴다
 */
export function PageEditor({
  page,
  vault,
  editing,
  blocks,
  onChange,
}: {
  page: VaultPage;
  vault: Record<ID, VaultNode>;
  editing: boolean;
  blocks: VaultPageBlock[];
  onChange(blocks: VaultPageBlock[]): void;
}) {
  const mobile = useBreakpoint() === 'mobile';
  const [picking, setPicking] = useState(false);
  const [drag, setDrag] = useState<BlockDrag | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  // 끄는 중에 블록이 바뀌어도 놓을 때는 최신 목록으로 계산한다
  const latest = useRef(blocks);
  latest.current = blocks;
  const shown = editing ? blocks : page.blocks;
  const full = blocks.length >= VAULT_LIMITS.blocks;
  const rows = pageRows(shown);

  const add = (block: { itemId: ID } | { text: string }) => onChange([...blocks, { id: newId('b'), ...block }]);
  const setText = (id: ID, text: string) => onChange(blocks.map((b) => (b.id === id && 'text' in b ? { ...b, text } : b)));

  /** 손가락·커서 위치 → 놓을 자리. 블록 왼쪽·오른쪽 가장자리는 나란히, 그 밖은 위·아래 줄 */
  const dropAt = (id: ID, x: number, y: number): BlockDrag['target'] => {
    const el = pointTarget(x, y, '[data-vault-block]');
    const targetId = el?.dataset.vaultBlock;
    if (!el || !targetId || targetId === id) return null;
    const r = el.getBoundingClientRect();
    const rx = (x - r.left) / r.width;
    const where: Where = !mobile && rx < 0.25 ? 'left' : !mobile && rx > 0.75 ? 'right' : y < r.top + r.height / 2 ? 'before' : 'after';
    const cur = latest.current;
    const next = placePageBlock(cur, id, targetId, where);
    return layoutKey(next) === layoutKey(cur) ? null : { id: targetId, where };
  };

  const startDrag = (e: PointerEvent, id: ID) => {
    const scroller = edgeScroller(rootRef.current?.closest<HTMLElement>('[data-vault-scroll]') ?? null);
    let target: BlockDrag['target'] = null;
    beginDrag(
      e,
      {
        onStart: (x, y) => setDrag({ id, x, y, target: null }),
        onMove: (x, y) => {
          scroller.update(y);
          target = dropAt(id, x, y);
          setDrag({ id, x, y, target });
        },
        onDrop: () => {
          scroller.stop();
          setDrag(null);
          if (target) onChange(placePageBlock(latest.current, id, target.id, target.where));
        },
        onCancel: () => {
          scroller.stop();
          setDrag(null);
        },
      },
      { handle: true },
    );
  };

  if (!editing && !page.blocks.length) {
    return <p className="py-8 text-center text-[14px] text-muted">빈 페이지예요. 위쪽 [수정하기]에서 조각과 글을 넣어 보세요.</p>;
  }

  const dragging = drag ? shown.find((b) => b.id === drag.id) : undefined;
  const nameOf = (b: VaultPageBlock) => ('text' in b ? '글' : (vault[b.itemId]?.name ?? '지워진 조각'));

  return (
    <div ref={rootRef} data-vault-page={page.id} className="mx-auto max-w-4xl">
      <ol className={cn(editing ? 'space-y-3' : 'space-y-4')}>
        {rows.map((row, ri) => {
          const rowTarget = drag?.target && row.some((b) => b.id === drag.target!.id) ? drag.target : null;
          const cells = row.map((b, ci) => {
            const idx = shown.indexOf(b);
            const node = 'itemId' in b ? vault[b.itemId] : undefined;
            const body =
              'text' in b ? (
                editing ? (
                  <textarea
                    aria-label="글"
                    value={b.text}
                    rows={Math.min(12, Math.max(3, b.text.split('\n').length))}
                    maxLength={VAULT_LIMITS.text}
                    placeholder="이 자리에 넣을 글 (Markdown)"
                    onChange={(e) => setText(b.id, e.target.value)}
                    className="w-full resize-y rounded-lg border border-line bg-bg px-2.5 py-2 text-[15px] leading-relaxed outline-none focus:border-accent md:text-sm"
                  />
                ) : b.text.trim() ? (
                  <div className="md">
                    <Markdown content={b.text} />
                  </div>
                ) : null
              ) : node?.kind === 'item' ? (
                <ItemContent item={node.item} playKey={`page:${page.id}:${b.id}`} />
              ) : (
                <p className="rounded-xl border border-dashed border-line px-3 py-3 text-[13px] text-muted">지워진 조각이에요.</p>
              );
            if (!editing) return body ? <div key={b.id} className="min-w-0 md:flex-1">{body}</div> : null;
            const side = drag?.target?.id === b.id && (drag.target.where === 'left' || drag.target.where === 'right') ? drag.target.where : null;
            const prevRow = ri > 0 ? rows[ri - 1]! : undefined;
            return (
              <div
                key={b.id}
                data-vault-block={b.id}
                className={cn('relative min-w-0 rounded-xl border border-line bg-surface p-2 md:flex-1', drag?.id === b.id && 'opacity-40')}
              >
                {side && <span aria-hidden className={cn('absolute inset-y-1 w-1 rounded-full bg-accent', side === 'left' ? '-left-2' : '-right-2')} />}
                <div className="mb-1.5 flex items-center gap-0.5 text-[12px] text-muted">
                  <span
                    role="button"
                    tabIndex={-1}
                    aria-label="끌어서 옮기기"
                    title="끌어서 옮기기"
                    data-vault-handle
                    onPointerDown={(e) => startDrag(e, b.id)}
                    className="-ml-1 grid size-8 shrink-0 cursor-grab touch-none place-items-center rounded text-muted hover:bg-surface-2 hover:text-fg active:cursor-grabbing"
                  >
                    <GripVertical size={15} />
                  </span>
                  {'text' in b ? <Type size={13} className="shrink-0" /> : node ? <NodeIcon node={node} size={13} /> : <FileText size={13} className="shrink-0" />}
                  <span className="ml-1 min-w-0 flex-1 truncate">{nameOf(b)}</span>
                  <IconButton size="sm" label="위로" disabled={idx === 0} onClick={() => onChange(movePageBlock(blocks, b.id, 'up'))}>
                    <ArrowUp size={14} />
                  </IconButton>
                  <IconButton size="sm" label="아래로" disabled={idx === blocks.length - 1} onClick={() => onChange(movePageBlock(blocks, b.id, 'down'))}>
                    <ArrowDown size={14} />
                  </IconButton>
                  {row.length > 1 ? (
                    <IconButton size="sm" label="나란히 풀기" className="max-md:hidden" onClick={() => onChange(setPageBlockBeside(blocks, b.id, false))}>
                      <Rows2 size={14} />
                    </IconButton>
                  ) : (
                    ci === 0 &&
                    prevRow &&
                    prevRow.length < PAGE_ROW_MAX && (
                      <IconButton size="sm" label="앞 블록 옆에 나란히" className="max-md:hidden" onClick={() => onChange(setPageBlockBeside(blocks, b.id, true))}>
                        <Columns2 size={14} />
                      </IconButton>
                    )
                  )}
                  <IconButton size="sm" label="페이지에서 빼기" onClick={() => onChange(removePageBlock(blocks, b.id))}>
                    <X size={14} />
                  </IconButton>
                </div>
                {body}
              </div>
            );
          });
          if (!editing && cells.every((c) => !c)) return null;
          return (
            <li key={row[0]!.id} data-vault-row className={cn('relative space-y-3 md:flex md:items-start md:space-y-0', editing ? 'md:gap-3' : 'md:gap-5')}>
              {rowTarget && (rowTarget.where === 'before' || rowTarget.where === 'after') && (
                <span aria-hidden className={cn('absolute inset-x-0 h-1 rounded-full bg-accent', rowTarget.where === 'before' ? '-top-2' : '-bottom-2')} />
              )}
              {cells}
            </li>
          );
        })}
      </ol>

      {editing && (
        <div className="mt-3 space-y-2">
          {!blocks.length && <p className="py-4 text-center text-[14px] text-muted">조각이나 글을 넣어 페이지를 꾸며 보세요.</p>}
          <div className="flex flex-wrap gap-1.5">
            <Button size="sm" variant="soft" icon={<Plus size={14} />} disabled={full} onClick={() => setPicking((v) => !v)} aria-expanded={picking}>
              조각 넣기
            </Button>
            <Button size="sm" icon={<Type size={14} />} disabled={full} onClick={() => add({ text: '' })}>
              글 넣기
            </Button>
            {!mobile && blocks.length > 1 && <span className="self-center text-[12px] text-muted">손잡이를 끌어 다른 블록 왼쪽·오른쪽 끝에 놓으면 나란히 놓여요.</span>}
          </div>
          {picking && (
            <ItemPicker
              vault={vault}
              onPick={(itemId) => {
                add({ itemId });
                setPicking(false);
              }}
            />
          )}
        </div>
      )}

      {drag && dragging && (
        <DragGhost x={drag.x} y={drag.y}>
          <GripVertical size={13} className="shrink-0 text-muted" />
          <span className="truncate">{nameOf(dragging)}</span>
        </DragGhost>
      )}
    </div>
  );
}
