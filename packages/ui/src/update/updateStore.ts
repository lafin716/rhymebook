import { shouldShowUpdateNotice, type UpdateState } from '@branch/core';
import { useEffect } from 'react';
import { create } from 'zustand';
import { appStore, persistence } from '../app/store';
import { desktop, isDemo } from '../app/runtime';
import { pushNotice } from '../app/sync';
import { confirm } from '../components/ConfirmDialog';
import { t } from '../i18n';

/**
 * 앱 업데이트 상태 (ADR-118). 확인·다운로드·설치는 데스크톱 main 프로세스가 하고
 * 여기서는 IPC로 받은 상태를 보여 주고 사용자 선택만 전달한다. 데스크톱이 아니면 아무것도 하지 않는다.
 */
interface UpdateStore {
  state: UpdateState | null;
  /** [나중에]를 누른 새 버전 (다음 버전이 나오면 다시 알린다) */
  dismissedVersion: string | null;
  /** 이번 실행에서만 접어 둔 카드 (받는 중·받은 뒤·오류) */
  hiddenKey: string | null;
}

const DISMISS_KEY = 'octobooks.update.dismissed';

function readDismissed(): string | null {
  try {
    return localStorage.getItem(DISMISS_KEY);
  } catch {
    return null;
  }
}

export const useUpdateStore = create<UpdateStore>(() => ({ state: null, dismissedVersion: readDismissed(), hiddenKey: null }));

const api = desktop?.updater;

/** 상태별 카드 열쇠. 상태나 버전이 바뀌면 접어 둔 카드가 다시 보인다 */
export const noticeKey = (s: UpdateState) => `${s.status}:${s.latestVersion ?? ''}`;

let subscribed = false;
function subscribe() {
  if (subscribed || !api) return;
  subscribed = true;
  api.onChange((state) => useUpdateStore.setState({ state }));
  void api
    .getState()
    .then((state) => useUpdateStore.setState({ state }))
    .catch(() => {});
}

/** 업데이트 상태를 쓰는 화면에서 부른다 (구독은 한 번만) */
export function useUpdateState(): UpdateState | null {
  useEffect(subscribe, []);
  return useUpdateStore((s) => s.state);
}

export function useUpdateNoticeVisible(): boolean {
  const state = useUpdateState();
  const dismissed = useUpdateStore((s) => s.dismissedVersion);
  const hidden = useUpdateStore((s) => s.hiddenKey);
  if (!api || !state || isDemo()) return false;
  return shouldShowUpdateNotice(state, dismissed) && noticeKey(state) !== hidden;
}

export const updateActions = {
  available: () => Boolean(api),

  async check(): Promise<void> {
    if (!api) return;
    useUpdateStore.setState({ dismissedVersion: null, hiddenKey: null });
    try {
      localStorage.removeItem(DISMISS_KEY);
    } catch {
      /* 저장소 없음 */
    }
    useUpdateStore.setState({ state: await api.check() });
  },

  async download(): Promise<void> {
    if (!api) return;
    useUpdateStore.setState({ state: await api.download() });
  },

  /** [나중에]. 새 버전 알림은 그 버전에 대해 다시 띄우지 않고, 그 밖의 카드는 이번 실행에서만 접는다 */
  later(): void {
    const s = useUpdateStore.getState().state;
    if (!s) return;
    if (s.status === 'available' && s.latestVersion) {
      try {
        localStorage.setItem(DISMISS_KEY, s.latestVersion);
      } catch {
        /* 저장소 없음 */
      }
      useUpdateStore.setState({ dismissedVersion: s.latestVersion });
    } else {
      useUpdateStore.setState({ hiddenKey: noticeKey(s) });
    }
  },

  /** 설정 화면에서 접어 둔 알림을 다시 연다 */
  showNotice(): void {
    useUpdateStore.setState({ dismissedVersion: null, hiddenKey: null });
    try {
      localStorage.removeItem(DISMISS_KEY);
    } catch {
      /* 저장소 없음 */
    }
  },

  /**
   * 재시작하여 설치. 생성 중인 응답이 있으면 먼저 묻고, 로컬 저장(IndexedDB 쓰기 대기열)을 끝낸 뒤 설치한다.
   * 저장에 실패하면 설치하지 않는다 (데이터 보호).
   */
  async install(): Promise<void> {
    if (!api) return;
    const streaming = Object.keys(appStore.getState().streaming).length;
    if (streaming > 0) {
      const ok = await confirm({
        title: t('update.notice.busyTitle'),
        message: t('update.notice.busyMessage', { count: streaming }),
        confirmLabel: t('update.notice.busyConfirm'),
      });
      if (!ok) return;
    }
    try {
      await persistence.flush();
    } catch {
      pushNotice(t('update.notice.saveFailed'));
      return;
    }
    await api.install();
  },

  async openRelease(): Promise<void> {
    await api?.openRelease();
  },
};
