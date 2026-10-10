import type { ID, Message, MessageStatus } from './model';

/** 세션 내 "질문 1개 + 이어지는 답변"의 묶음 (대화 목차/질문 이동용) */
export interface Turn {
  /** 0부터 */
  index: number;
  questionId: ID;
  question: string;
  answerId?: ID;
  /** 답변의 마크다운을 걷어낸 한 줄 미리보기 */
  answerPreview: string;
  answerStatus?: MessageStatus;
}

/** 마크다운을 대략적으로 걷어내 한 줄 평문으로 만든다 (목차 미리보기용) */
export function plainPreview(md: string, max = 90): string {
  const text = md
    .replace(/```[\s\S]*?(```|$)/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+[.)])\s+/gm, '')
    .replace(/^\s*\|?[-:| ]+\|[-:| ]*$/gm, ' ')
    .replace(/\|/g, ' ')
    .replace(/(\*\*|__|\*|_|~~)(?=\S)([^*_~]*?\S)\1/g, '$2')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

/** 메시지 목록을 질문 단위로 묶는다. 질문 앞에 온 assistant 메시지는 목차에서 제외 */
export function buildTurns(messages: readonly Message[]): Turn[] {
  const turns: Turn[] = [];
  for (const m of messages) {
    if (m.role === 'user') {
      turns.push({ index: turns.length, questionId: m.id, question: m.content.trim(), answerPreview: '' });
      continue;
    }
    const cur = turns.at(-1);
    if (m.role !== 'assistant' || !cur || cur.answerId) continue;
    cur.answerId = m.id;
    cur.answerPreview = plainPreview(m.content);
    if (m.status) cur.answerStatus = m.status;
  }
  return turns;
}
