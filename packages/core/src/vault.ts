import { isAttachmentList } from './attachments';
import type { Attachment, ID, VaultNode, VaultFolder, VaultItem, VaultPage, VaultItemContent, VaultPageBlock } from './model';

/** 보관함 크기 제한 (동기화·백업 검증 공통) */
export const VAULT_LIMITS = {
  name: 200,
  text: 100_000,
  blocks: 200,
  /** vault.delete 한 번에 지울 수 있는 id 수 */
  deleteIds: 2000,
} as const;

const VAULT_ID_RE = /^[\w-]{1,64}$/;
const isId = (v: unknown): v is ID => typeof v === 'string' && VAULT_ID_RE.test(v);
const isTime = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v >= 0;
const onlyKeys = (o: Record<string, unknown>, keys: string[]) => Object.keys(o).every((k) => keys.includes(k));

/** 보관함 노드가 유효한지 확인 (형식·크기·허용 필드). 동기화 op와 백업 복원에 쓴다 */
export function isVaultNode(v: unknown): v is VaultNode {
  if (!v || typeof v !== 'object') return false;
  const node = v as Record<string, unknown>;
  if (
    !isId(node.id) ||
    !(node.parentId === null || isId(node.parentId)) ||
    typeof node.name !== 'string' ||
    !node.name.trim() ||
    node.name.length > VAULT_LIMITS.name ||
    !isTime(node.createdAt) ||
    !isTime(node.updatedAt)
  ) {
    return false;
  }
  const base = ['id', 'kind', 'parentId', 'name', 'createdAt', 'updatedAt'];
  if (node.kind === 'folder') return onlyKeys(node, base);
  if (node.kind === 'item') {
    return (
      onlyKeys(node, [...base, 'item', 'source']) &&
      isVaultItemContent(node.item) &&
      (node.source === undefined || isValidSource(node.source))
    );
  }
  if (node.kind === 'page') {
    return (
      onlyKeys(node, [...base, 'blocks']) &&
      Array.isArray(node.blocks) &&
      node.blocks.length <= VAULT_LIMITS.blocks &&
      node.blocks.every(isValidPageBlock)
    );
  }
  return false;
}

/** 보관함 아이템 콘텐츠 검증 */
function isVaultItemContent(v: unknown): v is VaultItemContent {
  if (!v || typeof v !== 'object') return false;
  const item = v as Record<string, unknown>;
  const text = (t: unknown) => typeof t === 'string' && t.length > 0 && t.length <= VAULT_LIMITS.text;
  if (item.type === 'text') return onlyKeys(item, ['type', 'text']) && text(item.text);
  if (item.type === 'image') {
    const a = item.attachment as Attachment | undefined;
    return onlyKeys(item, ['type', 'attachment']) && isAttachmentList([a]) && a?.kind === 'image';
  }
  if (item.type === 'audio') {
    return onlyKeys(item, ['type', 'text', 'lang']) && text(item.text) && ['vi', 'en', 'ko'].includes(item.lang as string);
  }
  return false;
}

/** 원본 출처 검증 */
function isValidSource(v: unknown): v is { sessionId: ID; messageId: ID } {
  if (!v || typeof v !== 'object') return false;
  const src = v as Record<string, unknown>;
  return onlyKeys(src, ['sessionId', 'messageId']) && isId(src.sessionId) && isId(src.messageId);
}

/** 페이지 블록 검증: 항목 참조 또는 글 하나 */
function isValidPageBlock(v: unknown): v is VaultPageBlock {
  if (!v || typeof v !== 'object') return false;
  const block = v as Record<string, unknown>;
  if (!isId(block.id)) return false;
  if ('itemId' in block) return onlyKeys(block, ['id', 'itemId']) && isId(block.itemId);
  return onlyKeys(block, ['id', 'text']) && typeof block.text === 'string' && block.text.length <= VAULT_LIMITS.text;
}

/** 폴더인지 확인 */
export function isVaultFolder(node: VaultNode): node is VaultFolder {
  return node.kind === 'folder';
}

/** 항목인지 확인 */
export function isVaultItem(node: VaultNode): node is VaultItem {
  return node.kind === 'item';
}

/** 페이지인지 확인 */
export function isVaultPage(node: VaultNode): node is VaultPage {
  return node.kind === 'page';
}

/** 주어진 parentId를 가진 자식 노드 반환 (폴더 먼저, 그 다음 이름순, 마지막 생성순) */
export function vaultChildren(vault: Record<ID, VaultNode>, parentId: ID | null): VaultNode[] {
  const children = Object.values(vault).filter((n) => n.parentId === parentId);
  return children.sort((a, b) => {
    // 폴더 먼저
    if ((a.kind === 'folder') !== (b.kind === 'folder')) {
      return a.kind === 'folder' ? -1 : 1;
    }
    // 이름순
    if (a.name !== b.name) {
      return a.name.localeCompare(b.name);
    }
    // 생성순
    return a.createdAt - b.createdAt;
  });
}

/** parentId의 모든 자손 노드 id 반환 (재귀) */
export function vaultDescendants(vault: Record<ID, VaultNode>, parentId: ID): ID[] {
  const children = vaultChildren(vault, parentId);
  const result: ID[] = [];
  for (const child of children) {
    result.push(child.id);
    if (isVaultFolder(child)) {
      result.push(...vaultDescendants(vault, child.id));
    }
  }
  return result;
}

/** 폴더 이동 시 순환 감지 */
export function wouldCreateCycle(vault: Record<ID, VaultNode>, folderId: ID, newParentId: ID | null): boolean {
  if (newParentId === null) return false;
  if (newParentId === folderId) return true;

  let current: ID | null = newParentId;
  while (current) {
    if (current === folderId) return true;
    const node: VaultNode | undefined = vault[current];
    if (!node || node.kind !== 'folder') break;
    current = node.parentId;
  }
  return false;
}

/** 항목의 기본 이름 (콘텐츠에서 유도) */
export function defaultVaultItemName(item: VaultItemContent): string {
  if (item.type === 'text') {
    // 첫 줄 또는 첫 100자
    const lines = item.text.split('\n');
    return (lines[0] || '텍스트').slice(0, 100);
  }
  if (item.type === 'image') {
    return item.attachment.name || '이미지';
  }
  if (item.type === 'audio') {
    // 첫 줄 또는 첫 100자
    const lines = item.text.split('\n');
    return (lines[0] || '음성').slice(0, 100);
  }
  return '항목';
}

/** 폴더 생성 */
export function createVaultFolder(id: ID, parentId: ID | null, name: string, now: number): VaultFolder {
  return {
    id,
    kind: 'folder',
    parentId,
    name: name.slice(0, 200),
    createdAt: now,
    updatedAt: now,
  };
}

/** 항목 생성 */
export function createVaultItem(
  id: ID,
  parentId: ID | null,
  name: string,
  item: VaultItemContent,
  source: { sessionId: ID; messageId: ID } | undefined,
  now: number,
): VaultItem {
  return {
    id,
    kind: 'item',
    parentId,
    name: name.slice(0, 200),
    item,
    ...(source && { source }),
    createdAt: now,
    updatedAt: now,
  };
}

/** 페이지 생성 */
export function createVaultPage(id: ID, parentId: ID | null, name: string, now: number): VaultPage {
  return {
    id,
    kind: 'page',
    parentId,
    name: name.slice(0, 200),
    blocks: [],
    createdAt: now,
    updatedAt: now,
  };
}

/** 노드 이름 바꾸기 */
export function renameVaultNode(node: VaultNode, newName: string, now: number): VaultNode {
  return {
    ...node,
    name: newName.slice(0, 200),
    updatedAt: now,
  };
}

/** 노드의 parentId 변경 (폴더 순환 검사는 호출 쪽에서 wouldCreateCycle로) */
export function moveVaultNode(node: VaultNode, newParentId: ID | null, now: number): VaultNode {
  return { ...node, parentId: newParentId, updatedAt: now };
}

/** 페이지에 블록 추가 */
export function addVaultPageBlock(
  page: VaultPage,
  blockId: ID,
  content: { itemId: ID } | { text: string },
  now: number,
): VaultPage {
  return {
    ...page,
    blocks: [...page.blocks, { id: blockId, ...content }],
    updatedAt: now,
  };
}

/** 페이지 블록 제거 */
export function removeVaultPageBlock(page: VaultPage, blockId: ID, now: number): VaultPage {
  return {
    ...page,
    blocks: page.blocks.filter((b) => b.id !== blockId),
    updatedAt: now,
  };
}

/** 페이지 블록 위치 변경 */
export function moveVaultPageBlock(page: VaultPage, blockId: ID, direction: 'up' | 'down', now: number): VaultPage {
  const idx = page.blocks.findIndex((b) => b.id === blockId);
  if (idx < 0) return page;

  const newIdx = direction === 'up' ? idx - 1 : idx + 1;
  if (newIdx < 0 || newIdx >= page.blocks.length) return page;

  const blocks = [...page.blocks];
  const temp = blocks[idx]!;
  const next = blocks[newIdx]!;
  blocks[idx] = next;
  blocks[newIdx] = temp;
  return { ...page, blocks, updatedAt: now };
}
