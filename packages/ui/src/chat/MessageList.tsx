import type { ID, Session } from '@branch/core';
import { useMemo } from 'react';
import { useApp } from '../app/store';
import { MessageItem } from './MessageItem';

const NONE: Session[] = [];

export function MessageList({ sessionId }: { sessionId: ID }) {
  const messages = useApp((s) => s.messages[sessionId]);
  const sessions = useApp((s) => s.sessions);

  // 이 세션의 자식 가지를 앵커 메시지별로 묶는다 (앵커 위치 → 생성 순)
  const byMessage = useMemo(() => {
    const map = new Map<ID, Session[]>();
    for (const s of Object.values(sessions)) {
      if (s.parentId !== sessionId || !s.anchor) continue;
      const list = map.get(s.anchor.messageId) ?? [];
      list.push(s);
      map.set(s.anchor.messageId, list);
    }
    for (const list of map.values())
      list.sort((a, b) => a.anchor!.startOffset - b.anchor!.startOffset || a.createdAt - b.createdAt);
    return map;
  }, [sessions, sessionId]);

  if (!messages?.length) return null;
  return (
    <div className="space-y-6">
      {messages.map((m, i) => (
        <MessageItem key={m.id} message={m} branches={byMessage.get(m.id) ?? NONE} isLast={i === messages.length - 1} />
      ))}
    </div>
  );
}
