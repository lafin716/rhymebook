import { breadcrumb, effectiveProviderId, excerptAround, type ID, type ProviderId } from '@branch/core';
import { ChevronRight, CornerLeftUp, Quote, Sparkles } from 'lucide-react';
import { useMemo, type ReactNode } from 'react';
import { actions, useApp } from '../app/store';
import { Badge, StatusDot } from '../components/Badge';
import { cn } from '../lib/cn';
import { PROVIDER_ORDER, providerLabel, STATUS_LABEL, statusTone } from '../lib/connection';
import { revealAnchor } from './open';

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
  if (!session) return null;

  const isBranch = !!session.parentId;
  const ex =
    session.anchor && anchorMsg
      ? excerptAround(anchorMsg.content, session.anchor.startOffset, session.anchor.endOffset, compact ? 28 : 48)
      : null;

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
        <h1 className={cn('min-w-0 flex-1 truncate font-semibold text-fg', compact ? 'text-[15px]' : 'text-[17px]')}>
          {session.title}
        </h1>
        {session.summary && (
          <Badge tone="anchor" className="hidden sm:inline-flex">
            <Sparkles size={11} /> 요약됨
          </Badge>
        )}
        <ProviderSelect sessionId={sessionId} compact={compact} />
        {extra}
      </div>
      {ex && (
        <div className={cn('mt-2 flex items-start gap-2 rounded-lg border-l-2 border-anchor-line bg-surface-2/70 py-1.5 pr-2 pl-2.5', compact ? 'text-[12.5px]' : 'text-[13px]')}>
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
      {isBranch && !hasDraft && (
        <div className="mt-2 flex">
          <button
            type="button"
            disabled={streaming}
            onClick={() => void actions().requestSummary(sessionId)}
            className="inline-flex items-center gap-1 rounded-full border border-line px-2.5 py-1 text-[12.5px] font-medium text-fg-2 hover:border-anchor-line hover:text-fg disabled:opacity-40"
          >
            <Sparkles size={13} className="text-anchor-line" />
            {session.summary ? '요약 다시 만들기' : '부모에 요약 붙이기'}
          </button>
        </div>
      )}
    </header>
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
