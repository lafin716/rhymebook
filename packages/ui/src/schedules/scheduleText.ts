import { getLocale, intlLocale } from '../i18n';

/** Scheduling copy stays separate while the shared locale dictionaries are being migrated. Non-Korean locales use English. */
export function scheduleText(ko: string, en: string): string {
  return getLocale() === 'ko' ? ko : en;
}

export function scheduleDate(at: number): string {
  return new Intl.DateTimeFormat(intlLocale(), {
    dateStyle: 'medium', timeStyle: 'short',
  }).format(at);
}

/** datetime-local uses the device's calendar time; save converts it to an explicit UTC instant. */
export function localScheduleDate(at: number): string {
  const date = new Date(at);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
