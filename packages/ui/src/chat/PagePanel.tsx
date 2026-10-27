import { pageDoc, type ID, type Session } from '@branch/core';
import { Check, FileText, Pencil } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { actions, useApp } from '../app/store';
import { Button } from '../components/Button';
import { cn } from '../lib/cn';
import type { PanelVariant } from './ChatPanel';
import { FootnoteList } from './Footnotes';
import { AssistantMessage } from './MessageItem';
import { SessionHeader } from './SessionHeader';

const SAVE_DELAY = 500;

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
  const area = useRef<HTMLTextAreaElement>(null);

  const flush = useCallback(() => {
    clearTimeout(timer.current);
    if (pending.current === null) return;
    const next = pending.current;
    pending.current = null;
    actions().updatePage(sessionId, next);
  }, [sessionId]);

  // 다른 세션으로 바뀌거나 닫힐 때 쓰던 글을 저장한다
  useEffect(() => flush, [flush]);

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
  }

  useLayoutEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [draft, editing]);

  useEffect(() => {
    if (editing) area.current?.focus({ preventScroll: true });
  }, [editing, sessionId]);

  const onChange = (next: string) => {
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

  // 이 문서에 앵커를 둔 가지 (위치 → 생성 순)와 직접 만든 하위 세션(각주)
  const branches = useMemo(
    () =>
      Object.values(sessions)
        .filter((s): s is Session => s.parentId === sessionId && !!s.anchor && s.anchor.messageId === doc?.id)
        .sort((a, b) => a.anchor!.startOffset - b.anchor!.startOffset || a.createdAt - b.createdAt),
    [sessions, sessionId, doc?.id],
  );
  const notes = useMemo(
    () => Object.values(sessions).filter((s) => s.parentId === sessionId && !s.anchor).sort((a, b) => a.createdAt - b.createdAt),
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
            {toggle}
            {headerActions}
          </>
        }
      />
      <div
        data-scroll=""
        className={cn('scroll-thin min-h-0 flex-1 overflow-y-auto overscroll-contain', compact ? 'px-3.5 py-4' : 'px-4 py-6 md:px-6')}
      >
        <div className="mx-auto max-w-3xl">
          {editing ? (
            <textarea
              ref={area}
              aria-label="페이지 본문 (마크다운)"
              value={draft}
              onChange={(e) => onChange(e.target.value)}
              onBlur={flush}
              onKeyDown={(e) => {
                if (e.key === 'Escape' || ((e.metaKey || e.ctrlKey) && e.key === 'Enter')) {
                  e.preventDefault();
                  finish();
                }
              }}
              placeholder={'마크다운으로 자유롭게 적어 보세요.\n\n# 제목\n- 목록\n**굵게**, `코드`\n\n다 쓰면 완료를 누르고, 글을 골라 물어보거나 표시할 수 있어요.'}
              spellCheck={false}
              className="block min-h-[50vh] w-full resize-none overflow-hidden bg-transparent font-mono text-[14.5px] leading-relaxed text-fg outline-none placeholder:text-muted"
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
