/**
 * 퀴즈 블록 (IMP-17, ADR-048).
 * /quiz 스킬 답변의 ```quiz 코드 블록(JSON)을 문제 목록으로 읽고, 학습자 답을 채점한다.
 * 모델 출력은 그대로 믿지 않는다: 형식이 틀린 문제는 빼고, 쓸 만한 문제가 없으면 null.
 */

export type QuizQuestion =
  | { type: 'ox'; question: string; answer: boolean; explanation: string }
  | { type: 'choice'; question: string; choices: string[]; /** 0부터 */ answer: number; explanation: string }
  | { type: 'short'; question: string; /** 대표 정답 + 인정 답 */ answers: string[]; explanation: string };

export interface Quiz {
  title: string;
  questions: QuizQuestion[];
}

export type QuizAnswer = boolean | number | string;

/** 코드 블록 언어 이름 */
export const QUIZ_LANG = 'quiz';

export const QUIZ_LIMITS = { questions: 30, choices: 8, text: 2000 } as const;

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim().slice(0, QUIZ_LIMITS.text) : null);

function oxValue(v: unknown): boolean | null {
  if (typeof v === 'boolean') return v;
  if (typeof v !== 'string') return null;
  const s = v.trim().toUpperCase();
  if (['O', 'TRUE', '참', '맞다', '맞음', 'ㅇ'].includes(s)) return true;
  if (['X', 'FALSE', '거짓', '틀리다', '틀림', 'ㅌ'].includes(s)) return false;
  return null;
}

function parseQuestion(raw: unknown): QuizQuestion | null {
  if (!raw || typeof raw !== 'object') return null;
  const q = raw as Record<string, unknown>;
  const question = str(q.question);
  if (!question) return null;
  const explanation = str(q.explanation) ?? '';
  const type = typeof q.type === 'string' ? q.type.trim().toLowerCase() : '';
  if (type === 'ox') {
    const answer = oxValue(q.answer);
    return answer === null ? null : { type, question, answer, explanation };
  }
  if (type === 'choice') {
    if (!Array.isArray(q.choices)) return null;
    const choices = q.choices.map(str);
    if (choices.length < 2 || choices.length > QUIZ_LIMITS.choices || choices.some((c) => c === null)) return null;
    const list = choices as string[];
    let answer = -1;
    // 정답은 1부터 센 번호. 보기 문장 그대로 쓴 경우도 받는다
    if (typeof q.answer === 'number' && Number.isInteger(q.answer)) answer = q.answer - 1;
    else if (typeof q.answer === 'string') {
      const n = /^\s*(\d+)\s*(?:번)?\s*$/.exec(q.answer);
      answer = n ? Number(n[1]) - 1 : list.indexOf(q.answer.trim());
    }
    return answer >= 0 && answer < list.length ? { type, question, choices: list, answer, explanation } : null;
  }
  if (type === 'short') {
    const first = str(q.answer);
    const accept = Array.isArray(q.accept) ? q.accept.map(str).filter((a): a is string => !!a) : [];
    if (!first) return null;
    return { type, question, answers: [first, ...accept.filter((a) => a !== first)], explanation };
  }
  return null;
}

/** ```quiz 블록 본문(JSON)을 퀴즈로 읽는다. 문제가 하나도 없으면 null */
export function parseQuiz(source: string): Quiz | null {
  let data: unknown;
  try {
    data = JSON.parse(source.trim());
  } catch {
    return null;
  }
  // 문제 배열만 쓴 경우도 받는다
  const obj = (Array.isArray(data) ? { questions: data } : data) as Record<string, unknown> | null;
  if (!obj || typeof obj !== 'object' || !Array.isArray(obj.questions)) return null;
  const questions = obj.questions
    .slice(0, QUIZ_LIMITS.questions)
    .map(parseQuestion)
    .filter((q): q is QuizQuestion => !!q);
  if (!questions.length) return null;
  return { title: str(obj.title) ?? '퀴즈', questions };
}

/** 주관식 비교용: 대소문자·공백·문장부호·따옴표를 무시한다 */
export function normalizeShortAnswer(s: string): string {
  return s
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s.,!?;:'"`’‘“”()[\]{}<>「」『』·~-]/g, '');
}

/** 학습자 답이 맞았는지 */
export function gradeQuiz(q: QuizQuestion, answer: QuizAnswer): boolean {
  if (q.type === 'ox') return answer === q.answer;
  if (q.type === 'choice') return answer === q.answer;
  if (typeof answer !== 'string') return false;
  const a = normalizeShortAnswer(answer);
  return !!a && q.answers.some((x) => normalizeShortAnswer(x) === a);
}

/** 정답 표시 문구 */
export function quizAnswerLabel(q: QuizQuestion): string {
  if (q.type === 'ox') return q.answer ? 'O' : 'X';
  if (q.type === 'choice') return `${q.answer + 1}. ${q.choices[q.answer]}`;
  return q.answers[0]!;
}
