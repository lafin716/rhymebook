import { t } from '../i18n';
import { nextFallback, PROVIDER_LABELS, annotationsForMessage, planBranchSuggestions, stripBranchBlock, type Message, type SegmentMap, type Session, type SkillRef } from '@branch/core';
import { AlertTriangle, Archive, CalendarClock, RefreshCw, RotateCcw, Shuffle, Sparkles, Square } from 'lucide-react';
import { memo, useCallback, useLayoutEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { actions, useApp } from '../app/store';
import { Button } from '../components/Button';
import { cn } from '../lib/cn';
import type { AnchorMark } from './anchorPlugin';
import { AttachmentList } from './Attachments';
import { BranchSuggestContext, BranchSuggestions, type BranchSuggestValue } from './BranchSuggest';
import { Markdown } from './Markdown';
import { openBranch } from './open';
import { setSegmentMap } from './segmentRegistry';
import { ToolActivityList } from './ToolActivityList';
import { CitationChips } from '../knowledge/CitationChips';
import { BranchChips, SummaryCard } from './SummaryCard';
import { AnnotationPopover } from './AnnotationPopover';
import { RegionGutter } from './RegionGutter';
import { saveToVault } from '../vault/save';

export interface MessageItemProps {
  message: Message;
  /** 이 메시지를 앵커로 가진 가지들 (생성 순) */
  branches: Session[];
  isLast: boolean;
  /** 답변: 이 답변을 부른 질문에 쓴 스킬 (답변 위에 표시) */
  skill?: SkillRef;
}

const FALLBACK_CODES = new Set(['offline', 'auth', 'cli']);

export const MessageItem = memo(function MessageItem({ message, branches, isLast, skill }: MessageItemProps) {
  if (message.role === 'user') {
    const files = message.attachments ?? [];
    // 스킬만 고르고 비워 보낸 질문은 본문이 스킬 제목이다
    const body = message.skill && message.content === message.skill.title ? '' : message.content;
    return (
      <div data-turn={message.id} tabIndex={-1} className="flex scroll-mt-3 flex-col items-end gap-1.5 focus:outline-none">
        {(message.scheduleRun || message.skill || message.taskSkill) && <div className="flex flex-wrap justify-end gap-1">
        {message.scheduleRun && (
          <span data-schedule-run-badge title={t('chat.message.scheduleRunTitle')} className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2 py-0.5 text-[12px] font-medium text-fg-2">
            <CalendarClock size={12} />
            {t('chat.message.scheduleRun')}
          </span>
        )}
        {message.skill && (
          <span data-skill-badge={message.skill.name} title={t('chat.message.skillTitle', { name: message.skill.name })} className="inline-flex items-center gap-1 rounded-full bg-accent-soft px-2 py-0.5 text-[12px] font-medium text-accent">
            <Sparkles size={12} />
            {message.skill.title}
          </span>
        )}
        {message.taskSkill && (
          <span data-task-skill-badge={message.taskSkill.name} title={t('chat.composer.scheduleTaskSkill')} className="inline-flex items-center gap-1 rounded-full bg-accent-soft px-2 py-0.5 text-[12px] font-medium text-accent">
            <CalendarClock size={12} />
            {message.taskSkill.title}
          </span>
        )}
        </div>}
        {files.length > 0 && <AttachmentList items={files} align="end" className="max-w-[85%]" />}
        {body && (
          <div className="max-w-[85%] rounded-2xl rounded-br-md bg-accent-soft px-3.5 py-2 text-[15px] leading-relaxed whitespace-pre-wrap text-fg">
            {body}
          </div>
        )}
      </div>
    );
  }
  return <AssistantMessage message={message} branches={branches} isLast={isLast} skill={skill} />;
});

export function AssistantMessage({ message, branches, isLast, skill }: MessageItemProps) {
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

  // 추천 가지: 챕터 버튼 + 아래 칩 (다 받은 답변만, ADR-094)
  const plan = useMemo(() => (streaming ? null : planBranchSuggestions(message.content)), [message.content, streaming]);
  const suggest = useMemo<BranchSuggestValue | null>(
    () => (plan?.chapters.length ? { sessionId: message.sessionId, messageId: message.id, chapters: plan.chapters, branches } : null),
    [plan, message.sessionId, message.id, branches],
  );

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
      {skill && (
        <div
          data-skill-active={skill.name}
          title={t('chat.message.skillTitle', { name: skill.name })}
          className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-accent/30 bg-accent-soft px-2.5 py-0.5 text-[12px] font-medium text-accent"
        >
          <Sparkles size={12} className="shrink-0" />
          <span className="truncate">{t('chat.message.skillActive', { title: skill.title })}</span>
        </div>
      )}
      {tools.length > 0 && <ToolActivityList tools={tools} />}
      {streaming && !message.content ? (
        // 도구가 돌고 있으면 그 줄이 진행 표시다
        tools.some((t) => t.status === 'running') ? null : (
          <div className="flex items-center gap-2 py-1 text-[14px] text-muted">
            <span className="stream-caret" />
            {t('chat.message.thinking')}
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
            <BranchSuggestContext.Provider value={suggest}>
              <Markdown
                content={message.content}
                messageId={message.id}
                anchors={streaming ? undefined : anchors}
                annotations={streaming ? undefined : annotations}
                onMap={onMap}
                streaming={streaming}
              />
            </BranchSuggestContext.Provider>
          </div>
          {!streaming && <RegionGutter target={ref} />}
        </div>
      )}

      {!streaming && message.citations?.length ? <CitationChips citations={message.citations} /> : null}
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
          <Square size={12} /> {t('chat.message.stopped')}
          {isLast && (
            <Button size="sm" variant="ghost" icon={<RotateCcw size={14} />} onClick={() => actions().retry(message.sessionId)}>
              {t('chat.message.regenerate')}
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
      {plan && <BranchSuggestions sessionId={message.sessionId} items={plan.next} />}
      {!streaming && message.content.trim() && (
        <div className="-mt-1 flex opacity-0 transition-opacity group-hover/msg:opacity-100 focus-within:opacity-100 pointer-coarse:opacity-100">
          <Button
            size="sm"
            variant="ghost"
            data-vault-save
            icon={<Archive size={14} />}
            className="text-muted"
            onClick={() => saveToVault({ type: 'text', text: stripBranchBlock(message.content) }, message.id)}
          >
            {t('chat.message.keep')}
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
          <div className="font-medium">{t('chat.message.failed')}</div>
          <div className="mt-0.5 text-fg-2">
            {message.error?.message}
            {message.providerId && <span className="text-muted"> · {PROVIDER_LABELS[message.providerId]}</span>}
          </div>
        </div>
      </div>
      {canRetry && (
        <div className="mt-2 flex flex-wrap gap-1.5 pl-6">
          <Button size="sm" icon={<RefreshCw size={14} />} onClick={() => actions().retry(message.sessionId)}>
            {t('chat.message.retry')}
          </Button>
          {fallback && (
            <Button size="sm" variant="soft" icon={<Shuffle size={14} />} onClick={() => actions().retry(message.sessionId, fallback)}>
              {t('chat.message.retryWith', { provider: PROVIDER_LABELS[fallback] })}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
