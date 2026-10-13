import { describe, expect, it } from 'vitest';
import { mockAnswer } from '../src/providers/mock';
import {
  buildSkillAssistRequest,
  finalizeSkillAssist,
  parseSkillAssist,
  SKILL_ASSIST_SYSTEM,
  uniqueSkillName,
  type SkillFields,
} from '../src/skillAssist';
import { SKILL_LIMITS, validateSkill } from '../src/skills';

const EMPTY: SkillFields = { name: '', title: '', description: '', prompt: '' };
const CUR: SkillFields = { name: 'quiz', title: '퀴즈', description: '퀴즈를 내요', prompt: '세 문제를 낸다.' };

const OUT = [
  '<name>Word Card</name>',
  '<title>단어 카드</title>',
  '<description>단어를\n외워요</description>',
  '<prompt>',
  '1. 단어를 **굵게** 쓴다.',
  '2. 예문을 단다.',
  '</prompt>',
  '<note>만들었어요.</note>',
].join('\n');

describe('buildSkillAssistRequest', () => {
  it('새 스킬: 요청과 이미 있는 이름을 담는다', () => {
    const req = buildSkillAssistRequest({ request: '  단어 암기  ', current: EMPTY, takenNames: ['curriculum'] });
    expect(req.system).toBe(SKILL_ASSIST_SYSTEM);
    expect(req.purpose).toBe('skill');
    const u = req.messages[0]!.content;
    expect(u).toContain('## 새 스킬을 만든다');
    expect(u).toContain('curriculum');
    expect(u).toMatch(/## 요청\n단어 암기$/);
  });

  it('고치기: 현재 스킬을 태그로 보내고 자기 이름은 겹침 목록에서 뺀다', () => {
    const req = buildSkillAssistRequest({ request: '더 짧게', current: CUR, takenNames: ['quiz', 'curriculum'] });
    const u = req.messages[0]!.content;
    expect(u).toContain('## 현재 스킬');
    expect(u).toContain('<name>quiz</name>');
    expect(u).toContain('<prompt>\n세 문제를 낸다.\n</prompt>');
    expect(u).toMatch(/## 이미 있는 명령 이름\ncurriculum\n/);
  });

  it('요청이 비면 기본 요청을 쓴다', () => {
    expect(buildSkillAssistRequest({ request: ' ', current: CUR }).messages[0]!.content).toContain('다듬어');
    expect(buildSkillAssistRequest({ request: '' }).messages[0]!.content).toContain('만들어');
  });
});

describe('parseSkillAssist', () => {
  it('완성된 출력에서 필드를 읽는다 (이름 정규화, 한 줄 필드 공백 정리, 지시 줄바꿈 보존)', () => {
    expect(parseSkillAssist(OUT)).toEqual({
      name: 'word-card',
      title: '단어 카드',
      description: '단어를 외워요',
      prompt: '1. 단어를 **굵게** 쓴다.\n2. 예문을 단다.',
      note: '만들었어요.',
    });
  });

  it('코드 블록과 앞뒤 말은 무시한다', () => {
    expect(parseSkillAssist(`네, 만들었어요.\n\`\`\`xml\n${OUT}\n\`\`\`\n끝`).title).toBe('단어 카드');
  });

  it('스트리밍 중에는 닫히지 않은 태그도 지금까지만큼, 미완성 태그 조각은 뗀다', () => {
    const cut = OUT.slice(0, OUT.indexOf('2. 예문') + 3);
    const p = parseSkillAssist(cut, true);
    expect(p.prompt).toBe('1. 단어를 **굵게** 쓴다.\n2.');
    expect(p.note).toBeUndefined();
    expect(parseSkillAssist('<name>quiz</name>\n<title>퀴</ti', true)).toEqual({ name: 'quiz', title: '퀴' });
    // 스트리밍이 아니면 닫히지 않은 태그는 버린다
    expect(parseSkillAssist(cut).prompt).toBeUndefined();
  });

  it('닫는 태그를 빠뜨려도 다음 태그 앞에서 끊는다', () => {
    expect(parseSkillAssist('<title>퀴즈\n<prompt>\n낸다\n</prompt>').title).toBe('퀴즈');
  });
});

describe('uniqueSkillName / finalizeSkillAssist', () => {
  const others = [
    { id: 'a', name: 'quiz' },
    { id: 'b', name: 'quiz-2' },
  ];

  it('겹치면 번호를 붙이고, 자기 자신은 겹침으로 보지 않는다', () => {
    expect(uniqueSkillName('quiz', others)).toBe('quiz-3');
    expect(uniqueSkillName('quiz', others, 'a')).toBe('quiz');
    expect(uniqueSkillName('Quiz Me!', others)).toBe('quiz-me');
    expect(uniqueSkillName('!!!', others)).toBe('skill');
    expect(uniqueSkillName('x'.repeat(40), [{ id: 'c', name: 'x'.repeat(32) }])).toBe(`${'x'.repeat(30)}-2`);
  });

  it('빠진 필드는 현재 값으로, 길이는 제한에 맞추고, 저장 검증을 통과한다', () => {
    const f = finalizeSkillAssist({ name: 'quiz', prompt: 'p'.repeat(SKILL_LIMITS.prompt + 5) }, CUR, others)!;
    expect(f.name).toBe('quiz-3');
    expect(f.title).toBe('퀴즈');
    expect(f.prompt).toHaveLength(SKILL_LIMITS.prompt);
    expect(validateSkill({ ...f, id: 'new' }, [])).toBeNull();
    expect(finalizeSkillAssist({ title: 't' }, EMPTY, [])).toBeNull();
    expect(finalizeSkillAssist({ prompt: '낸다' }, EMPTY, [])).toMatchObject({ title: '새 스킬', name: '새-스킬' });
  });
});

describe('mockAnswer (skill)', () => {
  it('데모 모드도 형식에 맞는 스킬을 돌려준다', () => {
    const fresh = parseSkillAssist(mockAnswer(buildSkillAssistRequest({ request: '광합성 퀴즈' })));
    expect(fresh.prompt).toContain('광합성 퀴즈');
    const edited = parseSkillAssist(mockAnswer(buildSkillAssistRequest({ request: '표로', current: CUR })));
    expect(edited).toMatchObject({ name: 'quiz', title: '퀴즈' });
    expect(edited.prompt).toContain('세 문제를 낸다.');
  });
});
