import type { ID } from '@branch/core';
import { AlertTriangle, Sparkles, X } from 'lucide-react';
import { actions, useApp } from '../app/store';
import { Button } from '../components/Button';
import { cn } from '../lib/cn';

/** 요약 초안: 생성(스트리밍) → 편집 → 부모에 붙이기 */
export function SummaryDraftPanel({ sessionId, compact }: { sessionId: ID; compact?: boolean }) {
  const draft = useApp((s) => s.summaryDrafts[sessionId]);
  const parentTitle = useApp((s) => {
    const p = s.sessions[sessionId]?.parentId;
    return p ? s.sessions[p]?.title : undefined;
  });
  const hasSummary = useApp((s) => !!s.sessions[sessionId]?.summary);
  if (!draft) return null;
  const close = () => actions().discardSummaryDraft(sessionId);

  return (
    <div className={cn('shrink-0', compact ? 'px-2.5 pt-2' : 'px-3 pt-2 md:px-6')}>
      <div className="animate-pop-in mx-auto max-w-3xl rounded-2xl border border-anchor-line/50 bg-surface p-3 shadow-pop">
        <div className="mb-2 flex items-center gap-2 text-[13px]">
          <Sparkles size={15} className="text-anchor-line" />
          <span className="min-w-0 flex-1 truncate font-medium">
            {draft.status === 'generating' ? '요약 만드는 중…' : `"${parentTitle ?? '부모'}"에 붙일 요약`}
          </span>
          <button type="button" aria-label="요약 취소" onClick={close} className="rounded p-1 text-muted hover:bg-surface-2">
            <X size={15} />
          </button>
        </div>
        {draft.status === 'generating' && (
          <p className="min-h-12 text-[14px] leading-relaxed text-fg-2">
            {draft.text}
            <span className="stream-caret" />
          </p>
        )}
        {draft.status === 'ready' && (
          <>
            <textarea
              value={draft.text}
              onChange={(e) => actions().updateSummaryDraft(sessionId, e.target.value)}
              rows={3}
              aria-label="요약 편집"
              className="w-full resize-none rounded-lg border border-line bg-bg px-2.5 py-2 text-[14px] leading-relaxed outline-none focus:border-accent"
            />
            <div className="mt-2 flex items-center justify-end gap-1.5">
              <span className="mr-auto text-[12px] text-muted">직접 다듬은 뒤 붙일 수 있어요</span>
              <Button size="sm" variant="ghost" onClick={close}>
                취소
              </Button>
              {hasSummary && (
                <Button size="sm" variant="ghost" onClick={() => { actions().removeSummary(sessionId); close(); }}>
                  기존 요약 제거
                </Button>
              )}
              <Button size="sm" variant="primary" disabled={!draft.text.trim()} onClick={() => actions().attachSummary(sessionId)}>
                {hasSummary ? '요약 교체' : '부모에 붙이기'}
              </Button>
            </div>
          </>
        )}
        {draft.status === 'error' && draft.text && <p className="mb-2 text-[14px] leading-relaxed text-fg-2">{draft.text}</p>}
        {draft.status === 'error' && (
          <div className="flex items-center gap-2 text-[13px] text-danger">
            <AlertTriangle size={14} />
            <span className="flex-1">{draft.message}</span>
            <Button size="sm" onClick={() => void actions().requestSummary(sessionId)}>
              다시 시도
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
