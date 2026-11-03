import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAppStore, ProviderRegistry } from '@branch/core';
import { createMobileNotifications, type NativeNotifications } from '../../../apps/mobile/src/notifications';
import { notificationNavigation } from '../src/notifications/navigation';

const settle = async () => { await new Promise<void>((resolve) => setImmediate(resolve)); };
function nativeFixture() {
  let pending: { sessionId?: string; scope?: string } = {};
  let listener = () => {};
  const remove = vi.fn().mockResolvedValue(undefined);
  const native: NativeNotifications = {
    status: vi.fn().mockResolvedValue({ permission: 'default' }),
    requestPermission: vi.fn().mockResolvedValue({ permission: 'granted' }),
    show: vi.fn().mockResolvedValue({ shown: true }),
    takePendingClick: vi.fn(async () => { const value = pending; pending = {}; return value; }),
    addListener: vi.fn(async (_event, callback) => { listener = callback; return { remove }; }),
  };
  return { native, remove, click(value: typeof pending) { pending = value; listener(); }, pending(value: typeof pending) { pending = value; } };
}

describe('Capacitor local notification adapter', () => {
  it('checks permission without prompting and explicitly requests a grant', async () => {
    const { native } = nativeFixture(); const api = createMobileNotifications(native);
    expect(await api.status()).toBe('default'); expect(native.requestPermission).not.toHaveBeenCalled();
    expect(await api.requestPermission()).toBe('granted');
    expect(await api.show({ sessionId: 's', title: 'Done', body: '', scope: 'local' })).toBe(true);
    expect(native.show).toHaveBeenCalledWith({ sessionId: 's', title: 'Done', body: '', scope: 'local' });
  });
  it('delivers a cold launch tap once, then drains live taps without duplicates', async () => {
    const f = nativeFixture(); f.pending({ sessionId: 'cold', scope: 'remote:pc-a' });
    const api = createMobileNotifications(f.native); const callback = vi.fn(); const stop = api.onClick(callback);
    await settle(); expect(callback).toHaveBeenCalledExactlyOnceWith('cold', 'remote:pc-a');
    f.click({ sessionId: 'live', scope: 'local' }); f.click({ sessionId: 'live', scope: 'local' });
    await settle(); expect(callback).toHaveBeenCalledTimes(2);
    stop(); expect(f.remove).toHaveBeenCalledOnce();
  });
  it('does not consume pending data after unsubscribing before native listener setup', async () => {
    const f = nativeFixture(); const api = createMobileNotifications(f.native); const callback = vi.fn();
    const stop = api.onClick(callback); stop(); await settle();
    expect(f.native.takePendingClick).not.toHaveBeenCalled(); expect(f.remove).toHaveBeenCalledOnce();
    expect(callback).not.toHaveBeenCalled();
  });
  it('contains listener failures and rejects invalid tap payloads', async () => {
    const f = nativeFixture(); const api = createMobileNotifications(f.native); const callback = vi.fn();
    const stop = api.onClick(callback); await settle();
    f.click({ sessionId: '../invalid' }); await settle();
    f.click({ sessionId: 'ok', scope: '../invalid' }); await settle();
    expect(callback).not.toHaveBeenCalled(); stop();
    vi.mocked(f.native.addListener).mockRejectedValueOnce(new Error('not implemented'));
    const stopFailed = api.onClick(callback); await settle(); stopFailed();
  });
  it('propagates denial, native delivery failure, and unexpected permission errors', async () => {
    const f = nativeFixture(); const api = createMobileNotifications(f.native);
    vi.mocked(f.native.status).mockResolvedValueOnce({ permission: 'denied' }); expect(await api.status()).toBe('denied');
    vi.mocked(f.native.show).mockResolvedValueOnce({ shown: false }); expect(await api.show({ sessionId: 's', title: 'Done', body: '' })).toBe(false);
    vi.mocked(f.native.status).mockResolvedValueOnce({ permission: 'bad' as never }); await expect(api.status()).rejects.toThrow();
  });
});

afterEach(() => vi.useRealTimers());
describe('notification tap navigation', () => {
  function setup() {
    const store = createAppStore({ registry: new ProviderRegistry() });
    let current = 'remote:pc-a'; const unavailable = vi.fn();
    const nav = notificationNavigation(store, () => current, unavailable);
    return { store, nav, unavailable, scope(value: string) { current = value; } };
  }
  it('waits for a remote session snapshot and opens it exactly once, closing settings', () => {
    const { store, nav, unavailable } = setup(); const open = vi.spyOn(store.getState(), 'openSession');
    store.getState().setOverlay('settings'); nav.open('cold', 'remote:pc-a');
    expect(open).not.toHaveBeenCalled(); store.getState().newRootSession('cold', { focus: false });
    expect(open).toHaveBeenCalledOnce(); expect(store.getState().overlay).toBe('none');
    expect(unavailable).not.toHaveBeenCalled(); nav.dispose();
  });
  it('rejects another host/profile before opening an existing same-id session', () => {
    const { store, nav, unavailable } = setup(); store.getState().newRootSession('s');
    const open = vi.spyOn(store.getState(), 'openSession'); nav.open('s', 'local');
    expect(open).not.toHaveBeenCalled(); expect(unavailable).toHaveBeenCalledOnce(); nav.dispose();
  });
  it('expires unavailable sessions and cleans up timers on host switch or disposal', () => {
    vi.useFakeTimers(); const f = setup(); f.nav.open('missing', 'remote:pc-a');
    vi.advanceTimersByTime(30_000); expect(f.unavailable).toHaveBeenCalledOnce();
    f.nav.open('missing', 'remote:pc-a'); f.scope('remote:pc-b'); f.nav.cancel();
    expect(f.unavailable).toHaveBeenCalledTimes(2);
    f.nav.open('missing', 'remote:pc-b'); f.nav.dispose(); vi.advanceTimersByTime(30_000);
    expect(f.unavailable).toHaveBeenCalledTimes(2);
  });
});
