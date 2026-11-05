import { t } from '../i18n';
import { useEffect } from 'react';
import { useStore } from 'zustand';
import { pushNotice, remoteNotices, syncClient } from '../app/sync';

/** 원격 조작이 거절·실패했을 때의 안내 (SyncActError 코드 → 한국어) */
const FAILURE_TEXT: Record<string, string> = {
  get offline() { return t('components.toast.offline'); },
  get timeout() { return t('components.toast.timeout'); },
  get busy() { return t('components.toast.busy'); },
  get 'rate-limit'() { return t('components.toast.rateLimit'); },
  get forbidden() { return t('components.toast.forbidden'); },
  get 'not-found'() { return t('components.toast.notFound'); },
  get conflict() { return t('components.toast.conflict'); },
  get 'not-ready'() { return t('components.toast.notReady'); },
  get outdated() { return t('components.toast.outdated'); },
  get invalid() { return t('components.toast.invalid'); },
  get failed() { return t('components.toast.failed'); },
};

/** 화면 하단 토스트. 원격 기기: 조작 실패 안내 · PC: 원격 조작 알림 */
export function Toasts() {
  const items = useStore(remoteNotices, (s) => s.items);

  useEffect(() => {
    if (!syncClient) return;
    return syncClient.state.subscribe((s, prev) => {
      const f = s.lastFailure;
      if (f && f !== prev.lastFailure) pushNotice(FAILURE_TEXT[f.code] ?? FAILURE_TEXT.failed!);
      if (s.resumeFailedAt && s.resumeFailedAt !== prev.resumeFailedAt) pushNotice(t('components.toast.resumeFailed', { host: s.hostName ?? 'PC' }));
    });
  }, []);

  if (!items.length) return null;
  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-[max(5.5rem,calc(env(safe-area-inset-bottom)+5.5rem))] z-[100] flex flex-col items-center gap-2 px-4"
    >
      {items.map((n) => (
        <div key={n.id} role="status" className="animate-pop-in max-w-sm rounded-xl bg-fg px-3.5 py-2 text-[13px] text-bg shadow-float">
          {n.text}
        </div>
      ))}
    </div>
  );
}
