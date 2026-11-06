import { getLocale, intlLocale } from '../i18n';

/** Scheduling copy stays separate while the shared locale dictionaries are being migrated. Non-Korean locales use English. */
export function scheduleText(ko: string, en: string): string {
  return getLocale() === 'ko' ? ko : en;
}

/** timeZone을 주면 그 시간대(원격에서 PC의 시간대)로 표시하고, 없으면 기기 시간대로 표시한다. */
export function scheduleDate(at: number, timeZone?: string): string {
  return new Intl.DateTimeFormat(intlLocale(), {
    dateStyle: 'medium', timeStyle: 'short', ...(timeZone ? { timeZone } : {}),
  }).format(at);
}

/** datetime-local uses the device's calendar time; save converts it to an explicit UTC instant. */
export function localScheduleDate(at: number): string {
  const date = new Date(at);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
