import { describe, expect, it } from 'vitest';
import { locateSourceAnchor, markdownPlainText } from '../src/anchor';

const at = (source: string, text: string, startOffset = 0, endOffset = 0) => {
  const r = locateSourceAnchor(source, { text, startOffset, endOffset });
  return r && source.slice(r.start, r.end);
};

describe('locateSourceAnchor', () => {
  it('저장된 위치가 맞으면 그대로 쓴다', () => {
    const src = '# 제목\n\n**굵은** 글과 글';
    const s = src.indexOf('**굵은**');
    expect(locateSourceAnchor(src, { text: '굵은', startOffset: s, endOffset: s + 6 })).toEqual({ start: s, end: s + 6 });
  });

  it('렌더 글자로 만든 앵커를 마크다운 기호를 건너 찾는다', () => {
    expect(at('앞 **굵은 글** 뒤', '굵은 글')).toBe('굵은 글');
    expect(at('- 하나\n- 둘', '하나\n둘')).toBe('하나\n- 둘');
    expect(at('[링크](https://a.b/c) 다음', '링크 다음')).toBe('링크](https://a.b/c) 다음');
  });

  it('본문이 바뀌어도 가까운 출현을 찾고, 없으면 null', () => {
    const src = '사과 그리고 사과';
    const second = src.lastIndexOf('사과');
    expect(locateSourceAnchor(src, { text: '사과', startOffset: second - 1, endOffset: second + 1 })).toEqual({ start: second, end: second + 2 });
    expect(locateSourceAnchor(src, { text: '바나나', startOffset: 0, endOffset: 3 })).toBeNull();
    expect(locateSourceAnchor(src, { text: '  ', startOffset: 0, endOffset: 2 })).toBeNull();
  });
});

describe('markdownPlainText', () => {
  it('줄머리 표식과 강조 기호를 지운다', () => {
    expect(markdownPlainText('## 제목')).toBe('제목');
    expect(markdownPlainText('- [x] 할 일\n> 인용\n1. 번호')).toBe('할 일\n인용\n번호');
    expect(markdownPlainText('**굵게** _기울_ ~~취소~~ `코드` *별*')).toBe('굵게 _기울_ 취소 코드 별');
    expect(markdownPlainText('[글](http://x) ![그림](a.png)')).toBe('글 그림');
    expect(markdownPlainText('a * b')).toBe('a * b');
  });
});
