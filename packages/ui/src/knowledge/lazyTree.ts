import type { KnowledgeEntry } from '@branch/core';

/**
 * 지식베이스 파일 트리를 폴더 단위로 나눠 읽기 위한 순수 함수들.
 * 트리는 경로 목록(부모가 자식보다 앞서는 순서)으로 들고, 폴더를 펼칠 때 그 폴더의 바로 아래 항목을 합친다.
 */

/** 상위 폴더 경로 (최상위 항목은 '') */
export function parentOf(p: string): string {
  const i = p.lastIndexOf('/');
  return i < 0 ? '' : p.slice(0, i);
}

/** 경로의 상위 폴더들 (a/b/c → a, a/b) */
export function ancestors(p: string): string[] {
  const parts = p.split('/');
  return parts.slice(0, -1).map((_, i) => parts.slice(0, i + 1).join('/'));
}

const isUnder = (p: string, dir: string) => dir === '' || p.startsWith(`${dir}/`);

/** 경로 조각 순서로 비교한다: 부모가 자식보다 앞선다 (브리지의 재귀 목록과 같은 순서) */
export function comparePath(a: string, b: string): number {
  const x = a.split('/');
  const y = b.split('/');
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    if (x[i] !== y[i]) return x[i]! < y[i]! ? -1 : 1;
  }
  return x.length - y.length;
}

/**
 * dir 바로 아래 항목을 새로 받은 목록으로 바꾼다.
 * 사라진 하위 폴더 안에 있던 항목도 함께 뺀다. 받은 목록에 더 깊은 항목이 있으면(이전 버전 PC는 전체를 준다) 그대로 합친다.
 */
export function mergeLevel(tree: KnowledgeEntry[], dir: string, incoming: KnowledgeEntry[]): KnowledgeEntry[] {
  const freshDirs = new Set(incoming.filter((e) => e.dir).map((e) => e.path));
  const kept = tree.filter((e) => {
    if (!isUnder(e.path, dir)) return true;
    if (parentOf(e.path) === dir) return false;
    const rest = dir ? e.path.slice(dir.length + 1) : e.path;
    const top = dir ? `${dir}/${rest.split('/')[0]}` : rest.split('/')[0]!;
    return freshDirs.has(top);
  });
  const byPath = new Map(kept.map((e) => [e.path, e]));
  for (const e of incoming) byPath.set(e.path, e);
  return [...byPath.values()].sort((a, b) => comparePath(a.path, b.path));
}

/**
 * 이번 응답으로 내용을 다 알게 된 폴더들. 보통은 dir 하나지만,
 * 응답이 더 깊은 항목을 담고 있으면(전체 목록) 그 안의 모든 폴더도 읽은 것으로 본다.
 */
export function loadedBy(dir: string, incoming: KnowledgeEntry[]): string[] {
  const full = incoming.some((e) => parentOf(e.path) !== dir);
  return full ? [dir, ...incoming.filter((e) => e.dir).map((e) => e.path)] : [dir];
}
