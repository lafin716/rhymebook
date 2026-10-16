import {
  addVaultPageBlock,
  createVaultFolder,
  createVaultPage,
  isVaultFolder,
  moveVaultNode,
  moveVaultPageBlock,
  newId,
  removeVaultPageBlock,
  renameVaultNode,
  vaultChildren,
  vaultDescendants,
  VAULT_LIMITS,
  type ID,
  type VaultItem,
  type VaultItemContent,
  type VaultNode,
  type VaultPage,
} from '@branch/core';
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  AudioLines,
  ChevronRight,
  Copy,
  CornerDownRight,
  Download,
  Eye,
  FilePlus2,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  Image as ImageIcon,
  LayoutTemplate,
  Pencil,
  Play,
  Plus,
  Square,
  Trash2,
  Type,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { actions, useApp } from '../app/store';
import { pushNotice } from '../app/sync';
import { useBreakpoint } from '../app/useBreakpoint';
import { dataUrl } from '../chat/attach';
import { Markdown } from '../chat/Markdown';
import { Button, IconButton } from '../components/Button';
import { confirm } from '../components/ConfirmDialog';
import { Modal } from '../components/Modal';
import { cn } from '../lib/cn';
import { saveBase64File, saveTextFile } from '../lib/download';
import { speakAll, stopSpeaking, useSpeech } from '../voice/speak';

const LANG_LABEL = { vi: '베트남어', en: '영어', ko: '한국어' } as const;
const put = (node: VaultNode) => actions().putVaultNode(node);

/**
 * 보관함 (ADR-055): 답변에서 담은 글·이미지·음성 조각을 폴더 트리로 정리하고,
 * 조각과 글을 엮어 페이지 하나로 구성한다. 모바일은 목록 ↔ 상세 전환, 데스크톱은 두 칸
 */
export function VaultOverlay() {
  const open = useApp((s) => s.overlay === 'vault');
  const close = () => actions().setOverlay('none');
  return (
    <Modal open={open} onClose={close} label="보관함" className="md:h-[84vh] md:max-w-5xl">
      {open && <VaultBody onClose={close} />}
    </Modal>
  );
}

function VaultBody({ onClose }: { onClose(): void }) {
  const mobile = useBreakpoint() === 'mobile';
  const vault = useApp((s) => s.vault);
  const [selectedId, setSelectedId] = useState<ID | null>(null);
  const [expanded, setExpanded] = useState<Set<ID>>(new Set());
  const [fresh, setFresh] = useState<ID | null>(null);
  const selected = selectedId ? vault[selectedId] : undefined;

  const expand = (id: ID | null) => id && setExpanded((s) => (s.has(id) ? s : new Set(s).add(id)));
  const select = (id: ID | null) => {
    setSelectedId(id);
    setFresh(null);
  };

  /** 새 폴더·페이지는 고른 폴더 안(항목을 골랐으면 그 옆)에 만든다 */
  const create = (kind: 'folder' | 'page') => {
    const parentId = selected ? (isVaultFolder(selected) ? selected.id : selected.parentId) : null;
    const id = newId('v');
    const now = Date.now();
    put(kind === 'folder' ? createVaultFolder(id, parentId, '새 폴더', now) : createVaultPage(id, parentId, '새 페이지', now));
    expand(parentId);
    setSelectedId(id);
    setFresh(id);
  };

  const showDetail = !mobile || !!selected;
  const showTree = !mobile || !selected;

  return (
    <>
      <div className="flex h-13 shrink-0 items-center gap-2 border-b border-line px-2 md:px-4">
        {mobile && selected ? (
          <IconButton label="보관함 목록으로" onClick={() => select(null)}>
            <ArrowLeft size={18} />
          </IconButton>
        ) : (
          <span className="w-1 md:hidden" />
        )}
        <h2 className="min-w-0 flex-1 truncate text-[16px] font-semibold">보관함</h2>
        <IconButton label="보관함 닫기" onClick={onClose}>
          <X size={18} />
        </IconButton>
      </div>
      <div className="flex min-h-0 flex-1">
        {showTree && (
          <div data-vault-tree className="flex min-h-0 w-full flex-col md:w-[280px] md:shrink-0 md:border-r md:border-line">
            <div className="flex shrink-0 gap-1.5 border-b border-line px-3 py-2">
              <Button size="sm" variant="ghost" icon={<FolderPlus size={14} />} onClick={() => create('folder')}>
                새 폴더
              </Button>
              <Button size="sm" variant="ghost" icon={<FilePlus2 size={14} />} onClick={() => create('page')}>
                새 페이지
              </Button>
            </div>
            <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-2 py-2" role="tree" aria-label="보관함 폴더">
              {Object.keys(vault).length === 0 ? (
                <p className="px-3 py-8 text-center text-[13.5px] leading-relaxed text-muted">
                  아직 담은 조각이 없어요. 답변 아래 [보관]이나 글을 선택한 뒤 [보관]을 눌러 담아 보세요.
                </p>
              ) : (
                <TreeRows
                  vault={vault}
                  parentId={null}
                  depth={0}
                  selectedId={selectedId}
                  expanded={expanded}
                  onSelect={select}
                  onToggle={(id) =>
                    setExpanded((s) => {
                      const next = new Set(s);
                      if (!next.delete(id)) next.add(id);
                      return next;
                    })
                  }
                />
              )}
            </div>
          </div>
        )}
        {showDetail && (
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            {selected ? (
              <Detail key={selected.id} node={selected} vault={vault} fresh={fresh === selected.id} onSelect={select} onExpand={expand} onClose={onClose} />
            ) : (
              <div className="grid flex-1 place-items-center px-6 text-center text-[14px] text-muted">
                왼쪽에서 폴더·조각·페이지를 고르세요. [새 페이지]로 조각들을 엮어 한 페이지로 만들 수 있어요.
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}

function NodeIcon({ node, open, size = 15 }: { node: VaultNode; open?: boolean; size?: number }) {
  if (node.kind === 'folder') return open ? <FolderOpen size={size} className="text-accent" /> : <Folder size={size} className="text-accent" />;
  if (node.kind === 'page') return <LayoutTemplate size={size} className="text-accent" />;
  const t = node.item.type;
  return t === 'image' ? <ImageIcon size={size} className="text-muted" /> : t === 'audio' ? <AudioLines size={size} className="text-muted" /> : <FileText size={size} className="text-muted" />;
}

function TreeRows(props: {
  vault: Record<ID, VaultNode>;
  parentId: ID | null;
  depth: number;
  selectedId: ID | null;
  expanded: Set<ID>;
  onSelect(id: ID): void;
  onToggle(id: ID): void;
}) {
  const { vault, parentId, depth, selectedId, expanded, onSelect, onToggle } = props;
  const children = useMemo(() => vaultChildren(vault, parentId), [vault, parentId]);
  return (
    <ul role={depth ? 'group' : undefined}>
      {children.map((n) => {
        const folder = isVaultFolder(n);
        const open = folder && expanded.has(n.id);
        return (
          <li key={n.id} role="treeitem" aria-expanded={folder ? open : undefined} aria-selected={selectedId === n.id}>
            <div
              data-vault-node={n.id}
              data-kind={n.kind}
              className={cn(
                'flex min-h-10 items-center rounded-lg pr-2 text-[14px] md:min-h-8 md:text-[13.5px]',
                selectedId === n.id ? 'bg-accent-soft text-fg' : 'text-fg-2 hover:bg-surface-2',
              )}
              style={{ paddingLeft: `${4 + Math.min(depth, 6) * 14}px` }}
            >
              {folder ? (
                <button
                  type="button"
                  aria-label={open ? `${n.name} 접기` : `${n.name} 펼치기`}
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

/** 폴더 경로 이름 ("상위 / 하위") */
function folderPath(vault: Record<ID, VaultNode>, id: ID): string {
  const names: string[] = [];
  let cur: VaultNode | undefined = vault[id];
  for (let i = 0; cur && i < 20; i++) {
    names.unshift(cur.name);
    cur = cur.parentId ? vault[cur.parentId] : undefined;
  }
  return names.join(' / ');
}

function Detail({
  node,
  vault,
  fresh,
  onSelect,
  onExpand,
  onClose,
}: {
  node: VaultNode;
  vault: Record<ID, VaultNode>;
  fresh: boolean;
  onSelect(id: ID | null): void;
  onExpand(id: ID | null): void;
  onClose(): void;
}) {
  const [name, setName] = useState(node.name);
  useEffect(() => setName(node.name), [node.name]);

  const commitName = () => {
    const next = name.trim();
    if (!next) setName(node.name);
    else if (next !== node.name) put(renameVaultNode(node, next, Date.now()));
  };

  // 옮길 수 있는 폴더: 자기 자신과 그 아래 폴더는 뺀다
  const blocked = useMemo(() => (isVaultFolder(node) ? new Set([node.id, ...vaultDescendants(vault, node.id)]) : new Set<ID>()), [node, vault]);
  const folders = useMemo(
    () =>
      Object.values(vault)
        .filter((n) => isVaultFolder(n) && !blocked.has(n.id))
        .map((n) => ({ id: n.id, path: folderPath(vault, n.id) }))
        .sort((a, b) => a.path.localeCompare(b.path)),
    [vault, blocked],
  );

  const remove = async () => {
    const inside = isVaultFolder(node) ? vaultDescendants(vault, node.id).length : 0;
    const ok = await confirm({
      title: `'${node.name}'을(를) 지울까요?`,
      message: inside ? `안에 든 ${inside}개도 함께 지워져요.` : '지운 뒤에는 되돌릴 수 없어요.',
      confirmLabel: '지우기',
      tone: 'danger',
    });
    if (!ok) return;
    actions().deleteVaultNodes([node.id]);
    onSelect(node.parentId);
  };

  return (
    <>
      <div className="shrink-0 space-y-2 border-b border-line px-4 py-3">
        <div className="flex items-center gap-2">
          <NodeIcon node={node} size={17} />
          <input
            aria-label="이름"
            data-vault-name
            value={name}
            autoFocus={fresh}
            onFocus={(e) => fresh && e.target.select()}
            maxLength={VAULT_LIMITS.name}
            onChange={(e) => setName(e.target.value)}
            onBlur={commitName}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
              if (e.key === 'Escape') {
                e.stopPropagation();
                setName(node.name);
              }
            }}
            className="min-w-0 flex-1 rounded-lg border border-transparent bg-transparent px-1.5 py-1 text-[16px] font-semibold outline-none hover:border-line focus:border-accent"
          />
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <label className="flex min-w-0 items-center gap-1.5 text-[13px] text-muted">
            <CornerDownRight size={13} className="shrink-0" />
            <select
              aria-label="옮길 폴더"
              value={node.parentId ?? ''}
              onChange={(e) => {
                const to = e.target.value || null;
                put(moveVaultNode(node, to, Date.now()));
                onExpand(to);
              }}
              className="h-8 max-w-[14rem] min-w-0 truncate rounded-lg border border-line bg-surface px-2 text-[13px] text-fg"
            >
              <option value="">보관함 맨 위</option>
              {folders.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.path}
                </option>
              ))}
            </select>
          </label>
          <span className="flex-1" />
          <Button size="sm" variant="ghost" icon={<Trash2 size={14} />} className="text-danger hover:text-danger" onClick={() => void remove()}>
            지우기
          </Button>
        </div>
      </div>
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-4 py-4 md:px-6">
        {node.kind === 'folder' ? (
          <FolderView vault={vault} folderId={node.id} onSelect={onSelect} />
        ) : node.kind === 'item' ? (
          <ItemView item={node} vault={vault} onClose={onClose} />
        ) : (
          <PageEditor page={node} vault={vault} />
        )}
      </div>
    </>
  );
}

function FolderView({ vault, folderId, onSelect }: { vault: Record<ID, VaultNode>; folderId: ID; onSelect(id: ID): void }) {
  const children = vaultChildren(vault, folderId);
  if (!children.length) {
    return <p className="py-8 text-center text-[14px] text-muted">빈 폴더예요. 조각을 고른 뒤 위쪽 폴더 선택으로 이곳에 옮길 수 있어요.</p>;
  }
  return (
    <ul className="grid gap-2 sm:grid-cols-2">
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

/** 조각 내용 (글은 Markdown, 이미지는 그림, 음성은 듣기 버튼과 글) */
function ItemContent({ item, playKey }: { item: VaultItemContent; playKey: string }) {
  const status = useSpeech((s) => s.status);
  const current = useSpeech((s) => s.key);
  if (item.type === 'text') {
    return (
      <div className="md">
        <Markdown content={item.text} />
      </div>
    );
  }
  if (item.type === 'image') {
    return <img src={dataUrl(item.attachment)} alt={item.attachment.name} className="max-h-[28rem] w-auto max-w-full rounded-xl border border-line object-contain" />;
  }
  const playing = status !== 'idle' && !!current?.startsWith(`${playKey}#`);
  const lines = item.text.split('\n').filter((l) => l.trim());
  return (
    <div data-vault-audio className="overflow-hidden rounded-2xl border border-accent/25 bg-surface">
      <div className="flex items-center gap-2 border-b border-line bg-accent-soft/60 px-3 py-2">
        <AudioLines size={15} className="shrink-0 text-accent" />
        <span className="flex-1 text-[13px] text-muted">{LANG_LABEL[item.lang]}</span>
        <Button
          size="sm"
          variant={playing ? 'secondary' : 'soft'}
          icon={playing ? <Square size={13} /> : <Play size={14} />}
          onClick={() => (playing ? stopSpeaking() : speakAll(lines.map((text, i) => ({ text, lang: item.lang, key: `${playKey}#${i}` }))))}
        >
          {playing ? '멈춤' : '듣기'}
        </Button>
      </div>
      <div className="space-y-1 px-3 py-2.5 text-[15px] leading-snug text-fg">
        {lines.map((l, i) => (
          <p key={i} className={cn('break-words', status !== 'idle' && current === `${playKey}#${i}` && 'text-accent')}>
            {l}
          </p>
        ))}
      </div>
    </div>
  );
}

function ItemView({ item, vault, onClose }: { item: VaultItem; vault: Record<ID, VaultNode>; onClose(): void }) {
  const source = item.source;
  const hasSource = useApp((s) => !!(source && s.sessions[source.sessionId]));
  const pages = Object.values(vault).filter((n): n is VaultPage => n.kind === 'page');
  const c = item.item;
  return (
    <div className="space-y-4">
      <ItemContent item={c} playKey={`vault:${item.id}`} />
      <div className="flex flex-wrap items-center gap-1.5">
        {c.type === 'image' ? (
          <Button size="sm" icon={<Download size={14} />} onClick={() => void saveBase64File(c.attachment.name, c.attachment.data, c.attachment.mime).catch(() => {})}>
            이미지 저장
          </Button>
        ) : (
          <Button
            size="sm"
            icon={<Copy size={14} />}
            onClick={() =>
              void navigator.clipboard.writeText(c.text).then(
                () => pushNotice('복사했어요.'),
                () => pushNotice('복사하지 못했어요.'),
              )
            }
          >
            복사
          </Button>
        )}
        {pages.length > 0 && (
          <select
            aria-label="페이지에 넣기"
            value=""
            onChange={(e) => {
              const page = vault[e.target.value];
              if (page?.kind !== 'page') return;
              if (page.blocks.length >= VAULT_LIMITS.blocks) return pushNotice('페이지에 더 넣을 수 없어요.');
              put(addVaultPageBlock(page, newId('b'), { itemId: item.id }, Date.now()));
              pushNotice(`'${page.name}'에 넣었어요.`);
            }}
            className="h-8 rounded-lg border border-line bg-surface px-2 text-[13px] text-fg"
          >
            <option value="">페이지에 넣기…</option>
            {pages.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        )}
        {source && hasSource && (
          <Button
            size="sm"
            variant="ghost"
            icon={<CornerDownRight size={14} />}
            onClick={() => {
              actions().openSession(source.sessionId, 'main');
              onClose();
            }}
          >
            원래 대화 열기
          </Button>
        )}
      </div>
      <p className="text-[12px] text-muted">{new Date(item.createdAt).toLocaleString('ko-KR')}에 담음</p>
    </div>
  );
}

/** 페이지를 Markdown 한 편으로 (이미지는 data URL로 넣는다) */
function pageMarkdown(page: VaultPage, vault: Record<ID, VaultNode>): string {
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

function PageEditor({ page, vault }: { page: VaultPage; vault: Record<ID, VaultNode> }) {
  const [editing, setEditing] = useState(page.blocks.length === 0);
  const [picking, setPicking] = useState(false);
  const full = page.blocks.length >= VAULT_LIMITS.blocks;

  /** 보기로 바꿀 때 비어 있는 글 블록은 치운다 */
  const view = () => {
    setEditing(false);
    const blocks = page.blocks.filter((b) => !('text' in b) || b.text.trim());
    if (blocks.length !== page.blocks.length) put({ ...page, blocks, updatedAt: Date.now() });
  };
  const addText = () => put(addVaultPageBlock(page, newId('b'), { text: '' }, Date.now()));
  const addItem = (itemId: ID) => {
    put(addVaultPageBlock(page, newId('b'), { itemId }, Date.now()));
    setPicking(false);
  };
  const setText = (blockId: ID, text: string) =>
    put({ ...page, blocks: page.blocks.map((b) => (b.id === blockId ? { id: b.id, text } : b)), updatedAt: Date.now() });

  return (
    <div data-vault-page={page.id} className="mx-auto max-w-3xl space-y-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <div className="flex rounded-lg border border-line p-0.5" role="group" aria-label="페이지 보기 방식">
          <ModeButton active={!editing} icon={<Eye size={14} />} onClick={view}>
            보기
          </ModeButton>
          <ModeButton active={editing} icon={<Pencil size={14} />} onClick={() => setEditing(true)}>
            편집
          </ModeButton>
        </div>
        <span className="flex-1" />
        <Button
          size="sm"
          variant="ghost"
          icon={<Download size={14} />}
          disabled={!page.blocks.length}
          onClick={() => void saveTextFile(`${page.name}.md`, pageMarkdown(page, vault), 'text/markdown').catch(() => {})}
        >
          Markdown 저장
        </Button>
      </div>

      {page.blocks.length === 0 && !editing && <p className="py-8 text-center text-[14px] text-muted">빈 페이지예요. [편집]에서 조각과 글을 넣어 보세요.</p>}

      <ol className={cn(editing ? 'space-y-2' : 'space-y-4')}>
        {page.blocks.map((b, i) => {
          const node = 'itemId' in b ? vault[b.itemId] : undefined;
          const body =
            'text' in b ? (
              editing ? (
                <TextBlockInput value={b.text} onCommit={(t) => t !== b.text && setText(b.id, t)} />
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
          if (!editing) return body ? <li key={b.id}>{body}</li> : null;
          return (
            <li key={b.id} data-vault-block={b.id} className="rounded-xl border border-line bg-surface p-2">
              <div className="mb-1.5 flex items-center gap-1 text-[12px] text-muted">
                {'text' in b ? <Type size={13} /> : node ? <NodeIcon node={node} size={13} /> : <FileText size={13} />}
                <span className="min-w-0 flex-1 truncate">{'text' in b ? '글' : (node?.name ?? '지워진 조각')}</span>
                <IconButton size="sm" label="위로" disabled={i === 0} onClick={() => put(moveVaultPageBlock(page, b.id, 'up', Date.now()))}>
                  <ArrowUp size={14} />
                </IconButton>
                <IconButton size="sm" label="아래로" disabled={i === page.blocks.length - 1} onClick={() => put(moveVaultPageBlock(page, b.id, 'down', Date.now()))}>
                  <ArrowDown size={14} />
                </IconButton>
                <IconButton size="sm" label="페이지에서 빼기" onClick={() => put(removeVaultPageBlock(page, b.id, Date.now()))}>
                  <X size={14} />
                </IconButton>
              </div>
              {body}
            </li>
          );
        })}
      </ol>

      {editing && (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-1.5">
            <Button size="sm" variant="soft" icon={<Plus size={14} />} disabled={full} onClick={() => setPicking((v) => !v)} aria-expanded={picking}>
              조각 넣기
            </Button>
            <Button size="sm" icon={<Type size={14} />} disabled={full} onClick={addText}>
              글 넣기
            </Button>
          </div>
          {picking && <ItemPicker vault={vault} onPick={addItem} />}
        </div>
      )}
    </div>
  );
}

function ModeButton({ active, icon, onClick, children }: { active: boolean; icon: ReactNode; onClick(): void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn('inline-flex h-7 items-center gap-1 rounded-md px-2.5 text-[13px]', active ? 'bg-accent-soft font-medium text-accent' : 'text-fg-2 hover:text-fg')}
    >
      {icon}
      {children}
    </button>
  );
}

/** 글 블록 입력. 입력 중에는 로컬로 두고 포커스를 잃을 때 저장한다 */
function TextBlockInput({ value, onCommit }: { value: string; onCommit(text: string): void }) {
  const [text, setText] = useState(value);
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setText(value);
  }, [value, focused]);
  return (
    <textarea
      aria-label="글"
      value={text}
      rows={Math.min(12, Math.max(3, text.split('\n').length))}
      maxLength={VAULT_LIMITS.text}
      placeholder="이 자리에 넣을 글 (Markdown)"
      onFocus={() => setFocused(true)}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        setFocused(false);
        onCommit(text);
      }}
      className="w-full resize-y rounded-lg border border-line bg-bg px-2.5 py-2 text-[15px] leading-relaxed outline-none focus:border-accent md:text-sm"
    />
  );
}

function ItemPicker({ vault, onPick }: { vault: Record<ID, VaultNode>; onPick(id: ID): void }) {
  const [q, setQ] = useState('');
  const items = Object.values(vault)
    .filter((n): n is VaultItem => n.kind === 'item')
    .filter((n) => !q.trim() || n.name.toLowerCase().includes(q.trim().toLowerCase()))
    .sort((a, b) => b.createdAt - a.createdAt);
  return (
    <div data-vault-picker className="rounded-xl border border-line bg-surface p-2">
      <input
        aria-label="조각 찾기"
        value={q}
        autoFocus
        onChange={(e) => setQ(e.target.value)}
        placeholder="조각 이름으로 찾기"
        className="mb-1.5 h-9 w-full rounded-lg border border-line bg-bg px-2.5 text-[15px] outline-none focus:border-accent md:text-sm"
      />
      {items.length === 0 ? (
        <p className="px-2 py-4 text-center text-[13px] text-muted">넣을 조각이 없어요.</p>
      ) : (
        <ul className="scroll-thin max-h-60 overflow-y-auto">
          {items.map((n) => (
            <li key={n.id}>
              <button
                type="button"
                onClick={() => onPick(n.id)}
                className="flex min-h-10 w-full items-center gap-2 rounded-lg px-2 text-left text-[14px] hover:bg-surface-2 md:min-h-8"
              >
                <NodeIcon node={n} />
                <span className="min-w-0 flex-1 truncate">{n.name}</span>
                {n.parentId && <span className="max-w-[40%] shrink-0 truncate text-[12px] text-muted">{folderPath(vault, n.parentId)}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
