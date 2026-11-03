import { getLocale } from './i18n';

export type ScheduleRepeat = 'once' | 'daily' | 'weekdays' | 'weekly' | 'monthly';

export interface ScheduleInput {
  title: string;
  prompt: string;
  runAt: string;
  repeat: ScheduleRepeat;
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
  lastRunAt?: number;
  lastError?: string;
  pendingRunAt?: number;
}

export const SCHEDULE_LIMITS = { title: 120, prompt: 20_000, block: 24_000, text: 100_000 } as const;
const REPEATS: readonly ScheduleRepeat[] = ['once', 'daily', 'weekdays', 'weekly', 'monthly'];
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
  if (Object.keys(s).length !== 4 || !Object.keys(s).every((key) => ['title', 'prompt', 'runAt', 'repeat'].includes(key)) ||
      typeof s.title !== 'string' || !s.title.trim() || s.title.length > SCHEDULE_LIMITS.title ||
      typeof s.prompt !== 'string' || !s.prompt.trim() || s.prompt.length > SCHEDULE_LIMITS.prompt ||
      typeof s.runAt !== 'string' || typeof s.repeat !== 'string' || !REPEATS.includes(s.repeat as ScheduleRepeat)) return null;
  const at = parseTimestamp(s.runAt);
  if (at === null || at <= now) return null;
  return { title: s.title.trim(), prompt: s.prompt.trim(), runAt: s.runAt, repeat: s.repeat as ScheduleRepeat };
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
  const request = /(?:해|내|만들어|정리해|읽어|알려|보내|출제해|물어봐|제공해|실행해)\s*(?:줘|주세|줄래|주라)|부탁|\b(?:please|explain|quiz\s+me|tell\s+me|send\s+me|give\s+me|ask\s+me|run)\b/i;
  const concreteTime = /\d{4}-\d{1,2}-\d{1,2}|\d{1,2}월\s*\d{1,2}일|(?:오전|오후|아침|저녁)?\s*\d{1,2}\s*(?:시|:\d{2})|매일|매주|매달|매월|평일|주말|매\s*아침|매\s*저녁|\d+\s*(?:분|시간|일)\s*(?:뒤|후)|\b(?:every\s+(?:day|week|month|morning|evening|weekday|monday|tuesday|wednesday|thursday|friday|saturday|sunday)|daily|weekly|monthly|at\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?|in\s+\d+\s+(?:minutes?|hours?|days?))\b/i;
  // An ordinary "알려줘" needs a future date; an explicit reservation/reminder request may ask for missing details.
  return (explicit.test(t) && ((future.test(t) && concreteTime.test(t)) || /예약|스케줄|알림|리마인더|\bremind\s+me\b|\bschedule\b|\bset\s+(?:a\s+)?reminder\b/i.test(t))) || (future.test(t) && concreteTime.test(t) && request.test(t));
}

/** Localized built-in copy stays here so locale dictionary changes are not required for scheduling. */
export function scheduleSkillContent(): { title: string; description: string; prompt: string } {
  const protocol = '```schedule\n{"title":"…","prompt":"…","runAt":"YYYY-MM-DDTHH:mm:ss±HH:mm","repeat":"once"}\n```';
  return getLocale() === 'en' ? {
    title: 'Schedule a task',
    description: 'Schedule a future question or a daily, weekday, weekly or monthly task in this conversation.',
    prompt: `Turn the current request into a future scheduled question. Follow the current clock and timezone in the system hint. Output exactly one JSON block with this schema:\n${protocol}\nUse a real future runAt with an explicit offset or Z. repeat is once, daily, weekdays, weekly or monthly. Ask for missing time or task details. For unsupported recurrence such as every two hours or selected weekdays, ask the user to choose a supported recurrence; never silently convert it. Explanations, examples, cancellation and negation must not produce a block. Do not claim that a schedule has been saved; the app validates and saves it.`,
  } : {
    title: '작업 예약',
    description: '이 대화에서 나중에 질문하거나 매일·평일·매주·매달 반복할 작업을 예약해요.',
    prompt: `이번 요청을 미래에 실행할 질문으로 만든다. 현재 시간과 시간대는 시스템 지시를 따른다. 아래 형식의 JSON 블록을 정확히 하나 출력한다:\n${protocol}\nrunAt은 실제로 존재하는 미래 날짜이며 offset 또는 Z를 포함한다. repeat는 once, daily, weekdays, weekly, monthly 중 하나다. 시간이나 작업이 모호하면 먼저 질문한다. 두 시간마다·특정 요일 묶음 등 지원하지 않는 반복은 지원 주기를 선택하도록 묻고 임의 변환하지 않는다. 설명·예제·취소·부정 요청에는 블록을 출력하지 않는다. 저장 성공은 앱이 검증하므로 예약을 저장했다고 주장하지 않는다.`,
  };
}

export function scheduleSystemHint(now = Date.now()): string {
  const date = new Date(now);
  const current = Number.isFinite(date.getTime()) ? date : new Date();
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const clock = `UTC: ${current.toISOString()}\nTimezone: ${zone}\nLocal: ${current.toString()}`;
  const protocol = '```schedule\n{"title":"…","prompt":"…","runAt":"YYYY-MM-DDTHH:mm:ss±HH:mm","repeat":"once"}\n```';
  return getLocale() === 'en' ? [
    '## Schedule request', clock,
    'Only for a clear request to schedule future work, output exactly one schedule JSON code block with only title, prompt, runAt and repeat.',
    protocol,
    `title: 1–${SCHEDULE_LIMITS.title} characters; prompt: 1–${SCHEDULE_LIMITS.prompt} characters, a self-contained question to send in this conversation at the scheduled time.`,
    'runAt must be a real future ISO date/time with explicit offset or Z. Resolve relative dates using the current local timezone. repeat must be once, daily, weekdays, weekly or monthly.',
    'Ask a brief question if the time, timezone, repetition or task is ambiguous. Do not guess. For past dates, ask for a future time.',
    'Unsupported recurrence (for example every two hours or selected weekdays) requires asking the user to choose a supported recurrence; never silently coerce it.',
    'Do not emit a schedule block for explanations, examples, cancellation, negation or the execution of an existing scheduled task. Do not claim a schedule was saved; the app validates and saves it. Tasks run only while this device’s app is open.',
  ].join('\n') : [
    '## 예약 요청', clock,
    '미래 작업 예약을 명확히 요청했을 때만 title, prompt, runAt, repeat 네 필드의 JSON 코드 블록을 정확히 하나 출력한다.',
    protocol,
    `title은 1~${SCHEDULE_LIMITS.title}자, prompt는 1~${SCHEDULE_LIMITS.prompt}자이며 실행 시 이 대화에 보낼 독립적인 질문이다.`,
    'runAt은 실제로 존재하는 미래 ISO 날짜/시간이며 offset 또는 Z를 반드시 포함한다. 상대 날짜는 현재 로컬 시간대를 기준으로 계산한다. repeat는 once, daily, weekdays, weekly, monthly 중 하나다.',
    '시간·시간대·반복·작업이 모호하면 짧게 되묻고 추측하지 않는다. 과거 날짜면 미래 시간을 묻는다.',
    '두 시간마다·특정 요일 묶음 등 지원하지 않는 반복은 지원 주기를 선택하도록 묻고 임의로 변환하지 않는다.',
    '설명·예제·취소·부정 요청이나 기존 예약 작업의 실행에는 schedule 블록을 출력하지 않는다. 앱이 검증하고 저장하므로 예약을 저장했다고 주장하지 않는다. 이 기기에서 앱이 열려 있을 때만 작업이 실행된다.',
  ].join('\n');
}
