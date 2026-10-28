import { describe, expect, it } from 'vitest';
import {
  filterPageBlocks,
  pageFileMarkdown,
  pageImageMarkdown,
  restoreEmbeds,
  stashEmbeds,
  stripEmbeds,
  toggleInlineFormat,
  taskItemOffsets,
  toggleTaskAt,
} from '../src';

const sel = (r: { text: string; selStart: number; selEnd: number } | null) => {
  expect(r).not.toBeNull();
  return [r!.text, r!.text.slice(r!.selStart, r!.selEnd)];
};

describe('toggleInlineFormat', () => {
  it('선택한 글을 감싸고 안쪽 글을 다시 선택한다', () => {
    const t = '가나 다라 마바';
    expect(sel(toggleInlineFormat(t, 3, 5, 'bold'))).toEqual(['가나 **다라** 마바', '다라']);
    expect(sel(toggleInlineFormat(t, 3, 5, 'italic'))).toEqual(['가나 *다라* 마바', '다라']);
    expect(sel(toggleInlineFormat(t, 3, 5, 'strike'))).toEqual(['가나 ~~다라~~ 마바', '다라']);
    expect(sel(toggleInlineFormat(t, 3, 5, 'code'))).toEqual(['가나 `다라` 마바', '다라']);
  });

  it('앞뒤 공백은 표시 바깥에 둔다', () => {
    expect(toggleInlineFormat('a  bc  d', 1, 7, 'bold')!.text).toBe('a  **bc**  d');
  });

  it('바깥이나 안쪽에 표시가 있으면 벗긴다', () => {
    expect(sel(toggleInlineFormat('가 **나다** 라', 4, 6, 'bold'))).toEqual(['가 나다 라', '나다']);
    expect(sel(toggleInlineFormat('가 **나다** 라', 2, 8, 'bold'))).toEqual(['가 나다 라', '나다']);
    expect(toggleInlineFormat('x ~~y~~ z', 4, 5, 'strike')!.text).toBe('x y z');
  });

  it('굵게 안의 글에 기울임을 누르면 벗기지 않고 더한다', () => {
    expect(toggleInlineFormat('**굵은**', 2, 4, 'italic')!.text).toBe('***굵은***');
    expect(toggleInlineFormat('***둘다***', 3, 5, 'italic')!.text).toBe('**둘다**');
    expect(toggleInlineFormat('***둘다***', 3, 5, 'bold')!.text).toBe('*둘다*');
    expect(toggleInlineFormat('*기울*', 1, 3, 'bold')!.text).toBe('***기울***');
  });

  it('여러 줄은 줄마다 감싼다', () => {
    const r = toggleInlineFormat('하나\n\n둘 셋', 0, 7, 'bold')!;
    expect(r.text).toBe('**하나**\n\n**둘 셋**');
    expect(toggleInlineFormat(r.text, r.selStart, r.selEnd, 'bold')!.text).toBe('하나\n\n둘 셋');
  });

  it('링크는 주소 자리에 커서를 둔다', () => {
    const r = toggleInlineFormat('보기 문서 끝', 3, 5, 'link')!;
    expect(r.text).toBe('보기 [문서]() 끝');
    expect(r.selStart).toBe(r.selEnd);
    expect(r.text.slice(r.selStart - 2, r.selStart + 1)).toBe('](' + ')');
  });

  it('공백뿐인 선택은 null', () => {
    expect(toggleInlineFormat('a   b', 1, 4, 'bold')).toBeNull();
  });
});

describe('taskItemOffsets', () => {
  it('할 일 항목 표시 위치를 순서대로, 코드 블록은 뺀다', () => {
    const doc = '- [ ] 하나\n```\n- [ ] 코드\n```\n  - [x] 둘\n> 1. [ ] 셋\n- [링크](x)';
    const at = taskItemOffsets(doc);
    expect(at).toEqual([0, doc.indexOf('- [x]'), doc.indexOf('1.')]);
    expect(toggleTaskAt(doc, at[2]!)).toBe(doc.replace('1. [ ]', '1. [x]'));
  });
});

describe('toggleTaskAt', () => {
  const doc = '- [ ] 하나\n  - [x] 둘\n> 1. [ ] 셋\n- 그냥';
  it('항목 표시 위치에서 체크를 바꾼다', () => {
    expect(toggleTaskAt(doc, 0)).toBe(doc.replace('- [ ] 하나', '- [x] 하나'));
    const second = doc.indexOf('- [x]');
    expect(toggleTaskAt(doc, second)).toBe(doc.replace('- [x] 둘', '- [ ] 둘'));
    const third = doc.indexOf('1.');
    expect(toggleTaskAt(doc, third, true)).toBe(doc.replace('1. [ ]', '1. [x]'));
  });
  it('원하는 상태가 이미면 그대로, 할 일이 아니면 null', () => {
    expect(toggleTaskAt(doc, 0, false)).toBe(doc);
    expect(toggleTaskAt(doc, doc.indexOf('- 그냥'))).toBeNull();
    expect(toggleTaskAt(doc, 3)).toBeNull();
  });
  it('대문자 X도 체크로 읽는다', () => {
    expect(toggleTaskAt('- [X] a', 0)).toBe('- [ ] a');
  });
});

describe('페이지 첨부', () => {
  const img = 'data:image/png;base64,iVBORw0KGgo=';
  const pdf = 'data:application/pdf;base64,JVBERi0x';
  it('이미지·파일 마크다운', () => {
    expect(pageImageMarkdown('사진 [1].png', img)).toBe(`![사진 \\[1\\].png](${img})`);
    expect(pageFileMarkdown('보고서 "최종".pdf', pdf)).toBe(`[📎 보고서 "최종".pdf](${pdf} "보고서 최종.pdf")`);
  });
  it('data URL을 자리표시로 바꿨다가 되돌린다', () => {
    const text = `글\n\n${pageImageMarkdown('a', img)}\n\n${pageFileMarkdown('b.pdf', pdf)}`;
    const s = stashEmbeds(text);
    expect(s.text).toBe('글\n\n![a](embed:0)\n\n[📎 b.pdf](embed:1 "b.pdf")');
    expect(s.embeds).toEqual([img, pdf]);
    expect(restoreEmbeds(s.text, s.embeds)).toBe(text);
    expect(restoreEmbeds('![x](embed:9)', s.embeds)).toBe('![x](embed:9)');
    expect(stripEmbeds('그냥 글')).toBe('그냥 글');
  });
  it('/ 메뉴에서 이미지·파일을 찾는다', () => {
    expect(filterPageBlocks('이미지').map((b) => b.id)).toEqual(['image']);
    expect(filterPageBlocks('file').map((b) => b.id)).toEqual(['file']);
    expect(filterPageBlocks('첨부').map((b) => b.id)).toEqual(['image', 'file']);
  });
});
