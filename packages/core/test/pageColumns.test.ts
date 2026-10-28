import { describe, expect, it } from 'vitest';
import { markdownBlocks, moveMarkdownBlock, parseColumns, placeBlockBeside, unwrapColumns, renumberOrderedLists } from '../src';

describe('markdownBlocks', () => {
  it('최상위 블록 목록을 반환한다', () => {
    const text = '# 제목\n\n문단 1\n\n- 목록\n\n---\n\n```\n코드\n```';
    const blocks = markdownBlocks(text);
    expect(blocks.length).toBeGreaterThan(0);
    expect(blocks[0]?.kind).toBe('heading');
  });

  it('columns 묶음을 하나의 블록으로 센다', () => {
    const text = '<!-- columns -->\n왼쪽\n<!-- column -->\n오른쪽\n<!-- /columns -->';
    const blocks = markdownBlocks(text);
    expect(blocks.some((b) => b.kind === 'columns')).toBe(true);
  });

  it('빈 줄과 일반 문단을 구분한다', () => {
    const text = '문단\n\n\n또 다른 문단';
    const blocks = markdownBlocks(text);
    expect(blocks.filter((b) => b.kind === 'paragraph').length).toBeGreaterThanOrEqual(1);
  });

  it('코드 블록의 끝을 찾는다', () => {
    const text = '```\n코드 1\n코드 2\n```\n\n다른 문단';
    const blocks = markdownBlocks(text);
    const codeBlock = blocks.find((b) => b.kind === 'code');
    expect(codeBlock).toBeDefined();
  });
});

describe('renumberOrderedLists', () => {
  it('순서 있는 목록을 다시 번호 매긴다', () => {
    const text = '1. 첫 번째\n3. 세 번째\n5. 다섯 번째';
    const result = renumberOrderedLists(text);
    expect(result).toBe('1. 첫 번째\n2. 세 번째\n3. 다섯 번째');
  });

  it('중첩 목록의 들여쓰기를 유지한다', () => {
    const text = '1. 하나\n  2. 한 가지\n  4. 다른 것\n2. 둘';
    const result = renumberOrderedLists(text);
    const lines = result.split('\n');
    expect(lines[0]).toMatch(/^1\./);
    expect(lines[1]).toMatch(/^ {2}2\./);
    expect(lines[2]).toMatch(/^ {2}3\./);
    expect(lines[3]).toMatch(/^2\./);
  });

  it('비 목록 줄은 그대로 둔다', () => {
    const text = '1. 첫 번째\n문단\n2. 두 번째';
    const result = renumberOrderedLists(text);
    expect(result).toContain('문단');
  });

  it('글머리 목록·할 일 목록은 바꾸지 않는다', () => {
    const text = '- 글머리\n- [ ] 할 일\n1. 번호';
    const result = renumberOrderedLists(text);
    expect(result).toContain('- 글머리');
    expect(result).toContain('- [ ] 할 일');
  });
});

describe('moveMarkdownBlock', () => {
  it('블록을 다른 위치로 이동한다', () => {
    const text = '첫 번째\n\n두 번째\n\n세 번째';
    const blocks = markdownBlocks(text);
    const result = moveMarkdownBlock(text, 0, 2);
    expect(result).toBeDefined();
    const newBlocks = markdownBlocks(result);
    expect(newBlocks.length).toBe(blocks.length);
  });

  it('같은 위치로 이동은 변화 없음', () => {
    const text = '첫 번째\n\n두 번째';
    const result = moveMarkdownBlock(text, 0, 0);
    expect(result).toBe(text);
  });

  it('범위를 벗어나면 원본 반환', () => {
    const text = '첫 번째';
    const result = moveMarkdownBlock(text, 10, 5);
    expect(result).toBe(text);
  });
});

describe('placeBlockBeside', () => {
  it('블록을 다른 블록 옆에 배치 — columns 생성', () => {
    const text = '블록 A\n\n블록 B';
    const result = placeBlockBeside(text, 0, 1, 'left');
    expect(result).toContain('<!-- columns -->');
    expect(result).toContain('<!-- column -->');
    expect(result).toContain('<!-- /columns -->');
  });

  it('우측에 배치', () => {
    const text = '블록 A\n\n블록 B';
    const result = placeBlockBeside(text, 0, 1, 'right');
    expect(result).toContain('<!-- columns -->');
  });
});

describe('unwrapColumns', () => {
  it('columns 묶음을 풀어낸다', () => {
    const text = '<!-- columns -->\n왼쪽\n<!-- column -->\n오른쪽\n<!-- /columns -->';
    const blocks = markdownBlocks(text);
    const columnsIdx = blocks.findIndex((b) => b.kind === 'columns');
    expect(columnsIdx).toBeGreaterThanOrEqual(0);
    const result = unwrapColumns(text, columnsIdx);
    expect(result).not.toContain('<!-- columns -->');
    expect(result).toContain('왼쪽');
    expect(result).toContain('오른쪽');
  });

  it('columns가 아닌 블록은 변화 없음', () => {
    const text = '일반 문단';
    const result = unwrapColumns(text, 0);
    expect(result).toBe(text);
  });
});

describe('pageColumns — 정확한 동작 (ADR-087)', () => {
  it('표·수식·코드는 한 블록, 할 일은 todo', () => {
    const text = '| a | b |\n|---|---|\n| 1 | 2 |\n\n$$\nx^2\n$$\n- [ ] 할 일\n- 글머리\n2. 번호';
    expect(markdownBlocks(text).map((b) => b.kind)).toEqual(['table', 'math', 'todo', 'bullet', 'ordered']);
  });

  it('이동 후 빈 줄이 남지 않는다', () => {
    const text = 'A\n\nB\n\nC';
    expect(moveMarkdownBlock(text, 0, 3)).toBe('B\n\nC\n\nA');
    expect(moveMarkdownBlock(text, 2, 0)).toBe('C\n\nA\n\nB');
    expect(moveMarkdownBlock(text, 0, 2)).toBe('B\n\nA\n\nC');
    expect(moveMarkdownBlock('- a\n- b\n- c', 2, 1)).toBe('- a\n- c\n- b');
    expect(moveMarkdownBlock(text, 1, 2)).toBe(text);
  });

  it('옆에 놓기는 정확한 대상만 감싸고, columns에는 칸을 더한다', () => {
    const text = 'X\n\nA\n\nX';
    const once = placeBlockBeside(text, 1, 2, 'right');
    expect(once).toBe('X\n\n<!-- columns -->\nX\n<!-- column -->\nA\n<!-- /columns -->');
    const blocks = markdownBlocks(once);
    expect(blocks.map((b) => b.kind)).toEqual(['paragraph', 'columns']);
    const twice = placeBlockBeside(once, 0, 1, 'left');
    expect(twice).toBe('<!-- columns -->\nX\n<!-- column -->\nX\n<!-- column -->\nA\n<!-- /columns -->');
    expect(parseColumns(twice)).toEqual(['X', 'X', 'A']);
    expect(placeBlockBeside(twice, 0, 0, 'left')).toBe(twice);
    expect(unwrapColumns(twice, 0)).toBe('X\n\nX\n\nA');
  });

  it('중간 번호를 지우면 아래 번호가 당겨진다', () => {
    expect(renumberOrderedLists('1. a\n3. c\n4. d')).toBe('1. a\n2. c\n3. d');
  });

  it('하위 목록은 상위 항목마다 새로 시작하고 별개 목록은 따로 센다', () => {
    const text = '1. a\n   1. a1\n   2. a2\n3. b\n   5. b1\n   6. b2\n\n문단\n\n4. x\n7. y';
    expect(renumberOrderedLists(text)).toBe('1. a\n   1. a1\n   2. a2\n2. b\n   5. b1\n   6. b2\n\n문단\n\n4. x\n5. y');
  });

  it('빈 줄로 띄운 목록은 이어 세고, 코드 안은 건드리지 않는다', () => {
    expect(renumberOrderedLists('1. a\n\n5. b')).toBe('1. a\n\n2. b');
    expect(renumberOrderedLists('```\n1. a\n5. b\n```')).toBe('```\n1. a\n5. b\n```');
  });
});
