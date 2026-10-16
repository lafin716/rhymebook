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
  if (!isId(block.id) || !(block.beside === undefined || block.beside === true)) return false;
  if ('itemId' in block) return onlyKeys(block, ['id', 'itemId', 'beside']) && isId(block.itemId);
  return onlyKeys(block, ['id', 'text', 'beside']) && typeof block.text === 'string' && block.text.length <= VAULT_LIMITS.text;
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

/** 페이지 한 줄에 나란히 놓을 수 있는 블록 수 */
export const PAGE_ROW_MAX = 3;

/** 블록의 '나란히' 표시를 바꾼 사본 */
function withBeside(block: VaultPageBlock, beside: boolean): VaultPageBlock {
  const { beside: _, ...rest } = block;
  return beside ? { ...rest, beside: true } : rest;
}

/** 블록을 줄 단위로 묶는다. 첫 블록은 늘 새 줄이고, 한 줄이 가득 차면 다음 블록은 새 줄로 넘긴다 */
export function pageRows(blocks: VaultPageBlock[]): VaultPageBlock[][] {
  const rows: VaultPageBlock[][] = [];
  for (const b of blocks) {
    const row = rows[rows.length - 1];
    if (b.beside && row && row.length < PAGE_ROW_MAX) row.push(b);
    else rows.push([b]);
  }
  return rows;
}

/** 줄 구조를 pageRows와 같게 정리한다 (첫 블록·넘친 블록의 beside 제거) */
export function normalizePageBlocks(blocks: VaultPageBlock[]): VaultPageBlock[] {
  return pageRows(blocks).flatMap((row) => row.map((b, i) => (Boolean(b.beside) === i > 0 ? b : withBeside(b, i > 0))));
}

/** 블록 목록 → 줄마다 블록 id 위치 */
function rowOf(blocks: VaultPageBlock[], id: ID): VaultPageBlock[] | undefined {
  return pageRows(blocks).find((row) => row.some((b) => b.id === id));
}

/** 블록 하나를 뺀다. 줄 첫 블록이 빠지면 같은 줄 다음 블록이 줄을 이어받는다 */
export function removePageBlock(blocks: VaultPageBlock[], id: ID): VaultPageBlock[] {
  return normalizePageBlocks(blocks.filter((b) => b.id !== id));
}

/**
 * 블록을 다른 블록 기준으로 옮긴다 (드래그 놓기).
 * before/after: 대상 줄의 위·아래에 새 줄로, left/right: 대상과 같은 줄 왼쪽·오른쪽에 나란히.
 * 같은 줄이 이미 가득 찼거나 대상이 없으면 그대로 돌려준다
 */
export function placePageBlock(
  blocks: VaultPageBlock[],
  id: ID,
  targetId: ID,
  where: 'before' | 'after' | 'left' | 'right',
): VaultPageBlock[] {
  const moving = blocks.find((b) => b.id === id);
  if (!moving || id === targetId || !blocks.some((b) => b.id === targetId)) return blocks;
  const rest = removePageBlock(blocks, id);
  const row = rowOf(rest, targetId)!;
  const ti = rest.findIndex((b) => b.id === targetId);
  const out = [...rest];
  if (where === 'left' || where === 'right') {
    if (row.length >= PAGE_ROW_MAX) return blocks;
    if (where === 'left') {
      out.splice(ti, 1, withBeside(moving, Boolean(rest[ti]!.beside)), withBeside(rest[ti]!, true));
    } else {
      out.splice(ti + 1, 0, withBeside(moving, true));
    }
  } else {
    const first = rest.findIndex((b) => b.id === row[0]!.id);
    out.splice(where === 'before' ? first : first + row.length, 0, withBeside(moving, false));
  }
  return normalizePageBlocks(out);
}

/** 블록을 앞 블록 줄에 붙이거나(true) 자기 줄로 떼어낸다(false). 뗀 블록은 원래 줄 바로 아래 줄이 된다 */
export function setPageBlockBeside(blocks: VaultPageBlock[], id: ID, beside: boolean): VaultPageBlock[] {
  const idx = blocks.findIndex((b) => b.id === id);
  if (idx < 0) return blocks;
  if (beside) {
    if (idx === 0 || blocks[idx]!.beside) return blocks;
    const prev = rowOf(blocks, blocks[idx - 1]!.id)!;
    if (prev.length >= PAGE_ROW_MAX) return blocks;
    const out = [...blocks];
    out[idx] = withBeside(blocks[idx]!, true);
    return normalizePageBlocks(out);
  }
  const row = rowOf(blocks, id)!;
  if (row.length < 2) return blocks;
  return placePageBlock(blocks, id, row.find((b) => b.id !== id)!.id, 'after');
}

/** 읽는 순서로 한 칸 앞/뒤 블록과 자리를 바꾼다. 줄 모양(나란히 자리)은 그대로 두고 내용만 바뀐다 */
export function movePageBlock(blocks: VaultPageBlock[], id: ID, direction: 'up' | 'down'): VaultPageBlock[] {
  const idx = blocks.findIndex((b) => b.id === id);
  const to = direction === 'up' ? idx - 1 : idx + 1;
  if (idx < 0 || to < 0 || to >= blocks.length) return blocks;
  const out = [...blocks];
  out[idx] = withBeside(blocks[to]!, Boolean(blocks[idx]!.beside));
  out[to] = withBeside(blocks[idx]!, Boolean(blocks[to]!.beside));
  return out;
}

/** 페이지 블록 제거 */
export function removeVaultPageBlock(page: VaultPage, blockId: ID, now: number): VaultPage {
  return {
    ...page,
    blocks: removePageBlock(page.blocks, blockId),
    updatedAt: now,
  };
}

/** 페이지 블록 위치 변경 (줄 모양은 유지) */
export function moveVaultPageBlock(page: VaultPage, blockId: ID, direction: 'up' | 'down', now: number): VaultPage {
  const blocks = movePageBlock(page.blocks, blockId, direction);
  return blocks === page.blocks ? page : { ...page, blocks, updatedAt: now };
}
