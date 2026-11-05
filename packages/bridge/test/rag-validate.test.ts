import { describe, expect, it } from 'vitest';
import { DEFAULT_RAG_SETTINGS, t } from '@branch/core';
import { parseRetrievalRequest } from '../src';

const plan = {
  original: '질문',
  rewritten: '질문',
  keywords: ['질문'],
  contextTerms: [],
  vectorText: '질문',
  keywordQuery: ['질문'],
  contextual: false,
};
const kbId = 'kbabcdef1234';

describe('검색 요청 검증', () => {
  it('정상 요청은 그대로 통과하고 설정 기본값을 채운다', () => {
    const req = parseRetrievalRequest({ kbIds: [kbId], plan, settings: { topK: 4 } });
    expect(req.kbIds).toEqual([kbId]);
    expect(req.settings.topK).toBe(4);
    expect(req.settings.rrfK).toBe(DEFAULT_RAG_SETTINGS.rrfK);
  });

  it('숫자 설정은 허용 범위로 자른다', () => {
    const req = parseRetrievalRequest({
      kbIds: [kbId],
      plan,
      settings: { topK: 100_000, candidates: -5, maxContextChars: 1e9, minScore: 7 },
    });
    expect(req.settings.topK).toBe(50);
    expect(req.settings.candidates).toBe(1);
    expect(req.settings.maxContextChars).toBe(50_000);
    expect(req.settings.minScore).toBe(1);
  });

  it('숫자가 아닌 설정과 잘못된 kbId는 거부한다', () => {
    expect(() => parseRetrievalRequest({ kbIds: [kbId], plan, settings: { topK: 'x' } })).toThrow(
      t('knowledge.error.badQuery'),
    );
    expect(() => parseRetrievalRequest({ kbIds: ['../etc'], plan, settings: {} })).toThrow(
      t('knowledge.error.badQuery'),
    );
  });

  it('너무 긴 질의, 배열이 아닌 키워드, 알 수 없는 문서 종류는 거부한다', () => {
    expect(() => parseRetrievalRequest({ kbIds: [kbId], plan: { ...plan, original: 'a'.repeat(2001) }, settings: {} })).toThrow();
    expect(() => parseRetrievalRequest({ kbIds: [kbId], plan: { ...plan, keywords: 'x' }, settings: {} })).toThrow();
    expect(() =>
      parseRetrievalRequest({ kbIds: [kbId], plan, settings: {}, filter: { kinds: ['exe'] } }),
    ).toThrow();
  });

  it('KB 수가 상한을 넘으면 거부한다', () => {
    const ids = Array.from({ length: 21 }, (_, i) => `kbabcdef${String(1000 + i)}`);
    expect(() => parseRetrievalRequest({ kbIds: ids, plan, settings: {} })).toThrow();
  });
});
