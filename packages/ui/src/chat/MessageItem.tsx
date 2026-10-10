import { nextFallback, PROVIDER_LABELS, type Message, type SegmentMap, type Session } from '@branch/core';
import { AlertTriangle, RefreshCw, RotateCcw, Shuffle, Square } from 'lucide-react';
import { memo, useCallback, useLayoutEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { actions, useApp } from '../app/store';
import { Button } from '../components/Button';
import { cn } from '../lib/cn';
import type { AnchorMark } from './anchorPlugin';
import { Markdown } from './Markdown';
import { openBranch } from './open';
import { setSegmentMap } from './segmentRegistry';
import { BranchChips, SummaryCard } from './SummaryCard';

export interface MessageItemProps {
  message: Message;
  /** 이 메시지를 앵커로 가진 가지들 (생성 순) */
  branches: Session[];
  isLast: boolean;
}

const FALLBACK_CODES = new Set(['offline', 'auth', 'cli']);

export const MessageItem = memo(function MessageItem({ message, branches, isLast }: MessageItemProps) {
  if (message.role === 'user') {
    return (
      <div className="flex justify-end">
        <div
          data-turn={message.id}
          tabIndex={-1}
          className="max-w-[85%] scroll-mt-3 rounded-2xl rounded-br-md bg-accent-soft px-3.5 py-2 text-[15px] leading-relaxed whitespace-pre-wrap text-fg focus:outline-none"
        >
          {message.content}
        </div>
      </div>
    );
  }
  return <AssistantMessage message={message} branches={branches} isLast={isLast} />;
});

function AssistantMessage({ message, branches, isLast }: MessageItemProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [unlocated, setUnlocated] = useState<Set<string>>(new Set());
  const streaming = message.status === 'streaming';

  const anchors = useMemo<AnchorMark[]>(
    () =>
      branches
        .filter((b) => b.anchor)
        .map((b) => ({ sessionId: b.id, text: b.anchor!.text, startOffset: b.anchor!.startOffset, hasSummary: !!b.summary })),
    [branches],
  );
  const onMap = useCallback((map: SegmentMap) => setSegmentMap(message.id, map), [message.id]);

  // 렌더 후 DOM에서 실제로 하이라이트된 앵커를 확인 (원문이 바뀌어 못 찾은 앵커 표시)
  const anchorKey = anchors.map((a) => a.sessionId).join('|');
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || streaming) return;
    const found = new Set(Array.from(el.querySelectorAll<HTMLElement>('mark[data-session-ids]')).flatMap((m) => m.dataset.sessionIds!.split(' ')));
    const missing = anchors.filter((a) => !found.has(a.sessionId)).map((a) => a.sessionId);
    setUnlocated((prev) => (prev.size === missing.length && missing.every((m) => prev.has(m)) ? prev : new Set(missing)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchorKey, message.content, streaming]);

  const onClick = (e: MouseEvent) => {
    const mark = (e.target as Element).closest<HTMLElement>('mark.anchor');
    if (!mark?.dataset.sessionId) return;
    if (!window.getSelection()?.isCollapsed) return;
    openBranch(mark.dataset.sessionId);
  };

  const summaries = branches.filter((b) => b.summary);

  return (
    <div className="group/msg space-y-2.5">
      {streaming && !message.content ? (
        <div className="flex items-center gap-2 py-1 text-[14px] text-muted">
          <span className="stream-caret" />
          생각 중…
        </div>
      ) : (
        <div
          ref={ref}
          className={cn('md', streaming && 'is-streaming')}
          data-anchorable={streaming ? undefined : ''}
          data-message-id={message.id}
          data-session-id={message.sessionId}
          onClick={onClick}
        >
          <Markdown content={message.content} anchors={streaming ? undefined : anchors} onMap={onMap} />
        </div>
      )}

      {message.status === 'error' && <ErrorBox message={message} canRetry={isLast} />}
      {message.status === 'stopped' && (
        <div className="flex items-center gap-2 text-[13px] text-muted">
          <Square size={12} /> 응답을 중지했습니다.
          {isLast && (
            <Button size="sm" variant="ghost" icon={<RotateCcw size={14} />} onClick={() => actions().retry(message.sessionId)}>
              다시 생성
            </Button>
          )}
        </div>
      )}

      {summaries.length > 0 && (
        <div className="space-y-2">
          {summaries.map((b) => (
            <SummaryCard key={b.id} session={b} />
          ))}
        </div>
      )}
      <BranchChips branches={branches} unlocated={unlocated} />
    </div>
  );
}

function ErrorBox({ message, canRetry }: { message: Message; canRetry: boolean }) {
  const code = message.error?.code ?? 'unknown';
  const fallback = useApp((s) => (FALLBACK_CODES.has(code) ? nextFallback(s, message.providerId ?? 'mock') : null));
  return (
    <div role="alert" className="rounded-xl border border-danger/30 bg-danger-soft px-3 py-2.5 text-[13.5px]">
      <div className="flex items-start gap-2 text-danger">
        <AlertTriangle size={16} className="mt-0.5 shrink-0" />
        <div className="min-w-0">
          <div className="font-medium">응답을 받지 못했습니다</div>
          <div className="mt-0.5 text-fg-2">
            {message.error?.message}
            {message.providerId && <span className="text-muted"> · {PROVIDER_LABELS[message.providerId]}</span>}
          </div>
        </div>
      </div>
      {canRetry && (
        <div className="mt-2 flex flex-wrap gap-1.5 pl-6">
          <Button size="sm" icon={<RefreshCw size={14} />} onClick={() => actions().retry(message.sessionId)}>
            다시 시도
          </Button>
          {fallback && (
            <Button size="sm" variant="soft" icon={<Shuffle size={14} />} onClick={() => actions().retry(message.sessionId, fallback)}>
              {PROVIDER_LABELS[fallback]}로 재시도
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
