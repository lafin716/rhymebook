import {
  annotationsForMessage,
  buildPageFillRequest,
  buildPageOrganizeRequest,
  cleanPageAssist,
  locateSourceAnchor,
  pageDoc,
  restoreEmbeds,
  stashEmbeds,
  type ID,
  type Session,
} from '@branch/core';
import { Sparkles, Square, Undo2, Redo2, Settings, X } from 'lucide-react';
import { undo, redo } from '@codemirror/commands';
import type { EditorView } from '@codemirror/view';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { actions, useApp } from '../app/store';
import { Button } from '../components/Button';
import { IconButton } from '../components/Button';
import { PanelFullToggle } from '../components/PanelFullToggle';
import { cn } from '../lib/cn';
import type { PanelVariant } from './ChatPanel';
import { AnnotationPopover } from './AnnotationPopover';
import { FootnoteList } from './Footnotes';
import { PageEditor } from './PageEditor';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { SessionHeader } from './SessionHeader';
import { BranchChips, SummaryCard } from './SummaryCard';
import { usePageAi } from './usePageAi';
import { PageSettings } from './PageSettings';
import { PageKeyboardBar } from './PageKeyboardBar';
import { minimalChange } from './pageText';

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
 * 글을 골라 묻기·하이라이트·메모가 된다. 편집 모드가 따로 없이 늘 고칠 수 있고 쓰는 대로 저장된다 (ADR-086).
 */
export function PagePanel({ sessionId, variant = 'main', headerActions, handleClassName, className }: PagePanelProps) {
  const doc = useApp((s) => pageDoc(s.messages[sessionId]));
  const sessions = useApp((s) => s.sessions);
  const compact = variant !== 'main';
  const content = doc?.content ?? '';
  const [draft, setDraft] = useState(content);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pending = useRef<string | null>(null);
  const ai = usePageAi();

  // 편집기 인스턴스 및 상태
  const editorRef = useRef<EditorView | null>(null);
  const [history, setHistory] = useState<{ undo: number; redo: number }>({ undo: 0, redo: 0 });

  // 설정 창
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [emoji, setEmoji] = useState(() => {
    try {
      const v = localStorage.getItem('octobooks.page.emoji');
      return v !== 'false';
    } catch {
      return true;
    }
  });

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

  // 저장 대기 글이 없으면 바깥(원격·다른 창·AI) 변경을 그대로 따른다
  useEffect(() => {
    if (pending.current === null) setDraft(content);
  }, [content]);

  // 다른 페이지로 바뀌면 그 페이지 상태로 다시 시작
  const [shown, setShown] = useState(sessionId);
  if (shown !== sessionId) {
    setShown(sessionId);
    setDraft(content);
    ai.clearError();
  }
  // 다른 페이지로 가면 돌던 AI를 멈춘다
  const stopAi = ai.stop;
  useEffect(() => stopAi, [sessionId, stopAi]);

  const hasPending = useCallback(() => pending.current !== null, []);
  const onChange = (next: string) => {
    setDraft(next);
    pending.current = next;
    clearTimeout(timer.current);
    timer.current = setTimeout(flush, SAVE_DELAY);
  };

  const title = () => actions().sessions[sessionId]?.title ?? '';

  /** 노트 전체를 AI로 정리한다. 편집기가 있으면 dispatch로 넣어 기록 1칸이 되게 하고, 없으면 updatePage로 저장한다 */
  const organize = async () => {
    flush();
    const before = pageDoc(actions().messages[sessionId])?.content ?? '';
    if (!before.trim()) return;
    // 첨부(data URL)는 자리표시로 보내고 받은 글에서 되돌린다 (ADR-077)
    const stash = stashEmbeds(before);
    const raw = await ai.run('organize', buildPageOrganizeRequest({ title: title(), content: stash.text }));
    const next = raw === null ? '' : restoreEmbeds(cleanPageAssist(raw), stash.embeds);
    if (!next) return;
    // 기다리는 동안 다른 곳(원격)에서 바뀌었으면 덮어쓰지 않는다
    if ((pageDoc(actions().messages[sessionId])?.content ?? '') !== before) return;

    // 편집기가 있으면 dispatch로 넣어 기록을 만들고, 없으면 updatePage로 저장
    if (editorRef.current) {
      const changes = minimalChange(before, next);
      editorRef.current.dispatch({
        changes,
        userEvent: 'input.ai',
      });
    } else {
      actions().updatePage(sessionId, next);
    }
  };
  /** 편집기 커서 자리에 채울 글 — 받는 동안 onDelta로 흘려 보낸다 */
  const fill = (input: { before: string; after: string; request?: string }, onDelta: (text: string) => void) => {
    const before = stashEmbeds(input.before);
    const after = stashEmbeds(input.after);
    const embeds = [...before.embeds, ...after.embeds];
    // 뒤쪽 자리표시 번호는 앞쪽 개수만큼 밀어 하나의 목록으로 되돌린다
    const afterText = after.text.replace(/\]\(embed:(\d+)/g, (_, n: string) => `](embed:${Number(n) + before.embeds.length}`);
    const clean = (t: string, partial: boolean) => restoreEmbeds(cleanPageAssist(t, partial), embeds);
    return ai
      .run('fill', buildPageFillRequest({ title: title(), ...input, before: before.text, after: afterText }), (t) => onDelta(clean(t, true)))
      .then((raw) => (raw === null ? null : clean(raw, false)));
  };

  // 이 문서에 앵커를 둔 가지 (위치 → 생성 순)와 직접 만든 하위 세션(각주)
  const branches = useMemo(
    () =>
      Object.values(sessions)
        .filter((s): s is Session => s.parentId === sessionId && !!s.anchor && s.anchor.messageId === doc?.id)
        .sort((a, b) => a.anchor!.startOffset - b.anchor!.startOffset || a.createdAt - b.createdAt),
    [sessions, sessionId, doc?.id],
  );
  const allAnnotations = useApp((s) => s.annotations);
  const annotations = useMemo(() => (doc ? annotationsForMessage(allAnnotations, doc.id) : []), [allAnnotations, doc]);
  const [noteOpen, setNoteOpen] = useState<{ id: string; rect: DOMRect } | null>(null);
  /** 본문에서 더는 찾을 수 없는 가지 — 칩에 표시한다 */
  const unlocated = useMemo(
    () => new Set(branches.filter((b) => !locateSourceAnchor(draft, b.anchor!)).map((b) => b.id)),
    [branches, draft],
  );
  const summaries = branches.filter((b) => b.summary);
  const notes = useMemo(
    () => Object.values(sessions).filter((s) => s.parentId === sessionId && !s.anchor && s.kind !== 'page').sort((a, b) => a.createdAt - b.createdAt),
    [sessions, sessionId],
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
            ) : (
              <Button
                size="sm"
                variant="ghost"
                icon={<Sparkles size={14} />}
                data-page-ai-organize=""
                disabled={!!ai.busy || !draft.trim()}
                onClick={() => void organize()}
                title="AI로 노트 내용을 읽기 좋게 정리해요"
              >
                {compact ? 'AI 정리' : 'AI로 정리'}
              </Button>
            )}
            {variant === 'main' && <PanelFullToggle />}
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
          {/* 상단 도구 줄: Undo/Redo (좌측) 및 설정 (우측) */}
          <div className="flex items-center justify-between mb-3 gap-2">
            <div className="flex items-center gap-1" data-page-toolbar="">
              <IconButton
                label="실행 취소"
                size="sm"
                disabled={!editorRef.current || history.undo === 0}
                onClick={() => {
                  if (editorRef.current) {
                    undo({ state: editorRef.current.state, dispatch: editorRef.current.dispatch });
                    editorRef.current.focus();
                  }
                }}
                data-page-undo=""
              >
                <Undo2 size={16} />
              </IconButton>
              <IconButton
                label="다시 실행"
                size="sm"
                disabled={!editorRef.current || history.redo === 0}
                onClick={() => {
                  if (editorRef.current) {
                    redo({ state: editorRef.current.state, dispatch: editorRef.current.dispatch });
                    editorRef.current.focus();
                  }
                }}
                data-page-redo=""
              >
                <Redo2 size={16} />
              </IconButton>
            </div>
            <IconButton
              label="페이지 설정"
              size="sm"
              onClick={() => setSettingsOpen(true)}
              data-page-settings-open=""
            >
              <Settings size={16} />
            </IconButton>
          </div>

          {/* 편집기가 그리다 예외를 내도 화면 전체가 비지 않게 */}
          <ErrorBoundary key={sessionId} name="page-editor">
            <PageEditor
              sessionId={sessionId}
              initial={draft}
              content={content}
              hasPending={hasPending}
              onChange={onChange}
              onBlur={flush}
              messageId={doc?.id}
              branches={branches}
              annotations={annotations}
              onNote={(a, rect) => setNoteOpen({ id: a.id, rect })}
              locked={!!ai.busy}
              filling={ai.busy === 'fill'}
              onFill={fill}
              onStopFill={ai.stop}
              onView={(view: EditorView | null) => {
                editorRef.current = view;
              }}
              onHistory={(h: { undo: number; redo: number }) => {
                setHistory(h);
              }}
              emoji={emoji}
            />
          </ErrorBoundary>
          {(summaries.length > 0 || branches.length > 0 || notes.length > 0) && (
            <div className="mt-6 space-y-3">
              {summaries.map((b) => (
                <SummaryCard key={b.id} session={b} />
              ))}
              <BranchChips branches={branches} unlocated={unlocated} />
              <FootnoteList notes={notes} />
            </div>
          )}
          {noteOpen && allAnnotations[noteOpen.id] && (
            <AnnotationPopover annotation={allAnnotations[noteOpen.id]!} rect={noteOpen.rect} onClose={() => setNoteOpen(null)} />
          )}
        </div>
      </div>

      <PageSettings
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onEmojiChange={(value) => {
          setEmoji(value);
        }}
      />

      <ErrorBoundary name="page-keyboard-bar" silent>
        <PageKeyboardBar view={editorRef.current} history={history} />
      </ErrorBoundary>
    </section>
  );
}
