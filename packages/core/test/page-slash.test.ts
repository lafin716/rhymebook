import { describe, expect, it } from 'vitest';
import { applyPageBlock, filterPageBlocks, PAGE_BLOCKS, pageSlashQuery, type PageBlock } from '../src/page';

const block = (id: string): PageBlock => PAGE_BLOCKS.find((b) => b.id === id)!;
/** "|"를 커서로 보고 / 블록을 넣는다 */
function put(src: string, id: string) {
  const caret = src.indexOf('|');
  const text = src.replace('|', '');
  const q = pageSlashQuery(text, caret)!;
  const r = applyPageBlock(text, q.start, caret, block(id));
  return { ...r, sel: r.text.slice(r.selStart, r.selEnd) };
}

describe('pageSlashQuery', () => {
  it('줄 처음이나 공백 뒤의 /만 잡는다', () => {
    expect(pageSlashQuery('/', 1)).toEqual({ start: 0, query: '' });
    expect(pageSlashQuery('글\n/제목', 5)).toEqual({ start: 2, query: '제목' });
    expect(pageSlashQuery('가나 /h', 5)).toEqual({ start: 3, query: 'h' });
    expect(pageSlashQuery('a/b', 3)).toBeNull(); // 경로·분수
    expect(pageSlashQuery('https://x', 9)).toBeNull();
    expect(pageSlashQuery('/제목 ', 4)).toBeNull(); // 공백을 치면 닫힌다
    expect(pageSlashQuery('없음', 2)).toBeNull();
  });
  it('코드·수식 울타리 안에서는 열지 않는다', () => {
    const code = '```\n/제목';
    expect(pageSlashQuery(code, code.length)).toBeNull();
    const closed = '```\nx\n```\n/제목';
    expect(pageSlashQuery(closed, closed.length)).toEqual({ start: closed.length - 3, query: '제목' });
    const math = '$$\n/a';
    expect(pageSlashQuery(math, math.length)).toBeNull();
    const tilde = '~~~\n```\n/a'; // 다른 울타리 표시는 닫지 않는다
    expect(pageSlashQuery(tilde, tilde.length)).toBeNull();
  });
  it('검색어가 너무 길면 잡지 않는다', () => {
    const t = `/${'a'.repeat(25)}`;
    expect(pageSlashQuery(t, t.length)).toBeNull();
  });
});

describe('filterPageBlocks', () => {
  it('한국어 이름·영문 검색어로 찾는다', () => {
    expect(filterPageBlocks('').length).toBe(PAGE_BLOCKS.length);
    expect(filterPageBlocks('제목').map((b) => b.id)).toEqual(['h1', 'h2', 'h3']);
    expect(filterPageBlocks('제목2').map((b) => b.id)).toEqual(['h2']);
    expect(filterPageBlocks('H2').map((b) => b.id)).toEqual(['h2']);
    expect(filterPageBlocks('목록').map((b) => b.id)).toEqual(['bullet', 'number', 'todo']);
    expect(filterPageBlocks('tab').map((b) => b.id)).toEqual(['table']);
    expect(filterPageBlocks('zzz')).toEqual([]);
  });
});

describe('applyPageBlock', () => {
  it('줄 표시는 /검색어를 바꾸고 커서를 뒤에 둔다', () => {
    const r = put('/제목|', 'h1');
    expect(r.text).toBe('# ');
    expect(r.selStart).toBe(2);
    expect(put('첫 줄\n/할|\n끝', 'todo').text).toBe('첫 줄\n- [ ] \n끝');
  });
  it('줄 중간이면 새 줄에서 시작한다', () => {
    const r = put('문장 /인용|', 'quote');
    expect(r.text).toBe('문장\n> ');
    expect(r.selStart).toBe(r.text.length);
  });
  it('빈 목록·인용 표시 뒤면 그 표시를 바꾼다', () => {
    expect(put('- /제목|', 'h1').text).toBe('# ');
    expect(put('  1. /할|', 'todo').text).toBe('  - [ ] ');
    expect(put('- [ ] /인용|', 'quote').text).toBe('> ');
    expect(put('- 항목 /인용|', 'quote').text).toBe('- 항목\n> ');
  });
  it('구분선은 앞뒤를 빈 줄로 띄운다 (문단 밑 ---가 제목이 되지 않게)', () => {
    expect(put('문단\n/구분|', 'divider').text).toBe('문단\n\n---\n');
    expect(put('문단\n/구분|\n다음', 'divider').text).toBe('문단\n\n---\n\n다음');
    const hr = put('/hr|', 'divider');
    expect(hr.text).toBe('---\n');
    expect(hr.selStart).toBe(4); // 다음 줄에서 이어 쓴다
  });
  it('코드 블록은 안쪽 빈 줄에, 표는 첫 머리 칸을 선택한다', () => {
    const c = put('/code|', 'code');
    expect(c.text).toBe('```\n\n```\n');
    expect(c.selStart).toBe(4);
    const t = put('글\n\n/표|', 'table');
    expect(t.text.startsWith('글\n\n| 항목 | 설명 |\n| --- | --- |\n')).toBe(true);
    expect(t.sel).toBe('항목');
  });
});
