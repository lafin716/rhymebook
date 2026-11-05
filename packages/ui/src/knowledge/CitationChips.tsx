import { t } from '../i18n';
import type { Citation } from '@branch/core';
import { useState } from 'react';
import { SourceViewer } from './SourceViewer';

/**
 * 답변 아래 출처 칩 ([1] 문서 제목). 누르면 출처 보기가 열린다.
 * 답변 본문의 [n] 표시와 같은 번호를 쓴다.
 */
export function CitationChips({ citations }: { citations: Citation[] }) {
  const [active, setActive] = useState<Citation | null>(null);
  if (!citations.length) return null;
  return (
    <div data-citations="" aria-label={t('knowledge.citations.label')} className="flex flex-wrap items-center gap-1.5">
      <span className="text-[12px] text-muted">{t('knowledge.citations.label')}</span>
      {citations.map((c) => (
        <button
          key={`${c.kbId}:${c.chunkId}`}
          type="button"
          data-citation={c.n}
          title={c.path}
          aria-label={t('knowledge.citations.open', { n: c.n, title: c.title })}
          onClick={() => setActive(c)}
          className="inline-flex max-w-[16rem] items-center gap-1 rounded-full border border-line bg-surface-2 px-2 py-0.5 text-[12px] text-fg-2 transition-colors hover:border-accent/40 hover:text-fg"
        >
          <span className="shrink-0 font-medium text-accent">[{c.n}]</span>
          <span className="truncate">{c.title}</span>
        </button>
      ))}
      <SourceViewer citation={active} onClose={() => setActive(null)} />
    </div>
  );
}
