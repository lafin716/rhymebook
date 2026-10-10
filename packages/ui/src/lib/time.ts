const rtf = new Intl.RelativeTimeFormat('ko', { numeric: 'auto' });

/** "3분 전", "어제" 같은 상대 시간 */
export function relativeTime(ts: number, now = Date.now()): string {
  const diff = Math.round((ts - now) / 1000);
  const abs = Math.abs(diff);
  if (abs < 45) return '방금';
  if (abs < 60 * 45) return rtf.format(Math.round(diff / 60), 'minute');
  if (abs < 60 * 60 * 22) return rtf.format(Math.round(diff / 3600), 'hour');
  if (abs < 60 * 60 * 24 * 6) return rtf.format(Math.round(diff / 86400), 'day');
  return new Date(ts).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' });
}
