import { describe, expect, it } from 'vitest';
import { ancestors, comparePath, loadedBy, mergeLevel, parentOf } from '../src/knowledge/lazyTree';

const d = (path: string) => ({ path, dir: true });
const f = (path: string) => ({ path, dir: false, size: 1 });
const paths = (es: { path: string }[]) => es.map((e) => e.path);

describe('lazyTree', () => {
  it('parentOf·ancestors', () => {
    expect(parentOf('a')).toBe('');
    expect(parentOf('a/b/c')).toBe('a/b');
    expect(ancestors('a/b/c')).toEqual(['a', 'a/b']);
  });

  it('comparePath는 부모를 자식보다 앞에 둔다', () => {
    const list = ['b.md', 'a/z.md', 'a', 'a-b', 'a/b', 'a/b/c.md'].sort(comparePath);
    expect(list).toEqual(['a', 'a/b', 'a/b/c.md', 'a/z.md', 'a-b', 'b.md']);
  });

  it('최상위를 읽고 폴더를 펼치면 그 아래가 제자리에 들어간다', () => {
    let tree = mergeLevel([], '', [d('docs'), f('readme.md')]);
    tree = mergeLevel(tree, 'docs', [d('docs/api'), f('docs/intro.md')]);
    expect(paths(tree)).toEqual(['docs', 'docs/api', 'docs/intro.md', 'readme.md']);
  });

  it('다시 읽으면 사라진 항목과 그 하위 항목을 뺀다', () => {
    let tree = mergeLevel([], '', [d('docs'), d('old'), f('readme.md')]);
    tree = mergeLevel(tree, 'docs', [f('docs/intro.md')]);
    tree = mergeLevel(tree, 'old', [f('old/x.md')]);
    tree = mergeLevel(tree, '', [d('docs'), f('new.md')]);
    expect(paths(tree)).toEqual(['docs', 'docs/intro.md', 'new.md']);
  });

  it('전체 목록을 받으면(이전 버전 PC) 모든 폴더를 읽은 것으로 본다', () => {
    const full = [d('a'), d('a/b'), f('a/b/c.md'), f('top.md')];
    expect(paths(mergeLevel([], '', full))).toEqual(['a', 'a/b', 'a/b/c.md', 'top.md']);
    expect(loadedBy('', full)).toEqual(['', 'a', 'a/b']);
    expect(loadedBy('a', [d('a/b'), f('a/x.md')])).toEqual(['a']);
  });
});
