import type { UpdateModeReason, UpdateState } from '@branch/core';
import { RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { Button } from '../components/Button';
import { t } from '../i18n';
import { updateErrorText } from '../update/UpdateNotice';
import { updateActions, useUpdateState } from '../update/updateStore';
import { Section } from './controls';

function reasonText(r: UpdateModeReason): string {
  switch (r) {
    case 'dev':
      return t('update.settings.reason.dev');
    case 'env-disabled':
      return t('update.settings.reason.envDisabled');
    case 'mac-unsigned':
      return t('update.settings.reason.macUnsigned');
    case 'linux-package':
      return t('update.settings.reason.linuxPackage');
    case 'portable':
      return t('update.settings.reason.portable');
    default:
      return t('update.settings.reason.unsupportedPlatform');
  }
}

function statusText(s: UpdateState): string | null {
  switch (s.status) {
    case 'checking':
      return t('update.settings.checking');
    case 'available':
      return t('update.settings.available', { version: s.latestVersion ?? '' });
    case 'downloading':
      return t('update.settings.downloading', { percent: Math.round(s.percent ?? 0) });
    case 'downloaded':
      return t('update.settings.downloaded', { version: s.latestVersion ?? '' });
    case 'installing':
      return t('update.settings.installing');
    case 'error':
      return null;
    default:
      return s.lastCheckedAt ? t('update.settings.upToDate') : null;
  }
}

/** 설정 > 일반 > 앱 업데이트 (데스크톱 전용, ADR-118) */
export function UpdateSettings() {
  const state = useUpdateState();
  const [pending, setPending] = useState(false);
  if (!state) return null;

  const disabled = state.mode === 'disabled';
  const status = statusText(state);
  const hasNotice = state.status === 'available' || state.status === 'downloaded' || (state.status === 'error' && state.error?.during !== 'check');
  const busy = pending || state.status === 'checking' || state.status === 'downloading' || state.status === 'installing';

  const check = async () => {
    setPending(true);
    try {
      await updateActions.check();
    } finally {
      setPending(false);
    }
  };

  return (
    <Section title={t('update.settings.title')} hint={disabled ? undefined : t('update.settings.hint')}>
      <div data-testid="update-settings" className="rounded-xl border border-line bg-surface px-3.5 py-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="text-[13.5px] font-medium">{t('update.settings.current', { version: state.currentVersion })}</div>
            {status && (
              <p role="status" className="mt-0.5 text-[12.5px] text-fg-2">
                {status}
              </p>
            )}
            {state.error && (state.status === 'error' || state.error.during === 'check') && (
              <p role="alert" className="mt-0.5 text-[12.5px] text-danger">
                {updateErrorText(state.error.kind)}
              </p>
            )}
          </div>
          {!disabled && (
            <div className="flex gap-2">
              {hasNotice && (
                <Button size="sm" variant="ghost" onClick={() => updateActions.showNotice()}>
                  {t('update.settings.showNotice')}
                </Button>
              )}
              <Button size="sm" variant="secondary" disabled={busy} icon={<RefreshCw size={14} className={busy ? 'animate-spin' : undefined} />} onClick={check}>
                {state.status === 'checking' ? t('update.settings.checking') : t('update.settings.check')}
              </Button>
            </div>
          )}
        </div>
        <p className="mt-2 text-[12px] text-muted">
          {state.modeReason ? reasonText(state.modeReason) : state.mode === 'auto' ? t('update.settings.modeAuto') : t('update.settings.modeManual')}
          {state.mode === 'manual' && state.modeReason ? ` ${t('update.settings.modeManual')}` : ''}
        </p>
        {state.lastCheckedAt && !disabled ? (
          <p className="mt-0.5 text-[12px] text-muted">{t('update.settings.lastChecked', { time: new Date(state.lastCheckedAt).toLocaleString() })}</p>
        ) : null}
      </div>
    </Section>
  );
}
