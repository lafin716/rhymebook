import { describe, expect, it } from 'vitest';
import { insertRowAfter, rowPrefix, shiftListLines, spaceShortcut } from '../src/pageRows';

describe('rowPrefix — 공백까지 친 기호만 블록', () => {
  it('공백 없는 기호는 평범한 글', () => {
    expect(rowPrefix('#')).toBeNull();
    expect(rowPrefix('#제목')).toBeNull();
    expect(rowPrefix('-')).toBeNull();
    expect(rowPrefix('1.')).toBeNull();
    expect(rowPrefix('>')).toBeNull();
    expect(rowPrefix('####### 일곱')).toBeNull();
  });
  it('기호 종류와 내용 시작', () => {
    expect(rowPrefix('## 제목')).toEqual({ kind: 'heading', indent: 0, end: 3, level: 2 });
    expect(rowPrefix('# ')).toMatchObject({ kind: 'heading', end: 2 });
    expect(rowPrefix('  - [x] 끝')).toEqual({ kind: 'todo', indent: 2, end: 8 });
    expect(rowPrefix('- 항목')).toEqual({ kind: 'bullet', indent: 0, end: 2 });
    expect(rowPrefix('12) 번호')).toEqual({ kind: 'ordered', indent: 0, end: 4 });
    expect(rowPrefix('> 인용')).toEqual({ kind: 'quote', indent: 0, end: 2 });
  });
});

describe('spaceShortcut', () => {
  it('[] 뒤 공백 → 할 일', () => {
    expect(spaceShortcut('[] ')).toBe('- [ ] ');
    expect(spaceShortcut('[ ] ')).toBe('- [ ] ');
    expect(spaceShortcut('  [x] ')).toBe('  - [x] ');
  });
  it('그 밖은 없음', () => {
    expect(spaceShortcut('a[] ')).toBeNull();
    expect(spaceShortcut('[]')).toBeNull();
    expect(spaceShortcut('# ')).toBeNull();
  });
});

describe('insertRowAfter', () => {
  it('문단 아래에 빈 행', () => {
    expect(insertRowAfter('하나\n둘', 0)).toEqual({ text: '하나\n\n둘', cursor: 3 });
    expect(insertRowAfter('# 제목', 0)).toEqual({ text: '# 제목\n', cursor: 5 });
  });
  it('목록은 같은 기호로 잇고 번호는 다음 수', () => {
    expect(insertRowAfter('- 가\n- 나', 0)).toEqual({ text: '- 가\n- \n- 나', cursor: 6 });
    expect(insertRowAfter('  2. 가', 0)).toEqual({ text: '  2. 가\n  3. ', cursor: 12 });
    expect(insertRowAfter('- [x] 끝', 0)).toEqual({ text: '- [x] 끝\n- [ ] ', cursor: 14 });
  });
  it('인용·표·코드 뒤는 빈 줄로 띄운다', () => {
    expect(insertRowAfter('> 인용', 0)).toEqual({ text: '> 인용\n\n', cursor: 6 });
    expect(insertRowAfter('```\na\n```\n다음', 0)).toEqual({ text: '```\na\n```\n\n\n다음', cursor: 11 });
    expect(insertRowAfter('|a|\n|-|\n\n끝', 0)).toEqual({ text: '|a|\n|-|\n\n\n끝', cursor: 9 });
  });
  it('없는 블록은 null', () => {
    expect(insertRowAfter('', 0)).toBeNull();
  });
});

describe('shiftListLines — Tab·Shift+Tab 목록 들여쓰기', () => {
  const apply = (text: string, first: number, last: number, dir: 1 | -1) => {
    const lines = text.split('\n');
    for (const e of shiftListLines(text, first, last, dir) ?? []) {
      lines[e.line] = e.delta > 0 ? ' '.repeat(e.delta) + lines[e.line] : lines[e.line]!.slice(-e.delta);
    }
    return lines.join('\n');
  };
  it('위 항목의 기호 폭만큼 하위로 넣는다', () => {
    expect(apply('- a\n- b', 1, 1, 1)).toBe('- a\n  - b');
    expect(apply('1. a\n2. b', 1, 1, 1)).toBe('1. a\n   2. b');
    expect(apply('- [ ] a\n- [ ] b', 1, 1, 1)).toBe('- [ ] a\n  - [ ] b');
  });
  it('첫 항목은 넣을 부모가 없어 그대로', () => {
    expect(shiftListLines('- a\n- b', 0, 0, 1)).toEqual([]);
    expect(shiftListLines('- a\n  - b\n  - c', 1, 1, 1)).toEqual([]);
  });
  it('하위 항목도 같이 움직인다', () => {
    expect(apply('- a\n- b\n  - c\n- d', 1, 1, 1)).toBe('- a\n  - b\n    - c\n- d');
    expect(apply('- a\n  - b\n    - c\n- d', 1, 1, -1)).toBe('- a\n- b\n  - c\n- d');
  });
  it('내어쓰기는 부모 깊이로, 맨 바깥은 그대로', () => {
    expect(apply('1. a\n   - b', 1, 1, -1)).toBe('1. a\n- b');
    expect(shiftListLines('- a', 0, 0, -1)).toEqual([]);
  });
  it('목록이 아니면 null', () => {
    expect(shiftListLines('글\n# 제목', 0, 1, 1)).toBeNull();
  });
  it('여러 줄을 고르면 첫 목록 줄 기준으로 함께', () => {
    expect(apply('- a\n- b\n- c', 1, 2, 1)).toBe('- a\n  - b\n  - c');
  });
});
