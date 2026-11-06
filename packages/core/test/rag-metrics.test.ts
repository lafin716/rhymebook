import { describe, expect, it } from 'vitest';
import {
  hitAtK,
  mean,
  mrr,
  ndcgAtK,
  percentile,
  recallAtK,
  reciprocalRank,
  spanOverlaps,
  uniqueRanked,
} from '../src/rag/metrics';

const rel = (...xs: string[]) => new Set(xs);

describe('검색 지표', () => {
  it('recall@k는 상위 k 안의 관련 항목 비율이다', () => {
    const ranked = ['a', 'x', 'b', 'y', 'c'];
    expect(recallAtK(rel('a', 'b', 'c'), ranked, 1)).toBeCloseTo(1 / 3);
    expect(recallAtK(rel('a', 'b', 'c'), ranked, 3)).toBeCloseTo(2 / 3);
    expect(recallAtK(rel('a', 'b', 'c'), ranked, 5)).toBe(1);
  });

  it('같은 문서가 여러 번 나와도 한 번만 센다', () => {
    expect(recallAtK(rel('a'), ['a', 'a', 'a', 'b'], 3)).toBe(1);
    expect(uniqueRanked(['a', 'b', 'a', 'c'])).toEqual(['a', 'b', 'c']);
    // 중복이 k 자리를 차지하면 뒤의 관련 문서는 빠진다
    expect(recallAtK(rel('c'), ['a', 'a', 'b', 'c'], 2)).toBe(0);
  });

  it('관련 항목이 없으면 recall과 nDCG는 0', () => {
    expect(recallAtK(rel(), ['a'], 5)).toBe(0);
    expect(ndcgAtK(rel(), ['a'], 5)).toBe(0);
  });

  it('hit@k는 상위 k에 관련 항목이 하나라도 있으면 1', () => {
    expect(hitAtK(rel('z'), ['a', 'z'], 1)).toBe(0);
    expect(hitAtK(rel('z'), ['a', 'z'], 2)).toBe(1);
  });

  it('MRR은 첫 관련 항목 역순위의 평균이다', () => {
    expect(reciprocalRank(rel('b'), ['a', 'b'])).toBe(0.5);
    expect(reciprocalRank(rel('q'), ['a', 'b'])).toBe(0);
    const items = [
      { relevant: rel('a'), ranked: ['a'] }, // 1
      { relevant: rel('c'), ranked: ['a', 'b', 'c'] }, // 1/3
      { relevant: rel('q'), ranked: ['a'] }, // 0
    ];
    expect(mrr(items)).toBeCloseTo((1 + 1 / 3 + 0) / 3);
  });

  it('nDCG@k는 완벽한 순위에서 1, 뒤로 밀릴수록 작아진다', () => {
    expect(ndcgAtK(rel('a', 'b'), ['a', 'b', 'x'], 10)).toBeCloseTo(1);
    const late = ndcgAtK(rel('a'), ['x', 'y', 'a'], 10);
    expect(late).toBeCloseTo(1 / Math.log2(4));
    expect(ndcgAtK(rel('a', 'b'), ['x', 'a', 'b'], 10)).toBeLessThan(1);
    expect(ndcgAtK(rel('a'), ['x'], 10)).toBe(0);
  });

  it('nDCG의 이상 순위는 관련 항목 수와 k 중 작은 값까지 채운다', () => {
    // 관련 3개, k=2: 이상 DCG = 1 + 1/log2(3)
    const ideal = 1 + 1 / Math.log2(3);
    expect(ndcgAtK(rel('a', 'b', 'c'), ['a', 'b'], 2)).toBeCloseTo(1);
    expect(ndcgAtK(rel('a', 'b', 'c'), ['a', 'x'], 2)).toBeCloseTo(1 / ideal);
  });

  it('백분위수는 선형 보간이다', () => {
    const v = [10, 20, 30, 40];
    expect(percentile(v, 0)).toBe(10);
    expect(percentile(v, 100)).toBe(40);
    expect(percentile(v, 50)).toBe(25);
    expect(percentile([5], 95)).toBe(5);
    expect(percentile([], 50)).toBeNaN();
    // 입력 순서와 무관
    expect(percentile([40, 10, 30, 20], 50)).toBe(25);
  });

  it('평균은 빈 입력에서 NaN', () => {
    expect(mean([1, 2, 3])).toBe(2);
    expect(mean([])).toBeNaN();
  });

  it('구간 겹침: 같은 경로 안에서 줄 범위가 겹칠 때만 맞는다', () => {
    expect(spanOverlaps({ startLine: 10, endLine: 20 }, { lineStart: 18, lineEnd: 30 })).toBe(true);
    expect(spanOverlaps({ startLine: 10, endLine: 20 }, { lineStart: 21, lineEnd: 30 })).toBe(false);
    expect(spanOverlaps({ startLine: 10 }, { lineStart: 10, lineEnd: 10 })).toBe(true);
    // 줄 정보가 없는 근거는 구간 정답을 맞힐 수 없다
    expect(spanOverlaps({ startLine: 1, endLine: 2 }, {})).toBe(false);
    // 정답에 줄 정보가 없으면 문서 일치만으로 충분하다
    expect(spanOverlaps({}, {})).toBe(true);
  });
});
