import type { ID, Message, MessageStatus, Session } from './model';

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
      // 첨부만 보낸 질문은 첨부 이름으로 목차에 보인다
      const question = m.content.trim() || (m.attachments?.length ? `[첨부] ${m.attachments.map((a) => a.name).join(', ')}` : '');
      turns.push({ index: turns.length, questionId: m.id, question, answerPreview: '' });
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

/**
 * 질문 하나를 지울 때 함께 지울 메시지 id: 그 질문 + 다음 질문 전까지의 답변.
 * 세션의 첫 질문은 지울 수 없다(제목·가지 맥락의 기준) → null. 질문이 없어도 null
 */
export function turnMessageIds(messages: readonly Message[], questionId: ID): ID[] | null {
  const start = messages.findIndex((m) => m.id === questionId);
  if (start < 0 || messages[start]!.role !== 'user') return null;
  if (messages.findIndex((m) => m.role === 'user') === start) return null;
  const ids = [questionId];
  for (let i = start + 1; i < messages.length && messages[i]!.role !== 'user'; i++) ids.push(messages[i]!.id);
  return ids;
}

/** 이 질문을 지울 수 있는지 (첫 질문이 아닌 질문) */
export const canDeleteTurn = (messages: readonly Message[], questionId: ID): boolean => turnMessageIds(messages, questionId) !== null;

/** 질문 하나를 하위 세션으로 분리할 때 옮길 것 */
export interface TurnSplitPlan {
  /** 옮길 메시지 id (질문 + 답변) */
  messageIds: ID[];
  /** 새 하위 세션으로 부모를 바꿀 자식 세션: 옮길 답변의 가지, 그 질문을 보던 중 만든 각주 */
  childIds: ID[];
  /** 새 하위 세션 제목의 바탕이 될 질문 글 */
  question: string;
  /** 새 하위 세션의 createdAt: 질문 바로 앞이라 부모 맥락은 그 질문 전까지, 각주 표식은 앞 답변 뒤에 붙는다 */
  createdAt: number;
}

/** 질문 분리 계획. 첫 질문은 분리할 수 없다(deleteTurn과 같은 규칙) → null */
export function planTurnSplit(sessions: Record<ID, Session>, messages: readonly Message[], sessionId: ID, questionId: ID): TurnSplitPlan | null {
  const messageIds = turnMessageIds(messages, questionId);
  if (!messageIds) return null;
  const moved = new Set(messageIds);
  const q = messages.find((m) => m.id === questionId)!;
  const childIds = Object.values(sessions)
    .filter((s) => {
      if (s.parentId !== sessionId) return false;
      if (s.anchor) return moved.has(s.anchor.messageId);
      // 각주는 만든 시점의 마지막 메시지 뒤에 붙는다 (MessageList와 같은 규칙)
      let at: ID | undefined;
      for (const m of messages) if (m.createdAt <= s.createdAt) at = m.id;
      return !!at && moved.has(at);
    })
    .map((s) => s.id);
  const question = q.content.trim() || (q.attachments?.length ? `[첨부] ${q.attachments.map((a) => a.name).join(', ')}` : '분리한 질문');
  return { messageIds, childIds, question, createdAt: q.createdAt - 1 };
}
