import type { UpdateErrorKind, UpdateState } from '@branch/core';
import { Download, ExternalLink, RefreshCw, RotateCw, Sparkles, TriangleAlert, X } from 'lucide-react';
import { useState } from 'react';
import { Button, IconButton } from '../components/Button';
import { t } from '../i18n';
import { updateActions, useUpdateNoticeVisible, useUpdateState } from './updateStore';

export function updateErrorText(kind: UpdateErrorKind): string {
  switch (kind) {
    case 'network':
      return t('update.errors.network');
    case 'rate-limit':
      return t('update.errors.rateLimit');
    case 'integrity':
      return t('update.errors.integrity');
    case 'signature':
      return t('update.errors.signature');
    case 'not-found':
      return t('update.errors.notFound');
    case 'disk':
      return t('update.errors.disk');
    default:
      return t('update.errors.unknown');
  }
}

export function formatBytes(n: number | undefined): string {
  if (!n || n < 0) return '0 MB';
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function titleOf(s: UpdateState): string {
  switch (s.status) {
    case 'downloading':
      return t('update.notice.downloadingTitle');
    case 'downloaded':
      return t('update.notice.downloadedTitle');
    case 'installing':
      return t('update.notice.installingTitle');
    case 'error':
      return t('update.notice.errorTitle');
    default:
      return t('update.notice.availableTitle');
  }
}

/**
 * 앱 업데이트 알림 카드 (ADR-118). 데스크톱에서만 보이며, 데스크톱 화면에서는 오른쪽 아래, 좁은 화면에서는 아래 전체 폭.
 * 새 버전 → [업데이트 다운로드]/[나중에] → 진행률 → [재시작하여 설치]. 실패하면 안내와 [다시 시도].
 */
export function UpdateNotice() {
  const state = useUpdateState();
  const visible = useUpdateNoticeVisible();
  const [notesOpen, setNotesOpen] = useState(false);
  const [pending, setPending] = useState(false);
  if (!visible || !state) return null;

  const run = (fn: () => Promise<void>) => async () => {
    if (pending) return;
    setPending(true);
    try {
      await fn();
    } finally {
      setPending(false);
    }
  };

  const manual = state.mode === 'manual';
  const percent = Math.round(state.percent ?? 0);
  const err = state.error;
  const busy = pending || state.status === 'downloading' || state.status === 'installing';

  return (
    <section
      role="dialog"
      aria-label={t('update.notice.aria')}
      data-testid="update-notice"
      className="animate-pop-in fixed inset-x-3 bottom-[max(0.75rem,calc(env(safe-area-inset-bottom)+0.75rem))] z-[90] rounded-2xl border border-line bg-surface p-4 text-fg shadow-float md:inset-x-auto md:right-5 md:bottom-5 md:w-[360px]"
    >
      <div className="flex items-start gap-2.5">
        <span
          className={
            state.status === 'error'
              ? 'mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-surface-2 text-danger'
              : 'mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent'
          }
        >
          {state.status === 'error' ? <TriangleAlert size={15} /> : <Sparkles size={15} />}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-[14px] font-semibold">{titleOf(state)}</h2>
          <p className="mt-0.5 text-[12.5px] text-muted">
            {t('update.notice.versions', { current: state.currentVersion, latest: state.latestVersion ?? '' })}
          </p>
        </div>
        {state.status !== 'installing' && (
          <IconButton label={t('update.notice.close')} size="sm" onClick={() => updateActions.later()}>
            <X size={15} />
          </IconButton>
        )}
      </div>

      {state.releaseNotes && state.status === 'available' && (
        <div className="mt-2.5">
          <button
            type="button"
            className="text-[12.5px] font-medium text-accent hover:underline"
            aria-expanded={notesOpen}
            onClick={() => setNotesOpen((v) => !v)}
          >
            {notesOpen ? t('update.notice.notesHide') : t('update.notice.notesShow')}
          </button>
          {notesOpen && (
            <div
              data-testid="update-notes"
              className="mt-1.5 max-h-48 overflow-y-auto rounded-lg bg-surface-2 px-3 py-2 text-[12.5px] leading-relaxed whitespace-pre-wrap text-fg-2"
            >
              {state.releaseNotes}
            </div>
          )}
        </div>
      )}

      {manual && state.status === 'available' && <p className="mt-2.5 text-[12.5px] text-fg-2">{t('update.notice.manualHint')}</p>}

      {state.status === 'downloading' && (
        <div className="mt-3" data-testid="update-progress">
          <div
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
            className="h-1.5 w-full overflow-hidden rounded-full bg-surface-2"
          >
            <div className="h-full rounded-full bg-accent transition-[width] duration-300" style={{ width: `${percent}%` }} />
          </div>
          <div className="mt-1.5 flex justify-between text-[12px] text-muted tabular-nums">
            <span>{t('update.notice.progress', { percent })}</span>
            {state.total ? (
              <span>{t('update.notice.progressBytes', { transferred: formatBytes(state.transferred), total: formatBytes(state.total) })}</span>
            ) : null}
          </div>
        </div>
      )}

      {state.status === 'downloaded' && <p className="mt-2.5 text-[12.5px] text-fg-2">{t('update.notice.downloadedHint')}</p>}
      {state.status === 'installing' && <p className="mt-2.5 text-[12.5px] text-fg-2">{t('update.notice.installingHint')}</p>}

      {err && (state.status === 'error' || state.status === 'downloaded') && (
        <p role="alert" className="mt-2.5 text-[12.5px] text-danger">
          {updateErrorText(err.kind)}
        </p>
      )}

      <div className="mt-3.5 flex flex-wrap justify-end gap-2">
        {state.status === 'available' && (
          <>
            <Button size="sm" variant="ghost" onClick={() => updateActions.later()}>
              {t('update.notice.later')}
            </Button>
            {manual ? (
              <Button size="sm" variant="primary" icon={<ExternalLink size={14} />} onClick={run(updateActions.openRelease)}>
                {t('update.notice.openRelease')}
              </Button>
            ) : (
              <Button size="sm" variant="primary" disabled={busy} icon={<Download size={14} />} onClick={run(updateActions.download)}>
                {t('update.notice.download')}
              </Button>
            )}
          </>
        )}
        {state.status === 'downloaded' && (
          <>
            <Button size="sm" variant="ghost" onClick={() => updateActions.later()}>
              {t('update.notice.later')}
            </Button>
            <Button size="sm" variant="primary" disabled={busy} icon={<RotateCw size={14} />} onClick={run(updateActions.install)}>
              {t('update.notice.restart')}
            </Button>
          </>
        )}
        {state.status === 'error' && (
          <>
            <Button size="sm" variant="ghost" icon={<ExternalLink size={14} />} onClick={run(updateActions.openRelease)}>
              {t('update.notice.openRelease')}
            </Button>
            <Button size="sm" variant="primary" disabled={busy} icon={<RefreshCw size={14} />} onClick={run(updateActions.download)}>
              {t('update.notice.retry')}
            </Button>
          </>
        )}
      </div>
    </section>
  );
}
