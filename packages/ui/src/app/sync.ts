import {
  createSyncClient,
  createSyncHost,
  syncLinkOf,
  type DesktopWindowsApi,
  type RemotePairing,
  type SyncClient,
  type SyncClientState,
  type SyncHost,
  type SyncLink,
  type SyncOp,
} from '@branch/core';
import { useEffect, useState } from 'react';
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import { isUsable } from '../lib/connection';
import { remoteMode } from './capabilities';
import { desktop, isDemo, loadRemotePairing, remoteLink, saveRemotePairing, sessionWindowId } from './runtime';
import { appStore, loadPersisted } from './store';

/**
 * 원격 전용 동기화 연결 (ADR-026).
 * - 웹·모바일(remoteMode): 데이터는 PC에만 있고, 이 기기는 PC 스토어를 미러링한다.
 *   질문·가지·삭제 등은 PC로 신호를 보내고 실제 CLI 호출은 PC가 한다.
 * - 데스크톱: 이 PC 스토어를 원격 기기에 내보내는 호스트 엔진을 켠다.
 */

/* ── 클라이언트 (웹·모바일) ─────────────────────────────── */

/** 세션 창 → 같은 PC 메인 창(엔진) 링크 (ADR-036). 끊김은 main이 sync.error로 알린다 */
function windowLink(link: NonNullable<DesktopWindowsApi['link']>): SyncLink {
  return {
    send: (msg) => {
      link.send(msg);
      return true;
    },
    subscribe: (cb) => link.onMessage(cb),
    onDisconnect: () => () => {},
    ensure: () => Promise.resolve(),
  };
}

const localLink = sessionWindowId ? desktop?.windows?.link : undefined;

export const syncClient: SyncClient | null = remoteMode
  ? createSyncClient(
      localLink
        ? { store: appStore, link: windowLink(localLink), isPaired: async () => true, backoff: { base: 300, max: 3000 } }
        : {
            store: appStore,
            link: syncLinkOf(remoteLink),
            isPaired: async () => !!(await loadRemotePairing()),
          },
    )
  : null;

const idleState = createStore<SyncClientState>(() => ({ status: 'unsupported', loaded: {} }));

/** 원격 동기화 상태 구독 (데스크톱에서는 항상 unsupported) */
export function useSync<T>(selector: (s: SyncClientState) => T): T {
  return useStore(syncClient?.state ?? idleState, selector);
}

/** 페어링을 저장·해제하고 동기화를 다시 시작한다 */
export async function setPairing(p: RemotePairing | null): Promise<void> {
  await saveRemotePairing(p);
  if (!syncClient || isDemo()) return;
  if (p) {
    syncClient.stop();
    syncClient.start();
  } else {
    syncClient.stop();
    clearMirror();
  }
}

/** 미러링한 PC 데이터를 화면에서 지운다 (페어링 해제) */
function clearMirror() {
  const st = appStore.getState();
  st.applyRemote({ sessions: {}, messages: {}, streaming: {}, summaryDrafts: {}, view: { ...st.view, activeSessionId: null, splitSessionIds: [], popups: [], sheetSessionIds: [], mode: 'single' } });
}

/* ── 원격 모드 화면 설정 (기기별, localStorage) ─────────────── */

const ANCHOR_KEY = 'branch.anchorOpenTarget';

function loadLocalSettings() {
  try {
    const v = localStorage.getItem(ANCHOR_KEY);
    if (v === 'popup' || v === 'split') appStore.getState().updateSettings({ anchorOpenTarget: v });
  } catch {
    /* 저장소 접근 불가 */
  }
  appStore.subscribe((s, prev) => {
    if (s.settings.anchorOpenTarget === prev.settings.anchorOpenTarget) return;
    try {
      localStorage.setItem(ANCHOR_KEY, s.settings.anchorOpenTarget);
    } catch {
      /* 저장소 접근 불가 */
    }
  });
}

/* ── 호스트 엔진 (데스크톱) ─────────────────────────────── */

const ALLOW_DELETE_KEY = 'branch.host.allowRemoteDelete';

export function remoteDeleteAllowed(): boolean {
  try {
    return localStorage.getItem(ALLOW_DELETE_KEY) !== '0';
  } catch {
    return true;
  }
}

export function setRemoteDeleteAllowed(on: boolean) {
  try {
    localStorage.setItem(ALLOW_DELETE_KEY, on ? '1' : '0');
  } catch {
    /* 저장소 접근 불가 */
  }
}

const OP_LABEL: Record<SyncOp['kind'], string> = {
  newRoot: '새 학습을 시작했어요',
  send: '질문을 보냈어요',
  stop: '응답을 멈췄어요',
  retry: '다시 답변을 요청했어요',
  branch: '가지를 만들었어요',
  rename: '세션 이름을 바꿨어요',
  'session.agent': '답할 에이전트·모델을 바꿨어요',
  delete: '세션을 삭제했어요',
  'summary.request': '요약을 요청했어요',
  'summary.discard': '요약 초안을 버렸어요',
  'summary.attach': '요약을 붙였어요',
  'summary.remove': '요약을 떼어 냈어요',
  'annot.set': '메모를 추가했어요',
  'annot.delete': '메모를 삭제했어요',
};

export interface RemoteNotice {
  id: number;
  text: string;
}

/** 원격 기기의 조작 알림 (PC 화면 토스트) */
export const remoteNotices = createStore<{ items: RemoteNotice[] }>(() => ({ items: [] }));
let noticeSeq = 0;

export function pushNotice(text: string) {
  const id = ++noticeSeq;
  remoteNotices.setState((s) => ({ items: [...s.items.slice(-2), { id, text }] }));
  window.setTimeout(() => remoteNotices.setState((s) => ({ items: s.items.filter((n) => n.id !== id) })), 3500);
}

const HOST_CLI_ORDER = ['claude-cli', 'codex-cli'] as const;

/** 세션 창은 엔진이 아니다 (메인 창만 호스트를 연다) */
const sync = sessionWindowId ? undefined : desktop?.host?.sync;

/** 같은 PC의 세션 창 피어 (main 프로세스가 붙이는 접두사) */
const isWindowPeer = (peerId: string) => peerId.startsWith('win-');
let hostName = 'PC';
let deviceNames = new Map<string, string>();

export const syncHost: SyncHost | null = sync
  ? createSyncHost({
      store: appStore,
      hostName: () => hostName,
      send: (peerId, msg) => sync.send(peerId, msg),
      rootProvider: () => {
        const st = appStore.getState();
        const agent = st.settings.hostAgent ?? 'auto';
        if (agent !== 'auto') return agent;
        // 자동: 준비된 CLI (Claude 우선). 둘 다 없으면 PC 기본 provider
        return HOST_CLI_ORDER.find((p) => isUsable(st.connections[p]));
      },
      allowDelete: (peerId) => isWindowPeer(peerId) || remoteDeleteAllowed(),
      onRemoteAction: (peerId, op) => {
        if (isWindowPeer(peerId)) return;
        // 스트리밍 중 잦은 조작(중지 등)은 묶지 않고 그대로 알린다
        const who = deviceNames.get(peerId) ?? '원격 기기';
        pushNotice(`${who}: ${OP_LABEL[op.kind]}`);
      },
    })
  : null;

if (sync && syncHost) {
  sync.onMessage((peerId, msg) => syncHost.receive(peerId, msg));
  sync.onPeerGone?.((peerId) => syncHost.peerGone(peerId));
  const host = desktop?.host;
  const learn = (s: { name: string; devices: { id: string; name: string }[] }) => {
    hostName = s.name || 'PC';
    deviceNames = new Map(s.devices.map((d) => [d.id, d.name]));
  };
  void host?.getState().then(learn);
  host?.onChange(learn);
}

/* ── 시작·데모 전환 ─────────────────────────────────────── */

/** 실제 데이터로 시작한다 (앱 시작·데모 종료). 원격 모드는 PC에 연결, 데스크톱은 저장소에서 불러온 뒤 호스트를 연다 */
export async function startData(): Promise<void> {
  if (isDemo()) return;
  if (syncClient) {
    clearMirror();
    // 세션 창: 스냅샷을 받으면 이 세션의 메시지를 바로 요청하도록 미리 활성화해 둔다
    if (sessionWindowId) appStore.getState().applyRemote({ view: { ...appStore.getState().view, activeSessionId: sessionWindowId } });
    // 페어링 확인 전 '페어링 필요' 화면이 깜빡이지 않게 먼저 연결 중으로 둔다
    if (await loadRemotePairing()) syncClient.state.setState({ status: 'connecting' });
    syncClient.start();
    return;
  }
  await loadPersisted();
  if (isDemo()) return;
  syncHost?.reset();
  sync?.ready(true);
}

/** 데모 모드로 들어가기 전: 원격 미러링을 멈추고, 호스트는 원격 요청을 받지 않는다 */
export function suspendData() {
  syncClient?.stop();
  if (sync) {
    sync.ready(false);
    syncHost?.reset();
  }
}

let localSettingsLoaded = false;
/** 앱 시작 시 한 번 */
export function initRemoteSettings() {
  if (!remoteMode || localSettingsLoaded) return;
  localSettingsLoaded = true;
  loadLocalSettings();
}

/** 페어링된 PC 정보 (설정 화면) */
export function useRemotePairing(): RemotePairing | null {
  const status = useSync((s) => s.status);
  const [p, setP] = useState<RemotePairing | null>(null);
  useEffect(() => {
    if (isDemo()) return;
    let alive = true;
    void loadRemotePairing().then((v) => alive && setP(v));
    return () => {
      alive = false;
    };
  }, [status]);
  return p;
}
