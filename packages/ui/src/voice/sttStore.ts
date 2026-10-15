import type { SttManageOp, SttModelId, SttState, SttStatus } from '@branch/core';
import { useEffect } from 'react';
import { create } from 'zustand';
import { desktop, sttClient } from '../app/runtime';
import { usePcOnline } from '../components/PcStatus';

/**
 * 음성 입력 상태 (ADR-045). 켜짐·모델은 PC 설정이 정하고, 웹·모바일은 페어링된 PC에 물어 따른다.
 * 데스크톱은 IPC 변경 알림으로, 원격은 연결·화면 복귀 때마다 다시 묻는다.
 * 원격 설정 화면은 PC 설정을 바꿀 수도 있다 (ADR-046).
 */
interface SttStore {
  status: SttStatus | null;
  /** 설정 화면용 전체 상태 */
  state: SttState | null;
  /** 원격: 전체 상태를 못 받았을 때(이전 버전 PC 등) 이유 */
  stateError: string | null;
}

export const useSttStore = create<SttStore>(() => ({ status: null, state: null, stateError: null }));

const sttApi = desktop?.stt;
const OFF: SttStatus = { enabled: false, ready: false };

let inflight: Promise<void> | null = null;

export function refreshStt(): Promise<void> {
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      if (sttApi) {
        const state = await sttApi.getState();
        useSttStore.setState({ state, status: pick(state) });
      } else {
        useSttStore.setState({ status: await sttClient.client.sttStatus() });
      }
    } catch {
      // 연결 안 됨·이전 버전 PC: 마이크를 숨긴다
      useSttStore.setState({ status: OFF });
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

const pick = ({ enabled, ready, detail }: SttStatus): SttStatus => ({ enabled, ready, ...(detail ? { detail } : {}) });

let subscribed = false;
function subscribeDesktop() {
  if (subscribed || !sttApi) return;
  subscribed = true;
  sttApi.onChange((state) => useSttStore.setState({ state, status: pick(state) }));
}

/** 음성 입력 상태를 쓰는 화면에서 부른다. PC 연결·화면 복귀 때 다시 확인한다 */
export function useSttStatus(): SttStatus | null {
  const status = useSttStore((s) => s.status);
  const online = usePcOnline();
  useEffect(() => {
    subscribeDesktop();
    if (!sttApi && !online) {
      useSttStore.setState({ status: OFF });
      return;
    }
    void refreshStt();
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refreshStt();
    };
    document.addEventListener('visibilitychange', onVisible);
    // 원격: PC에서 설정을 바꾸면 알림이 없으므로 가끔 다시 묻는다
    const timer = sttApi ? 0 : window.setInterval(() => document.visibilityState === 'visible' && void refreshStt(), 30_000);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.clearInterval(timer);
    };
  }, [online]);
  return status;
}

/** 데스크톱 설정 화면: 전체 상태 */
export function useSttState(): SttState | null {
  const state = useSttStore((s) => s.state);
  useEffect(() => {
    subscribeDesktop();
    void refreshStt();
  }, []);
  return state;
}

let stateInflight: Promise<void> | null = null;

/** 원격 설정 화면: PC의 전체 상태를 다시 받는다 (느린 연결에서 요청이 쌓이지 않게 하나씩) */
function refreshRemoteState(): Promise<void> {
  stateInflight ??= (async () => {
    try {
      const state = await sttClient.client.sttState();
      useSttStore.setState({ state, status: pick(state), stateError: null });
    } catch (e) {
      useSttStore.setState({ stateError: e instanceof Error ? e.message : '음성 설정을 불러오지 못했습니다.' });
    } finally {
      stateInflight = null;
    }
  })();
  return stateInflight;
}

/** 원격에서 PC 음성 설정을 바꾼다. 바뀐 상태를 바로 반영한다 */
async function manageRemote(op: SttManageOp, model?: SttModelId): Promise<SttState> {
  const state = await sttClient.client.sttManage(op, model);
  useSttStore.setState({ state, status: pick(state), stateError: null });
  return state;
}

/** 설정 화면의 동작 (데스크톱 IPC와 원격 bridge가 같은 모양) */
export interface SttActions {
  setEnabled(enabled: boolean): Promise<SttState>;
  setModel(model: SttModelId): Promise<SttState>;
  download(model: SttModelId): Promise<SttState>;
  cancelDownload(): Promise<SttState>;
  remove(model: SttModelId): Promise<SttState>;
}

export const remoteSttActions: SttActions = {
  setEnabled: (v) => manageRemote(v ? 'enable' : 'disable'),
  setModel: (m) => manageRemote('select', m),
  download: (m) => manageRemote('download', m),
  cancelDownload: () => manageRemote('cancel'),
  remove: (m) => manageRemote('remove', m),
};

/** 받는 중이면 진행률을 자주, 아니면 PC에서 바뀐 것을 가끔 확인한다 */
const POLL_DOWNLOADING_MS = 1_000;
const POLL_IDLE_MS = 10_000;

/** 원격 설정 화면: PC의 전체 상태. 연결돼 있을 때만 묻는다 */
export function useRemoteSttState(online: boolean): { state: SttState | null; error: string | null } {
  const state = useSttStore((s) => s.state);
  const error = useSttStore((s) => s.stateError);
  const downloading = !!state?.download;
  useEffect(() => {
    if (!online) return;
    void refreshRemoteState();
    const timer = window.setInterval(
      () => document.visibilityState === 'visible' && void refreshRemoteState(),
      downloading ? POLL_DOWNLOADING_MS : POLL_IDLE_MS,
    );
    return () => window.clearInterval(timer);
  }, [online, downloading]);
  return { state: online ? state : null, error };
}
