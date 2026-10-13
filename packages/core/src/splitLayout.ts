import type { DropEdge, ID, SplitDir, SplitNode } from './model';

/**
 * 분할 배치 트리 연산 (ADR-035). 모두 순수 함수이며 입력을 바꾸지 않는다.
 * 불변식: 같은 세션은 한 번만 나오고, 그룹은 자식이 2개 이상이며, 같은 방향 그룹은 중첩하지 않는다.
 * ViewState.splitSessionIds는 항상 leafIds(splitLayout)와 같은 순서로 맞춘다.
 */

export const leaf = (sessionId: ID): SplitNode => ({ kind: 'leaf', sessionId });

/** 잎 세션 id (왼쪽→오른쪽, 위→아래 순) */
export function leafIds(node: SplitNode | undefined): ID[] {
  if (!node) return [];
  if (node.kind === 'leaf') return [node.sessionId];
  return node.children.flatMap(leafIds);
}

/** 세션들을 좌우로 나란히 둔 기본 배치 */
export function rowLayout(ids: readonly ID[], sizes?: readonly number[]): SplitNode | undefined {
  if (ids.length === 0) return undefined;
  if (ids.length === 1) return leaf(ids[0]!);
  return {
    kind: 'group',
    dir: 'row',
    children: ids.map(leaf),
    ...(sizes && sizes.length === ids.length ? { sizes: [...sizes] } : {}),
  };
}

const total = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0);

/** 비율을 합 100으로 맞춘다. 길이가 다르거나 값이 이상하면 균등 분배 */
function fitSizes(sizes: readonly number[] | undefined, n: number): number[] {
  if (sizes && sizes.length === n && sizes.every((x) => Number.isFinite(x) && x > 0)) {
    const t = total(sizes);
    return sizes.map((x) => (x / t) * 100);
  }
  return Array.from({ length: n }, () => 100 / n);
}

/** 그룹 정리: 빈 자식 제거, 자식 1개면 풀기, 같은 방향 자식 그룹은 펼쳐 합친다 */
function tidy(node: SplitNode): SplitNode | undefined {
  if (node.kind === 'leaf') return node;
  const sizes = fitSizes(node.sizes, node.children.length);
  const kids: SplitNode[] = [];
  const kidSizes: number[] = [];
  node.children.forEach((c, i) => {
    const t = tidy(c);
    if (!t) return;
    if (t.kind === 'group' && t.dir === node.dir) {
      const inner = fitSizes(t.sizes, t.children.length);
      t.children.forEach((cc, j) => {
        kids.push(cc);
        kidSizes.push((sizes[i]! * inner[j]!) / 100);
      });
    } else {
      kids.push(t);
      kidSizes.push(sizes[i]!);
    }
  });
  if (kids.length === 0) return undefined;
  if (kids.length === 1) return kids[0];
  return { kind: 'group', dir: node.dir, children: kids, sizes: fitSizes(kidSizes, kids.length) };
}

function filterLeaves(node: SplitNode, keep: (id: ID) => boolean): SplitNode | undefined {
  if (node.kind === 'leaf') return keep(node.sessionId) ? node : undefined;
  const pairs = node.children
    .map((c, i) => [filterLeaves(c, keep), fitSizes(node.sizes, node.children.length)[i]!] as const)
    .filter((p): p is readonly [SplitNode, number] => !!p[0]);
  if (!pairs.length) return undefined;
  return { kind: 'group', dir: node.dir, children: pairs.map((p) => p[0]), sizes: pairs.map((p) => p[1]) };
}

/**
 * 배치를 세션 목록에 맞춘다: 목록에 없는 잎·중복 잎은 빼고, 배치에 없는 세션은 오른쪽 끝에 붙인다.
 * 배치가 없으면 좌우 나란히. 결과 잎 순서가 새 splitSessionIds 순서다.
 */
export function normalizeLayout(layout: SplitNode | undefined, ids: readonly ID[]): SplitNode | undefined {
  const want = new Set(ids);
  const seen = new Set<ID>();
  let node = layout
    ? filterLeaves(layout, (id) => {
        if (!want.has(id) || seen.has(id)) return false;
        seen.add(id);
        return true;
      })
    : undefined;
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    if (!node) node = leaf(id);
    else if (node.kind === 'group' && node.dir === 'row') {
      const n = node.children.length;
      const sizes = fitSizes(node.sizes, n).map((x) => (x * n) / (n + 1));
      node = { ...node, children: [...node.children, leaf(id)], sizes: [...sizes, 100 / (n + 1)] };
    } else node = { kind: 'group', dir: 'row', children: [node, leaf(id)], sizes: [50, 50] };
  }
  return node ? tidy(node) : undefined;
}

const EDGE_DIR: Record<Exclude<DropEdge, 'center'>, SplitDir> = { left: 'row', right: 'row', top: 'col', bottom: 'col' };

/**
 * targetId 잎의 가장자리에 sessionId를 끼워 넣는다 (가운데면 교체).
 * sessionId가 이미 배치에 있으면 그 자리에서 빼서 옮긴다. 대상이 없으면 오른쪽 끝에 붙인다.
 */
export function insertLeaf(layout: SplitNode | undefined, targetId: ID, sessionId: ID, edge: DropEdge): SplitNode {
  if (targetId === sessionId) return layout ?? leaf(sessionId);
  if (edge === 'center') return replaceLeaf(layout, targetId, sessionId);
  const base = layout ? filterLeaves(layout, (id) => id !== sessionId) : undefined;
  if (!base || !leafIds(base).includes(targetId)) {
    return normalizeLayout(base, [...leafIds(base), sessionId])!;
  }
  const dir = EDGE_DIR[edge];
  const before = edge === 'left' || edge === 'top';
  const visit = (node: SplitNode): SplitNode => {
    if (node.kind === 'leaf') {
      if (node.sessionId !== targetId) return node;
      return { kind: 'group', dir, children: before ? [leaf(sessionId), node] : [node, leaf(sessionId)], sizes: [50, 50] };
    }
    const sizes = fitSizes(node.sizes, node.children.length);
    const i = node.children.findIndex((c) => c.kind === 'leaf' && c.sessionId === targetId);
    if (i >= 0 && node.dir === dir) {
      // 같은 방향이면 형제로 끼우고 대상 칸을 반으로 나눈다
      const children = [...node.children];
      const nextSizes = [...sizes];
      const half = sizes[i]! / 2;
      children.splice(before ? i : i + 1, 0, leaf(sessionId));
      nextSizes.splice(i, 1, half, half);
      return { ...node, children, sizes: nextSizes };
    }
    return { ...node, children: node.children.map(visit), sizes };
  };
  return tidy(visit(base))!;
}

/** targetId 잎을 sessionId로 바꾼다. sessionId가 다른 칸에 있으면 두 칸을 맞바꾼다 */
export function replaceLeaf(layout: SplitNode | undefined, targetId: ID, sessionId: ID): SplitNode {
  if (!layout) return leaf(sessionId);
  const ids = leafIds(layout);
  if (!ids.includes(targetId)) return normalizeLayout(layout, [...ids.filter((x) => x !== sessionId), sessionId])!;
  const swap = ids.includes(sessionId);
  const visit = (node: SplitNode): SplitNode => {
    if (node.kind === 'leaf') {
      if (node.sessionId === targetId) return leaf(sessionId);
      if (swap && node.sessionId === sessionId) return leaf(targetId);
      return node;
    }
    return { ...node, children: node.children.map(visit) };
  };
  return visit(layout);
}

/** 잎을 뺀다. 남은 잎이 없으면 undefined */
export function removeLeaf(layout: SplitNode | undefined, sessionId: ID): SplitNode | undefined {
  if (!layout) return undefined;
  const next = filterLeaves(layout, (id) => id !== sessionId);
  return next ? tidy(next) : undefined;
}

/** path(자식 인덱스 경로)가 가리키는 그룹의 비율을 바꾼다 */
export function setGroupSizes(layout: SplitNode | undefined, path: readonly number[], sizes: readonly number[]): SplitNode | undefined {
  if (!layout) return layout;
  const visit = (node: SplitNode, depth: number): SplitNode => {
    if (node.kind === 'leaf') return node;
    if (depth === path.length) {
      return sizes.length === node.children.length ? { ...node, sizes: fitSizes(sizes, sizes.length) } : node;
    }
    const i = path[depth]!;
    if (i < 0 || i >= node.children.length) return node;
    return { ...node, children: node.children.map((c, j) => (j === i ? visit(c, depth + 1) : c)) };
  };
  return visit(layout, 0);
}

/** 저장·동기화된 값이 배치 트리 모양인지 (깊이·크기 제한 포함) */
export function isSplitNode(v: unknown, depth = 0): v is SplitNode {
  if (!v || typeof v !== 'object' || depth > 8) return false;
  const n = v as Record<string, unknown>;
  if (n.kind === 'leaf') return typeof n.sessionId === 'string';
  if (n.kind !== 'group' || (n.dir !== 'row' && n.dir !== 'col') || !Array.isArray(n.children)) return false;
  if (n.children.length > 16) return false;
  if (n.sizes !== undefined && (!Array.isArray(n.sizes) || !n.sizes.every((x) => typeof x === 'number'))) return false;
  return n.children.every((c) => isSplitNode(c, depth + 1));
}
