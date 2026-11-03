import type { MessageMap } from '@branch/core';
import { getLocale } from '@branch/core';
import { remoteMode } from '../app/capabilities';
import { desktop, mobile, presentWindowId, sessionWindowId } from '../app/runtime';
import { appStore } from '../app/store';
import { notificationNavigation } from './navigation';

const KEY = 'branch.notifications.enabled';
let memoryEnabled = true;
export const notificationText = (ko: string, en: string) => getLocale() === 'ko' ? ko : en;
export type NotificationStatus = 'native' | NotificationPermission | 'unsupported' | 'failed';

export function notificationsEnabled(): boolean {
  try { return localStorage.getItem(KEY) !== 'false'; } catch { return memoryEnabled; }
}
export function setNotificationsEnabled(enabled: boolean): void {
  memoryEnabled = enabled;
  try { localStorage.setItem(KEY, String(enabled)); } catch { /* Keep the choice for this window. */ }
}
export async function notificationStatus(): Promise<NotificationStatus> {
  try {
    if (desktop?.notifications) return await desktop.notifications.supported() ? 'native' : 'unsupported';
    if (mobile?.notifications) return await mobile.notifications.status();
    return typeof Notification === 'undefined' ? 'unsupported' : Notification.permission;
  } catch { return 'failed'; }
}
/** Call only inside the permission button's user gesture. */
export async function requestNotificationPermission(): Promise<NotificationStatus> {
  try {
    if (desktop?.notifications) return notificationStatus();
    if (mobile?.notifications) return await mobile.notifications.requestPermission();
    if (typeof Notification === 'undefined') return 'unsupported';
    return await Notification.requestPermission();
  } catch { return 'failed'; }
}

function openSession(sessionId: string) {
  if (appStore.getState().sessions[sessionId]) appStore.getState().openSession(sessionId);
}

export async function showCompletionNotification(sessionId: string, test = false): Promise<boolean> {
  if (!notificationsEnabled() || sessionWindowId || presentWindowId) return false;
  const title = notificationText('응답이 완료되었어요', 'Response complete');
  const session = appStore.getState().sessions[sessionId];
  const body = (test ? notificationText('로컬 알림 테스트입니다.', 'This is a local notification test.') : session?.title ?? '').slice(0, 240);
  try {
    if (desktop?.notifications) return await desktop.notifications.show({ sessionId, title, body });
    if (mobile?.notifications) {
      const { remoteHosts } = await import('../app/sync');
      const scope = remoteMode ? `remote:${remoteHosts.getState().activeId ?? 'unpaired'}` : 'local';
      return await mobile.notifications.show({ sessionId, title, body, scope });
    }
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return false;
    const notification = new Notification(title, { body, tag: test ? 'notification-test' : `response-${sessionId}` });
    notification.onclick = () => { window.focus(); openSession(sessionId); notification.close(); };
    return true;
  } catch { return false; }
}

/** The owner calls this only for a successfully completed local response. */
export function notifyResponseComplete(sessionId: string): void {
  void showCompletionNotification(sessionId);
}

/** Track only messages already observed streaming, never newly hydrated done messages. */
export function completionObserver(notify: (sessionId: string) => void) {
  let previous: MessageMap = {};
  const delivered = new Set<string>();
  return (messages: MessageMap, reset = false) => {
    if (!reset) for (const [sessionId, list] of Object.entries(messages)) {
      const before = new Map((previous[sessionId] ?? []).map((message) => [message.id, message]));
      for (const message of list) {
        const key = `${sessionId}:${message.id}`;
        if (message.role === 'assistant' && message.status === 'done' && !message.error
          && before.get(message.id)?.status === 'streaming' && !delivered.has(key)) {
          delivered.add(key);
          notify(sessionId);
        }
      }
    }
    previous = messages;
  };
}

export function startNotificationService(): () => void {
  if (sessionWindowId || presentWindowId) return () => {};
  const stopClick = desktop?.notifications?.onClick(openSession);
  let disposed = false;
  let stopStore: (() => void) | undefined;
  let stopConnection: (() => void) | undefined;
  let stopMobile: (() => void) | undefined;
  // Delay sync import so the store's completion hook can import this service without a cycle.
  if (remoteMode || mobile?.notifications) void import('../app/sync').then(({ syncClient, remoteHosts, pushNotice }) => {
    if (disposed) return;
    if (mobile?.notifications) {
      const navigation = notificationNavigation(appStore,
        () => remoteMode ? `remote:${remoteHosts.getState().activeId ?? 'unpaired'}` : 'local',
        () => pushNotice(notificationText('이 알림의 대화를 현재 프로필에서 찾을 수 없어요. 원래 PC에 연결한 뒤 확인해 주세요.', 'This conversation is unavailable in the current profile. Connect to its original PC to view it.')));
      const stopTap = mobile.notifications.onClick(navigation.open);
      const stopHost = remoteHosts.subscribe((state, previous) => { if (state.activeId !== previous.activeId) navigation.cancel(); });
      stopMobile = () => { stopTap(); stopHost(); navigation.dispose(); };
    }
    if (!remoteMode || !syncClient) return;
    let online = syncClient.state.getState().status === 'online';
    const observe = completionObserver(notifyResponseComplete);
    observe(appStore.getState().messages, true);
    stopConnection = syncClient.state.subscribe((state) => {
      const nextOnline = state.status === 'online';
      if (!nextOnline || nextOnline !== online) observe(appStore.getState().messages, true);
      online = nextOnline;
    });
    stopStore = appStore.subscribe((state) => observe(state.messages, !online));
  }).catch((error: unknown) => console.warn('[notifications] Remote observer unavailable', error));
  return () => { disposed = true; stopClick?.(); stopStore?.(); stopConnection?.(); stopMobile?.(); };
}
