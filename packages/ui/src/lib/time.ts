import { t, intlLocale } from '../i18n';
/** 호출 시점의 로케일로 만든다 (모듈 로드 시 t()/로케일을 고정하지 않는다) */
const rtf = () => new Intl.RelativeTimeFormat(intlLocale(), { numeric: 'auto' });

/** "3분 전", "어제" 같은 상대 시간 */
export function relativeTime(ts: number, now = Date.now()): string {
  const diff = Math.round((ts - now) / 1000);
  const abs = Math.abs(diff);
  if (abs < 45) return t('app.time.justNow');
  if (abs < 60 * 45) return rtf().format(Math.round(diff / 60), 'minute');
  if (abs < 60 * 60 * 22) return rtf().format(Math.round(diff / 3600), 'hour');
  if (abs < 60 * 60 * 24 * 6) return rtf().format(Math.round(diff / 86400), 'day');
  return new Date(ts).toLocaleDateString(intlLocale(), { month: 'short', day: 'numeric' });
}
