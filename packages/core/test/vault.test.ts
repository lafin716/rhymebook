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
  renameVaultNode,
  vaultChildren,
  vaultDescendants,
  wouldCreateCycle,
} from '../src/vault';
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
