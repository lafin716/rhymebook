import { isVaultFolder, vaultChildren, type ID, type VaultItem, type VaultNode, type VaultPage } from '@branch/core';
import { Archive, X } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { IconButton } from '../components/Button';
import { Modal } from '../components/Modal';
import { cn } from '../lib/cn';
import { folderPath, NodeIcon } from './shared';

/** 보관함 위에 뜨는 작은 선택 창 (모바일은 전체 화면) */
function PickerDialog({ label, title, onClose, children }: { label: string; title: string; onClose(): void; children: ReactNode }) {
  return (
    <Modal open onClose={onClose} label={label} className="md:max-w-md">
      <div className="flex h-13 shrink-0 items-center gap-2 border-b border-line pr-2 pl-4">
        <h3 className="min-w-0 flex-1 truncate text-[15px] font-semibold">{title}</h3>
        <IconButton label="닫기" onClick={onClose}>
          <X size={18} />
        </IconButton>
      </div>
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto p-2">{children}</div>
    </Modal>
  );
}

function PickRow({ depth = 0, current, onClick, children }: { depth?: number; current?: boolean; onClick(): void; children: ReactNode }) {
  return (
    <button
      type="button"
      disabled={current}
      onClick={onClick}
      className={cn(
        'flex min-h-11 w-full items-center gap-2 rounded-lg pr-2 text-left text-[14px] md:min-h-9',
        current ? 'text-muted' : 'text-fg hover:bg-surface-2',
      )}
      style={{ paddingLeft: `${8 + Math.min(depth, 8) * 16}px` }}
    >
      {children}
      {current && <span className="ml-auto shrink-0 text-[12px]">지금 위치</span>}
    </button>
  );
}

/** 옮길 폴더 고르기: 폴더 트리 전체를 펼쳐 보여 준다. 자기 자신과 그 아래 폴더는 뺀다 */
export function FolderPicker({ vault, node, onPick, onClose }: { vault: Record<ID, VaultNode>; node: VaultNode; onPick(to: ID | null): void; onClose(): void }) {
  const rows = useMemo(() => {
    const out: { id: ID; node: VaultNode; depth: number }[] = [];
    const walk = (parentId: ID | null, depth: number) => {
      for (const n of vaultChildren(vault, parentId)) {
        if (!isVaultFolder(n) || n.id === node.id) continue;
        out.push({ id: n.id, node: n, depth });
        walk(n.id, depth + 1);
      }
    };
    walk(null, 1);
    return out;
  }, [vault, node.id]);
  return (
    <PickerDialog label="옮길 폴더 고르기" title={`'${node.name}' 옮기기`} onClose={onClose}>
      <ul data-vault-folder-picker>
        <li>
          <PickRow current={node.parentId === null} onClick={() => onPick(null)}>
            <Archive size={15} className="shrink-0 text-accent" />
            <span className="truncate">보관함 맨 위</span>
          </PickRow>
        </li>
        {rows.map((r) => (
          <li key={r.id}>
            <PickRow depth={r.depth} current={node.parentId === r.id} onClick={() => onPick(r.id)}>
              <NodeIcon node={r.node} />
              <span className="truncate">{r.node.name}</span>
            </PickRow>
          </li>
        ))}
      </ul>
      {rows.length === 0 && <p className="px-3 py-4 text-center text-[13px] text-muted">폴더가 없어요. 왼쪽 [새 폴더]로 만들 수 있어요.</p>}
    </PickerDialog>
  );
}

/** 조각을 넣을 페이지 고르기 */
export function PagePicker({ vault, onPick, onClose }: { vault: Record<ID, VaultNode>; onPick(page: VaultPage): void; onClose(): void }) {
  const pages = Object.values(vault)
    .filter((n): n is VaultPage => n.kind === 'page')
    .sort((a, b) => b.updatedAt - a.updatedAt);
  return (
    <PickerDialog label="넣을 페이지 고르기" title="페이지에 넣기" onClose={onClose}>
      {pages.length === 0 ? (
        <p className="px-3 py-6 text-center text-[13.5px] text-muted">아직 페이지가 없어요. 왼쪽 [새 페이지]로 만든 뒤 넣어 보세요.</p>
      ) : (
        <ul data-vault-page-picker>
          {pages.map((p) => (
            <li key={p.id}>
              <PickRow onClick={() => onPick(p)}>
                <NodeIcon node={p} />
                <span className="min-w-0 flex-1 truncate">{p.name}</span>
                {p.parentId && <span className="max-w-[40%] shrink-0 truncate text-[12px] text-muted">{folderPath(vault, p.parentId)}</span>}
              </PickRow>
            </li>
          ))}
        </ul>
      )}
    </PickerDialog>
  );
}

/** 페이지 편집 중 넣을 조각 찾기 (편집기 안에 펼쳐진다) */
export function ItemPicker({ vault, onPick }: { vault: Record<ID, VaultNode>; onPick(id: ID): void }) {
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
