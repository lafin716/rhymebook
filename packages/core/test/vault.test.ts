import { describe, it, expect } from 'vitest';
import {
  createVaultFolder,
  createVaultItem,
  createVaultPage,
  defaultVaultItemName,
  isVaultFolder,
  isVaultItem,
  isVaultNode,
  isVaultPage,
  moveVaultNode,
  movePageBlock,
  normalizePageBlocks,
  pageRows,
  placePageBlock,
  removePageBlock,
  renameVaultNode,
  setPageBlockBeside,
  vaultChildren,
  vaultDescendants,
  wouldCreateCycle,
} from '../src/vault';
import type { VaultPageBlock } from '../src/model';
import { gatedRepository, memoryRepository } from '../src/repo';

describe('vault', () => {
  const now = Date.now();

  describe('node creation', () => {
    it('creates folders', () => {
      const folder = createVaultFolder('f1', null, '폴더 1', now);
      expect(folder.kind).toBe('folder');
      expect(folder.name).toBe('폴더 1');
      expect(folder.parentId).toBeNull();
      expect(folder.createdAt).toBe(now);
    });

    it('creates items', () => {
      const item = createVaultItem('i1', 'f1', '항목', { type: 'text', text: 'hello' }, undefined, now);
      expect(item.kind).toBe('item');
      expect(item.name).toBe('항목');
      expect(item.item.type).toBe('text');
      expect(item.source).toBeUndefined();
    });

    it('creates pages', () => {
      const page = createVaultPage('p1', null, '페이지', now);
      expect(page.kind).toBe('page');
      expect(page.blocks).toEqual([]);
    });
  });

  describe('item naming', () => {
    it('gets default name from text content', () => {
      const name = defaultVaultItemName({ type: 'text', text: 'first line\nsecond line' });
      expect(name).toBe('first line');
    });

    it('truncates long text names', () => {
      const long = 'a'.repeat(150);
      const name = defaultVaultItemName({ type: 'text', text: long });
      expect(name.length).toBe(100);
    });
  });

  describe('tree navigation', () => {
    it('finds children by parent id', () => {
      const vault = {
        f1: createVaultFolder('f1', null, 'folder 1', now),
        f2: createVaultFolder('f2', 'f1', 'folder 2', now),
        i1: createVaultItem('i1', 'f1', 'item 1', { type: 'text', text: 'hi' }, undefined, now),
        i2: createVaultItem('i2', 'f2', 'item 2', { type: 'text', text: 'hi' }, undefined, now),
      };
      const children = vaultChildren(vault, 'f1');
      expect(children.length).toBe(2);
      expect(children[0]?.kind).toBe('folder'); // folders first
    });

    it('finds all descendants', () => {
      const vault = {
        f1: createVaultFolder('f1', null, 'folder 1', now),
        f2: createVaultFolder('f2', 'f1', 'folder 2', now),
        f3: createVaultFolder('f3', 'f2', 'folder 3', now),
        i1: createVaultItem('i1', 'f3', 'item 1', { type: 'text', text: 'hi' }, undefined, now),
      };
      const descendants = vaultDescendants(vault, 'f1');
      expect(descendants).toContain('f2');
      expect(descendants).toContain('f3');
      expect(descendants).toContain('i1');
    });
  });

  describe('cycle detection', () => {
    it('detects direct cycle', () => {
      const vault = {
        f1: createVaultFolder('f1', null, 'folder 1', now),
        f2: createVaultFolder('f2', 'f1', 'folder 2', now),
      };
      const wouldCycle = wouldCreateCycle(vault, 'f1', 'f2');
      expect(wouldCycle).toBe(true); // 자기 자식(f2) 안으로 f1을 옮기면 순환
    });

    it('detects indirect cycle', () => {
      const vault = {
        f1: createVaultFolder('f1', null, 'folder 1', now),
        f2: createVaultFolder('f2', 'f1', 'folder 2', now),
      };
      const wouldCycle = wouldCreateCycle(vault, 'f2', 'f2');
      expect(wouldCycle).toBe(true); // moving f2 into itself
    });

    it('allows moves to null', () => {
      const vault = {
        f1: createVaultFolder('f1', null, 'folder 1', now),
      };
      const wouldCycle = wouldCreateCycle(vault, 'f1', null);
      expect(wouldCycle).toBe(false);
    });
  });

  describe('node operations', () => {
    it('renames nodes', () => {
      const original = createVaultFolder('f1', null, 'old name', now);
      const renamed = renameVaultNode(original, 'new name', now + 1000);
      expect(renamed.name).toBe('new name');
      expect(renamed.updatedAt).toBe(now + 1000);
      expect(renamed.createdAt).toBe(now);
    });

    it('moves items and folders', () => {
      const original = createVaultItem('i1', 'f1', 'item', { type: 'text', text: 'hi' }, undefined, now);
      const moved = moveVaultNode(original, 'f2', now + 1000);
      expect(moved.parentId).toBe('f2');
      expect(moved.updatedAt).toBe(now + 1000);
    });
  });

  describe('type guards', () => {
    it('identifies folders', () => {
      const folder = createVaultFolder('f1', null, 'folder', now);
      expect(isVaultFolder(folder)).toBe(true);
      expect(isVaultItem(folder)).toBe(false);
      expect(isVaultPage(folder)).toBe(false);
    });

    it('validates nodes', () => {
      const valid = createVaultFolder('f1', null, 'folder', now);
      expect(isVaultNode(valid)).toBe(true);
      expect(isVaultNode({ id: 'f1' })).toBe(false);
      expect(isVaultNode(null)).toBe(false);
    });
  });
});

describe('gatedRepository — 보관함', () => {
  it('보관함 저장·삭제도 통과시키고, 막혀 있으면 막는다', () => {
    const calls: string[] = [];
    const base = { ...memoryRepository(), saveVaultNode: () => calls.push('save'), deleteVaultNodes: () => calls.push('delete') };
    let enabled = true;
    const repo = gatedRepository(base, () => enabled);
    repo.saveVaultNode(createVaultFolder('f', null, '폴더', 1));
    repo.deleteVaultNodes(['f']);
    enabled = false;
    repo.saveVaultNode(createVaultFolder('g', null, '폴더', 1));
    expect(calls).toEqual(['save', 'delete']);
  });
});

describe('보관함 페이지 레이아웃 (ADR-058)', () => {
  const b = (id: string, beside?: boolean): VaultPageBlock => (beside ? { id, text: id, beside: true } : { id, text: id });
  const shape = (blocks: VaultPageBlock[]) => pageRows(blocks).map((row) => row.map((x) => x.id).join('')).join('|');

  it('beside 블록을 앞 줄에 묶고, 첫 블록·넘친 블록은 새 줄로 정리한다', () => {
    expect(shape([b('a', true), b('b', true), b('c'), b('d', true), b('e', true), b('f', true)])).toBe('ab|cde|f');
    const norm = normalizePageBlocks([b('a', true), b('b')]);
    expect(norm[0]!.beside).toBeUndefined();
    expect('beside' in norm[0]!).toBe(false);
  });

  it('왼쪽·오른쪽에 놓으면 나란히, 위·아래에 놓으면 대상 줄 위아래 새 줄', () => {
    const blocks = [b('a'), b('b', true), b('c'), b('d')];
    expect(shape(placePageBlock(blocks, 'd', 'c', 'right'))).toBe('ab|cd');
    expect(shape(placePageBlock(blocks, 'd', 'c', 'left'))).toBe('ab|dc');
    expect(shape(placePageBlock(blocks, 'd', 'b', 'before'))).toBe('d|ab|c');
    expect(shape(placePageBlock(blocks, 'a', 'c', 'after'))).toBe('b|c|a|d');
    expect(shape(placePageBlock(blocks, 'd', 'a', 'left'))).toBe('dab|c');
    // 가득 찬 줄에는 더 붙일 수 없다
    const full = placePageBlock(blocks, 'd', 'a', 'right');
    expect(placePageBlock(full, 'c', 'b', 'right')).toBe(full);
    expect(placePageBlock(blocks, 'x', 'a', 'right')).toBe(blocks);
  });

  it('줄 첫 블록을 빼면 같은 줄 다음 블록이 줄을 이어받는다', () => {
    const blocks = [b('a'), b('b', true), b('c', true), b('d')];
    expect(shape(removePageBlock(blocks, 'a'))).toBe('bc|d');
    expect(removePageBlock(blocks, 'a')[0]!.beside).toBeUndefined();
  });

  it('나란히 붙이기·풀기', () => {
    const blocks = [b('a'), b('b'), b('c')];
    const joined = setPageBlockBeside(blocks, 'b', true);
    expect(shape(joined)).toBe('ab|c');
    expect(shape(setPageBlockBeside(joined, 'a', false))).toBe('b|a|c');
    expect(shape(setPageBlockBeside(joined, 'b', false))).toBe('a|b|c');
    expect(setPageBlockBeside(blocks, 'a', true)).toBe(blocks);
  });

  it('위/아래 이동은 줄 모양을 유지하고 내용만 바꾼다', () => {
    const blocks = [b('a'), b('b', true), b('c')];
    expect(shape(movePageBlock(blocks, 'c', 'up'))).toBe('ac|b');
    expect(shape(movePageBlock(blocks, 'b', 'up'))).toBe('ba|c');
    expect(movePageBlock(blocks, 'a', 'up')).toBe(blocks);
  });

  it('검증: beside는 true만 허용', () => {
    const page = { ...createVaultPage('p', null, '페이지', 1), blocks: [b('a'), { id: 'i', itemId: 'x', beside: true as const }] };
    expect(isVaultNode(page)).toBe(true);
    expect(isVaultNode({ ...page, blocks: [{ id: 'a', text: 'a', beside: false }] })).toBe(false);
    expect(isVaultNode({ ...page, blocks: [{ id: 'a', text: 'a', side: true }] })).toBe(false);
  });
});
