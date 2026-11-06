import { canChangeKind, cleanExcludes, DEFAULT_CODEBASE_EXCLUDES, type DesktopKnowledgeApi, type KnowledgeBase, type KnowledgeIndexState, type KnowledgeKind, type KnowledgeReadiness, type ReadinessInfo } from '@branch/core';
import { ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { intlLocale, t } from '../i18n';
import { Button } from '../components/Button';
import { cn } from '../lib/cn';
import { kindKey, methodKey, validTime } from './kbModel';

/** 준비 상태 색. 실패는 붉게, 진행·경고는 노랑/파랑, 정상은 초록으로 보인다 */
const TONE: Record<KnowledgeReadiness, string> = {
  ready: 'bg-surface-2 text-ok',
  empty: 'bg-surface-2 text-fg-2',
  loading: 'bg-accent-soft text-accent',
  indexing: 'bg-accent-soft text-accent',
  rebuilding: 'bg-accent-soft text-accent',
  partial: 'bg-warn-soft text-warn',
  cancelled: 'bg-warn-soft text-warn',
  needsKind: 'bg-warn-soft text-warn',
  failed: 'bg-danger-soft text-danger',
};

/** 원인 키 → 문구. 알 수 없는 원인은 일반 문구로 보인다 */
const CAUSE_KEYS = ['updating', 'last_failed', 'stale', 'failed_docs', 'index_error', 'not_indexed', 'codebase_missing', 'cancelled', 'interrupted'] as const;
type CauseKey = (typeof CAUSE_KEYS)[number];
const isCauseKey = (c: string): c is CauseKey => (CAUSE_KEYS as readonly string[]).includes(c);
export function causeText(cause: string | undefined): string | null {
  if (!cause) return null;
  const key: CauseKey | 'unknown' = isCauseKey(cause) ? cause : 'unknown';
  return t(`knowledge.cause.${key}`);
}

export function ReadinessBadge({ info }: { info: ReadinessInfo }) {
  return (
    <span data-readiness={info.readiness} className={cn('inline-flex shrink-0 items-center rounded-full px-2 py-px text-[11px] font-medium', TONE[info.readiness])}>
      {t(`knowledge.readiness.${info.readiness}`)}
    </span>
  );
}

/** 원인과 해결 방법. 조치 버튼이 없는 경우(예: 코드베이스 폴더 사라짐)에도 무엇을 해야 하는지 알려 준다 */
export function ReadinessNote({ info }: { info: ReadinessInfo }) {
  const cause = causeText(info.cause);
  if (!cause && !info.action) return null;
  return (
    <div role="note" data-readiness-note={info.readiness} className="flex flex-col gap-0.5 rounded-lg bg-surface-2 px-3 py-2 text-[12px] text-fg-2">
      {cause && <span>{cause}</span>}
      {info.action && <span className="text-fg">{t(`knowledge.fix.${info.action}`)}</span>}
    </div>
  );
}

/** 목록 항목에 붙는 유형 표시 */
export function KindBadge({ kind }: { kind: KnowledgeKind | undefined }) {
  const key = kindKey(kind);
  return (
    <span data-kind={key} className={cn('inline-flex shrink-0 items-center rounded-full border border-line px-1.5 py-px text-[11px] font-medium', key === 'codebase' ? 'text-accent' : 'text-fg-2')}>
      {t(`knowledge.kind.${key}`)}
    </span>
  );
}

/** 개요: 유형·검색 방식·연결 경로·개수·갱신 시각·준비 상태 */
export function KbOverview({ kb, info }: { kb: KnowledgeBase; info: ReadinessInfo }) {
  const method = methodKey(kb.kind);
  const rows: [string, string][] = [
    [t('knowledge.overview.kind'), t(`knowledge.kind.${kindKey(kb.kind)}`)],
    [t('knowledge.overview.method'), t(`knowledge.method.${method}`)],
  ];
  if (kb.kind === 'codebase' && kb.linkedPath) rows.push([t('knowledge.overview.path'), kb.linkedPath]);
  rows.push([t('knowledge.overview.files'), kb.statsPending ? t('knowledge.list.counting') : t('knowledge.list.count', { count: kb.fileCount })]);
  const updated = validTime(kb.updatedAt);
  if (updated !== null) rows.push([t('knowledge.overview.updated'), new Date(updated).toLocaleString(intlLocale())]);
  return (
    <section aria-label={t('knowledge.overview.heading')} data-kb-overview="" className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <KindBadge kind={kb.kind} />
        <ReadinessBadge info={info} />
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[13px]">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-fg-2">{k}</dt>
            <dd className="min-w-0 truncate text-fg" title={v}>
              {v}
            </dd>
          </div>
        ))}
      </dl>
      <ReadinessNote info={info} />
    </section>
  );
}

/** 코드베이스 제외 목록 편집. 저장하면 다음 질문부터 새 목록을 쓴다 (색인이 없어 다시 색인할 것은 없다). */
export function ExcludesEditor({ kb, api, disabled, onSaved, onError }: { kb: KnowledgeBase; api: DesktopKnowledgeApi; disabled: boolean; onSaved(): void; onError(e: unknown): void }) {
  const initial = (kb.excludes ?? DEFAULT_CODEBASE_EXCLUDES).join('\n');
  const [text, setText] = useState(initial);
  const [saving, setSaving] = useState(false);
  const supported = !!api.setExcludes;
  const dirty = text !== initial;
  const save = async () => {
    if (!api.setExcludes) return;
    setSaving(true);
    try {
      await api.setExcludes(kb.id, cleanExcludes(text.split('\n')));
      onSaved();
    } catch (e) {
      onError(e);
    } finally {
      setSaving(false);
    }
  };
  return (
    <section aria-label={t('knowledge.codebase.excludes')} data-excludes-editor="" className="flex flex-col gap-2">
      <h4 className="text-[13px] font-semibold text-fg-2">{t('knowledge.codebase.excludes')}</h4>
      <p className="text-[12px] text-fg-2">{t('knowledge.codebase.excludesHint')}</p>
      <textarea
        aria-label={t('knowledge.codebase.excludes')}
        value={text}
        disabled={disabled || !supported || saving}
        rows={6}
        spellCheck={false}
        onChange={(e) => setText(e.target.value)}
        className="scroll-thin min-h-24 w-full resize-y rounded-lg border border-line bg-surface p-2 font-mono text-[12px] outline-none focus:border-accent disabled:opacity-60"
      />
      <div className="flex flex-wrap justify-end gap-2">
        <Button size="sm" variant="ghost" disabled={disabled || saving || text === DEFAULT_CODEBASE_EXCLUDES.join('\n')} onClick={() => setText(DEFAULT_CODEBASE_EXCLUDES.join('\n'))}>
          {t('knowledge.codebase.excludesReset')}
        </Button>
        <Button size="sm" variant="primary" disabled={disabled || !supported || !dirty || saving} onClick={() => void save()}>
          {t('knowledge.codebase.excludesSave')}
        </Button>
      </div>
    </section>
  );
}

/** 문서 색인 정비: 실패한 문서 재시도, 전체 다시 만들기, 무결성 확인, 백업 복원. 없는 API 버튼은 숨긴다. */
export function DocMaintenance({
  kb,
  state,
  api,
  disabled,
  onChanged,
  onError,
}: {
  kb: KnowledgeBase;
  state: KnowledgeIndexState | undefined;
  api: DesktopKnowledgeApi;
  disabled: boolean;
  onChanged(): void;
  onError(e: unknown): void;
}) {
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const run = async (fn: () => Promise<string | null>) => {
    setPending(true);
    setMsg(null);
    try {
      setMsg(await fn());
      onChanged();
    } catch (e) {
      onError(e);
    } finally {
      setPending(false);
    }
  };
  const failed = state?.failedDocs ?? 0;
  return (
    <section aria-label={t('knowledge.maint.heading')} data-doc-maint="" className="flex flex-col gap-2">
      <h4 className="text-[13px] font-semibold text-fg-2">{t('knowledge.maint.heading')}</h4>
      <div className="flex flex-wrap gap-2">
        {api.reindex && failed > 0 && (
          <Button size="sm" variant="soft" disabled={disabled || pending} onClick={() => run(async () => (await api.reindex!(kb.id, { retryFailed: true }), t('knowledge.maint.retried', { count: failed })))}>
            {t('knowledge.maint.retryFailed', { count: failed })}
          </Button>
        )}
        {api.reindex && (
          <Button size="sm" variant="secondary" disabled={disabled || pending} onClick={() => run(async () => (await api.reindex!(kb.id, { full: true }), t('knowledge.maint.rebuilding')))}>
            {t('knowledge.maint.rebuild')}
          </Button>
        )}
        {api.verifyIndex && (
          <Button
            size="sm"
            variant="secondary"
            icon={<ShieldCheck size={14} />}
            disabled={disabled || pending}
            onClick={() =>
              run(async () => {
                const r = await api.verifyIndex!(kb.id);
                return r.ok ? t('knowledge.maint.verifyOk') : t('knowledge.maint.verifyBad');
              })
            }
          >
            {t('knowledge.maint.verify')}
          </Button>
        )}
        {api.restoreIndexBackup && (
          <Button
            size="sm"
            variant="ghost"
            disabled={disabled || pending}
            onClick={() =>
              run(async () => ((await api.restoreIndexBackup!(kb.id)) ? t('knowledge.maint.restored') : t('knowledge.maint.noBackup')))
            }
          >
            {t('knowledge.maint.restore')}
          </Button>
        )}
      </div>
      {msg && (
        <p role="status" className="text-[12px] text-fg-2">
          {msg}
        </p>
      )}
    </section>
  );
}

/** 미분류 지식베이스: 제안 유형을 보여 주고 사용자가 고르게 한다. 코드베이스로 바꿀 수 없는 경우(연결 경로 제약)는 막는다. */
export function KindChooser({ kb, api, disabled, onChanged, onError }: { kb: KnowledgeBase; api: DesktopKnowledgeApi; disabled: boolean; onChanged(): void; onError(e: unknown): void }) {
  const [pending, setPending] = useState(false);
  const suggestion = kb.kindSuggestion;
  const choose = async (kind: KnowledgeKind) => {
    if (!api.setKind) return;
    setPending(true);
    try {
      await api.setKind(kb.id, kind);
      onChanged();
    } catch (e) {
      onError(e);
    } finally {
      setPending(false);
    }
  };
  const kinds: KnowledgeKind[] = ['codebase', 'document'];
  return (
    <section data-kind-chooser="" role="region" aria-label={t('knowledge.kind.choose')} className="flex flex-col gap-2 rounded-xl border border-warn/40 bg-warn-soft p-3">
      <p className="text-[13px] font-medium text-fg">{t('knowledge.kind.choose')}</p>
      {suggestion && <p className="text-[12px] text-fg-2">{t('knowledge.kind.suggest', { kind: t(`knowledge.kind.${suggestion.kind}`) })}</p>}
      <div className="flex flex-wrap gap-2">
        {kinds.map((k) => {
          const allowed = canChangeKind(kb, k);
          return (
            <Button
              key={k}
              size="sm"
              variant={suggestion?.kind === k ? 'primary' : 'secondary'}
              disabled={disabled || pending || !allowed || !api.setKind}
              title={allowed ? undefined : t('knowledge.kind.blocked')}
              onClick={() => void choose(k)}
            >
              {t(`knowledge.kind.${k}`)}
            </Button>
          );
        })}
      </div>
    </section>
  );
}
