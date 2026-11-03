import type { PluginListenerHandle } from '@capacitor/core';
import type { LocalNotificationPermission, MobileNotifications } from '@branch/core';

export interface NativeNotifications {
  status(): Promise<{ permission: LocalNotificationPermission }>;
  requestPermission(): Promise<{ permission: LocalNotificationPermission }>;
  show(input: Parameters<MobileNotifications['show']>[0]): Promise<{ shown: boolean }>;
  takePendingClick(): Promise<{ sessionId?: string; scope?: string }>;
  setBackgroundWork?(input: { active: boolean }): Promise<void>;
  addListener(event: 'notificationClick', listener: () => void): Promise<PluginListenerHandle>;
}

/** Native retains taps until this adapter can deliver them, including cold launch. */
export function createMobileNotifications(native: NativeNotifications): MobileNotifications {
  const listeners = new Set<Parameters<MobileNotifications['onClick']>[0]>();
  let generation = 0;
  let handle: PluginListenerHandle | undefined;
  let draining = Promise.resolve();
  const permission = (value: string): LocalNotificationPermission => {
    if (value === 'default' || value === 'denied' || value === 'granted') return value;
    throw new Error('Invalid notification permission');
  };
  const drain = (token: number) => {
    draining = draining.then(async () => {
      if (token !== generation || !listeners.size) return;
      const target = await native.takePendingClick();
      if (token !== generation || !target.sessionId || !/^[\w-]{1,64}$/.test(target.sessionId)
        || (target.scope !== undefined && !/^[\w:.-]{1,128}$/.test(target.scope))) return;
      for (const listener of [...listeners]) listener(target.sessionId, target.scope);
    }).catch(() => {});
  };
  return {
    status: async () => permission((await native.status()).permission),
    requestPermission: async () => permission((await native.requestPermission()).permission),
    show: async (input) => (await native.show(input)).shown === true,
    setBackgroundWork: async (active) => { await native.setBackgroundWork?.({ active }); },
    onClick(listener) {
      listeners.add(listener);
      if (listeners.size === 1) {
        const token = ++generation;
        void native.addListener('notificationClick', () => drain(token)).then((subscription) => {
          if (token !== generation || !listeners.size) { void subscription.remove().catch(() => {}); return; }
          handle = subscription;
          drain(token);
        }).catch(() => {});
      }
      return () => {
        listeners.delete(listener);
        if (listeners.size) return;
        generation++;
        if (handle) void handle.remove().catch(() => {});
        handle = undefined;
      };
    },
  };
}
