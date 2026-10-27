import { nextFallback, PROVIDER_LABELS, annotationsForMessage, type Message, type SegmentMap, type Session } from '@branch/core';
import { AlertTriangle, Archive, RefreshCw, RotateCcw, Shuffle, Sparkles, Square } from 'lucide-react';
import { memo, useCallback, useLayoutEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { actions, useApp } from '../app/store';
import { Button } from '../components/Button';
import { cn } from '../lib/cn';
import type { AnchorMark } from './anchorPlugin';
import { AttachmentList } from './Attachments';
import { Markdown } from './Markdown';
import { openBranch } from './open';
import { setSegmentMap } from './segmentRegistry';
import { ToolActivityList } from './ToolActivityList';
import { BranchChips, SummaryCard } from './SummaryCard';
import { AnnotationPopover } from './AnnotationPopover';
import { RegionGutter } from './RegionGutter';
import { saveToVault } from '../vault/save';

export interface MessageItemProps {
  message: Message;
  /** 이 메시지를 앵커로 가진 가지들 (생성 순) */
  branches: Session[];
  isLast: boolean;
}

const FALLBACK_CODES = new Set(['offline', 'auth', 'cli']);

export const MessageItem = memo(function MessageItem({ message, branches, isLast }: MessageItemProps) {
  if (message.role === 'user') {
    const files = message.attachments ?? [];
    // 스킬만 고르고 비워 보낸 질문은 본문이 스킬 제목이다
    const body = message.skill && message.content === message.skill.title ? '' : message.content;
    return (
      <div data-turn={message.id} tabIndex={-1} className="flex scroll-mt-3 flex-col items-end gap-1.5 focus:outline-none">
        {message.skill && (
          <span data-skill-badge={message.skill.name} title={`스킬: /${message.skill.name}`} className="inline-flex items-center gap-1 rounded-full bg-accent-soft px-2 py-0.5 text-[12px] font-medium text-accent">
            <Sparkles size={12} />
            {message.skill.title}
          </span>
        )}
        {files.length > 0 && <AttachmentList items={files} align="end" className="max-w-[85%]" />}
        {body && (
          <div className="max-w-[85%] rounded-2xl rounded-br-md bg-accent-soft px-3.5 py-2 text-[15px] leading-relaxed whitespace-pre-wrap text-fg">
            {body}
          </div>
        )}
      </div>
    );
  }
  return <AssistantMessage message={message} branches={branches} isLast={isLast} />;
});

export function AssistantMessage({ message, branches, isLast }: MessageItemProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [unlocated, setUnlocated] = useState<Set<string>>(new Set());
  const [noteOpen, setNoteOpen] = useState<{ id: string; rect: DOMRect } | null>(null);
  const streaming = message.status === 'streaming';

  const allAnnotations = useApp((s) => s.annotations);
  const annotations = useMemo(
    () => (streaming ? [] : annotationsForMessage(allAnnotations, message.id)),
    [allAnnotations, message.id, streaming],
  );

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
    if (!window.getSelection()?.isCollapsed) return;
    const target = e.target as Element;
    // 가지 하이라이트가 우선. 영역 가지(왼쪽 막대)는 막대로만 연다
    const mark = target.closest<HTMLElement>('mark.anchor');
    if (mark?.dataset.sessionId && mark.dataset.region !== 'true') {
      openBranch(mark.dataset.sessionId);
      return;
    }
    // 메모가 달린 텍스트 → 메모 팝오버
    const span = target.closest<HTMLElement>('span.annot[data-note]');
    const id = span?.dataset.annotIds?.split(' ').find((x) => allAnnotations[x]?.note);
    if (span && id) setNoteOpen({ id, rect: span.getBoundingClientRect() });
  };

  const summaries = branches.filter((b) => b.summary);
  const images = message.attachments?.filter((a) => a.kind === 'image') ?? [];
  const tools = message.tools ?? [];

  return (
    <div className="group/msg space-y-2.5">
      {tools.length > 0 && <ToolActivityList tools={tools} />}
      {streaming && !message.content ? (
        // 도구가 돌고 있으면 그 줄이 진행 표시다
        tools.some((t) => t.status === 'running') ? null : (
          <div className="flex items-center gap-2 py-1 text-[14px] text-muted">
            <span className="stream-caret" />
            생각 중…
          </div>
        )
      ) : !message.content && images.length ? null : (
        <div className="relative">
          <div
            ref={ref}
            className={cn('md', streaming && 'is-streaming')}
            data-anchorable={streaming ? undefined : ''}
            data-message-id={message.id}
            data-session-id={message.sessionId}
            onClick={onClick}
          >
            <Markdown
              content={message.content}
              messageId={message.id}
              anchors={streaming ? undefined : anchors}
              annotations={streaming ? undefined : annotations}
              onMap={onMap}
              streaming={streaming}
            />
          </div>
          {!streaming && <RegionGutter target={ref} />}
        </div>
      )}

      {images.length > 0 && <AttachmentList items={images} large messageId={message.id} />}

      {noteOpen && allAnnotations[noteOpen.id] && (
        <AnnotationPopover
          annotation={allAnnotations[noteOpen.id]!}
          rect={noteOpen.rect}
          onClose={() => setNoteOpen(null)}
        />
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
      {!streaming && message.content.trim() && (
        <div className="-mt-1 flex opacity-0 transition-opacity group-hover/msg:opacity-100 focus-within:opacity-100 pointer-coarse:opacity-100">
          <Button
            size="sm"
            variant="ghost"
            data-vault-save
            icon={<Archive size={14} />}
            className="text-muted"
            onClick={() => saveToVault({ type: 'text', text: message.content }, message.id)}
          >
            보관
          </Button>
        </div>
      )}
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
