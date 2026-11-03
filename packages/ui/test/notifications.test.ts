import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MessageMap, MessageStatus, MobileNotifications } from '@branch/core';

const runtime = vi.hoisted(() => ({ mobile: undefined as { notifications: MobileNotifications } | undefined, desktop: undefined as { notifications?: { supported: () => Promise<boolean>; show: (input: unknown) => Promise<boolean>; onClick: () => () => void } } | undefined, sessionWindowId: null as string | null, presentWindowId: null as string | null }));
vi.mock('../src/app/runtime', () => runtime);
vi.mock('../src/app/sync', () => ({ remoteHosts: { getState: () => ({ activeId: 'pc' }) } }));
vi.mock('../src/app/capabilities', () => ({ remoteMode: false }));
vi.mock('../src/app/store', () => ({ appStore: { getState: () => ({ sessions: { session: { title: 'Conversation' } }, openSession: vi.fn() }) } }));
import {
  completionObserver, notificationsEnabled, setNotificationsEnabled, notificationStatus,
  notifyResponseComplete, requestNotificationPermission, showCompletionNotification,
} from '../src/notifications/service';

function messages(status: MessageStatus, id = 'response'): MessageMap {
  return { session: [{ id, sessionId: 'session', role: 'assistant', content: 'hello', createdAt: 1, status }] };
}

beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) });
  runtime.desktop = undefined;
  runtime.mobile = undefined;
  runtime.sessionWindowId = null;
  runtime.presentWindowId = null;
  setNotificationsEnabled(true);
});
afterEach(() => vi.unstubAllGlobals());

describe('device notifications', () => {
  it('defaults on and retains the device toggle', () => {
    expect(notificationsEnabled()).toBe(true);
    setNotificationsEnabled(false);
    expect(notificationsEnabled()).toBe(false);
  });
  it('does not ask permission on completion and skips an off preference', async () => {
    const requestPermission = vi.fn();
    const constructor = vi.fn();
    vi.stubGlobal('Notification', Object.assign(constructor, { permission: 'default', requestPermission }));
    expect(await showCompletionNotification('session')).toBe(false);
    expect(requestPermission).not.toHaveBeenCalled();
    setNotificationsEnabled(false);
    notifyResponseComplete('session');
    expect(constructor).not.toHaveBeenCalled();
  });
  it('requests permission only through the explicit permission API', async () => {
    const requestPermission = vi.fn().mockResolvedValue('granted');
    vi.stubGlobal('Notification', { permission: 'default', requestPermission });
    expect(await requestNotificationPermission()).toBe('granted');
    expect(requestPermission).toHaveBeenCalledOnce();
  });
  it('reports unsupported environments and permission failures', async () => {
    vi.stubGlobal('Notification', undefined);
    expect(await notificationStatus()).toBe('unsupported');
    expect(await showCompletionNotification('session')).toBe(false);
    vi.stubGlobal('Notification', { requestPermission: vi.fn().mockRejectedValue(new Error('blocked')) });
    expect(await requestNotificationPermission()).toBe('failed');
  });
  it('uses mobile native permission and delivery without a browser fallback or automatic prompt', async () => {
    const mobile = { status: vi.fn().mockResolvedValue('default'), requestPermission: vi.fn().mockResolvedValue('granted'), show: vi.fn().mockResolvedValue(true), onClick: () => () => {} };
    runtime.mobile = { notifications: mobile };
    const browser = vi.fn(); vi.stubGlobal('Notification', Object.assign(browser, { permission: 'granted' }));
    expect(await notificationStatus()).toBe('default'); expect(mobile.requestPermission).not.toHaveBeenCalled();
    expect(await requestNotificationPermission()).toBe('granted');
    expect(await showCompletionNotification('session')).toBe(true);
    expect(mobile.show).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 'session', scope: 'local' }));
    expect(browser).not.toHaveBeenCalled();
    mobile.show.mockRejectedValueOnce(new Error('denied')); expect(await showCompletionNotification('session')).toBe(false);
    expect(browser).not.toHaveBeenCalled();
    setNotificationsEnabled(false); await showCompletionNotification('session'); expect(mobile.show).toHaveBeenCalledTimes(2);
  });
  it('contains rejected native delivery and constructor failures', async () => {
    runtime.desktop = { notifications: { supported: vi.fn().mockResolvedValue(true), show: vi.fn().mockRejectedValue(new Error('OS refused')), onClick: () => () => {} } };
    expect(await notificationStatus()).toBe('native');
    expect(await showCompletionNotification('session')).toBe(false);
    runtime.desktop = undefined;
    class UnsupportedNotification {
      static permission = 'granted';
      constructor() { throw new Error('Not supported in WebView'); }
    }
    vi.stubGlobal('Notification', UnsupportedNotification);
    expect(await showCompletionNotification('session')).toBe(false);
  });
  it('uses browser notifications when granted and suppresses session/audience windows', async () => {
    const constructor = vi.fn(function () { return { close() {} }; });
    vi.stubGlobal('Notification', Object.assign(constructor, { permission: 'granted' }));
    expect(await showCompletionNotification('session')).toBe(true);
    expect(constructor).toHaveBeenCalledOnce();
    runtime.sessionWindowId = 'session';
    expect(await showCompletionNotification('session')).toBe(false);
    runtime.sessionWindowId = null;
    runtime.presentWindowId = 'session';
    expect(await showCompletionNotification('session')).toBe(false);
    expect(constructor).toHaveBeenCalledOnce();
  });
});

describe('remote completion observation', () => {
  it('ignores history, stops/errors and delivers streaming-to-done once', () => {
    const notify = vi.fn();
    const observe = completionObserver(notify);
    observe(messages('done'));
    expect(notify).not.toHaveBeenCalled();
    observe(messages('streaming'));
    observe(messages('stopped'));
    observe(messages('done'));
    expect(notify).not.toHaveBeenCalled();
    observe(messages('streaming'));
    observe(messages('done'));
    expect(notify).toHaveBeenCalledExactlyOnceWith('session');
    observe(messages('streaming'));
    observe(messages('done'));
    expect(notify).toHaveBeenCalledOnce();
    observe(messages('streaming', 'error'));
    observe(messages('error', 'error'));
    expect(notify).toHaveBeenCalledOnce();
  });
  it('resets baseline during reconnect and ignores hydrated completions', () => {
    const notify = vi.fn();
    const observe = completionObserver(notify);
    observe(messages('streaming'));
    observe(messages('done'), true);
    observe(messages('done'));
    expect(notify).not.toHaveBeenCalled();
    observe(messages('streaming', 'new'));
    observe(messages('done', 'new'));
    expect(notify).toHaveBeenCalledOnce();
  });
});
