import { t } from '../i18n';
import type { Citation, SourceView } from '@branch/core';
import { useEffect, useState } from 'react';
import { Button } from '../components/Button';
import { Modal } from '../components/Modal';
import { knowledgeApi, ipcErrorMessage } from './api';

export interface SourceViewerProps {
  citation: Citation | null;
  onClose(): void;
}

/** 위치 문구: 쪽 번호·줄 범위·제목 경로 (있는 것만) */
export function sourceLocation(v: { page?: number; lineStart?: number; lineEnd?: number; headingPath: string[] }): string {
  const parts: string[] = [];
  if (v.page) parts.push(t('knowledge.source.page', { page: v.page }));
  if (v.lineStart) {
    parts.push(
      v.lineEnd && v.lineEnd !== v.lineStart
        ? t('knowledge.source.lines', { start: v.lineStart, end: v.lineEnd })
        : t('knowledge.source.line', { line: v.lineStart }),
    );
  }
  if (v.headingPath.length) parts.push(v.headingPath.join(' › '));
  return parts.join(' · ');
}

/**
 * 출처 보기: 인용한 청크를 강조하고 부모 섹션을 함께 보여 준다.
 * 원문은 main에서 읽어 오므로 여기서는 표시만 한다.
 */
export function SourceViewer({ citation, onClose }: SourceViewerProps) {
  const [view, setView] = useState<SourceView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!citation) return;
    let alive = true;
    setView(null);
    setError(null);
    setLoading(true);
    const api = knowledgeApi();
    const req = api?.source ? api.source(citation.kbId, citation.chunkId) : Promise.reject(new Error('unavailable'));
    req
      .then((v) => alive && setView(v))
      .catch((e: unknown) => {
        if (!alive) return;
        const detail = ipcErrorMessage(e);
        setError(detail === 'unavailable' || !detail ? t('knowledge.error.unavailable') : detail);
      })
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [citation]);

  const open = !!citation;
  const location = view ? sourceLocation(view) : citation ? sourceLocation(citation) : '';

  return (
    <Modal open={open} onClose={onClose} label={t('knowledge.source.title')} size="tall" className="md:w-[min(720px,92vw)]">
      {citation && (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="border-b border-line px-5 py-4">
            <div className="text-[12px] text-muted">
              [{citation.n}] {citation.kbName}
            </div>
            <h2 className="mt-0.5 truncate text-[16px] font-semibold text-fg">{view?.title ?? citation.title}</h2>
            <div className="mt-1 truncate font-mono text-[12px] text-muted" title={view?.path ?? citation.path}>
              {view?.path ?? citation.path}
            </div>
            {location && <div className="mt-1 text-[12px] text-fg-2">{location}</div>}
            {view?.url && (
              <a href={view.url} target="_blank" rel="noreferrer" className="mt-1 block truncate text-[12px] text-accent underline">
                {view.url}
              </a>
            )}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
            {loading && <p className="text-[13px] text-muted">{t('knowledge.source.loading')}</p>}
            {error && (
              <div role="alert" className="space-y-3">
                <p className="text-[13px] text-danger">{t('knowledge.source.failed', { message: error })}</p>
                <div className="rounded-lg border border-line bg-surface-2 p-3 text-[13px] text-fg-2 whitespace-pre-wrap">{citation.snippet}</div>
              </div>
            )}
            {view && (
              <div className="space-y-4">
                <section aria-label={t('knowledge.source.chunk')}>
                  <h3 className="mb-1.5 text-[12px] font-medium text-muted">{t('knowledge.source.chunk')}</h3>
                  <mark
                    data-source-chunk=""
                    className="block rounded-lg bg-accent-soft p-3 text-[13px] leading-relaxed text-fg whitespace-pre-wrap"
                  >
                    {view.chunkText}
                  </mark>
                </section>
                {view.sectionText && view.sectionText !== view.chunkText && (
                  <section aria-label={t('knowledge.source.section')}>
                    <h3 className="mb-1.5 text-[12px] font-medium text-muted">{t('knowledge.source.section')}</h3>
                    <div className="rounded-lg border border-line p-3 text-[13px] leading-relaxed text-fg-2 whitespace-pre-wrap">
                      {view.sectionText}
                    </div>
                  </section>
                )}
              </div>
            )}
          </div>
          <div className="flex justify-end border-t border-line px-5 py-3">
            <Button variant="ghost" onClick={onClose}>
              {t('knowledge.source.close')}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
