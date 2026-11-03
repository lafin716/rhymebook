import { t, intlLocale } from '../i18n';
import {
  addVaultPageBlock,
  createVaultFolder,
  createVaultPage,
  isVaultFolder,
  moveVaultNode,
  newId,
  normalizePageBlocks,
  placeVaultNode,
  renameVaultNode,
  vaultChildren,
  vaultDescendants,
  wouldCreateCycle,
  VAULT_LIMITS,
  type ID,
  type VaultItem,
  type VaultNode,
  type VaultPage,
  type VaultPageBlock,
} from '@branch/core';
import {
  ArrowLeft,
  ChevronRight,
  Copy,
  CornerDownRight,
  Download,
  FilePlus2,
  FolderInput,
  FolderPlus,
  LayoutTemplate,
  Maximize2,
  Minimize2,
  Pencil,
  Save,
  Trash2,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent, type ReactNode } from 'react';
import { actions, useApp } from '../app/store';
import { pushNotice } from '../app/sync';
import { useUi } from '../app/uiState';
import { useBreakpoint } from '../app/useBreakpoint';
import { Button, IconButton } from '../components/Button';
import { confirm } from '../components/ConfirmDialog';
import { Modal } from '../components/Modal';
import { cn } from '../lib/cn';
import { saveBase64File, saveTextFile } from '../lib/download';
import { beginDrag, edgeScroller, pointTarget } from './drag';
import { PageEditor, pageMarkdown } from './PageEditor';
import { FolderPicker, PagePicker } from './pickers';
import { confirmDiscard, DragGhost, ItemContent, NodeIcon, put } from './shared';

/**
 * 보관함 (ADR-055, ADR-058): 답변에서 담은 글·이미지·음성 조각을 폴더 트리로 정리하고,
 * 조각과 글을 엮어 페이지 하나로 구성한다. 모바일은 목록 ↔ 상세 전환, 태블릿 이상은 두 칸(창 또는 전체 화면)
 */
export function VaultOverlay() {
  const open = useApp((s) => s.overlay === 'vault');
  const full = useUi((s) => s.vaultFull);
  /** 상세에서 저장하지 않은 수정이 있는지 (닫기·다른 항목 고르기 전에 묻는다) */
  const dirty = useRef(false);
  const close = async () => {
    if (dirty.current && !(await confirmDiscard())) return;
    dirty.current = false;
    actions().setOverlay('none');
  };
  return (
    <Modal open={open} onClose={() => void close()} label={t('vault.overlay.label')} size={full ? 'full' : 'tall'} className="md:max-w-5xl">
      {open && <VaultBody dirty={dirty} onClose={() => void close()} />}
    </Modal>
  );
}

/** 놓을 자리: 폴더 안(null은 맨 위) 또는 어떤 줄의 앞·뒤 (ADR-059) */
type TreeTarget = { into: ID | null } | { id: ID; where: 'before' | 'after' };
interface TreeDrag {
  id: ID;
  x: number;
  y: number;
  /** undefined: 놓을 수 없음 */
  to: TreeTarget | undefined;
}

const sameOrder = (a: VaultNode[], b: VaultNode[]) => a.length === b.length && a.every((n, i) => n.id === b[i]!.id);

function VaultBody({ dirty, onClose }: { dirty: { current: boolean }; onClose(): void }) {
  const mobile = useBreakpoint() === 'mobile';
  const full = useUi((s) => s.vaultFull);
  const vault = useApp((s) => s.vault);
  const [selectedId, setSelectedId] = useState<ID | null>(null);
  const [expanded, setExpanded] = useState<Set<ID>>(new Set());
  const [fresh, setFresh] = useState<ID | null>(null);
  const [drag, setDrag] = useState<TreeDrag | null>(null);
  const treeRef = useRef<HTMLDivElement>(null);
  const vaultRef = useRef(vault);
  const expandedRef = useRef(expanded);
  useEffect(() => {
    vaultRef.current = vault;
    expandedRef.current = expanded;
  }, [vault, expanded]);
  const selected = selectedId ? vault[selectedId] : undefined;
  const setDirty = useCallback((d: boolean) => {
    dirty.current = d;
  }, [dirty]);

  const expand = (id: ID | null) => id && setExpanded((s) => (s.has(id) ? s : new Set(s).add(id)));
  const toggle = (id: ID) =>
    setExpanded((s) => {
      const next = new Set(s);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  /** 저장하지 않은 수정이 있으면 버릴지 먼저 묻는다 */
  const leave = async () => !dirty.current || (await confirmDiscard());
  const select = async (id: ID | null) => {
    if (id === selectedId || !(await leave())) return;
    setSelectedId(id);
    setFresh(null);
  };

  /** 새 폴더·페이지는 고른 폴더 안(항목을 골랐으면 그 옆)에 만든다 */
  const create = async (kind: 'folder' | 'page') => {
    if (!(await leave())) return;
    const parentId = selected ? (isVaultFolder(selected) ? selected.id : selected.parentId) : null;
    const id = newId('v');
    const now = Date.now();
    put(kind === 'folder' ? createVaultFolder(id, parentId, t('vault.defaults.newFolder'), now) : createVaultPage(id, parentId, t('vault.defaults.newPage'), now));
    expand(parentId);
    setSelectedId(id);
    setFresh(id);
  };

  const moveTo = (node: VaultNode, to: ID | null) => {
    if (to === node.parentId) return;
    put(moveVaultNode(node, to, Date.now()));
    expand(to);
    pushNotice(to ? t('vault.move.toFolder', { name: vaultRef.current[to]?.name ?? t('vault.defaults.folder') }) : t('vault.move.toTop'));
  };

  /**
   * 트리 항목 끌기: 줄의 위·아래 가장자리에 놓으면 그 줄 앞·뒤(같은 폴더 안 순서), 폴더 줄 가운데면 그 폴더 안,
   * 빈 곳이면 맨 위 폴더의 맨 뒤. 놓일 자리는 선(앞·뒤)이나 테두리(폴더 안)로 미리 보여 준다
   */
  const startDrag = (e: PointerEvent, id: ID) => {
    const scroller = edgeScroller(treeRef.current);
    let to: TreeDrag['to'];
    let hover: { id: ID; timer: ReturnType<typeof setTimeout> } | undefined;
    const clearHover = () => {
      if (hover) clearTimeout(hover.timer);
      hover = undefined;
    };
    const into = (dest: ID | null): TreeDrag['to'] => {
      const v = vaultRef.current;
      const node = v[id];
      if (!node || dest === node.parentId) return undefined;
      if (dest && (dest === id || (isVaultFolder(node) && wouldCreateCycle(v, id, dest)))) return undefined;
      return { into: dest };
    };
    const line = (targetId: ID, where: 'before' | 'after'): TreeDrag['to'] => {
      const v = vaultRef.current;
      const changed = placeVaultNode(v, id, targetId, where, 0);
      if (!changed.length) return undefined;
      const parentId = v[targetId]!.parentId;
      const next = { ...v, ...Object.fromEntries(changed.map((n) => [n.id, n])) };
      // 자리가 그대로면(바로 앞·뒤에 놓기) 놓을 곳이 아니다
      if (v[id]!.parentId === parentId && sameOrder(vaultChildren(v, parentId), vaultChildren(next, parentId))) return undefined;
      return { id: targetId, where };
    };
    const targetAt = (x: number, y: number): TreeDrag['to'] => {
      const row = pointTarget(x, y, '[data-vault-node]');
      const targetId = row?.dataset.vaultNode;
      if (row && targetId) {
        if (targetId === id) return undefined;
        const r = row.getBoundingClientRect();
        const ry = (y - r.top) / r.height;
        if (row.dataset.kind === 'folder') {
          if (ry < 0.25) return line(targetId, 'before');
          // 펼친 폴더의 아래쪽은 첫 칸과 겹쳐 보이므로 폴더 안으로 둔다
          if (ry > 0.75 && !expandedRef.current.has(targetId)) return line(targetId, 'after');
          return into(targetId);
        }
        return line(targetId, ry < 0.5 ? 'before' : 'after');
      }
      return pointTarget(x, y, '[data-vault-drop]') ? into(null) : undefined;
    };
    const end = () => {
      scroller.stop();
      clearHover();
      setDrag(null);
    };
    beginDrag(e, {
      onStart: (x, y) => setDrag({ id, x, y, to: undefined }),
      onMove: (x, y) => {
        scroller.update(y);
        to = targetAt(x, y);
        setDrag({ id, x, y, to });
        // 닫힌 폴더 가운데에 잠시 머물면 펼친다
        const over = to && 'into' in to ? to.into : null;
        if (over !== (hover?.id ?? null)) {
          clearHover();
          if (over) hover = { id: over, timer: setTimeout(() => expand(over), 650) };
        }
      },
      onDrop: () => {
        end();
        const v = vaultRef.current;
        const node = v[id];
        if (!node || !to) return;
        if ('into' in to) return moveTo(node, to.into);
        const changed = placeVaultNode(v, id, to.id, to.where, Date.now());
        changed.forEach(put);
        const parentId = v[to.id]?.parentId ?? null;
        if (parentId !== node.parentId) {
          expand(parentId);
          pushNotice(parentId ? t('vault.move.toFolder', { name: v[parentId]?.name ?? t('vault.defaults.folder') }) : t('vault.move.toTop'));
        }
      },
      onCancel: end,
    });
  };

  const showDetail = !mobile || !!selected;
  const showTree = !mobile || !selected;
  const dragNode = drag ? vault[drag.id] : undefined;

  return (
    <>
      <div className={cn('flex h-13 shrink-0 items-center gap-1 border-b border-line px-2 md:px-4', full && 'md:px-5')}>
        {mobile && selected ? (
          <IconButton label={t('vault.overlay.backToList')} onClick={() => void select(null)}>
            <ArrowLeft size={18} />
          </IconButton>
        ) : (
          <span className="w-1 md:hidden" />
        )}
        <h2 className="min-w-0 flex-1 truncate text-[16px] font-semibold">{t('vault.overlay.label')}</h2>
        {!mobile && (
          <IconButton label={full ? t('vault.overlay.windowed') : t('vault.overlay.fullScreen')} title={full ? t('vault.overlay.windowed') : t('vault.overlay.fullScreen')} onClick={() => useUi.getState().toggleVaultFull()}>
            {full ? <Minimize2 size={17} /> : <Maximize2 size={17} />}
          </IconButton>
        )}
        <IconButton label={t('vault.overlay.close')} onClick={onClose}>
          <X size={18} />
        </IconButton>
      </div>
      <div className="flex min-h-0 flex-1">
        {showTree && (
          <div data-vault-tree className={cn('flex min-h-0 w-full flex-col md:w-[280px] md:shrink-0 md:border-r md:border-line', full && 'lg:w-[320px]')}>
            <div className="flex shrink-0 gap-1.5 border-b border-line px-3 py-2">
              <Button size="sm" variant="ghost" icon={<FolderPlus size={14} />} onClick={() => void create('folder')}>
                {t('vault.defaults.newFolder')}
              </Button>
              <Button size="sm" variant="ghost" icon={<FilePlus2 size={14} />} onClick={() => void create('page')}>
                {t('vault.defaults.newPage')}
              </Button>
            </div>
            <div
              ref={treeRef}
              data-vault-drop=""
              className={cn(
                'scroll-thin min-h-0 flex-1 overflow-y-auto px-2 py-2 transition-shadow',
                drag?.to && 'into' in drag.to && drag.to.into === null && 'shadow-[inset_0_0_0_2px_var(--color-accent)]',
              )}
              role="tree"
              aria-label={t('vault.overlay.folderAria')}
            >
              {Object.keys(vault).length === 0 ? (
                <p className="px-3 py-8 text-center text-[13.5px] leading-relaxed text-muted">
                  {t('vault.overlay.empty')}
                </p>
              ) : (
                <>
                  <TreeRows
                    vault={vault}
                    parentId={null}
                    depth={0}
                    selectedId={selectedId}
                    expanded={expanded}
                    drag={drag}
                    onSelect={(id) => void select(id)}
                    onToggle={toggle}
                    onDragStart={startDrag}
                  />
                  {drag && <p className="px-3 pt-3 pb-6 text-center text-[12px] text-muted">{t('vault.overlay.dropHint')}</p>}
                </>
              )}
            </div>
          </div>
        )}
        {showDetail && (
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            {selected ? (
              <Detail
                key={selected.id}
                node={selected}
                vault={vault}
                fresh={fresh === selected.id}
                onDirty={setDirty}
                onSelect={(id) => void select(id)}
                onMove={moveTo}
                onDeleted={(parentId) => {
                  dirty.current = false;
                  setSelectedId(parentId);
                }}
                onClose={onClose}
              />
            ) : (
              <div className="grid flex-1 place-items-center px-6 text-center text-[14px] text-muted">
                {t('vault.overlay.pickHint')}
              </div>
            )}
          </div>
        )}
      </div>
      {drag && dragNode && (
        <DragGhost x={drag.x} y={drag.y}>
          <NodeIcon node={dragNode} size={14} />
          <span className="truncate">{dragNode.name}</span>
        </DragGhost>
      )}
    </>
  );
}

function TreeRows(props: {
  vault: Record<ID, VaultNode>;
  parentId: ID | null;
  depth: number;
  selectedId: ID | null;
  expanded: Set<ID>;
  drag: TreeDrag | null;
  onSelect(id: ID): void;
  onToggle(id: ID): void;
  onDragStart(e: PointerEvent, id: ID): void;
}) {
  const { vault, parentId, depth, selectedId, expanded, drag, onSelect, onToggle, onDragStart } = props;
  const children = useMemo(() => vaultChildren(vault, parentId), [vault, parentId]);
  return (
    <ul role={depth ? 'group' : undefined}>
      {children.map((n) => {
        const folder = isVaultFolder(n);
        const open = folder && expanded.has(n.id);
        const to = drag?.to;
        const target = !!to && 'into' in to && to.into === n.id;
        const edge = to && 'where' in to && to.id === n.id ? to.where : null;
        return (
          <li key={n.id} role="treeitem" aria-expanded={folder ? open : undefined} aria-selected={selectedId === n.id}>
            <div
              data-vault-node={n.id}
              data-kind={n.kind}
              data-vault-drop={folder ? n.id : (n.parentId ?? '')}
              className={cn(
                'relative flex min-h-10 items-center rounded-lg pr-2 text-[14px] select-none [-webkit-touch-callout:none] md:min-h-8 md:text-[13.5px]',
                target ? 'bg-accent-soft text-fg ring-2 ring-accent ring-inset' : selectedId === n.id ? 'bg-accent-soft text-fg' : 'text-fg-2 hover:bg-surface-2',
                drag?.id === n.id && 'opacity-40',
              )}
              style={{ paddingLeft: `${4 + Math.min(depth, 6) * 14}px` }}
            >
              {edge && (
                <span
                  aria-hidden
                  data-vault-drop-line={edge}
                  className={cn('pointer-events-none absolute right-1 h-0.5 rounded-full bg-accent', edge === 'before' ? '-top-px' : '-bottom-px')}
                  style={{ left: `${4 + Math.min(depth, 6) * 14 + 24}px` }}
                >
                  <span className="absolute -top-[3px] -left-1.5 size-2 rounded-full border-2 border-accent bg-surface" />
                </span>
              )}
              {folder ? (
                <button
                  type="button"
                  aria-label={open ? t('vault.tree.collapse', { name: n.name }) : t('vault.tree.expand', { name: n.name })}
                  onClick={() => onToggle(n.id)}
                  className="grid size-7 shrink-0 place-items-center rounded text-muted hover:text-fg"
                >
                  <ChevronRight size={14} className={cn('transition-transform', open && 'rotate-90')} />
                </button>
              ) : (
                <span className="w-7 shrink-0" />
              )}
              <button
                type="button"
                onPointerDown={(e) => onDragStart(e, n.id)}
                onClick={() => {
                  onSelect(n.id);
                  if (folder && !open) onToggle(n.id);
                }}
                className="flex min-w-0 flex-1 items-center gap-2 self-stretch text-left"
              >
                <NodeIcon node={n} open={open} />
                <span className="truncate">{n.name}</span>
              </button>
            </div>
            {open && <TreeRows {...props} parentId={n.id} depth={depth + 1} />}
          </li>
        );
      })}
    </ul>
  );
}

/** 상세 위쪽 도구 모음 버튼 */
function Tool({ icon, onClick, danger, disabled, children }: { icon: ReactNode; onClick(): void; danger?: boolean; disabled?: boolean; children: ReactNode }) {
  return (
    <Button size="sm" variant="ghost" icon={icon} disabled={disabled} className={cn('shrink-0', danger && 'text-danger hover:text-danger')} onClick={onClick}>
      {children}
    </Button>
  );
}

function Detail({
  node,
  vault,
  fresh,
  onDirty,
  onSelect,
  onMove,
  onDeleted,
  onClose,
}: {
  node: VaultNode;
  vault: Record<ID, VaultNode>;
  fresh: boolean;
  onDirty(dirty: boolean): void;
  onSelect(id: ID): void;
  onMove(node: VaultNode, to: ID | null): void;
  onDeleted(parentId: ID | null): void;
  onClose(): void;
}) {
  const [editing, setEditing] = useState(fresh);
  const [name, setName] = useState(node.name);
  const [text, setText] = useState(node.kind === 'item' && node.item.type !== 'image' ? node.item.text : '');
  const [blocks, setBlocks] = useState<VaultPageBlock[]>(node.kind === 'page' ? node.blocks : []);
  const [picker, setPicker] = useState<'folder' | 'page' | null>(null);
  const source = node.kind === 'item' ? node.source : undefined;
  const hasSource = useApp((s) => !!(source && s.sessions[source.sessionId]));
  const editableText = node.kind === 'item' && node.item.type !== 'image';

  const dirty =
    editing &&
    (name.trim() !== node.name ||
      (node.kind === 'item' && node.item.type !== 'image' && text !== node.item.text) ||
      (node.kind === 'page' && JSON.stringify(blocks) !== JSON.stringify(node.blocks)));
  useEffect(() => {
    onDirty(dirty);
  }, [dirty, onDirty]);
  useEffect(
    () => () => {
      onDirty(false);
    },
    [onDirty],
  );

  const startEdit = () => {
    setName(node.name);
    if (node.kind === 'item' && node.item.type !== 'image') setText(node.item.text);
    if (node.kind === 'page') setBlocks(node.blocks);
    setEditing(true);
  };
  const cancel = async () => {
    if (dirty && !(await confirmDiscard())) return;
    setName(node.name);
    setEditing(false);
  };
  const save = () => {
    const nextName = name.trim() || node.name;
    const now = Date.now();
    let next: VaultNode = nextName === node.name ? node : renameVaultNode(node, nextName, now);
    if (next.kind === 'item' && next.item.type !== 'image' && text !== next.item.text) {
      if (!text.trim()) return pushNotice(t('vault.notice.emptyContent'));
      next = { ...next, item: { ...next.item, text }, updatedAt: now };
    }
    if (next.kind === 'page') {
      const cleaned = normalizePageBlocks(blocks.filter((b) => !('text' in b) || b.text.trim()));
      if (JSON.stringify(cleaned) !== JSON.stringify(next.blocks)) next = { ...next, blocks: cleaned, updatedAt: now };
    }
    if (next !== node) {
      put(next);
      if (node.kind === 'page') pushNotice(t('vault.notice.saved'));
    }
    setName(next.name);
    setEditing(false);
  };

  const remove = async () => {
    const inside = isVaultFolder(node) ? vaultDescendants(vault, node.id).length : 0;
    const ok = await confirm({
      title: t('vault.delete.title', { name: node.name }),
      message: inside ? t('vault.delete.withContents', { count: inside }) : t('vault.delete.irreversible'),
      confirmLabel: t('vault.delete.confirm'),
      tone: 'danger',
    });
    if (!ok) return;
    actions().deleteVaultNodes([node.id]);
    onDeleted(node.parentId);
  };

  const addToPage = (page: VaultPage) => {
    setPicker(null);
    if (page.blocks.length >= VAULT_LIMITS.blocks) return pushNotice(t('vault.notice.pageFull'));
    put(addVaultPageBlock(page, newId('b'), { itemId: node.id }, Date.now()));
    pushNotice(t('vault.notice.addedToPage', { name: page.name }));
  };

  const copy = (item: VaultItem) => {
    const c = item.item;
    if (c.type === 'image') return void saveBase64File(c.attachment.name, c.attachment.data, c.attachment.mime).catch(() => {});
    void navigator.clipboard.writeText(c.text).then(
      () => pushNotice(t('vault.notice.copied')),
      () => pushNotice(t('vault.notice.copyFailed')),
    );
  };

  const toolbar = editing ? (
    <>
      <Button size="sm" variant="primary" icon={<Save size={14} />} onClick={save}>
        {t('vault.item.save')}
      </Button>
      <Button size="sm" variant="ghost" onClick={() => void cancel()}>
        {t('vault.item.cancel')}
      </Button>
    </>
  ) : (
    <>
      {node.kind === 'item' && (
        <Tool icon={<LayoutTemplate size={14} />} onClick={() => setPicker('page')}>
          {t('vault.item.addToPage')}
        </Tool>
      )}
      <Tool icon={<FolderInput size={14} />} onClick={() => setPicker('folder')}>
        {t('vault.item.move')}
      </Tool>
      {node.kind === 'item' && (
        <Tool icon={node.item.type === 'image' ? <Download size={14} /> : <Copy size={14} />} onClick={() => copy(node)}>
          {node.item.type === 'image' ? t('vault.item.saveImage') : t('vault.item.copy')}
        </Tool>
      )}
      <Tool icon={<Trash2 size={14} />} danger onClick={() => void remove()}>
        {t('vault.delete.confirm')}
      </Tool>
      <Tool icon={<Pencil size={14} />} onClick={startEdit}>
        {t('vault.item.edit')}
      </Tool>
      {node.kind === 'page' && (
        <Tool
          icon={<Download size={14} />}
          disabled={!node.blocks.length}
          onClick={() => void saveTextFile(`${node.name}.md`, pageMarkdown(node, vault), 'text/markdown').catch(() => {})}
        >
          {t('vault.item.saveMarkdown')}
        </Tool>
      )}
      {source && hasSource && (
        <Tool
          icon={<CornerDownRight size={14} />}
          onClick={() => {
            actions().openSession(source.sessionId, 'main');
            onClose();
          }}
        >
          {t('vault.item.openChat')}
        </Tool>
      )}
    </>
  );

  return (
    <>
      <div className="shrink-0 space-y-1.5 border-b border-line px-3 py-2.5 md:px-4">
        <div data-vault-toolbar role="toolbar" aria-label={t('vault.item.toolbarAria')} className="scroll-thin -mx-1 flex items-center gap-0.5 overflow-x-auto px-1 md:flex-wrap md:overflow-visible">
          {toolbar}
        </div>
        <div className="flex min-h-10 items-center gap-2 px-1">
          <NodeIcon node={node} size={17} />
          {editing ? (
            <input
              aria-label={t('vault.item.nameAria')}
              data-vault-name
              value={name}
              autoFocus={fresh || node.kind !== 'page'}
              onFocus={(e) => fresh && e.target.select()}
              maxLength={VAULT_LIMITS.name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.nativeEvent.isComposing) return;
                if (e.key === 'Enter') {
                  e.preventDefault();
                  if (node.kind === 'page' || editableText) e.currentTarget.blur();
                  else save();
                }
                if (e.key === 'Escape') {
                  e.stopPropagation();
                  void cancel();
                }
              }}
              className="min-w-0 flex-1 rounded-lg border border-line bg-bg px-2 py-1 text-[16px] font-semibold outline-none focus:border-accent"
            />
          ) : (
            <h3 data-vault-title className="min-w-0 flex-1 truncate text-[16px] font-semibold">
              {node.name}
            </h3>
          )}
        </div>
      </div>
      <div data-vault-scroll className="scroll-thin min-h-0 flex-1 overflow-y-auto px-4 py-4 md:px-6">
        {node.kind === 'folder' ? (
          <FolderView vault={vault} folderId={node.id} onSelect={onSelect} />
        ) : node.kind === 'item' ? (
          <div className="space-y-4">
            {editing && editableText ? (
              <textarea
                aria-label={t('vault.item.contentAria')}
                value={text}
                rows={Math.min(18, Math.max(5, text.split('\n').length + 1))}
                maxLength={VAULT_LIMITS.text}
                onChange={(e) => setText(e.target.value)}
                className="w-full resize-y rounded-lg border border-line bg-bg px-3 py-2 text-[15px] leading-relaxed outline-none focus:border-accent md:text-sm"
              />
            ) : (
              <ItemContent item={node.item} playKey={`vault:${node.id}`} />
            )}
            <p className="text-[12px] text-muted">{t('vault.item.savedOn', { date: new Date(node.createdAt).toLocaleString(intlLocale()) })}</p>
          </div>
        ) : (
          <PageEditor page={node} vault={vault} editing={editing} blocks={blocks} onChange={setBlocks} />
        )}
      </div>
      {picker === 'folder' && (
        <FolderPicker
          vault={vault}
          node={node}
          onClose={() => setPicker(null)}
          onPick={(to) => {
            setPicker(null);
            onMove(node, to);
          }}
        />
      )}
      {picker === 'page' && <PagePicker vault={vault} onClose={() => setPicker(null)} onPick={addToPage} />}
    </>
  );
}

function FolderView({ vault, folderId, onSelect }: { vault: Record<ID, VaultNode>; folderId: ID; onSelect(id: ID): void }) {
  const children = vaultChildren(vault, folderId);
  if (!children.length) {
    return <p className="py-8 text-center text-[14px] text-muted">{t('vault.folder.empty')}</p>;
  }
  return (
    <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
      {children.map((n) => (
        <li key={n.id}>
          <button
            type="button"
            onClick={() => onSelect(n.id)}
            className="flex w-full items-center gap-2 rounded-xl border border-line bg-surface px-3 py-2.5 text-left text-[14px] hover:bg-surface-2/70"
          >
            <NodeIcon node={n} />
            <span className="truncate">{n.name}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
