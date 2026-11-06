import type { RagTrace, RetrievalNoticeCode, RetrievalTimings } from '@branch/core';
import { t } from '../i18n';
import { useApp } from '../app/store';

/** 사용자가 알아야 하는 대체·실패 안내 (펼치지 않아도 보인다) */
type WarnCode = Exclude<RetrievalNoticeCode, 'expanded'>;
const WARN_CODES: ReadonlySet<RetrievalNoticeCode> = new Set<WarnCode>([
  'semantic_unavailable',
  'embed_failed',
  'insufficient',
  'timeout',
  'kb_skipped',
  'keyword_only',
  'version_conflict',
  'codebase_missing',
]);
const isWarn = (c: RetrievalNoticeCode): c is WarnCode => WARN_CODES.has(c);

const TIMING_KEYS: (keyof RetrievalTimings)[] = ['expandMs', 'embedMs', 'keywordMs', 'symbolMs', 'pathMs', 'folderMs', 'vectorMs', 'fetchMs', 'selectMs', 'totalMs'];

/**
 * 답변 아래 "검색 과정" 한 줄 (ADR-122). 검색한 KB 수·주요 문서·추가 탐색 여부·대체 안내.
 * 펼치면 주요 문서 경로, 디버그 모드(Settings.rag.debug)에서는 단계별 시간까지 보인다.
 * 문서 본문은 담지 않는다 (출처는 CitationChips).
 */
export function RagTraceLine({ trace }: { trace: RagTrace }) {
  const debug = useApp((s) => s.settings.rag?.debug === true);
  const warns = [...new Set(trace.notices.map((n) => n.code).filter(isWarn))];
  const parts = [t('knowledge.trace.kbs', { n: trace.kbIds.length }), t('knowledge.trace.docs', { n: trace.topPaths.length })];
  if (trace.expanded) parts.push(t('knowledge.trace.expanded'));
  if (trace.toolCalls) parts.push(t('knowledge.trace.tools', { n: trace.toolCalls }));
  if (trace.semanticKbIds?.length) parts.push(t('knowledge.trace.semantic'));
  const timings = trace.timings ?? {};
  return (
    <div data-rag-trace="" className="flex flex-col gap-1 text-[12px] text-muted">
      <details>
        <summary className="cursor-pointer select-none">
          {t('knowledge.trace.label')} · {t(`knowledge.mode.${trace.mode}`)} · {parts.join(' · ')}
        </summary>
        <div className="mt-1 flex flex-col gap-1 pl-3">
          {trace.topPaths.length > 0 && (
            <ul className="flex flex-col gap-0.5" aria-label={t('knowledge.trace.topDocs')}>
              {trace.topPaths.map((p) => (
                <li key={p} className="truncate font-mono text-[11.5px]">
                  {p}
                </li>
              ))}
            </ul>
          )}
          {debug && (
            <dl data-rag-debug="" className="grid grid-cols-[auto_1fr] gap-x-3 font-mono text-[11px]">
              <dt>sufficient</dt>
              <dd>{trace.sufficient === undefined ? '-' : String(trace.sufficient)}</dd>
              {TIMING_KEYS.filter((k) => typeof timings[k] === 'number').map((k) => (
                <div key={k} className="contents">
                  <dt>{k}</dt>
                  <dd>{Math.round(timings[k]!)} ms</dd>
                </div>
              ))}
              {trace.notices.length > 0 && (
                <>
                  <dt>notices</dt>
                  <dd>{trace.notices.map((n) => (n.kbId ? `${n.code}(${n.kbId})` : n.code)).join(', ')}</dd>
                </>
              )}
            </dl>
          )}
        </div>
      </details>
      {warns.map((code) => (
        <p key={code} role="note" data-rag-notice={code} className="text-warn">
          {t(`knowledge.notice.${code}`)}
        </p>
      ))}
    </div>
  );
}
