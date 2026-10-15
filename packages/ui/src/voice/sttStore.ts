import type { SttState, SttStatus } from '@branch/core';
import { useEffect } from 'react';
import { create } from 'zustand';
import { desktop, sttClient } from '../app/runtime';
import { usePcOnline } from '../components/PcStatus';

/**
 * 음성 입력 상태 (ADR-045). 켜짐·모델은 PC 설정이 정하고, 웹·모바일은 페어링된 PC에 물어 따른다.
 * 데스크톱은 IPC 변경 알림으로, 원격은 연결·화면 복귀 때마다 다시 묻는다.
 */
interface SttStore {
  status: SttStatus | null;
  /** 데스크톱 설정 화면용 전체 상태 */
  state: SttState | null;
}

export const useSttStore = create<SttStore>(() => ({ status: null, state: null }));

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
