import { describe, expect, it } from 'vitest';
import { mockAnswer } from '../src/providers/mock';
import { gradeQuiz, normalizeShortAnswer, parseQuiz, quizAnswerLabel } from '../src/quiz';
import { defaultSkills, withSkill, skillRef, QUIZ_SKILL_ID } from '../src/skills';

const sample = JSON.stringify({
  title: '어텐션',
  questions: [
    { type: 'ox', question: 'Q·K 내적', answer: true, explanation: '맞다' },
    { type: 'choice', question: '왜 나누나', choices: ['a', 'b', 'c', 'd'], answer: 2, explanation: 'b' },
    { type: 'short', question: '가중합 대상', answer: 'Value', accept: ['V', '밸류'], explanation: '' },
  ],
});

describe('parseQuiz', () => {
  it('reads the three question types', () => {
    const quiz = parseQuiz(sample)!;
    expect(quiz.title).toBe('어텐션');
    expect(quiz.questions.map((q) => q.type)).toEqual(['ox', 'choice', 'short']);
    const choice = quiz.questions[1]!;
    expect(choice.type === 'choice' && choice.answer).toBe(1); // 1부터 센 번호 → 0부터
    const short = quiz.questions[2]!;
    expect(short.type === 'short' && short.answers).toEqual(['Value', 'V', '밸류']);
  });

  it('accepts loose answer forms', () => {
    const quiz = parseQuiz(
      JSON.stringify([
        { type: 'OX', question: 'q', answer: 'X' },
        { type: 'choice', question: 'q', choices: ['가', '나'], answer: '나' },
        { type: 'choice', question: 'q', choices: ['가', '나'], answer: '1번' },
      ]),
    )!;
    expect(quiz.title).toBe('퀴즈');
    expect(quiz.questions.map((q) => ('answer' in q ? q.answer : null))).toEqual([false, 1, 0]);
    expect(quiz.questions[0]!.explanation).toBe('');
  });

  it('drops malformed questions and rejects unusable input', () => {
    const quiz = parseQuiz(
      JSON.stringify({
        questions: [
          { type: 'choice', question: 'q', choices: ['a', 'b'], answer: 3 },
          { type: 'choice', question: 'q', choices: ['a'], answer: 1 },
          { type: 'ox', question: 'q', answer: 'maybe' },
          { type: 'short', question: '', answer: 'a' },
          { type: 'essay', question: 'q', answer: 'a' },
          { type: 'short', question: 'ok', answer: 'a' },
        ],
      }),
    )!;
    expect(quiz.questions).toHaveLength(1);
    expect(parseQuiz('{"questions": [')).toBeNull();
    expect(parseQuiz('{"questions": []}')).toBeNull();
    expect(parseQuiz('null')).toBeNull();
    expect(parseQuiz('"text"')).toBeNull();
  });
});

describe('gradeQuiz', () => {
  const [ox, choice, short] = parseQuiz(sample)!.questions as [never, never, never];
  it('grades each type', () => {
    expect(gradeQuiz(ox, true)).toBe(true);
    expect(gradeQuiz(ox, false)).toBe(false);
    expect(gradeQuiz(choice, 1)).toBe(true);
    expect(gradeQuiz(choice, 0)).toBe(false);
    expect(gradeQuiz(short, ' value. ')).toBe(true);
    expect(gradeQuiz(short, '밸 류')).toBe(true);
    expect(gradeQuiz(short, 'Key')).toBe(false);
    expect(gradeQuiz(short, '  ')).toBe(false);
  });

  it('labels the correct answer', () => {
    expect(quizAnswerLabel(ox)).toBe('O');
    expect(quizAnswerLabel(choice)).toBe('2. b');
    expect(quizAnswerLabel(short)).toBe('Value');
    expect(normalizeShortAnswer('“Self-Attention”!')).toBe('selfattention');
  });
});

describe('/quiz skill', () => {
  it('is a builtin skill whose mock answer is a valid quiz block', () => {
    const skill = defaultSkills().find((s) => s.id === QUIZ_SKILL_ID)!;
    expect(skill.name).toBe('quiz');
    const system = withSkill('기본 지시', skillRef(skill));
    const answer = mockAnswer({ purpose: 'chat', system, messages: [{ role: 'user', content: '어텐션' }] } as never);
    const block = /```quiz\n([\s\S]*?)\n```/.exec(answer)?.[1];
    const quiz = parseQuiz(block ?? '')!;
    expect(quiz.questions.map((q) => q.type)).toEqual(['ox', 'choice', 'short']);
    expect(quiz.questions[1]!.question).toContain('\\sqrt');
  });
});
