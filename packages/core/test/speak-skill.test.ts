import { describe, expect, it } from 'vitest';
import { matchSkill } from '../src/skill-match';
import { defaultSkills, SPEAK_SKILL_ID, withSkill, skillRef } from '../src/skills';
import { parseSpeakBlock, speakLang, SPEAK_LIMITS } from '../src/speak-block';
import type { Skill } from '../src/model';

describe('parseSpeakBlock', () => {
  it('reads the JSON form', () => {
    const s = parseSpeakBlock(
      JSON.stringify({ title: '인사', items: [{ text: 'Xin chào', lang: 'vi', note: '안녕하세요' }, { text: 'Hello', lang: 'en-US' }] }),
    );
    expect(s).toEqual({
      title: '인사',
      items: [
        { text: 'Xin chào', lang: 'vi', note: '안녕하세요' },
        { text: 'Hello', lang: 'en' },
      ],
    });
  });

  it('detects missing languages and applies a block language', () => {
    expect(parseSpeakBlock('["Cảm ơn", "안녕하세요", "Thank you"]')!.items.map((i) => i.lang)).toEqual(['vi', 'ko', 'en']);
    const s = parseSpeakBlock(JSON.stringify({ lang: 'vi', items: [{ text: 'banh mi' }, { text: '김치', lang: 'ko' }] }))!;
    expect(s.items.map((i) => i.lang)).toEqual(['vi', 'ko']);
  });

  it('falls back to one line per item for plain text', () => {
    const s = parseSpeakBlock('Xin chào\n\n  Cảm ơn  \n')!;
    expect(s.title).toBe('');
    expect(s.items.map((i) => i.text)).toEqual(['Xin chào', 'Cảm ơn']);
  });

  it('rejects empty or unusable blocks and caps sizes', () => {
    expect(parseSpeakBlock('')).toBeNull();
    expect(parseSpeakBlock('{"items": []}')).toBeNull();
    expect(parseSpeakBlock('{"items": [{"note": "x"}, 3]}')).toBeNull();
    expect(parseSpeakBlock('42')).toBeNull();
    const many = parseSpeakBlock(JSON.stringify(Array.from({ length: 80 }, (_, i) => `line ${i}`)))!;
    expect(many.items).toHaveLength(SPEAK_LIMITS.items);
    expect(parseSpeakBlock(JSON.stringify(['a'.repeat(5000)]))!.items[0]!.text).toHaveLength(SPEAK_LIMITS.text);
  });

  it('maps language names', () => {
    expect(speakLang('vi-VN')).toBe('vi');
    expect(speakLang('Vietnamese')).toBe('vi');
    expect(speakLang('영어')).toBe('en');
    expect(speakLang('ko_KR')).toBe('ko');
    expect(speakLang('fr')).toBeNull();
    expect(speakLang(3)).toBeNull();
  });
});

describe('speak skill', () => {
  it('asks for a speak block', () => {
    const skill = defaultSkills().find((s) => s.id === SPEAK_SKILL_ID)!;
    expect(skill).toMatchObject({ name: 'speak', builtin: true });
    const system = withSkill('BASE', skillRef(skill));
    expect(system).toContain('## 스킬: 음성으로 읽기 (/speak)');
    expect(system).toContain('```speak');
  });
});

describe('matchSkill', () => {
  const skills = defaultSkills(1);
  const name = (t: string, list: readonly Skill[] = skills) => matchSkill(t, list)?.name ?? null;

  it('picks builtin skills by intent', () => {
    expect(name('베트남어 인사 발음 들려줘')).toBe('speak');
    expect(name('이 문장 소리 내어 읽어 줘')).toBe('speak');
    expect(name('Can you read it aloud?')).toBe('speak');
    expect(name('지금까지 내용으로 퀴즈 내줘')).toBe('quiz');
    expect(name('확인 문제 5개 만들어 줘')).toBe('quiz');
    expect(name('러스트 학습 계획 짜 줘')).toBe('curriculum');
    expect(name('오늘 배운 걸 책으로 엮어 줘')).toBe('book');
  });

  it('leaves ordinary questions alone', () => {
    expect(name('베트남어 성조는 몇 개야?')).toBeNull();
    expect(name('이 문제가 왜 틀렸는지 설명해 줘')).toBeNull();
    expect(name('책 추천해 줘')).toBeNull();
    expect(name('호찌민 여행 이야기 들려줘')).toBeNull();
    expect(name('네 경험 좀 들려주세요')).toBeNull();
    expect(name('이 문장 들려줘')).toBe('speak');
    expect(name('')).toBeNull();
    expect(name('/quiz 러스트')).toBeNull();
  });

  it('prefers the intent that comes first', () => {
    expect(name('퀴즈 문제를 소리 내어 읽어 줘')).toBe('quiz');
    expect(name('발음 들려주고 퀴즈도 내 줘')).toBe('speak');
  });

  it('matches custom skills by title or name, after builtin intents', () => {
    const own: Skill = { id: 'x', name: 'vocab', title: '단어장 만들기', description: '', prompt: 'p', createdAt: 1, updatedAt: 1 };
    const list = [...skills, own];
    expect(name('오늘 대화로 단어장 만들기 해 줘', list)).toBe('vocab');
    expect(name('vocab 스킬로 정리', list)).toBe('vocab');
    expect(name('vocabulary가 뭐야', list)).toBeNull();
    expect(name('단어장 만들기 하고 퀴즈 내 줘', list)).toBe('quiz');
    // 지운 기본 스킬은 고르지 않는다
    expect(name('퀴즈 내 줘', list.filter((s) => s.name !== 'quiz'))).toBeNull();
  });
});
