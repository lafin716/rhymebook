import { t } from '../i18n';
import type { KnowledgeIndexState } from '@branch/core';
import { useEffect, useState } from 'react';
import { Button } from '../components/Button';
import { cn } from '../lib/cn';
import { knowledgeApi } from './api';

/**
 * 지식베이스 색인 상태 한 줄 (ADR-113). main이 색인 상태를 밀어 주므로 구독해서 갱신한다.
 * stale·error여도 기존 색인은 계속 검색되므로 상태와 함께 "다시 색인"만 보여 준다.
 */
export function IndexStatus({ kbId }: { kbId: string }) {
  const api = knowledgeApi();
  const [state, setState] = useState<KnowledgeIndexState | null>(null);

  useEffect(() => {
    if (!api?.indexStates) return;
    let alive = true;
    void api
      .indexStates([kbId])
      .then((list) => alive && setState(list.find((s) => s.kbId === kbId) ?? null))
      .catch(() => undefined);
    const off = api.onIndexState?.((s) => {
      if (alive && s.kbId === kbId) setState(s);
    });
    return () => {
      alive = false;
      off?.();
    };
  }, [api, kbId]);

  if (!api?.indexStates || !state) return null;
  const busyNow = state.status === 'queued' || state.status === 'indexing';
  const p = state.progress;
  const label =
    state.status === 'indexing' && p
      ? t('knowledge.index.indexing', { done: p.done, total: p.total })
      : state.status === 'ready'
        ? t('knowledge.index.ready', { count: state.chunkCount })
        : state.status === 'queued'
          ? t('knowledge.index.queued')
          : state.status === 'stale'
            ? t('knowledge.index.stale')
            : state.status === 'error'
              ? t('knowledge.index.error')
              : t('knowledge.index.empty');
  const tone = state.status === 'error' ? 'text-danger' : state.status === 'stale' ? 'text-warn' : 'text-fg-2';

  return (
    <div data-index-status={state.status} className="flex flex-wrap items-center gap-2 text-[12px]">
      <span className={cn('inline-flex items-center gap-1.5', tone)} role={state.status === 'error' ? 'alert' : undefined}>
        <span aria-hidden className={cn('size-1.5 rounded-full', busyNow ? 'animate-pulse bg-accent' : state.status === 'ready' ? 'bg-ok' : 'bg-muted')} />
        {label}
      </span>
      {state.status === 'error' && state.error && <span className="truncate text-muted">{state.error}</span>}
      {busyNow && api.cancelIndex && (
        <Button size="sm" variant="ghost" onClick={() => void api.cancelIndex?.(kbId)}>
          {t('knowledge.index.cancel')}
        </Button>
      )}
      {!busyNow && api.reindex && (
        <Button size="sm" variant="ghost" onClick={() => void api.reindex?.(kbId)}>
          {t('knowledge.index.reindex')}
        </Button>
      )}
    </div>
  );
}
