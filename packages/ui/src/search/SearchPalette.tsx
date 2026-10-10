import { breadcrumb, type ID } from '@branch/core';
import { GitBranch, MessageSquare, Search } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { actions, useApp } from '../app/store';
import { Modal } from '../components/Modal';
import { cn } from '../lib/cn';
import { relativeTime } from '../lib/time';

interface Hit {
  id: ID;
  title: string;
  path: string;
  snippet?: { before: string; match: string; after: string };
  updatedAt: number;
  isBranch: boolean;
}

function snippetOf(text: string, q: string) {
  const i = text.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return undefined;
  const clean = (s: string) => s.replace(/[*`#>|]/g, '').replace(/\s+/g, ' ');
  return {
    before: (i > 30 ? '…' : '') + clean(text.slice(Math.max(0, i - 30), i)),
    match: text.slice(i, i + q.length),
    after: clean(text.slice(i + q.length, i + q.length + 50)),
  };
}

/** Cmd/Ctrl+K 세션 검색 (제목 + 메시지 본문) */
export function SearchPalette() {
  const open = useApp((s) => s.overlay === 'search');
  const close = () => actions().setOverlay('none');
  return (
    <Modal open={open} onClose={close} placement="top" label="세션 검색" className="md:max-w-xl">
      {open && <PaletteBody onClose={close} />}
    </Modal>
  );
}

function PaletteBody({ onClose }: { onClose(): void }) {
  const sessions = useApp((s) => s.sessions);
  const messages = useApp((s) => s.messages);
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);

  const hits = useMemo<Hit[]>(() => {
    const query = q.trim();
    const all = Object.values(sessions).sort((a, b) => b.updatedAt - a.updatedAt);
    const out: Hit[] = [];
    for (const s of all) {
      const path = breadcrumb(sessions, s.id, 4)
        .slice(0, -1)
        .map((b) => (b.ellipsis ? '…' : b.title))
        .join(' › ');
      const base = { id: s.id, title: s.title, path, updatedAt: s.updatedAt, isBranch: !!s.parentId };
      if (!query) {
        out.push(base);
        continue;
      }
      if (s.title.toLowerCase().includes(query.toLowerCase())) {
        out.push(base);
        continue;
      }
      const m = (messages[s.id] ?? []).find((x) => x.content.toLowerCase().includes(query.toLowerCase()));
      if (m) out.push({ ...base, snippet: snippetOf(m.content, query) });
    }
    return out.slice(0, query ? 30 : 8);
  }, [q, sessions, messages]);

  useEffect(() => setSel(0), [q]);
  useEffect(() => {
    listRef.current?.querySelector(`[data-idx="${sel}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [sel]);

  const pick = (id: ID) => {
    onClose();
    actions().openSession(id, 'main');
  };

  return (
    <>
      <div className="flex items-center gap-2 border-b border-line px-4">
        <Search size={18} className="shrink-0 text-muted" />
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setSel((v) => Math.min(hits.length - 1, v + 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setSel((v) => Math.max(0, v - 1));
            } else if (e.key === 'Enter' && hits[sel]) {
              e.preventDefault();
              pick(hits[sel].id);
            }
          }}
          placeholder="세션 제목이나 대화 내용으로 검색"
          aria-label="검색어"
          className="h-13 min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-muted focus-visible:outline-none"
        />
        <button type="button" onClick={onClose} className="text-[13px] text-muted md:hidden">
          닫기
        </button>
      </div>
      <div className="px-4 pt-3 pb-1 text-[11.5px] font-medium text-muted">{q.trim() ? `결과 ${hits.length}개` : '최근 세션'}</div>
      <ul ref={listRef} role="listbox" aria-label="검색 결과" className="scroll-thin min-h-0 flex-1 overflow-y-auto px-2 pb-2 md:max-h-[52vh]">
        {hits.length === 0 && <li className="px-3 py-10 text-center text-[13.5px] text-muted">“{q}”와 일치하는 세션이 없어요</li>}
        {hits.map((h, i) => (
          <li key={h.id} role="option" aria-selected={i === sel} data-idx={i}>
            <button
              type="button"
              onMouseMove={() => setSel(i)}
              onClick={() => pick(h.id)}
              className={cn('flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left', i === sel && 'bg-surface-2')}
            >
              <span className="mt-0.5 text-muted">{h.isBranch ? <GitBranch size={15} /> : <MessageSquare size={15} />}</span>
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline gap-2">
                  <span className="truncate text-[14px] font-medium">{h.title}</span>
                  <span className="ml-auto shrink-0 text-[11px] text-muted">{relativeTime(h.updatedAt)}</span>
                </span>
                {h.path && <span className="block truncate text-[11.5px] text-muted">{h.path}</span>}
                {h.snippet && (
                  <span className="mt-0.5 line-clamp-2 block text-[12.5px] text-fg-2">
                    {h.snippet.before}
                    <mark className="rounded bg-anchor px-0.5 text-fg">{h.snippet.match}</mark>
                    {h.snippet.after}
                  </span>
                )}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}
