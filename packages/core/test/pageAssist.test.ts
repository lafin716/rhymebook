import { describe, expect, it } from 'vitest';
import { buildPageFillRequest, buildPageOrganizeRequest, cleanPageAssist, joinPageFill } from '../src/pageAssist';

describe('페이지 AI 요청', () => {
  it('정리 요청은 노트 전체와 추가 요청을 담는다', () => {
    const r = buildPageOrganizeRequest({ title: '어텐션', content: '# 메모\nQKV', request: '표로' });
    expect(r.purpose).toBe('page');
    expect(r.messages[0]!.content).toContain('# 메모\nQKV');
    expect(r.messages[0]!.content).toContain('## 추가 요청\n표로');
  });

  it('채우기 요청은 커서 자리에 표시를 넣는다', () => {
    const r = buildPageFillRequest({ title: 't', before: '## 장점\n', after: '\n## 단점' });
    expect(r.messages[0]!.content).toContain('## 장점\n[여기에 채우기]\n## 단점');
    expect(r.messages[0]!.content).toContain('맥락에 맞는');
  });
});

describe('cleanPageAssist', () => {
  it('전체를 감싼 울타리를 걷는다', () => {
    expect(cleanPageAssist('```markdown\n# 제목\n- a\n```\n')).toBe('# 제목\n- a');
  });
  it('안쪽 코드 블록은 둔다', () => {
    expect(cleanPageAssist('# 제목\n```js\nx\n```')).toBe('# 제목\n```js\nx\n```');
  });
  it('스트리밍 중 닫는 울타리 조각을 숨긴다', () => {
    expect(cleanPageAssist('```md\n# 제목\n``', true)).toBe('# 제목');
  });
  it('남은 채우기 표시를 지운다', () => {
    expect(cleanPageAssist('[여기에 채우기]본문')).toBe('본문');
  });
});

describe('joinPageFill', () => {
  it('한 줄은 그대로 잇는다', () => {
    expect(joinPageFill('어텐션은 ', '가중합이다', '')).toBe('가중합이다');
  });
  it('문단 끝의 덩어리는 빈 줄로 띄운다', () => {
    expect(joinPageFill('## 장점', '- 빠르다\n- 쉽다', '\n## 단점')).toBe('\n\n- 빠르다\n- 쉽다\n');
  });
  it('목록 끝에서 목록은 한 줄만 띄운다', () => {
    expect(joinPageFill('- a', '- b', '')).toBe('\n- b');
  });
  it('빈 줄 위에서는 더 띄우지 않는다', () => {
    expect(joinPageFill('문단\n\n', '## 새 절\n본문', '')).toBe('## 새 절\n본문');
  });
});
