import type { Message, Session } from './model';

/** 마크다운 페이지 세션인가 (ADR-072) */
export const isPage = (s: Pick<Session, 'kind'> | undefined): boolean => s?.kind === 'page';

/** 페이지 본문 문서 메시지 — 페이지 세션의 첫 번째 assistant 메시지 */
export const pageDoc = (messages: readonly Message[] | undefined): Message | undefined =>
  messages?.find((m) => m.role === 'assistant');
