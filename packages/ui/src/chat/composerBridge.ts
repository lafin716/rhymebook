import type { ID } from '@branch/core';

/** 열려 있는 입력창에 글을 넣는 함수 (세션별. 같은 세션 입력창이 여럿이면 마지막에 열린 것) */
type Insert = (text: string) => void;
const inserts = new Map<ID, Insert[]>();

/** 입력창이 열릴 때 등록하고, 반환 함수로 해제한다 */
export function registerComposer(sessionId: ID, insert: Insert): () => void {
  const list = inserts.get(sessionId) ?? [];
  list.push(insert);
  inserts.set(sessionId, list);
  return () => {
    const cur = inserts.get(sessionId)?.filter((f) => f !== insert) ?? [];
    if (cur.length) inserts.set(sessionId, cur);
    else inserts.delete(sessionId);
  };
}

export const hasComposer = (sessionId: ID) => !!inserts.get(sessionId)?.length;

/** 선택한 글을 그 세션 입력창에 인용으로 붙인다. 입력창이 없으면 false */
export function quoteToComposer(sessionId: ID, text: string): boolean {
  const insert = inserts.get(sessionId)?.at(-1);
  if (!insert) return false;
  insert(toQuote(text));
  return true;
}

/** 마크다운 인용 블록 (순수 함수, 테스트용 export) */
export function toQuote(text: string): string {
  return text
    .trim()
    .split(/\r?\n/)
    .map((line) => (line.trim() ? `> ${line}` : '>'))
    .join('\n');
}
