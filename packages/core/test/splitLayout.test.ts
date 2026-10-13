import { describe, expect, it } from 'vitest';
import type { SplitNode } from '../src/model';
import { insertLeaf, isSplitNode, leafIds, normalizeLayout, removeLeaf, replaceLeaf, rowLayout, setGroupSizes } from '../src/splitLayout';
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
});
