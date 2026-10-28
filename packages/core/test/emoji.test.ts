import { describe, expect, it } from 'vitest';
import { emojiMatches } from '../src';

describe('emojiMatches', () => {
  it('비어 있으면 빈 배열', () => {
    expect(emojiMatches('', 20)).toEqual([]);
  });

  it('`:smi` 입력시 smile 관련 이모지 반환', () => {
    const result = emojiMatches('smi', 20);
    expect(result.length).toBeGreaterThan(0);
    expect(result.some((e) => e.name === 'smiley')).toBe(true);
    expect(result[0]?.emoji).toBeDefined();
    expect(result[0]?.name).toBeDefined();
  });

  it('한글 검색 미지원, 영문만 지원', () => {
    const result = emojiMatches('heart', 20);
    expect(result.length).toBeGreaterThan(0);
    expect(result.some((e) => e.name.includes('heart'))).toBe(true);
  });

  it('제한 수를 초과하지 않는다', () => {
    const result = emojiMatches('a', 5);
    expect(result.length).toBeLessThanOrEqual(5);
  });

  it('대소문자 무시', () => {
    const lower = emojiMatches('smile', 10);
    const upper = emojiMatches('SMILE', 10);
    expect(lower.length).toBe(upper.length);
  });

  it('부분 매칭', () => {
    const result = emojiMatches('face', 20);
    expect(result.length).toBeGreaterThan(0);
    expect(result.some((e) => e.name.includes('face'))).toBe(true);
  });
});
