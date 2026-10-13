import { describe, expect, it } from 'vitest';
import type { SplitNode } from '../src/model';
import {
  flipGroupDir,
  insertLeaf,
  isSplitNode,
  leafIds,
  leafRects,
  neighborOf,
  normalizeLayout,
  removeLeaf,
  replaceLeaf,
  rowLayout,
  setGroupSizes,
  swapChildren,
  swapLeaves,
} from '../src/splitLayout';
import { sanitizeView } from '../src/persist';
import { emptyView } from '../src/seed';

const row = (...ids: string[]) => rowLayout(ids)!;

describe('split layout tree', () => {
  it('inserts on each edge, nesting only when the direction changes', () => {
    let l = insertLeaf(undefined, 'a', 'b', 'right');
    expect(leafIds(l)).toEqual(['b']);
    l = insertLeaf({ kind: 'leaf', sessionId: 'a' }, 'a', 'b', 'right');
    expect(l).toMatchObject({ kind: 'group', dir: 'row', sizes: [50, 50] });
    expect(leafIds(l)).toEqual(['a', 'b']);
    l = insertLeaf(l, 'a', 'c', 'left');
    // 같은 방향이면 형제로 끼우고 대상 칸을 반으로 나눈다
    expect(l).toMatchObject({ dir: 'row', sizes: [25, 25, 50] });
    expect(leafIds(l)).toEqual(['c', 'a', 'b']);
    l = insertLeaf(l, 'b', 'd', 'top');
    expect(leafIds(l)).toEqual(['c', 'a', 'd', 'b']);
    const col = (l as Extract<SplitNode, { kind: 'group' }>).children[2]!;
    expect(col).toMatchObject({ kind: 'group', dir: 'col', sizes: [50, 50] });
  });

  it('moves an existing leaf instead of duplicating it', () => {
    const l = insertLeaf(row('a', 'b', 'c'), 'a', 'c', 'bottom');
    expect(leafIds(l)).toEqual(['a', 'c', 'b']);
    expect(l).toMatchObject({ dir: 'row', children: [{ dir: 'col' }, { sessionId: 'b' }] });
  });

  it('replaces or swaps on center', () => {
    expect(leafIds(replaceLeaf(row('a', 'b'), 'a', 'x'))).toEqual(['x', 'b']);
    expect(leafIds(replaceLeaf(row('a', 'b'), 'a', 'b'))).toEqual(['b', 'a']);
    expect(leafIds(insertLeaf(row('a', 'b'), 'b', 'x', 'center'))).toEqual(['a', 'x']);
  });

  it('removes leaves and collapses single-child groups', () => {
    const l = insertLeaf(row('a', 'b'), 'b', 'c', 'bottom');
    const r = removeLeaf(l, 'c')!;
    expect(r).toEqual({ kind: 'group', dir: 'row', children: [{ kind: 'leaf', sessionId: 'a' }, { kind: 'leaf', sessionId: 'b' }], sizes: [50, 50] });
    expect(removeLeaf(removeLeaf(r, 'a'), 'b')).toBeUndefined();
  });

  it('flattens nested groups with the same direction and keeps proportions', () => {
    const nested: SplitNode = {
      kind: 'group',
      dir: 'row',
      sizes: [50, 50],
      children: [{ kind: 'leaf', sessionId: 'a' }, { kind: 'group', dir: 'row', sizes: [50, 50], children: [{ kind: 'leaf', sessionId: 'b' }, { kind: 'leaf', sessionId: 'c' }] }],
    };
    expect(normalizeLayout(nested, ['a', 'b', 'c'])).toMatchObject({ dir: 'row', sizes: [50, 25, 25] });
  });

  it('normalizes against the session list (drop missing/duplicates, append new)', () => {
    const l = normalizeLayout(row('a', 'b', 'a', 'gone'), ['a', 'b', 'c'])!;
    expect(leafIds(l)).toEqual(['a', 'b', 'c']);
    expect(normalizeLayout(undefined, [])).toBeUndefined();
    expect(normalizeLayout(undefined, ['a'])).toEqual({ kind: 'leaf', sessionId: 'a' });
  });

  it('sets sizes by path and validates shape', () => {
    const l = insertLeaf(row('a', 'b'), 'b', 'c', 'bottom');
    const s = setGroupSizes(l, [1], [30, 70]) as Extract<SplitNode, { kind: 'group' }>;
    expect((s.children[1] as Extract<SplitNode, { kind: 'group' }>).sizes).toEqual([30, 70]);
    expect(setGroupSizes(l, [1], [1, 2, 3])).toEqual(l);
    expect(isSplitNode(l)).toBe(true);
    expect(isSplitNode({ kind: 'group', dir: 'diag', children: [] })).toBe(false);
    expect(isSplitNode({ kind: 'leaf' })).toBe(false);
  });

  it('migrates old left-right sizes and drops dead panels on restore', () => {
    const sessions = { a: { id: 'a', parentId: null, rootId: 'a', title: 'a', createdAt: 0, updatedAt: 0 }, b: { id: 'b', parentId: 'a', rootId: 'a', title: 'b', createdAt: 0, updatedAt: 0 } };
    const v = sanitizeView({ ...emptyView('a'), mode: 'split', splitSessionIds: ['a', 'b'], splitSizes: [30, 70] }, sessions);
    expect(v.splitLayout).toMatchObject({ dir: 'row', sizes: [30, 70] });
    expect(v.splitSizes).toBeUndefined();
    const dead = sanitizeView({ ...emptyView('a'), mode: 'split', splitSessionIds: ['a', 'x'], splitLayout: row('a', 'x') }, sessions);
    expect(dead.mode).toBe('single');
    expect(dead.splitLayout).toBeUndefined();
  });

  describe('move & swap (IMP-10)', () => {
    // a | (b / c)
    const tri = (): SplitNode => insertLeaf(row('a', 'b'), 'b', 'c', 'bottom');
    // (a | b) / (c | d)
    const quad = (): SplitNode => ({ kind: 'group', dir: 'col', sizes: [50, 50], children: [row('a', 'b'), row('c', 'd')] });

    it('computes leaf rects from sizes', () => {
      const r = leafRects(tri());
      expect(r.a).toEqual({ x: 0, y: 0, w: 50, h: 100 });
      expect(r.c).toEqual({ x: 50, y: 50, w: 50, h: 50 });
    });

    it('finds spatial neighbors and returns null at the edges', () => {
      const l = tri();
      expect(neighborOf(l, 'a', 'right')).toBe('b');
      expect(neighborOf(l, 'c', 'left')).toBe('a');
      expect(neighborOf(l, 'b', 'down')).toBe('c');
      expect(neighborOf(l, 'c', 'up')).toBe('b');
      expect(neighborOf(l, 'a', 'left')).toBeNull();
      expect(neighborOf(l, 'a', 'up')).toBeNull();
      expect(neighborOf(l, 'b', 'up')).toBeNull();
      expect(neighborOf(l, 'x', 'up')).toBeNull();
      const q = quad();
      expect(neighborOf(q, 'a', 'down')).toBe('c');
      expect(neighborOf(q, 'b', 'down')).toBe('d');
      expect(neighborOf(q, 'd', 'left')).toBe('c');
      expect(neighborOf(q, 'd', 'up')).toBe('b');
    });

    it('swaps two leaves, keeping sizes on positions and not mutating input', () => {
      const l = rowLayout(['a', 'b', 'c'], [20, 30, 50])!;
      const copy = structuredClone(l);
      const s = swapLeaves(l, 'a', 'c');
      expect(leafIds(s)).toEqual(['c', 'b', 'a']);
      expect(s).toMatchObject({ sizes: [20, 30, 50] });
      expect(l).toEqual(copy);
      expect(swapLeaves(l, 'a', 'x')).toBe(l);
      expect(leafIds(swapLeaves(tri(), 'a', 'c'))).toEqual(['c', 'b', 'a']);
    });

    it('swaps subtrees on both sides of a separator', () => {
      const l = setGroupSizes(tri(), [], [30, 70])!;
      const copy = structuredClone(l);
      const s = swapChildren(l, [], 0, 1)!;
      expect(leafIds(s)).toEqual(['b', 'c', 'a']);
      expect(s).toMatchObject({ dir: 'row', sizes: [30, 70], children: [{ kind: 'group', dir: 'col' }, { sessionId: 'a' }] });
      expect(l).toEqual(copy);
      expect(leafIds(swapChildren(l, [1], 0, 1))).toEqual(['a', 'c', 'b']);
      expect(leafIds(swapChildren(l, [], 0, 5))).toEqual(['a', 'b', 'c']);
    });

    it('flips a group direction and re-tidies nested same-direction groups', () => {
      expect(flipGroupDir(row('a', 'b'), [])).toMatchObject({ dir: 'col', children: [{ sessionId: 'a' }, { sessionId: 'b' }] });
      // 안쪽 상하 그룹을 좌우로 바꾸면 바깥 좌우 그룹과 합쳐진다
      const flat = flipGroupDir(tri(), [1])!;
      expect(flat).toMatchObject({ kind: 'group', dir: 'row', sizes: [50, 25, 25] });
      expect(leafIds(flat)).toEqual(['a', 'b', 'c']);
      const q = flipGroupDir(quad(), [])!;
      expect(q).toMatchObject({ dir: 'row', sizes: [25, 25, 25, 25] });
      expect(isSplitNode(q)).toBe(true);
    });
  });
});
