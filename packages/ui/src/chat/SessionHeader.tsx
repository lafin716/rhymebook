import { breadcrumb, effectiveProviderId, excerptAround, type ID, type ProviderId } from '@branch/core';
import { ChevronDown, ChevronRight, ChevronUp, Compass, CornerLeftUp, ListRestart, Quote, Sparkles } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { remoteMode } from '../app/capabilities';
import { actions, useApp } from '../app/store';
import { useUi } from '../app/uiState';
import { useBreakpoint } from '../app/useBreakpoint';
import { Badge, StatusDot } from '../components/Badge';
import { IconButton } from '../components/Button';
import { RemoteAgentPicker } from './RemoteAgentPicker';
import { BookPdfButton } from '../book/BookPdfButton';
import { cn } from '../lib/cn';
import { RenameInput } from '../session/SessionMenu';
import { PROVIDER_ORDER, providerLabel, STATUS_LABEL, statusTone } from '../lib/connection';
import { revealAnchor } from './open';
import { reorganizeSession } from './turnActions';

export interface SessionHeaderProps {
  sessionId: ID;
  compact?: boolean;
  /** 우측 버튼 영역 (닫기, 도킹 등) */
  actions?: ReactNode;
  /** 팝업 드래그 핸들용 클래스 */
  handleClassName?: string;
}

export function SessionHeader({ sessionId, compact, actions: extra, handleClassName }: SessionHeaderProps) {
  const session = useApp((s) => s.sessions[sessionId]);
  const sessions = useApp((s) => s.sessions);
  const crumbs = useMemo(
    () => (sessions[sessionId]?.parentId ? breadcrumb(sessions, sessionId, compact ? 3 : 4) : []),
    [sessions, sessionId, compact],
  );
  const anchorMsg = useApp((s) => {
    const a = s.sessions[sessionId]?.anchor;
    const pid = s.sessions[sessionId]?.parentId;
    return a && pid ? s.messages[pid]?.find((m) => m.id === a.messageId) : undefined;
  });
  const hasDraft = useApp((s) => !!s.summaryDrafts[sessionId]);
  const streaming = useApp((s) => !!s.streaming[sessionId]);
  const answered = useApp((s) => !!s.messages[sessionId]?.some((m) => m.role === 'assistant' && m.content.trim()));
  const quoteCollapsed = useUi((s) => s.quoteCollapsed);
  const toggleQuote = useUi((s) => s.toggleQuote);
  const [renaming, setRenaming] = useState(false);
  // 다른 세션으로 바뀌면 이름 바꾸기를 접는다
  const [shown, setShown] = useState(sessionId);
  if (shown !== sessionId) {
    setShown(sessionId);
    setRenaming(false);
  }
  if (!session) return null;

  /** 페이지는 대화용 버튼(재정리·책·provider)을 숨기고 제목을 눌러 바꾼다 (ADR-072) */
  const page = session.kind === 'page';

  const isBranch = !!session.parentId;
  const summaryButton = isBranch && !hasDraft;
  const summaryLabel = session.summary ? '요약 다시 만들기' : '부모에 요약 붙이기';
  const requestSummary = () => void actions().requestSummary(sessionId);
  const ex =
    session.anchor && anchorMsg
      ? excerptAround(anchorMsg.content, session.anchor.startOffset, session.anchor.endOffset, compact ? 28 : 48)
      : null;
  /** 접으면 부모 원문 인용과 요약 버튼 줄을 모두 숨긴다 (기기별 저장). 앵커 없는 하위 세션은 요약 버튼 줄만 */
  const collapsible = isBranch && (!!ex || summaryButton);
  const foldLabel = ex ? (quoteCollapsed ? '부모 원문 펼치기' : '부모 원문 접기') : quoteCollapsed ? '요약 버튼 펼치기' : '요약 버튼 접기';

  return (
    <header className={cn('shrink-0 border-b border-line bg-surface', compact ? 'px-3 pt-2 pb-2' : 'px-4 pt-3 pb-3 md:px-6')}>
      {isBranch && crumbs.length > 0 && (
        <nav aria-label="가지 경로" className={cn('mb-1 flex min-w-0 items-center gap-0.5 text-[12px] text-muted', handleClassName)}>
          {crumbs.slice(0, -1).map((c, i) => (
            <span key={`${c.id}-${i}`} className="flex min-w-0 items-center gap-0.5">
              {c.ellipsis ? (
                <span className="px-0.5">…</span>
              ) : (
                <button
                  type="button"
                  onClick={() => actions().openSession(c.id, 'main')}
                  className="max-w-[9rem] truncate rounded px-0.5 hover:bg-surface-2 hover:text-fg"
                >
                  {c.title}
                </button>
              )}
              <ChevronRight size={12} className="shrink-0" />
            </span>
          ))}
        </nav>
      )}
      <div className={cn('flex min-w-0 items-center gap-2', handleClassName)}>
        {page && renaming ? (
          <div className="min-w-0 flex-1">
            <RenameInput
              value={session.title}
              className={compact ? 'text-[15px]' : 'h-8 text-[17px] font-semibold'}
              onDone={(next) => {
                setRenaming(false);
                if (next) actions().renameSession(sessionId, next);
              }}
            />
          </div>
        ) : page ? (
          <h1 className={cn('min-w-0 flex-1 truncate font-semibold text-fg', compact ? 'text-[15px]' : 'text-[17px]')}>
            <button type="button" title="제목 바꾸기" data-page-title="" onClick={() => setRenaming(true)} className="max-w-full truncate rounded px-0.5 text-left hover:bg-surface-2">
              {session.title}
            </button>
          </h1>
        ) : (
          <h1 className={cn('min-w-0 flex-1 truncate font-semibold text-fg', compact ? 'text-[15px]' : 'text-[17px]')}>
            {session.title}
          </h1>
        )}
        {session.summary && (
          <Badge tone="anchor" className="hidden sm:inline-flex">
            <Sparkles size={11} /> 요약됨
          </Badge>
        )}
        {summaryButton && collapsible && quoteCollapsed && (
          <IconButton size="sm" label={summaryLabel} disabled={streaming} onClick={requestSummary}>
            <Sparkles size={14} className="text-anchor-line" />
          </IconButton>
        )}
        {answered && !page && (
          <IconButton size="sm" label="세션 재정리" data-reorganize="" disabled={streaming} onClick={() => void reorganizeSession(sessionId)}>
            <ListRestart size={14} />
          </IconButton>
        )}
        {!page && <BookPdfButton sessionId={sessionId} compact={compact} />}
        {!remoteMode && !page && <ProviderSelect sessionId={sessionId} compact={compact} />}
        {!remoteMode && <NavRestoreButton />}
        {collapsible && (
          <button
            type="button"
            onClick={toggleQuote}
            aria-expanded={!quoteCollapsed}
            aria-label={foldLabel}
            title={foldLabel}
            className={cn(
              'inline-flex shrink-0 items-center gap-0.5 rounded-lg border px-1.5 transition-colors',
              compact ? 'h-7' : 'h-8',
              quoteCollapsed
                ? 'border-line text-fg-2 hover:bg-surface-2 hover:text-fg'
                : 'border-anchor-line/40 bg-anchor/50 text-anchor-line hover:bg-anchor',
            )}
          >
            {ex && <Quote size={13} />}
            {quoteCollapsed ? <ChevronDown size={12} /> : <ChevronUp size={12} />}
          </button>
        )}
        {remoteMode && !page && <RemoteAgentPicker sessionId={sessionId} compact={compact} />}
        {remoteMode && <NavRestoreButton />}
        {extra}
      </div>
      {ex && !quoteCollapsed && (
        <div
          data-quote="expanded"
          className={cn(
            'mt-2 flex items-start gap-2 rounded-lg border-l-2 border-anchor-line bg-surface-2/70 py-1.5 pr-2 pl-2.5',
            compact ? 'text-[12.5px]' : 'text-[13px]',
          )}
        >
          <Quote size={13} className="mt-0.5 shrink-0 text-anchor-line" />
          <p className={cn('min-w-0 flex-1 leading-relaxed text-fg-2', compact && 'line-clamp-2')}>
            {ex.before}
            <mark className="rounded bg-anchor px-0.5 text-fg">{ex.text}</mark>
            {ex.after}
          </p>
          <button
            type="button"
            onClick={() => revealAnchor(sessionId)}
            className="inline-flex shrink-0 items-center gap-0.5 rounded px-1 text-[12px] font-medium text-accent hover:bg-accent-soft"
          >
            <CornerLeftUp size={12} /> 원문
          </button>
        </div>
      )}
      {summaryButton && !(collapsible && quoteCollapsed) && (
        <div className="mt-2 flex">
          <button
            type="button"
            disabled={streaming}
            onClick={requestSummary}
            className="inline-flex items-center gap-1 rounded-full border border-line px-2.5 py-1 text-[12.5px] font-medium text-fg-2 hover:border-anchor-line hover:text-fg disabled:opacity-40"
          >
            <Sparkles size={13} className="text-anchor-line" />
            {summaryLabel}
          </button>
        </div>
      )}
    </header>
  );
}

/** 모바일에서 숨긴 세션 내비게이션을 다시 보이는 버튼 (ADR-056) */
function NavRestoreButton() {
  const mobile = useBreakpoint() === 'mobile';
  const hidden = useUi((s) => s.navDock.hidden);
  const setNavDock = useUi((s) => s.setNavDock);
  if (!mobile || !hidden) return null;
  return (
    <IconButton size="sm" label="내비게이션 보이기" data-nav-restore="" onClick={() => setNavDock({ hidden: false })}>
      <Compass size={15} />
    </IconButton>
  );
}

function ProviderSelect({ sessionId, compact }: { sessionId: ID; compact?: boolean }) {
  const own = useApp((s) => s.sessions[sessionId]?.providerId);
  const eff = useApp((s) => effectiveProviderId(s, sessionId));
  const def = useApp((s) => s.settings.defaultProviderId);
  const connections = useApp((s) => s.connections);
  const tone = statusTone(connections[eff]);
  return (
    <label
      className={cn(
        'relative inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-line bg-surface px-2 text-[12px] text-fg-2 hover:bg-surface-2',
        compact ? 'h-7' : 'h-8',
      )}
      title="이 세션의 provider"
    >
      <StatusDot tone={tone} />
      <span className={cn('max-w-[7.5rem] truncate', compact && 'hidden sm:inline')}>{providerLabel(eff)}</span>
      <select
        aria-label="세션 provider 선택"
        value={own ?? ''}
        onChange={(e) => actions().setSessionProvider(sessionId, (e.target.value || undefined) as ProviderId | undefined)}
        className="absolute inset-0 cursor-pointer opacity-0"
      >
        <option value="">기본값 ({providerLabel(def)})</option>
        {(own && !PROVIDER_ORDER.includes(own) ? [...PROVIDER_ORDER, own] : PROVIDER_ORDER).map((id) => (
          <option key={id} value={id}>
            {providerLabel(id)} — {STATUS_LABEL[connections[id].status]}
            {connections[id].enabled ? '' : ' (꺼짐)'}
          </option>
        ))}
      </select>
    </label>
  );
}
