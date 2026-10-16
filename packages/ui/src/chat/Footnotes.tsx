import type { Session } from '@branch/core';
import { NotebookPen, Sparkles } from 'lucide-react';
import { useApp } from '../app/store';
import { openBranch } from './open';

/** 각주 번호 표식. 하위 세션을 만든 시점의 메시지 뒤에 붙는다 (ADR-054) */
export function FootnoteRefs({ items }: { items: { n: number; session: Session }[] }) {
  if (!items.length) return null;
  return (
    <div className="mt-1.5 flex flex-wrap gap-1">
      {items.map(({ n, session }) => (
        <button
          key={session.id}
          type="button"
          data-footnote-ref={session.id}
          onClick={() => openBranch(session.id)}
          title={session.title}
          className="inline-flex max-w-[12rem] items-center gap-1 rounded-md px-1 py-0.5 text-[12px] text-accent hover:bg-accent-soft"
        >
          <sup className="font-semibold">[{n}]</sup>
          <span className="truncate">{session.title}</span>
        </button>
      ))}
    </div>
  );
}

/** 대화 끝의 각주 목록: 직접 만든 하위 세션 (번호 · 제목 · 요약) */
export function FootnoteList({ notes }: { notes: Session[] }) {
  const streaming = useApp((s) => s.streaming);
  if (!notes.length) return null;
  return (
    <section aria-label="각주" data-footnotes className="border-t border-line pt-3">
      <h3 className="mb-1.5 flex items-center gap-1.5 text-[12.5px] font-semibold text-muted">
        <NotebookPen size={13} /> 각주 {notes.length}
      </h3>
      <ol className="space-y-0.5">
        {notes.map((s, i) => (
          <li key={s.id}>
            <button
              type="button"
              data-footnote={s.id}
              onClick={() => openBranch(s.id)}
              className="flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-surface-2"
            >
              <span className="shrink-0 pt-px text-[12.5px] font-semibold text-accent tabular-nums">[{i + 1}]</span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5 text-[13.5px] text-fg">
                  <span className="truncate">{s.title}</span>
                  {s.summary && <Sparkles size={11} className="shrink-0 text-anchor-line" />}
                  {streaming[s.id] && <span className="stream-caret shrink-0" />}
                </span>
                {s.summary && <span className="mt-0.5 line-clamp-2 block text-[12.5px] leading-relaxed text-muted">{s.summary}</span>}
              </span>
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
}
