import { getLocale } from '../i18n';

/** Scheduling copy stays separate while the shared locale dictionaries are being migrated. */
export function scheduleText(ko: string, en: string): string {
  return getLocale() === 'en' ? en : ko;
}

export function scheduleDate(at: number): string {
  return new Intl.DateTimeFormat(getLocale() === 'en' ? 'en-US' : 'ko-KR', {
    dateStyle: 'medium', timeStyle: 'short',
  }).format(at);
}

/** datetime-local uses the device's calendar time; save converts it to an explicit UTC instant. */
export function localScheduleDate(at: number): string {
  const date = new Date(at);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
