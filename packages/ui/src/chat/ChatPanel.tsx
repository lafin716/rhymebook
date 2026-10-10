import type { ID } from '@branch/core';
import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react';
import { useApp } from '../app/store';
import { cn } from '../lib/cn';
import { ChatNav } from './ChatNav';
import { Composer } from './Composer';
import { EmptyChat } from './EmptyChat';
import { MessageList } from './MessageList';
import { SessionHeader } from './SessionHeader';
import { SummaryDraftPanel } from './SummaryDraftPanel';

export type PanelVariant = 'main' | 'pane' | 'popup' | 'sheet';

export interface ChatPanelProps {
  sessionId: ID;
  variant?: PanelVariant;
  headerActions?: ReactNode;
  handleClassName?: string;
  className?: string;
}

/** 하나의 세션을 보여주는 패널 (단일/분할/팝업/시트에서 공통 사용) */
export function ChatPanel({ sessionId, variant = 'main', headerActions, handleClassName, className }: ChatPanelProps) {
  const exists = useApp((s) => !!s.sessions[sessionId]);
  const count = useApp((s) => s.messages[sessionId]?.length ?? 0);
  const lastLen = useApp((s) => {
    const list = s.messages[sessionId];
    return list?.length ? list[list.length - 1]!.content.length : 0;
  });
  const lastStatus = useApp((s) => s.messages[sessionId]?.at(-1)?.status);
  const compact = variant !== 'main';
  const scrollRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  // 세션이 바뀌면 맨 아래로
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
    stick.current = true;
  }, [sessionId]);

  // 바닥 근처일 때만 새 내용에 따라 내려간다
  useEffect(() => {
    const el = scrollRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [count, lastLen, lastStatus]);

  // 오류 카드·오프라인 배너 등으로 크기가 바뀌어도 바닥에 붙어 있으면 유지
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      if (stick.current) el.scrollTop = el.scrollHeight;
    });
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    return () => ro.disconnect();
  }, [exists]);

  if (!exists) return null;
  return (
    <section
      className={cn('flex h-full min-h-0 min-w-0 flex-col bg-bg', className)}
      data-panel={variant}
      aria-label="대화"
    >
      <SessionHeader sessionId={sessionId} compact={compact} actions={headerActions} handleClassName={handleClassName} />
      <div className="@container relative min-h-0 flex-1">
        <div
        ref={scrollRef}
        data-scroll=""
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
        }}
        className={cn('scroll-thin h-full overflow-y-auto overscroll-contain', compact ? 'px-3.5 py-4' : 'px-4 py-6 md:px-6')}
        >
          <div className="mx-auto max-w-3xl">
            {count === 0 ? <EmptyChat sessionId={sessionId} compact={compact} /> : <MessageList sessionId={sessionId} />}
          </div>
        </div>
        <ChatNav
          sessionId={sessionId}
          scrollRef={scrollRef}
          keyboard={variant === 'main'}
          rail={variant === 'main' || variant === 'pane'}
        />
      </div>
      <SummaryDraftPanel sessionId={sessionId} compact={compact} />
      <Composer sessionId={sessionId} compact={compact} />
    </section>
  );
}
