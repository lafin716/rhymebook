import { BRANCHES_LANG, type BranchSuggestion, type ID, type LocatedChapter, type Session } from '@branch/core';
import { GitBranch, Sprout } from 'lucide-react';
import { Children, createContext, isValidElement, useContext, type ComponentProps, type ReactNode } from 'react';
import type { ExtraProps } from 'react-markdown';
import { actions, appStore } from '../app/store';
import { cn } from '../lib/cn';
import { openBranch } from './open';
import { codeSource } from './QuizCard';

/**
 * 추천 가지 (ADR-094). 커리큘럼·로드맵 답변은 챕터 제목 옆에 "가지" 버튼을, 모든 답변은 아래에 추천 칩을 단다.
 * 누르면 하위 세션을 만들어 바로 연다. 이미 만든 가지면 그 가지를 연다.
 */

export interface BranchSuggestValue {
  sessionId: ID;
  messageId: ID;
  chapters: LocatedChapter[];
  /** 이 메시지를 앵커로 가진 가지들 */
  branches: Session[];
}

export const BranchSuggestContext = createContext<BranchSuggestValue | null>(null);

/** ```branches 블록 본문 (아니면 null) — 화면에서는 숨긴다 */
export const branchesSource = (node: ExtraProps['node']) => codeSource(node, BRANCHES_LANG);

const sameAnchor = (b: Session, ch: LocatedChapter) =>
  !!b.anchor && (b.anchor.startOffset === ch.anchor.startOffset || b.anchor.text === ch.anchor.text);

function ChapterButton({ chapter, ctx }: { chapter: LocatedChapter; ctx: BranchSuggestValue }) {
  const existing = ctx.branches.find((b) => sameAnchor(b, chapter));
  const open = () => {
    if (existing) return openBranch(existing.id);
    const id = actions().createBranch(
      ctx.sessionId,
      { messageId: ctx.messageId, text: chapter.anchor.text, startOffset: chapter.anchor.startOffset, endOffset: chapter.anchor.endOffset },
      'custom',
      chapter.question,
    );
    if (id) openBranch(id);
  };
  return (
    <button
      type="button"
      data-anchor-ignore=""
      data-chapter-branch={existing ? 'open' : 'new'}
      contentEditable={false}
      title={existing ? '이 챕터 가지 열기' : `가지로 배우기: ${chapter.question}`}
      onClick={(e) => {
        e.stopPropagation();
        open();
      }}
      className={cn(
        'chapter-branch ml-2 inline-flex translate-y-[-0.1em] items-center gap-1 rounded-full border px-2 py-0.5 align-middle text-[12px] font-medium leading-none whitespace-nowrap select-none transition-colors max-md:min-h-11 max-md:px-3',
        existing
          ? 'border-anchor-line bg-anchor/40 text-fg hover:bg-anchor/60'
          : 'border-line bg-surface text-fg-2 hover:border-anchor-line hover:text-fg',
      )}
    >
      <GitBranch size={12} aria-hidden="true" />
      {existing ? '열기' : '가지'}
    </button>
  );
}

/** 제목·목록 노드의 원문 위치가 챕터 줄이면 그 챕터 (들여쓰기 3칸까지) */
function useChapterAt(node: ExtraProps['node']): { chapter: LocatedChapter; ctx: BranchSuggestValue } | null {
  const ctx = useContext(BranchSuggestContext);
  const at = node?.position?.start.offset;
  if (!ctx || at === undefined) return null;
  const chapter = ctx.chapters.find((c) => at - c.lineStart >= 0 && at - c.lineStart <= 3);
  return chapter ? { chapter, ctx } : null;
}

type HeadingTag = 'h1' | 'h2' | 'h3' | 'h4';

export function chapterHeading(Tag: HeadingTag) {
  return function ChapterHeading({ node, children, ...rest }: ComponentProps<HeadingTag> & ExtraProps) {
    const hit = useChapterAt(node);
    return (
      <Tag {...rest}>
        {children}
        {hit && <ChapterButton chapter={hit.chapter} ctx={hit.ctx} />}
      </Tag>
    );
  };
}

/** 목록 항목 챕터는 하위 목록 앞(챕터 글 바로 뒤)에 버튼을 단다 */
export function ChapterListItem({ node, children, ...rest }: ComponentProps<'li'> & ExtraProps) {
  const hit = useChapterAt(node);
  if (!hit) return <li {...rest}>{children}</li>;
  const parts = Children.toArray(children);
  const sub = parts.findIndex((c) => isValidElement(c) && (c.type === 'ul' || c.type === 'ol'));
  const button = <ChapterButton key="chapter-branch" chapter={hit.chapter} ctx={hit.ctx} />;
  const out: ReactNode[] = sub < 0 ? [...parts, button] : [...parts.slice(0, sub), button, ...parts.slice(sub)];
  return <li {...rest}>{out}</li>;
}

/** 같은 질문으로 이미 만든 하위 세션 (앵커 없는 가지) */
function existingSubSession(sessionId: ID, question: string): ID | undefined {
  const st = appStore.getState();
  return Object.values(st.sessions).find(
    (s) => s.parentId === sessionId && !s.anchor && st.messages[s.id]?.find((m) => m.role === 'user')?.content.trim() === question.trim(),
  )?.id;
}

/** 답변 아래 추천 칩 — 눌러서 하위 세션으로 이어 간다 */
export function BranchSuggestions({ sessionId, items }: { sessionId: ID; items: BranchSuggestion[] }) {
  if (!items.length) return null;
  const go = (s: BranchSuggestion) => {
    const id = existingSubSession(sessionId, s.question) ?? actions().createSubSession(sessionId, s.question);
    if (id) openBranch(id);
  };
  return (
    <div data-branch-suggestions="" className="flex flex-wrap items-center gap-1.5">
      <span className="inline-flex items-center gap-1 text-[12px] text-muted">
        <Sprout size={13} aria-hidden="true" /> 추천 가지
      </span>
      {items.map((s) => (
        <button
          key={s.question}
          type="button"
          data-suggest-branch=""
          title={s.question}
          onClick={() => go(s)}
          className="inline-flex max-w-[16rem] items-center gap-1 rounded-full border border-dashed border-line bg-surface px-2.5 py-0.5 text-[12px] text-fg-2 transition-colors hover:border-anchor-line hover:border-solid hover:text-fg max-md:min-h-11 max-md:px-3"
        >
          <GitBranch size={12} className="shrink-0" aria-hidden="true" />
          <span className="truncate">{s.title}</span>
        </button>
      ))}
    </div>
  );
}
