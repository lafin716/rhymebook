import { describe, expect, it } from 'vitest';
import { bookFileName, chapterSections, collectBookAnswers, isBookSession, parseBook } from '../src/book';
import type { Message } from '../src/model';
import { BOOK_SKILL_ID } from '../src/skills';

const msg = (over: Partial<Message>): Message => ({
  id: Math.random().toString(36).slice(2),
  sessionId: 's',
  role: 'assistant',
  content: '',
  createdAt: 0,
  status: 'done',
  ...over,
});

const FIRST = [
  '## 1단계: 구조 분석',
  '- 핵심 주제: 어텐션',
  '',
  '## 목차',
  '## 1장. 기초 개념 — 핵심 용어를 알 수 있어요',
  '## 2장. 실전 — 써 볼 수 있어요',
  '',
  '# 어텐션 이해하기',
  '',
  '## 머리말',
  '이 책은 어텐션을 다룬다.',
  '',
  '## 1장. 기초 개념',
  '### 1.1 쿼리와 키',
  '**쿼리**는 묻는 쪽이다.',
  '',
  '```md',
  '## 2장. 코드 속 제목은 장이 아니다',
  '```',
  '',
  '**핵심 정리**',
  '- 쿼리·키·값',
  '',
  '---',
  '',
  '— 1장까지 썼어요. \'계속\'이라고 보내면 다음 장부터 이어서 씁니다.',
].join('\n');

const SECOND = [
  '이어서 2장을 씁니다.',
  '',
  '## 2장. 실전',
  '### 2.1 셀프 어텐션',
  '본문',
  '',
  '## 용어 찾아보기',
  '- **쿼리**: 묻는 벡터',
  '',
  '## 맺음말',
  '다음은 트랜스포머.',
].join('\n');

describe('책 파싱', () => {
  it('구조 분석·목차·이어쓰기 안내를 걷어 내고 머리말·장·뒷부분으로 나눈다', () => {
    const book = parseBook([FIRST, SECOND], '📖 세션');
    expect(book.title).toBe('어텐션 이해하기');
    expect(book.front.map((p) => p.title)).toEqual(['머리말']);
    expect(book.chapters.map((c) => [c.number, c.title, c.id])).toEqual([
      [1, '기초 개념', 'ch-1'],
      [2, '실전', 'ch-2'],
    ]);
    // 맺음말이 앞, 용어 찾아보기가 맨 뒤
    expect(book.back.map((p) => p.title)).toEqual(['맺음말', '용어 찾아보기']);
    const ch1 = book.chapters[0]!.markdown;
    expect(ch1).toContain('코드 속 제목은 장이 아니다');
    expect(ch1).not.toContain('계속');
    expect(ch1.endsWith('- 쿼리·키·값')).toBe(true);
    expect(book.chapters[1]!.markdown).not.toContain('이어서 2장');
    expect(chapterSections(ch1)).toEqual(['1.1 쿼리와 키']);
  });

  it('H1이 없으면 "책 제목:" 줄, 그것도 없으면 세션 제목', () => {
    expect(parseBook(['책 제목: **「어텐션 입문」**\n\n## 1장. 시작\n본문'], '📖 x').title).toBe('어텐션 입문');
    const b = parseBook(['## 제1장: 시작\n본문'], '📖 어텐션');
    expect(b.title).toBe('어텐션');
    expect(b.chapters[0]).toMatchObject({ number: 1, title: '시작' });
  });

  it('장 사이 알 수 없는 ## 섹션은 직전 장에 붙인다', () => {
    const b = parseBook(['# 책\n## 1장. 하나\n본문\n## 쉬어 가기\n쉼'], 'x');
    expect(b.chapters[0]!.markdown).toContain('## 쉬어 가기\n\n쉼');
    expect(b.back).toEqual([]);
  });

  it('책 세션 판별·답변 모으기·파일 이름', () => {
    const skill = { id: BOOK_SKILL_ID, name: 'book', title: '책', prompt: '' };
    expect(isBookSession([msg({ role: 'user', skill })])).toBe(true);
    expect(isBookSession([msg({ role: 'user' })])).toBe(false);
    expect(isBookSession(undefined)).toBe(false);
    const answers = collectBookAnswers([
      msg({ role: 'user', content: '책' }),
      msg({ content: 'a' }),
      msg({ content: 'err', status: 'error' }),
      msg({ content: 'b', status: 'stopped' }),
      msg({ content: 'live', status: 'streaming' }),
    ]);
    expect(answers).toEqual(['a', 'b']);
    expect(bookFileName('어텐션/입문')).toBe('어텐션 입문.pdf');
  });
});
