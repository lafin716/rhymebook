import {
  buildRewriteContext,
  DEFAULT_RAG_SETTINGS,
  rewriteQuery,
  toCitations,
  type Citation,
  type DesktopKnowledgeApi,
  type KnowledgeBase,
  type RetrievalResult,
} from '@branch/core';
import { useEffect, useRef, useState, type FormEvent, type MouseEvent } from 'react';
import { t } from '../i18n';
import { Button } from '../components/Button';
import { useApp } from '../app/store';
import { cn } from '../lib/cn';
import { knowledgeErrorText } from './kbErrors';
import { hitLocation, methodKey, relevancePercent } from './kbModel';
import { SourceViewer } from './SourceViewer';

type TestState =
  | { status: 'idle' }
  | { status: 'running' }
  | { status: 'done'; result: RetrievalResult; citations: Citation[] }
  | { status: 'cancelled' }
  | { status: 'error'; message: string };

function newRequestId(): string {
  return `kbtest-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * 검색 테스트: 질문 한 개를 이 지식베이스에만 던져 어떤 근거가 나오는지 확인한다.
 * 실제 채팅과 같은 질문 재작성·검색 경로를 쓰되, 답변 생성은 하지 않는다.
 */
export function KnowledgeSearchTest({ kb, api }: { kb: KnowledgeBase; api: DesktopKnowledgeApi }) {
  const rag = useApp((s) => s.settings.rag) ?? DEFAULT_RAG_SETTINGS;
  const [query, setQuery] = useState('');
  const [state, setState] = useState<TestState>({ status: 'idle' });
  const [open, setOpen] = useState<Citation | null>(null);
  const activeRequest = useRef<string | null>(null);
  const mounted = useRef(true);
  const codebase = kb.kind === 'codebase';
  const supported = !!api.retrieve;
  const running = state.status === 'running';

  // 언마운트 때만 진행 중인 검색을 끊는다. api 참조가 바뀌어도 검색이 끊기지 않도록 ref로 읽는다.
  const apiRef = useRef(api);
  apiRef.current = api;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      const id = activeRequest.current;
      activeRequest.current = null;
      if (id && apiRef.current.cancelRetrieve) void apiRef.current.cancelRetrieve(id).catch(() => undefined);
    };
  }, []);

  const run = async (e: FormEvent) => {
    e.preventDefault();
    const q = query.trim();
    if (!q || !api.retrieve || running) return;
    const requestId = newRequestId();
    activeRequest.current = requestId;
    setState({ status: 'running' });
    try {
      const plan = rewriteQuery(buildRewriteContext({}, {}, '', q, [kb.name]));
      const result = await api.retrieve({ kbIds: [kb.id], plan, settings: rag }, requestId);
      // 취소했거나 다른 검색이 시작됐으면 늦게 온 결과는 버린다
      if (!mounted.current || activeRequest.current !== requestId) return;
      activeRequest.current = null;
      setState({ status: 'done', result, citations: toCitations(result.evidence) });
    } catch (err) {
      if (!mounted.current || activeRequest.current !== requestId) return;
      activeRequest.current = null;
      setState({ status: 'error', message: knowledgeErrorText(err, t) });
    }
  };

  const cancel = (e: MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    const id = activeRequest.current;
    if (!id) return;
    activeRequest.current = null;
    setState({ status: 'cancelled' });
    if (api.cancelRetrieve) void api.cancelRetrieve(id).catch(() => undefined);
  };

  const method = methodKey(kb.kind);

  return (
    <section aria-label={t('knowledge.test.heading')} data-search-test="" className="flex flex-col gap-3">
      <div className="flex flex-col gap-0.5">
        <h4 className="text-[13px] font-semibold text-fg-2">{t('knowledge.test.heading')}</h4>
        <p className="text-[12px] text-fg-2">{t('knowledge.test.hint')}</p>
      </div>
      {!supported && <p className="text-[12px] text-fg-2">{t('knowledge.test.unsupported')}</p>}
      <form role="search" onSubmit={(e) => void run(e)} className="flex flex-col gap-2 sm:flex-row">
        <input
          type="search"
          aria-label={t('knowledge.test.label')}
          value={query}
          disabled={!supported}
          placeholder={t('knowledge.test.placeholder')}
          onChange={(e) => setQuery(e.target.value)}
          className="min-h-11 min-w-0 flex-1 rounded-lg border border-line bg-surface px-3 text-[14px] text-fg outline-none placeholder:text-muted focus:border-accent disabled:opacity-60 md:min-h-9"
        />
        {running ? (
          // key를 나눠 두어야 취소 버튼이 제출 버튼으로 바뀌며 클릭 기본 동작(폼 제출)이 다시 검색을 시작하지 않는다
          <Button key="cancel" type="button" variant="secondary" onClick={cancel} data-search-cancel="">
            {t('knowledge.test.cancel')}
          </Button>
        ) : (
          <Button key="run" type="submit" variant="primary" disabled={!supported || !query.trim()}>
            {t('knowledge.test.run')}
          </Button>
        )}
      </form>

      <div aria-live="polite" className="flex flex-col gap-2">
        {state.status === 'running' && <p role="status" className="text-[12px] text-fg-2" data-search-state="running">{t('knowledge.test.running')}</p>}
        {state.status === 'cancelled' && (
          <p role="status" className="text-[12px] text-warn" data-search-state="cancelled">
            {t('knowledge.test.cancelled')}
          </p>
        )}
        {state.status === 'error' && (
          <div role="alert" data-search-state="error" className="flex flex-col gap-0.5 rounded-lg bg-danger-soft px-3 py-2 text-[12px] text-danger">
            <span>{t('knowledge.test.error')}</span>
            <span className="text-fg-2">{state.message}</span>
          </div>
        )}
        {state.status === 'done' && state.result.skipped.length > 0 && (
          <p role="note" className="text-[12px] text-warn" data-search-skipped="">
            {t('knowledge.test.skipped', { count: state.result.skipped.length })}
          </p>
        )}
        {state.status === 'done' && state.citations.length === 0 && (
          <p role="status" className="rounded-lg bg-surface-2 px-3 py-2 text-[12px] text-fg-2" data-search-state="empty">
            {t('knowledge.test.empty')}
          </p>
        )}
        {state.status === 'done' && state.citations.length > 0 && (
          <>
            <p className="text-[12px] text-fg-2">{t('knowledge.test.count', { count: state.citations.length, ms: state.result.tookMs })}</p>
            <ol className="flex flex-col gap-2" aria-label={t('knowledge.test.results')} data-search-results="">
              {state.citations.map((c) => {
                const m = state.result.evidence.find((e) => e.n === c.n)?.method ?? c.method ?? method;
                const pct = relevancePercent(c.score);
                return (
                  <li key={`${c.kbId}:${c.chunkId}`} data-search-hit={c.n} className="flex flex-col gap-1.5 rounded-xl border border-line bg-surface p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full border border-line px-1.5 py-px text-[11px] text-fg-2">{t(`knowledge.method.${m}`)}</span>
                      <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-fg-2" title={hitLocation(c, codebase)}>
                        {hitLocation(c, codebase)}
                      </span>
                    </div>
                    {c.title && c.title !== c.path && <p className="truncate text-[13px] font-semibold text-fg">{c.title}</p>}
                    <p className="line-clamp-3 text-[12.5px] text-fg-2">{c.snippet}</p>
                    <div className="flex items-center gap-2">
                      <div
                        role="meter"
                        aria-label={t('knowledge.test.relevance')}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={pct}
                        className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2"
                      >
                        <div className={cn('h-full rounded-full bg-accent')} style={{ width: `${pct}%` }} />
                      </div>
                      <span className="w-10 text-right font-mono text-[11px] text-fg-2">{pct}%</span>
                      <Button size="sm" variant="ghost" onClick={() => setOpen(c)}>
                        {t('knowledge.test.open')}
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ol>
          </>
        )}
      </div>
      <SourceViewer citation={open} onClose={() => setOpen(null)} />
    </section>
  );
}
