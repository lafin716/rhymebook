import { describe, expect, it } from 'vitest';
import {
  buildSegmentMap,
  excerptAround,
  layoutAnchorRanges,
  locateAnchor,
  selectionToAnchor,
  type RenderTextNode,
} from '../src/anchor';

const hinted = (source: string, value: string, from = 0): RenderTextNode => {
  const start = source.indexOf(value, from);
  return { value, hint: { start, end: start + value.length } };
};

describe('anchor mapping', () => {
  const source = '1. 각 단어를 **Query, Key, Value** 세 벡터로 바꿉니다.\n2. **소프트맥스**로 가중치';
  const nodes: RenderTextNode[] = [
    hinted(source, '각 단어를 '),
    hinted(source, 'Query, Key, Value'),
    hinted(source, ' 세 벡터로 바꿉니다.'),
    { value: '\n' },
    hinted(source, '소프트맥스'),
    hinted(source, '로 가중치'),
  ];
  const map = buildSegmentMap(nodes, source);

  it('selection across bold maps back to source offsets', () => {
    const rs = map.renderText.indexOf('Key');
    const re = map.renderText.indexOf('벡터') + 2;
    const a = selectionToAnchor('m1', map, rs, re)!;
    expect(a.text).toBe('Key, Value 세 벡터');
    expect(source.slice(a.startOffset, a.endOffset)).toBe('Key, Value** 세 벡터');
  });

  it('trims surrounding whitespace and rejects empty selections', () => {
    const rs = map.renderText.indexOf('소프트맥스') - 1;
    const a = selectionToAnchor('m1', map, rs, rs + 6)!;
    expect(a.text).toBe('소프트맥스');
    expect(selectionToAnchor('m1', map, 3, 3)).toBeNull();
  });

  it('locates anchors by text, preferring the occurrence nearest to startOffset', () => {
    const src = '어텐션 A. 그리고 어텐션 B.';
    const m = buildSegmentMap([{ value: src, hint: { start: 0, end: src.length } }], src);
    const second = src.lastIndexOf('어텐션');
    expect(locateAnchor(m, { text: '어텐션', startOffset: second })).toEqual({ start: second, end: second + 3 });
    expect(locateAnchor(m, { text: '어텐션', startOffset: 0 })).toEqual({ start: 0, end: 3 });
  });

  it('falls back to whitespace-normalized matching', () => {
    const src = 'Query,\nKey';
    const m = buildSegmentMap([{ value: 'Query, Key', hint: { start: 0, end: src.length } }], src);
    expect(locateAnchor(m, { text: 'Query,  Key', startOffset: 0 })).toEqual({ start: 0, end: 10 });
    expect(locateAnchor(m, { text: '없는 텍스트', startOffset: 0 })).toBeNull();
  });

  it('aligns hint-less nodes (syntax highlighted code) from the cursor', () => {
    const src = '```python\nscore = sum(q)\n```';
    const m = buildSegmentMap(
      [{ value: 'score' }, { value: ' = ' }, { value: 'sum' }, { value: '(q)' }, { value: '\n' }],
      src,
    );
    const rs = m.renderText.indexOf('sum');
    const a = selectionToAnchor('m', m, rs, rs + 3)!;
    expect(src.slice(a.startOffset, a.endOffset)).toBe('sum');
  });
});

describe('excerptAround', () => {
  it('clips at line boundaries and strips markdown', () => {
    const content = '첫 줄\n3. 점수를 **소프트맥스**로 가중치로 만듭니다.\n다음 줄';
    const s = content.indexOf('소프트맥스');
    const ex = excerptAround(content, s, s + 5);
    expect(ex.before).toBe('점수를 ');
    expect(ex.text).toBe('소프트맥스');
    expect(ex.after).toBe('로 가중치로 만듭니다.');
  });
});

describe('excerptAround 마크다운 정리', () => {
  it('목록 번호와 강조 기호는 지우고 d_k 같은 밑줄은 보존한다', () => {
    const content = '1. 첫째\n3. 점수를 **스케일링(√d_k)** 한 뒤 가중치로 만듭니다.';
    const s = content.indexOf('스케일링');
    const ex = excerptAround(content, s, s + '스케일링(√d_k)'.length);
    expect(ex.before).toBe('점수를 ');
    expect(ex.text).toBe('스케일링(√d_k)');
    expect(ex.after).toBe(' 한 뒤 가중치로 만듭니다.');
  });
});

describe('buildSegmentMap bound', () => {
  it('hint 없는 노드는 블록 범위 밖의 같은 텍스트로 건너뛰지 않는다', () => {
    const source = 'alpha beta\n\n```\nconst x = 1\n```\n\nconst x = 2 later';
    const codeStart = source.indexOf('```');
    const codeEnd = source.indexOf('```', codeStart + 3) + 3;
    // 코드 블록 안 노드가 원문에 없는 텍스트("const x = 9")라면 블록 밖 "const x = 2"로 오매칭되면 안 된다
    const map = buildSegmentMap(
      [hinted(source, 'alpha beta'), { value: 'const x = 1', bound: { start: codeStart, end: codeEnd } }, { value: 'const x = 9', bound: { start: codeStart, end: codeEnd } }],
      source,
    );
    const tail = source.indexOf('const x = 2');
    expect(map.segments.every((s) => s.sourceStart + s.length <= codeEnd)).toBe(true);
    expect(map.segments.some((s) => s.sourceStart >= tail)).toBe(false);
  });
});

describe('layoutAnchorRanges', () => {
  it('겹치지 않는 범위는 그대로', () => {
    expect(layoutAnchorRanges([{ start: 0, end: 3, id: 'a' }, { start: 5, end: 8, id: 'b' }])).toEqual([
      { start: 0, end: 3, id: 'a', ids: ['a'] },
      { start: 5, end: 8, id: 'b', ids: ['b'] },
    ]);
  });
  it('중첩: 안쪽 조각은 짧은 앵커가 대표, 모든 id 보존', () => {
    const pieces = layoutAnchorRanges([{ start: 0, end: 10, id: 'outer' }, { start: 3, end: 5, id: 'inner' }]);
    expect(pieces).toEqual([
      { start: 0, end: 3, id: 'outer', ids: ['outer'] },
      { start: 3, end: 5, id: 'inner', ids: ['outer', 'inner'] },
      { start: 5, end: 10, id: 'outer', ids: ['outer'] },
    ]);
  });
  it('부분 겹침과 동일 범위', () => {
    const pieces = layoutAnchorRanges([{ start: 0, end: 6, id: 'a' }, { start: 4, end: 9, id: 'b' }, { start: 4, end: 9, id: 'c' }]);
    const ids = new Set(pieces.flatMap((p) => p.ids));
    expect(ids).toEqual(new Set(['a', 'b', 'c']));
    expect(pieces.map((p) => [p.start, p.end])).toEqual([[0, 4], [4, 6], [6, 9]]);
    expect(pieces[1]!.ids).toContain('a');
  });
});
