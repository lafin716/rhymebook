import { t } from './i18n';
import type { SkillRef } from './model';

export type ScheduleRepeat = 'once' | 'daily' | 'weekdays' | 'weekly' | 'monthly';

export interface ScheduleInput {
  title: string;
  prompt: string;
  runAt: string;
  repeat: ScheduleRepeat;
  /** Command name of the skill to apply when the task runs (e.g. quiz). */
  skill?: string;
}

/** Device-local schedule. originAt preserves the original wall clock across DST. */
export interface Schedule {
  id: string;
  sessionId: string;
  title: string;
  prompt: string;
  nextRunAt: number;
  repeat: ScheduleRepeat;
  enabled: boolean;
  anchorDay: number;
  originAt: number;
  createdAt: number;
  updatedAt: number;
  sourceMessageId?: string;
  /** Skill snapshot applied to the scheduled question. The engine prefers the current skill with the same id. */
  skill?: SkillRef;
  lastRunAt?: number;
  lastError?: string;
  pendingRunAt?: number;
}

export const SCHEDULE_LIMITS = { title: 120, prompt: 20_000, block: 24_000, text: 100_000 } as const;
const REPEATS: readonly ScheduleRepeat[] = ['once', 'daily', 'weekdays', 'weekly', 'monthly'];
/** Same as SKILL_NAME_RE (skills.ts imports this module, so keep a local copy). */
const SKILL_NAME = /^[a-z0-9가-힣][a-z0-9가-힣_-]{0,31}$/;
const SCHEDULE_KEYS = ['title', 'prompt', 'runAt', 'repeat', 'skill'];
const daysInMonth = (year: number, month: number) =>
  [31, year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month]!;

/** Date.parse alone accepts overflowing dates such as February 30. Check the written calendar first. */
function parseTimestamp(value: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|([+-])(\d{2}):(\d{2}))$/.exec(value);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month - 1) ||
      Number(m[4]) > 23 || Number(m[5]) > 59 || Number(m[6] ?? 0) > 59 ||
      Number(m[10] ?? 0) > 23 || Number(m[11] ?? 0) > 59) return null;
  const at = Date.parse(value);
  return Number.isFinite(at) ? at : null;
}

/** Validate both manual input and AI output, without silently truncating a task. */
export function validateScheduleInput(value: unknown, now = Date.now()): ScheduleInput | null {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !Number.isFinite(now)) return null;
  const s = value as Record<string, unknown>;
  const keys = Object.keys(s);
  const skill = typeof s.skill === 'string' ? s.skill.trim().replace(/^\/+/, '').toLowerCase() : s.skill;
  if (skill !== undefined && skill !== null && skill !== '' && (typeof skill !== 'string' || !SKILL_NAME.test(skill) || skill === 'schedule')) return null;
  if (keys.filter((key) => key !== 'skill').length !== 4 || !keys.every((key) => SCHEDULE_KEYS.includes(key)) ||
      typeof s.title !== 'string' || !s.title.trim() || s.title.length > SCHEDULE_LIMITS.title ||
      typeof s.prompt !== 'string' || !s.prompt.trim() || s.prompt.length > SCHEDULE_LIMITS.prompt ||
      typeof s.runAt !== 'string' || typeof s.repeat !== 'string' || !REPEATS.includes(s.repeat as ScheduleRepeat)) return null;
  const at = parseTimestamp(s.runAt);
  if (at === null || at <= now) return null;
  return { title: s.title.trim(), prompt: s.prompt.trim(), runAt: s.runAt, repeat: s.repeat as ScheduleRepeat, ...(typeof skill === 'string' && skill ? { skill } : {}) };
}

/** Read one complete schedule fence; nested examples inside other code fences are not executable output. */
export function parseScheduleBlock(text: string, now = Date.now()): ScheduleInput | null {
  if (text.length > SCHEDULE_LIMITS.text) return null;
  let open: { char: string; length: number; schedule: boolean } | null = null;
  let blocks = 0;
  let body: string[] | null = null;
  let complete: string | null = null;
  for (const line of text.split('\n')) {
    const fence = /^ {0,3}(`{3,}|~{3,})([^\r\n]*)\r?$/.exec(line);
    if (!open) {
      if (!fence) continue;
      const schedule = fence[1]![0] === '`' && fence[2]!.trim() === 'schedule';
      open = { char: fence[1]![0]!, length: fence[1]!.length, schedule };
      if (schedule) {
        if (++blocks > 1) return null;
        body = [];
      }
    } else if (fence && fence[1]![0] === open.char && fence[1]!.length >= open.length && !fence[2]!.trim()) {
      if (open.schedule) complete = body!.join('\n');
      open = null;
      body = null;
    } else if (open.schedule) {
      body!.push(line);
    }
  }
  if (blocks !== 1 || complete === null || complete.length > SCHEDULE_LIMITS.block || open?.schedule) return null;
  try {
    return validateScheduleInput(JSON.parse(complete), now);
  } catch {
    return null;
  }
}

const calendarDay = (date: Date) => {
  const day = new Date(0);
  day.setUTCFullYear(date.getFullYear(), date.getMonth(), date.getDate());
  return day.getTime() / 86_400_000;
};

/**
 * First recurrence after both at and now, in this device's current local timezone.
 * Pass the schedule's originAt and anchorDay to preserve its intended clock/day after DST or a short month.
 * Nonexistent DST times advance by the gap; repeated times use the earlier occurrence (Date's compatible rule).
 */
export function nextScheduleRun(at: number, repeat: ScheduleRepeat, now: number, anchorDay?: number): number | null {
  const origin = new Date(at);
  const current = new Date(now);
  if (!Number.isFinite(origin.getTime()) || !Number.isFinite(current.getTime()) || repeat === 'once' || !REPEATS.includes(repeat)) return null;
  const day = anchorDay ?? origin.getDate();
  if (!Number.isInteger(day) || day < 1 || day > 31) return null;
  const threshold = Math.max(at, now);
  const clock = [origin.getHours(), origin.getMinutes(), origin.getSeconds(), origin.getMilliseconds()] as const;
  const build = (year: number, month: number, date: number) => {
    const result = new Date(at);
    result.setDate(1);
    result.setFullYear(year, month, date);
    result.setHours(...clock);
    return result;
  };
  if (repeat === 'monthly') {
    let months = Math.max(1, (current.getFullYear() - origin.getFullYear()) * 12 + current.getMonth() - origin.getMonth());
    for (let i = 0; i < 2; i++, months++) {
      const monthIndex = origin.getMonth() + months;
      const year = origin.getFullYear() + Math.floor(monthIndex / 12);
      const month = monthIndex % 12;
      const candidate = build(year, month, Math.min(day, daysInMonth(year, month))).getTime();
      if (!Number.isFinite(candidate)) return null;
      if (candidate > threshold) return candidate;
    }
    return null;
  }
  const step = repeat === 'weekly' ? 7 : 1;
  let days = Math.max(step, Math.floor((calendarDay(current) - calendarDay(origin)) / step) * step);
  // At most one elapsed candidate plus a weekend needs skipping.
  for (let i = 0; i < 4; i++, days += step) {
    const candidate = build(origin.getFullYear(), origin.getMonth(), origin.getDate() + days);
    if (!Number.isFinite(candidate.getTime())) return null;
    if (repeat === 'weekdays' && (candidate.getDay() === 0 || candidate.getDay() === 6)) continue;
    if (candidate.getTime() > threshold) return candidate.getTime();
  }
  return null;
}

/** Deliberately conservative: explaining, quoting, cancelling or negating a schedule must not reserve work. */
export function hasScheduleIntent(text: string): boolean {
  if (text.length > SCHEDULE_LIMITS.text) return false;
  const t = text.normalize('NFC').replace(/```[\s\S]*?```|`[^`]*`|"[^"\n]*"|“[^”]*”|「[^」]*」/g, ' ').trim();
  if (!t || /취소|삭제|해제|예약\s*(?:하지|안\s*해|말)|(?:예약|알림|스케줄)\s*(?:은|을|는|를)?\s*없이|알림\s*(?:끄|꺼)|(?:하지|주지|보내지|내지)\s*(?:마|말)|안\s*(?:해|보내|알려)|필요\s*없|cancel|delete|remove|disable|\b(?:do\s+not|don['’]?t|not\s+to|never)\b/i.test(t)) return false;
  if (/^(?:예시|예제)(?:로|를|:)|(?:무슨|어떤)\s*(?:뜻|의미)|라는\s*(?:문장|말|표현|요청)|(?:문장|표현|요청|예약|알림|스케줄).*(?:뜻|의미|해석|어떻게|방법|원리|기능|구현|설명|예시|예제)|번역해|\b(?:translate|meaning\s+of|what\s+(?:is|are|do|does)|how\s+(?:do|does|can|to))\b|\b(?:explain|example).*\b(?:scheduling|schedule|reminders?)\b/i.test(t)) return false;
  const explicit = /(?:예약|스케줄)\s*(?:(?:을|를|좀)\s*)?(?:해|잡아|등록|만들|설정|부탁)|(?:알림|리마인더)\s*(?:(?:을|를|좀)\s*)?(?:해|줘|주세|보내|등록|설정|부탁)|(?:알려|상기시켜)\s*(?:줘|주세|줄래)|\bremind\s+me\b|\b(?:schedule|set\s+(?:a\s+)?reminder)\s+(?:a\b|an\b|the\b|my\b|me\b|for\b|to\b)/i;
  const future = /내일|모레|다음\s*(?:주|달|월|해)|매일|매주|매달|매월|평일|주말|매\s*아침|매\s*저녁|\d{4}-\d{1,2}-\d{1,2}|\d{1,2}월\s*\d{1,2}일|(?:오전|오후|아침|저녁|오늘).*\d{1,2}\s*시|\d+\s*(?:분|시간|일)\s*(?:뒤|후)|\b(?:tomorrow|tonight|next\s+(?:week|month|monday|tuesday|wednesday|thursday|friday|saturday|sunday)|every\s+(?:day|week|month|morning|evening|weekday|monday|tuesday|wednesday|thursday|friday|saturday|sunday)|daily|weekly|monthly|in\s+\d+\s+(?:minutes?|hours?|days?))\b/i;
  const request = /(?:해|내|만들어|정리해|읽어|들려|알려|보내|출제해|물어봐|제공해|실행해)\s*(?:줘|주세|줄래|주라)|부탁|\b(?:please|explain|quiz\s+me|tell\s+me|send\s+me|give\s+me|ask\s+me|run)\b/i;
  const concreteTime = /\d{4}-\d{1,2}-\d{1,2}|\d{1,2}월\s*\d{1,2}일|(?:오전|오후|아침|저녁)?\s*\d{1,2}\s*(?:시|:\d{2})|매일|매주|매달|매월|평일|주말|매\s*아침|매\s*저녁|\d+\s*(?:분|시간|일)\s*(?:뒤|후)|\b(?:every\s+(?:day|week|month|morning|evening|weekday|monday|tuesday|wednesday|thursday|friday|saturday|sunday)|daily|weekly|monthly|at\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?|in\s+\d+\s+(?:minutes?|hours?|days?))\b/i;
  // An ordinary "알려줘" needs a future date; an explicit reservation/reminder request may ask for missing details.
  return (explicit.test(t) && ((future.test(t) && concreteTime.test(t)) || /예약|스케줄|알림|리마인더|\bremind\s+me\b|\bschedule\b|\bset\s+(?:a\s+)?reminder\b/i.test(t))) || (future.test(t) && concreteTime.test(t) && request.test(t));
}

export const SCHEDULE_PROTOCOL = '```schedule\n{"title":"…","prompt":"…","runAt":"YYYY-MM-DDTHH:mm:ss±HH:mm","repeat":"once","skill":"quiz"}\n```';

/** Skills a scheduled task may use (the schedule skill itself is excluded). */
export interface ScheduleSkillOption { name: string; title: string; description?: string }

/** Built-in schedule skill copy in the current language (locales/<lang>/skillsBuiltin.json). */
export function scheduleSkillContent(): { title: string; description: string; prompt: string } {
  return {
    title: t('skillsBuiltin.schedule.title'),
    description: t('skillsBuiltin.schedule.description'),
    prompt: t('skillsBuiltin.schedule.prompt', { protocol: SCHEDULE_PROTOCOL }),
  };
}

/**
 * chosen: the one skill the user picked for this task when the request named several (ADR-111).
 * The schedule then carries only that skill.
 */
export function scheduleSystemHint(now = Date.now(), skills: readonly ScheduleSkillOption[] = [], chosen?: ScheduleSkillOption): string {
  const date = new Date(now);
  const current = Number.isFinite(date.getTime()) ? date : new Date();
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const clock = `UTC: ${current.toISOString()}\nTimezone: ${zone}\nLocal: ${current.toString()}`;
  const protocol = SCHEDULE_PROTOCOL;
  const usable = skills.filter((skill) => skill.name !== 'schedule' && SKILL_NAME.test(skill.name)).slice(0, 60);
  const pick = chosen && chosen.name !== 'schedule' && SKILL_NAME.test(chosen.name) ? chosen : undefined;
  const list = usable.map((skill) => `- ${skill.name}: ${skill.title}${skill.description ? ` — ${skill.description.replace(/\s+/g, ' ').slice(0, 120)}` : ''}`).join('\n');
  return [
    t('llm.schedule.heading'), clock,
    t('llm.schedule.intro'),
    protocol,
    t('llm.schedule.limits', { titleMax: SCHEDULE_LIMITS.title, promptMax: SCHEDULE_LIMITS.prompt }),
    t('llm.schedule.runAt'),
    ...(pick ? [t('llm.schedule.skillChosen', { name: pick.name, title: pick.title })] : usable.length ? [t('llm.schedule.skillOptional'), list] : [t('llm.schedule.skillNone')]),
    t('llm.schedule.ask'),
    t('llm.schedule.unsupported'),
    t('llm.schedule.noBlock'),
  ].join('\n');
}
