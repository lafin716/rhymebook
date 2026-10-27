import {
  createSyncClient,
  createSyncHost,
  removeHost,
  upsertHost,
  withActiveHost,
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
import { desktop, isDemo, mobile, loadRemoteHosts, loadRemotePairing, remoteLink, saveRemoteHosts, saveRemotePairing, sessionWindowId } from './runtime';
import { appStore, loadPersisted } from './store';
import { dropHostSkills, pullSkillsFromPc, switchSkillHost, syncSkillFolders, useSkills } from '../skills/skillsStore';

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
            // 웹·모바일: 연결이 끊기거나 실패하면 그대로 두고 사용자가 [다시 연결]로 잇는다
            autoReconnect: false,
          },
    )
  : null;

/** 이만큼 넘게 백그라운드에 있다가 돌아오면 살아 보이는 연결도 새로 연다 (OS가 소켓을 조용히 죽였을 수 있다) */
const FRESH_AFTER_MS = 60_000;

/**
 * 앱 복귀 시 자동 재연결 (모바일 백그라운드 → 포그라운드, 웹 탭 전환).
 * 평소 끊김은 [다시 연결]로 잇지만, 복귀 직후에는 한 번 스스로 다시 잇는다. 실패하면 알림(Toasts).
 */
function watchResume(client: SyncClient) {
  let hiddenAt: number | null = null;
  const onActive = (active: boolean) => {
    if (!active) {
      hiddenAt ??= Date.now();
      return;
    }
    const away = hiddenAt === null ? 0 : Date.now() - hiddenAt;
    hiddenAt = null;
    if (isDemo()) return;
    client.resume({ fresh: away >= FRESH_AFTER_MS });
  };
  if (mobile?.onActiveChange) mobile.onActiveChange(onActive);
  else if (typeof document !== 'undefined') document.addEventListener('visibilitychange', () => onActive(document.visibilityState === 'visible'));
}

if (syncClient && !localLink) {
  watchResume(syncClient);
  // PC에 연결될 때마다(처음·전환·다시 연결) 그 PC의 스킬을 받아 이 PC 목록에 합친다 (ADR-064)
  syncClient.state.subscribe((s, prev) => {
    if (s.status === 'online' && prev.status !== 'online') void autoPullSkills(syncClient);
  });
}

async function autoPullSkills(client: SyncClient) {
  if (isDemo()) return;
  try {
    const { added, updated } = await pullSkillsFromPc(() => client.pullSkills());
    if (added || updated) {
      const parts = [added && `${added}개 추가`, updated && `${updated}개 갱신`].filter(Boolean);
      pushNotice(`${client.state.getState().hostName ?? 'PC'} 스킬을 동기화했어요 (${parts.join(', ')})`);
    }
  } catch (e) {
    // 옛 PC(sync.skills 미지원)·연결 끊김: 스킬 관리의 [동기화]로 다시 받을 수 있다
    console.warn('[skills] PC 스킬 자동 동기화 실패', e);
  }
}

const idleState = createStore<SyncClientState>(() => ({ status: 'unsupported', loaded: {} }));

/** 원격 동기화 상태 구독 (데스크톱에서는 항상 unsupported) */
export function useSync<T>(selector: (s: SyncClientState) => T): T {
  return useStore(syncClient?.state ?? idleState, selector);
}

/* ── 저장한 PC 목록 (ADR-063) ─────────────────────────── */

export interface RemoteHostsState {
  /** 전환할 수 있는 PC들 (페어링한 순서) */
  hosts: RemotePairing[];
  /** 지금 쓰는 PC의 bridgeId */
  activeId: string | null;
  loaded: boolean;
}

export const remoteHosts = createStore<RemoteHostsState>(() => ({ hosts: [], activeId: null, loaded: false }));

export function useRemoteHosts<T>(selector: (s: RemoteHostsState) => T): T {
  return useStore(remoteHosts, selector);
}

/** 보안 저장소에서 목록을 읽는다. 목록 기능 전에 페어링한 PC도 목록에 넣어 둔다 */
async function loadHosts(): Promise<void> {
  const [list, active] = await Promise.all([loadRemoteHosts(), loadRemotePairing()]);
  const hosts = withActiveHost(list, active);
  if (hosts.length !== list.length) await saveRemoteHosts(hosts);
  remoteHosts.setState({ hosts, activeId: active?.bridgeId ?? null, loaded: true });
  void switchSkillHost(active?.bridgeId ?? null);
  // 연결되기 전에도 '집 맥북에 연결하는 중'처럼 저장한 이름으로 보여 준다
  if (active && !syncClient?.state.getState().hostName) syncClient?.state.setState({ hostName: active.bridgeName });
}

async function writeHosts(hosts: RemotePairing[], activeId: string | null) {
  await saveRemoteHosts(hosts);
  remoteHosts.setState({ hosts, activeId, loaded: true });
}

/** 페어링을 저장·해제하고 동기화를 다시 시작한다. 새로 페어링한 PC는 목록에 넣고 바로 쓴다, 해제하면 목록에서도 뺀다 */
export async function setPairing(p: RemotePairing | null): Promise<void> {
  const { hosts, activeId } = remoteHosts.getState();
  if (p) await writeHosts(upsertHost(hosts, p), p.bridgeId);
  else await writeHosts(activeId ? removeHost(hosts, activeId) : hosts, null);
  // 해제한 PC의 스킬도 지운다 (다시 페어링하면 연결될 때 PC에서 다시 받는다)
  if (!p && activeId) await dropHostSkills(activeId);
  await applyPairing(p, p?.bridgeId !== activeId);
}

/** 활성 페어링을 바꾸고 동기화를 다시 시작한다. 다른 PC로 바뀌면 이전 PC의 화면은 먼저 지운다 */
async function applyPairing(p: RemotePairing | null, otherHost: boolean) {
  await saveRemotePairing(p);
  if (!syncClient || isDemo()) return;
  syncClient.stop();
  if (otherHost || !p) {
    clearMirror();
    // 스킬도 PC별: 연결 전에 이 PC의 목록으로 바꿔 둔다 (연결되면 PC에서 받아 합친다)
    await switchSkillHost(p?.bridgeId ?? null);
  }
  if (!p) return;
  // 이전 PC 이름이 '연결 중'에 남지 않게 페어링한 이름으로 바꿔 둔다
  syncClient.state.setState({ hostName: p.bridgeName, error: undefined });
  syncClient.start();
}

/** 저장한 PC로 전환한다. 지금 쓰는 PC면 끊겼을 때만 다시 잇는다 */
export async function switchHost(bridgeId: string): Promise<void> {
  const { hosts, activeId } = remoteHosts.getState();
  const p = hosts.find((h) => h.bridgeId === bridgeId);
  if (!p) return;
  if (bridgeId === activeId) {
    if (syncClient?.state.getState().status !== 'online') syncClient?.reconnect();
    return;
  }
  remoteHosts.setState({ activeId: bridgeId });
  await applyPairing(p, true);
}

/** 저장한 PC를 목록에서 지운다. 지금 쓰는 PC면 연결도 해제한다 */
export async function forgetHost(bridgeId: string): Promise<void> {
  const { hosts, activeId } = remoteHosts.getState();
  if (bridgeId === activeId) return setPairing(null);
  await writeHosts(removeHost(hosts, bridgeId), activeId);
  await dropHostSkills(bridgeId);
}

/** 미러링한 PC 데이터를 화면에서 지운다 (페어링 해제) */
function clearMirror() {
  const st = appStore.getState();
  st.applyRemote({ sessions: {}, messages: {}, streaming: {}, summaryDrafts: {}, annotations: {}, vault: {}, view: { ...st.view, activeSessionId: null, splitSessionIds: [], popups: [], sheetSessionIds: [], mode: 'single' } });
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
  'page.new': '새 페이지를 만들었어요',
  'session.child': '하위 세션을 만들었어요',
  'page.edit': '페이지를 고쳤어요',
  send: '질문을 보냈어요',
  stop: '응답을 멈췄어요',
  retry: '다시 답변을 요청했어요',
  branch: '가지를 만들었어요',
  subsession: '하위 세션을 만들었어요',
  rename: '세션 이름을 바꿨어요',
  'session.agent': '답할 에이전트·모델을 바꿨어요',
  delete: '세션을 삭제했어요',
  'turn.delete': '질문을 삭제했어요',
  'turn.split': '질문을 하위 세션으로 분리했어요',
  'turn.splitOut': '질문을 별도 세션으로 분리했어요',
  'turn.move': '질문을 다른 세션으로 옮겼어요',
  'session.reorganize': '세션 재정리를 요청했어요',
  'summary.request': '요약을 요청했어요',
  'summary.discard': '요약 초안을 버렸어요',
  'summary.attach': '요약을 붙였어요',
  'summary.remove': '요약을 떼어 냈어요',
  'annot.set': '메모를 추가했어요',
  'annot.delete': '메모를 삭제했어요',
  'vault.put': '보관함을 정리했어요',
  'vault.delete': '보관함에서 삭제했어요',
  'study.import': '학습을 가져왔어요',
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
      anySkillProvider: isWindowPeer,
      // 원격 기기의 스킬 동기화: 스킬 폴더에서 바뀐 내용까지 읽은 뒤 보낸다
      skills: async () => {
        await syncSkillFolders();
        return useSkills.getState().skills;
      },
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
    if (!localLink) await loadHosts();
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
