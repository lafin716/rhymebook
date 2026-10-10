import type { Session } from '@branch/core';
import { ChevronDown, CornerDownRight, GitBranch, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { cn } from '../lib/cn';
import { openBranch, setAnchorActive } from './open';

/** 가지 요약 카드: 부모 메시지 아래에 접히는 형태로 붙는다 */
export function SummaryCard({ session }: { session: Session }) {
  const [open, setOpen] = useState(true);
  return (
    <div
      className="rounded-xl border border-line bg-surface-2/60 text-[13.5px]"
      onMouseEnter={() => setAnchorActive(session.id, true)}
      onMouseLeave={() => setAnchorActive(session.id, false)}
      data-summary-card={session.id}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
      >
        <Sparkles size={14} className="shrink-0 text-anchor-line" />
        <span className="min-w-0 flex-1 truncate font-medium text-fg">
          <span className="text-muted">가지 요약 · </span>
          {session.title}
        </span>
        <ChevronDown size={15} className={cn('shrink-0 text-muted transition-transform', !open && '-rotate-90')} />
      </button>
      {open && (
        <div className="animate-fade-in border-t border-line px-3 pt-2 pb-2.5">
          <p className="leading-relaxed text-fg-2">{session.summary}</p>
          <button
            type="button"
            onClick={() => openBranch(session.id)}
            className="mt-1.5 inline-flex items-center gap-1 text-[12.5px] font-medium text-accent hover:underline"
          >
            <CornerDownRight size={13} /> 가지 열기
          </button>
        </div>
      )}
    </div>
  );
}

/** 메시지에 달린 가지 칩 목록 */
export function BranchChips({ branches, unlocated }: { branches: Session[]; unlocated: Set<string> }) {
  if (!branches.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="inline-flex items-center gap-1 text-[12px] text-muted">
        <GitBranch size={13} /> 가지 {branches.length}
      </span>
      {branches.map((b) => (
        <button
          key={b.id}
          type="button"
          onClick={() => openBranch(b.id)}
          onMouseEnter={() => setAnchorActive(b.id, true)}
          onMouseLeave={() => setAnchorActive(b.id, false)}
          title={unlocated.has(b.id) ? '원문에서 앵커 위치를 찾지 못했습니다' : undefined}
          className={cn(
            'inline-flex max-w-[14rem] items-center gap-1 rounded-full border px-2 py-0.5 text-[12px] transition-colors',
            unlocated.has(b.id)
              ? 'border-dashed border-warn text-warn'
              : 'border-line bg-surface text-fg-2 hover:border-anchor-line hover:text-fg',
          )}
        >
          <span className="truncate">{b.title}</span>
          {b.summary && <Sparkles size={11} className="shrink-0 text-anchor-line" />}
        </button>
      ))}
    </div>
  );
}
