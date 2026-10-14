import type { ID, Session } from '@branch/core';
import { useCallback, useMemo, useState, type MouseEvent } from 'react';
import { useApp } from '../app/store';
import type { MenuPoint } from '../session/SessionMenu';
import { MessageItem } from './MessageItem';
import { TurnMenu } from './turnDelete';

const NONE: Session[] = [];

export function MessageList({ sessionId }: { sessionId: ID }) {
  const messages = useApp((s) => s.messages[sessionId]);
  const sessions = useApp((s) => s.sessions);
  const [menu, setMenu] = useState<(MenuPoint & { questionId: ID; first: boolean }) | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);

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

  // 메시지 → 그 메시지가 속한 질문 (질문 앞의 답변은 없음)
  const questionOf = useMemo(() => {
    const map = new Map<ID, ID>();
    let q: ID | undefined;
    for (const m of messages ?? []) {
      if (m.role === 'user') q = m.id;
      if (q) map.set(m.id, q);
    }
    return map;
  }, [messages]);

  /** 질문·답변 우클릭 → 질문 삭제 메뉴. 텍스트를 선택한 상태면 가지 메뉴·기본 메뉴에 양보한다 */
  const onContextMenu = (e: MouseEvent, messageId: ID) => {
    if (e.defaultPrevented || !window.getSelection()?.isCollapsed) return;
    const questionId = questionOf.get(messageId);
    if (!questionId) return;
    e.preventDefault();
    const first = messages?.find((m) => m.role === 'user')?.id === questionId;
    setMenu({ x: e.clientX, y: e.clientY, questionId, first });
  };

  if (!messages?.length) return null;
  return (
    <div className="space-y-6">
      {messages.map((m, i) => (
        <div key={m.id} onContextMenu={(e) => onContextMenu(e, m.id)}>
          <MessageItem message={m} branches={byMessage.get(m.id) ?? NONE} isLast={i === messages.length - 1} />
        </div>
      ))}
      {menu && <TurnMenu at={menu} sessionId={sessionId} questionId={menu.questionId} first={menu.first} onClose={closeMenu} />}
    </div>
  );
}
