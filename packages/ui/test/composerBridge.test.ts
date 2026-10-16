import { describe, expect, it } from 'vitest';
import { quoteToComposer, registerComposer, toQuote } from '../src/chat/composerBridge';

describe('toQuote', () => {
  it('각 줄을 인용으로 바꾸고 빈 줄은 > 만 남긴다', () => {
    expect(toQuote('  첫 줄\n\n둘째 줄\r\n셋째  ')).toBe('> 첫 줄\n>\n> 둘째 줄\n> 셋째');
  });
});

describe('quoteToComposer', () => {
  it('그 세션의 마지막에 열린 입력창에 넣고, 해제 뒤엔 이전 입력창으로 돌아간다', () => {
    const got: string[] = [];
    const offA = registerComposer('s1', (t) => got.push(`A:${t}`));
    const offB = registerComposer('s1', (t) => got.push(`B:${t}`));
    expect(quoteToComposer('s1', '글')).toBe(true);
    offB();
    expect(quoteToComposer('s1', '글')).toBe(true);
    offA();
    expect(quoteToComposer('s1', '글')).toBe(false);
    expect(quoteToComposer('s2', '글')).toBe(false);
    expect(got).toEqual(['B:> 글', 'A:> 글']);
  });
});
