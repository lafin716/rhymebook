import { useEffect, useState } from 'react';
import { appStore } from '../app/store';
import { mobile } from '../app/runtime';
import { Button } from '../components/Button';
import { Section, Toggle } from '../settings/controls';
import {
  notificationsEnabled, setNotificationsEnabled, notificationStatus, requestNotificationPermission,
  showCompletionNotification, notificationText as text, type NotificationStatus,
} from './service';

export function NotificationSettings() {
  const [enabled, setEnabled] = useState(notificationsEnabled);
  const [status, setStatus] = useState<NotificationStatus>('default');
  const [result, setResult] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    const update = () => { void notificationStatus().then((value) => { if (active) setStatus(value); }); };
    update();
    window.addEventListener('focus', update);
    const stopActive = mobile?.onActiveChange?.((foreground) => { if (foreground) update(); });
    return () => { active = false; stopActive?.(); window.removeEventListener('focus', update); };
  }, []);
  const label = text('응답 완료 알림', 'Response completion notifications');
  const explanation: Record<NotificationStatus, string> = {
    native: text('시스템 알림을 사용합니다. 배너가 안 보이면 OS 알림 설정을 확인하세요.', 'Uses system notifications. Check OS settings if banners do not appear.'),
    granted: text('알림 권한이 허용되어 있어요.', 'Notifications are allowed.'),
    default: text('알림을 받으려면 권한 허용 버튼을 누르세요.', 'Press Allow notifications to enable permission.'),
    denied: mobile ? text('알림이 차단되어 있어요. 기기의 설정 → OctoBooks → 알림에서 허용하세요.', 'Notifications are blocked. Enable them in device Settings → OctoBooks → Notifications.') : text('알림이 차단되어 있어요. 브라우저 사이트 설정에서 허용하세요.', 'Notifications are blocked. Allow them in your browser site settings.'),
    unsupported: text('이 환경에서는 로컬 알림을 지원하지 않아요.', 'Local notifications are unavailable in this environment.'),
    failed: text('알림 상태를 확인하지 못했어요. 시스템 설정을 확인한 뒤 다시 시도하세요.', 'Could not check notifications. Check system settings and try again.'),
  };
  return (
    <Section title={label} hint={text('이 기기에서만 적용됩니다. 창을 닫거나 앱을 백그라운드로 보내도 생성 중인 응답이 끝나면 알려드려요. iOS는 백그라운드에서 짧은 시간만 이어집니다.', 'Applies to this device. Responses in progress keep running and notify you even after you close the window or background the app. On iOS, background time is short.')}>
      <div className="flex items-center justify-between gap-3">
        <span className="text-[13px]">{text('알림 켜기', 'Enable notifications')}</span>
        <Toggle label={label} checked={enabled} onChange={(value) => { setNotificationsEnabled(value); setEnabled(value); setResult(''); }} />
      </div>
      <p className="text-[12.5px] text-muted" role="status">{explanation[status]}</p>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={busy || status !== 'default'} onClick={() => {
          setBusy(true);
          void requestNotificationPermission().then(setStatus).finally(() => setBusy(false));
        }}>{text('권한 허용', 'Allow notifications')}</Button>
        <Button size="sm" disabled={busy || !enabled || !['native', 'granted'].includes(status)} onClick={() => {
          setBusy(true);
          const sessionId = Object.keys(appStore.getState().sessions)[0] ?? 'notification-test';
          void showCompletionNotification(sessionId, true).then((shown) => setResult(shown
            ? text('알림을 보냈어요. 표시 여부는 시스템 설정에 따라 달라집니다.', 'Notification sent. Display depends on system settings.')
            : text('알림을 보내지 못했어요. 권한과 시스템 설정을 확인하세요.', 'Could not send the notification. Check permissions and system settings.'))).finally(() => setBusy(false));
        }}>{text('테스트 알림', 'Test notification')}</Button>
      </div>
      {result && <p className="text-[12.5px] text-muted" role="status">{result}</p>}
    </Section>
  );
}
