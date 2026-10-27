import { buildPageFillRequest, buildPageOrganizeRequest, cleanPageAssist, pageDoc, type ID, type Session } from '@branch/core';
import { Check, FileText, Pencil, Sparkles, Square, Undo2, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { actions, useApp } from '../app/store';
import { Button } from '../components/Button';
import { cn } from '../lib/cn';
import type { PanelVariant } from './ChatPanel';
import { FootnoteList } from './Footnotes';
import { AssistantMessage } from './MessageItem';
import { PageEditor } from './PageEditor';
import { SessionHeader } from './SessionHeader';
import { usePageAi } from './usePageAi';

const SAVE_DELAY = 500;

/** 편집 중인 페이지의 저장 대기 글을 바로 저장한다 — 바깥에서 본문을 고치기 전에 부른다 */
const flushers = new Map<ID, () => void>();
export function flushPageDraft(id: ID) {
  flushers.get(id)?.();
}
/** 이름 바꾸기 — 부모 페이지 본문의 링크도 바뀌므로 부모의 쓰던 글을 먼저 저장한다 */
export function renameSession(id: ID, title: string) {
  const parentId = actions().sessions[id]?.parentId;
  if (parentId) flushPageDraft(parentId);
  actions().renameSession(id, title);
}

export interface PagePanelProps {
  sessionId: ID;
  variant?: PanelVariant;
  headerActions?: ReactNode;
  handleClassName?: string;
  className?: string;
}

/**
 * 마크다운 페이지 세션 (ADR-072). 본문은 문서 메시지 하나라 대화 답변과 똑같이
 * 글을 골라 묻기·하이라이트·메모가 되고, 편집 모드에서는 마크다운 원문을 고친다.
 */
export function PagePanel({ sessionId, variant = 'main', headerActions, handleClassName, className }: PagePanelProps) {
  const doc = useApp((s) => pageDoc(s.messages[sessionId]));
  const sessions = useApp((s) => s.sessions);
  const compact = variant !== 'main';
  const content = doc?.content ?? '';
  const [editing, setEditing] = useState(() => !content.trim());
  const [draft, setDraft] = useState(content);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pending = useRef<string | null>(null);
  const ai = usePageAi();
  /** AI 정리 전 본문 — 되돌리기용. 손으로 고치면 버린다 */
  const [undo, setUndo] = useState<string | null>(null);

  const flush = useCallback(() => {
    clearTimeout(timer.current);
    if (pending.current === null) return;
    const next = pending.current;
    pending.current = null;
    actions().updatePage(sessionId, next);
  }, [sessionId]);

  // 다른 세션으로 바뀌거나 닫힐 때 쓰던 글을 저장한다
  useEffect(() => {
    flushers.set(sessionId, flush);
    return () => {
      if (flushers.get(sessionId) === flush) flushers.delete(sessionId);
      flush();
    };
  }, [flush, sessionId]);

  // 편집 중이 아니면 바깥(원격·다른 창) 변경을 그대로 따른다
  useEffect(() => {
    if (!editing) setDraft(content);
  }, [content, editing]);

  // 다른 페이지로 바뀌면 그 페이지 상태로 다시 시작
  const [shown, setShown] = useState(sessionId);
  if (shown !== sessionId) {
    setShown(sessionId);
    setEditing(!content.trim());
    setDraft(content);
    setUndo(null);
    ai.clearError();
  }
  // 다른 페이지로 가면 돌던 AI를 멈춘다
  const stopAi = ai.stop;
  useEffect(() => stopAi, [sessionId, stopAi]);

  const hasPending = useCallback(() => pending.current !== null, []);
  const onChange = (next: string) => {
    setUndo(null);
    setDraft(next);
    pending.current = next;
    clearTimeout(timer.current);
    timer.current = setTimeout(flush, SAVE_DELAY);
  };
  const startEdit = () => {
    setDraft(content);
    setEditing(true);
  };
  const finish = () => {
    flush();
    setEditing(false);
  };

  const title = () => actions().sessions[sessionId]?.title ?? '';
  /** 노트 전체를 AI로 정리한다. 다 받은 뒤 한 번에 바꾸고, 되돌리기를 남긴다 */
  const organize = async () => {
    flush();
    const before = pageDoc(actions().messages[sessionId])?.content ?? '';
    if (!before.trim()) return;
    const raw = await ai.run('organize', buildPageOrganizeRequest({ title: title(), content: before }));
    const next = raw === null ? '' : cleanPageAssist(raw);
    if (!next) return;
    // 기다리는 동안 다른 곳(원격)에서 바뀌었으면 덮어쓰지 않는다
    if ((pageDoc(actions().messages[sessionId])?.content ?? '') !== before) return;
    if (actions().updatePage(sessionId, next)) setUndo(before);
  };
  const revert = () => {
    if (undo === null) return;
    flush();
    actions().updatePage(sessionId, undo);
    setUndo(null);
  };
  /** 편집기 커서 자리에 채울 글 — 받는 동안 onDelta로 흘려 보낸다 */
  const fill = (input: { before: string; after: string; request?: string }, onDelta: (text: string) => void) =>
    ai.run('fill', buildPageFillRequest({ title: title(), ...input }), (t) => onDelta(cleanPageAssist(t, true))).then((raw) =>
      raw === null ? null : cleanPageAssist(raw),
    );

  // 이 문서에 앵커를 둔 가지 (위치 → 생성 순)와 직접 만든 하위 세션(각주)
  const branches = useMemo(
    () =>
      Object.values(sessions)
        .filter((s): s is Session => s.parentId === sessionId && !!s.anchor && s.anchor.messageId === doc?.id)
        .sort((a, b) => a.anchor!.startOffset - b.anchor!.startOffset || a.createdAt - b.createdAt),
    [sessions, sessionId, doc?.id],
  );
  const notes = useMemo(
    () => Object.values(sessions).filter((s) => s.parentId === sessionId && !s.anchor && s.kind !== 'page').sort((a, b) => a.createdAt - b.createdAt),
    [sessions, sessionId],
  );

  const toggle = editing ? (
    <Button size="sm" variant="primary" icon={<Check size={14} />} data-page-done="" onClick={finish}>
      완료
    </Button>
  ) : (
    <Button size="sm" icon={<Pencil size={14} />} data-page-edit="" onClick={startEdit}>
      편집
    </Button>
  );

  return (
    <section className={cn('flex h-full min-h-0 min-w-0 flex-col bg-bg', className)} data-panel={variant} data-page="" aria-label="페이지">
      <SessionHeader
        sessionId={sessionId}
        compact={compact}
        handleClassName={handleClassName}
        actions={
          <>
            {ai.busy === 'organize' ? (
              <Button size="sm" variant="soft" icon={<Square size={13} />} data-page-ai-stop="" onClick={ai.stop} title="정리 멈추기">
                정리 중…
              </Button>
            ) : undo !== null ? (
              <Button size="sm" variant="ghost" icon={<Undo2 size={14} />} data-page-ai-undo="" onClick={revert}>
                되돌리기
              </Button>
            ) : (
              <Button
                size="sm"
                variant="ghost"
                icon={<Sparkles size={14} />}
                data-page-ai-organize=""
                disabled={!!ai.busy || !(editing ? draft : content).trim()}
                onClick={() => void organize()}
                title="AI로 노트 내용을 읽기 좋게 정리해요"
              >
                {compact ? 'AI 정리' : 'AI로 정리'}
              </Button>
            )}
            {toggle}
            {headerActions}
          </>
        }
      />
      {ai.error && (
        <div role="alert" className="flex items-center gap-2 border-b border-line bg-surface px-4 py-2 text-[13px] text-danger">
          <span className="min-w-0 flex-1">{ai.error}</span>
          <button type="button" aria-label="닫기" onClick={ai.clearError} className="grid size-6 place-items-center rounded-md text-muted hover:bg-surface-2">
            <X size={14} />
          </button>
        </div>
      )}
      <div
        data-scroll=""
        aria-busy={ai.busy === 'organize'}
        className={cn(
          'scroll-thin min-h-0 flex-1 overflow-y-auto overscroll-contain',
          compact ? 'px-3.5 py-4' : 'px-4 py-6 md:px-6',
          ai.busy === 'organize' && 'pointer-events-none animate-pulse opacity-60',
        )}
      >
        <div className="relative mx-auto max-w-3xl">
          {editing ? (
            <PageEditor
              key={sessionId}
              sessionId={sessionId}
              initial={draft}
              content={content}
              hasPending={hasPending}
              onChange={onChange}
              onBlur={flush}
              onFinish={finish}
              locked={!!ai.busy}
              filling={ai.busy === 'fill'}
              onFill={fill}
              onStopFill={ai.stop}
            />
          ) : content.trim() && doc ? (
            <div className="space-y-6">
              <AssistantMessage message={doc} branches={branches} isLast={false} />
              <FootnoteList notes={notes} />
            </div>
          ) : (
            <button
              type="button"
              onClick={startEdit}
              className="flex w-full flex-col items-center gap-2 rounded-xl border border-dashed border-line py-16 text-[14px] text-muted hover:bg-surface-2/60"
            >
              <FileText size={22} />
              빈 페이지예요. 눌러서 쓰기 시작
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
