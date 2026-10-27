import type { ID, Message, Session } from './model';

export type SessionMap = Record<ID, Session>;

/** 루트부터 대상까지의 경로 (대상 포함) */
export function pathToRoot(sessions: SessionMap, id: ID): Session[] {
  const path: Session[] = [];
  const seen = new Set<ID>();
  let cur: Session | undefined = sessions[id];
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    path.unshift(cur);
    cur = cur.parentId ? sessions[cur.parentId] : undefined;
  }
  return path;
}

export function childrenOf(sessions: SessionMap, parentId: ID | null): Session[] {
  return Object.values(sessions)
    .filter((s) => s.parentId === parentId)
    .sort((a, b) => a.createdAt - b.createdAt);
}

export function rootSessions(sessions: SessionMap): Session[] {
  return childrenOf(sessions, null).sort((a, b) => b.updatedAt - a.updatedAt);
}

type MessageMap = Record<ID, readonly Message[] | undefined>;

/**
 * 아직 대화를 시작하지 않은 루트 대화(초안) id. 목록·검색에 보이지 않고 첫 메시지를 보내면 나타난다 (ADR-074).
 * 원격 모드처럼 메시지를 아직 불러오지 않은 세션은 초안으로 보지 않는다.
 */
export function draftSessionIds(sessions: SessionMap, messages: MessageMap): Set<ID> {
  const parents = new Set(Object.values(sessions).map((s) => s.parentId));
  const out = new Set<ID>();
  for (const s of Object.values(sessions)) {
    if (s.parentId === null && s.kind !== 'page' && messages[s.id]?.length === 0 && !parents.has(s.id)) out.add(s.id);
  }
  return out;
}

/** 사이드바에 보이는 루트 세션 (초안 제외, 최근 순) */
export function listedRootSessions(sessions: SessionMap, messages: MessageMap): Session[] {
  const drafts = draftSessionIds(sessions, messages);
  return rootSessions(sessions).filter((r) => !drafts.has(r.id));
}

/** 다시 쓸 초안 (가장 최근에 만든 것) */
export function findDraftSession(sessions: SessionMap, messages: MessageMap): ID | undefined {
  const drafts = draftSessionIds(sessions, messages);
  return [...drafts].map((id) => sessions[id]!).sort((a, b) => b.createdAt - a.createdAt)[0]?.id;
}

/** 자기 자신을 포함한 모든 자손 id (DFS 순서) */
export function descendantIds(sessions: SessionMap, id: ID): ID[] {
  const out: ID[] = [];
  const walk = (cur: ID) => {
    out.push(cur);
    for (const c of childrenOf(sessions, cur)) walk(c.id);
  };
  if (sessions[id]) walk(id);
  return out;
}

export function depthOf(sessions: SessionMap, id: ID): number {
  return Math.max(0, pathToRoot(sessions, id).length - 1);
}

/** 특정 메시지에서 파생된 자식 가지들 */
export function branchesOfMessage(sessions: SessionMap, messageId: ID): Session[] {
  return Object.values(sessions)
    .filter((s) => s.anchor?.messageId === messageId)
    .sort((a, b) => (a.anchor!.startOffset - b.anchor!.startOffset) || a.createdAt - b.createdAt);
}

/** 직접 만든 하위 세션 제목: 질문 첫 줄 앞 24자 */
export function subSessionTitle(question: string): string {
  const line = question.trim().split('\n')[0]!.replace(/\s+/g, ' ');
  return line.length > 24 ? `${line.slice(0, 24)}…` : line;
}

/** 앵커 없이 직접 만든 하위 세션(각주). 만든 순서 */
export function footnoteChildren(sessions: SessionMap, parentId: ID): Session[] {
  return childrenOf(sessions, parentId).filter((s) => !s.anchor);
}

export interface BreadcrumbItem {
  id: ID;
  title: string;
  /** 생략 표시용 */
  ellipsis?: boolean;
}

/** 루트 > … > 현재. maxItems를 넘으면 루트와 마지막 (maxItems-2)개만 남기고 가운데를 생략 */
export function breadcrumb(sessions: SessionMap, id: ID, maxItems = 4): BreadcrumbItem[] {
  const path = pathToRoot(sessions, id).map((s) => ({ id: s.id, title: s.title }));
  if (path.length <= maxItems) return path;
  const tail = path.slice(path.length - (maxItems - 2));
  const hidden = path[path.length - tail.length - 1]!;
  return [path[0]!, { id: hidden.id, title: '…', ellipsis: true }, ...tail];
}
