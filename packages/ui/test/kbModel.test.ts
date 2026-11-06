import { describe, expect, it } from 'vitest';
import type { KnowledgeBase } from '@branch/core';
import {
  defaultNameFromGit,
  defaultNameFromPath,
  filterBases,
  findDuplicates,
  groupByKind,
  methodKey,
  sortBases,
  formatSize,
  hitLocation,
  relevancePercent,
  validTime,
  middleEllipsis,
} from '../src/knowledge/kbModel';

const kb = (over: Partial<KnowledgeBase> & { id: string; name: string }): KnowledgeBase => ({
  createdAt: 0,
  updatedAt: 0,
  fileCount: 0,
  totalBytes: 0,
  ...over,
});

const bases = [
  kb({ id: 'a', name: 'Kubernetes 소스', kind: 'codebase', linkedPath: '/src/k8s', totalBytes: 900, updatedAt: 3 }),
  kb({ id: 'b', name: '배포 문서', kind: 'document', description: '팀 배포 절차', totalBytes: 100, updatedAt: 1 }),
  kb({ id: 'c', name: '미정', totalBytes: 500, updatedAt: 2 }),
];

describe('filterBases', () => {
  it('유형 필터를 적용한다', () => {
    expect(filterBases(bases, { filter: 'codebase' }).map((k) => k.id)).toEqual(['a']);
    expect(filterBases(bases, { filter: 'document' }).map((k) => k.id)).toEqual(['b']);
    expect(filterBases(bases, { filter: 'all' })).toHaveLength(3);
  });
  it('이름·설명·연결 경로에서 모든 검색어 토막을 찾는다', () => {
    expect(filterBases(bases, { query: '배포 절차' }).map((k) => k.id)).toEqual(['b']);
    expect(filterBases(bases, { query: 'K8S' }).map((k) => k.id)).toEqual(['a']);
    expect(filterBases(bases, { query: '배포 k8s' })).toEqual([]);
  });
});

describe('sortBases', () => {
  it('최근·이름·크기 순으로 정렬하고 원본은 바꾸지 않는다', () => {
    expect(sortBases(bases, 'recent').map((k) => k.id)).toEqual(['a', 'c', 'b']);
    expect(sortBases(bases, 'size').map((k) => k.id)).toEqual(['a', 'c', 'b']);
    expect(sortBases(bases, 'name').map((k) => k.name)).toHaveLength(3);
    expect(bases[0]?.id).toBe('a');
  });
});

describe('groupByKind', () => {
  it('코드베이스·문서·미분류로 나눈다', () => {
    const g = groupByKind(bases);
    expect(g.codebase.map((k) => k.id)).toEqual(['a']);
    expect(g.document.map((k) => k.id)).toEqual(['b']);
    expect(g.unclassified.map((k) => k.id)).toEqual(['c']);
  });
});

describe('methodKey', () => {
  it('코드베이스는 직접 탐색, 나머지는 하이브리드', () => {
    expect(methodKey('codebase')).toBe('agentic');
    expect(methodKey('document')).toBe('hybrid');
    expect(methodKey(undefined)).toBe('hybrid');
  });
});

describe('findDuplicates', () => {
  it('이름+크기가 같은 파일을 기존 목록과 새 목록 안에서 찾는다', () => {
    const incoming = [
      { name: 'a.pdf', size: 10 },
      { name: 'A.pdf', size: 10 },
      { name: 'a.pdf', size: 11 },
      { name: 'b.md', size: 5 },
    ];
    const existing = [{ name: 'b.md', size: 5 }];
    const r = findDuplicates(incoming, existing);
    expect(r.duplicates.map((x) => `${x.name}:${x.size}`)).toEqual(['A.pdf:10', 'b.md:5']);
    expect(r.unique.map((x) => `${x.name}:${x.size}`)).toEqual(['a.pdf:10', 'a.pdf:11']);
  });
});

describe('기본 이름', () => {
  it('폴더 경로의 마지막 이름을 쓴다', () => {
    expect(defaultNameFromPath('/Users/me/code/my-app/')).toBe('my-app');
    expect(defaultNameFromPath('C:\\work\\proj')).toBe('proj');
  });
  it('GitHub 주소에서 저장소 이름을 얻는다', () => {
    expect(defaultNameFromGit('owner/repo')).toBe('repo');
    expect(defaultNameFromGit('https://github.com/owner/repo.git')).toBe('repo');
    expect(defaultNameFromGit('nope')).toBe('');
  });
});

describe('formatSize', () => {
  it('바이트를 사람이 읽는 단위로 바꾼다', () => {
    expect(formatSize(0)).toBe('0 B');
    expect(formatSize(512)).toBe('512 B');
    expect(formatSize(2048)).toBe('2.0 KB');
    expect(formatSize(5 * 1024 * 1024)).toBe('5.0 MB');
  });
});

describe('hitLocation', () => {
  const base = { path: 'pkg/sched/queue.go', title: 'queue.go', headingPath: [] };
  it('코드는 path:줄 범위로 보인다', () => {
    expect(hitLocation({ ...base, lineStart: 10, lineEnd: 24 }, true)).toBe('pkg/sched/queue.go:10-24');
    expect(hitLocation({ ...base, lineStart: 7, lineEnd: 7 }, true)).toBe('pkg/sched/queue.go:7');
    expect(hitLocation({ ...base }, true)).toBe('pkg/sched/queue.go');
  });
  it('문서는 문서명과 쪽 번호로 보인다', () => {
    expect(hitLocation({ ...base, title: '운영 가이드', page: 3 }, false)).toBe('운영 가이드 p.3');
    expect(hitLocation({ ...base, title: '운영 가이드' }, false)).toBe('운영 가이드');
  });
});

describe('relevancePercent', () => {
  it('0~1 점수를 0~100 정수로 바꾸고 범위를 벗어나면 자른다', () => {
    expect(relevancePercent(0.876)).toBe(88);
    expect(relevancePercent(1.4)).toBe(100);
    expect(relevancePercent(-0.2)).toBe(0);
    expect(relevancePercent(Number.NaN)).toBe(0);
  });
});

describe('validTime', () => {
  it('keeps positive finite timestamps', () => {
    expect(validTime(1_700_000_000_000)).toBe(1_700_000_000_000);
  });
  it('rejects 0, negatives, NaN, non-numbers', () => {
    expect(validTime(0)).toBeNull();
    expect(validTime(-5)).toBeNull();
    expect(validTime(Number.NaN)).toBeNull();
    expect(validTime(Number.POSITIVE_INFINITY)).toBeNull();
    expect(validTime('1700000000000')).toBeNull();
    expect(validTime(undefined)).toBeNull();
  });
  it('rejects values outside the Date range', () => {
    expect(validTime(9e15)).toBeNull();
  });
});

describe('middleEllipsis', () => {
  it('returns short strings unchanged', () => {
    expect(middleEllipsis('/a/b', 10)).toBe('/a/b');
    expect(middleEllipsis('abcde', 5)).toBe('abcde');
  });
  it('keeps both ends of a long path', () => {
    const out = middleEllipsis('/Users/me/workspace/project/src/components/Button.tsx', 20);
    expect(out.length).toBe(20);
    expect(out.startsWith('/Users/me')).toBe(true);
    expect(out.endsWith('.tsx')).toBe(true);
    expect(out).toContain('…');
  });
  it('handles tiny limits', () => {
    expect(middleEllipsis('abcdef', 1)).toBe('…');
    expect(middleEllipsis('abcdef', 0)).toBe('…');
    expect(middleEllipsis('abcdef', 2)).toBe('a…');
  });
});
