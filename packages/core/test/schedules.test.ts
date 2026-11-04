import { afterEach, describe, expect, it, vi } from 'vitest';
import { getLocale, setLocale } from '../src/i18n';
import { matchSkill, matchTaskSkill, matchTaskSkills } from '../src/skill-match';
import { defaultSkills, SCHEDULE_SKILL_ID, skillsToSeed } from '../src/skills';
import {
  hasScheduleIntent, nextScheduleRun, parseScheduleBlock, scheduleSystemHint,
  SCHEDULE_LIMITS, validateScheduleInput, type ScheduleInput,
} from '../src/schedules';

const NOW = Date.parse('2026-11-03T00:00:00Z');
const INPUT: ScheduleInput = { title: '영어 퀴즈', prompt: '영어 단어 퀴즈 3문제를 내줘', runAt: '2026-11-04T09:00:00+09:00', repeat: 'daily' };
const block = (value: unknown = INPUT) => `
예약 요청을 확인했어요.
\`\`\`schedule
${JSON.stringify(value)}
\`\`\`
`;

describe('schedule input and block protocol', () => {
  it('reads one complete fenced JSON object and trims task text', () => {
    expect(parseScheduleBlock(block(), NOW)).toEqual(INPUT);
    expect(validateScheduleInput({ ...INPUT, title: ' 영어 ', prompt: ' 퀴즈 ' }, NOW)).toMatchObject({ title: '영어', prompt: '퀴즈' });
    expect(parseScheduleBlock(block().replaceAll('\n', '\r\n'), NOW)).toEqual(INPUT);
    expect(parseScheduleBlock(`\`\`\`json\n{}\n\`\`\`\n${block()}`, NOW)).toEqual(INPUT);
  });

  it('rejects incomplete, repeated, nested example and raw JSON output', () => {
    expect(parseScheduleBlock(JSON.stringify(INPUT), NOW)).toBeNull();
    expect(parseScheduleBlock(block() + block(), NOW)).toBeNull();
    expect(parseScheduleBlock(block().trimEnd().slice(0, -3), NOW)).toBeNull();
    expect(parseScheduleBlock(`\`\`\`\`markdown\n${block()}\n\`\`\`\``, NOW)).toBeNull();
    expect(parseScheduleBlock(`${block()}\`\`\`schedule\n{`, NOW)).toBeNull();
    expect(parseScheduleBlock('```schedule\n{"title":}\n```', NOW)).toBeNull();
    expect(parseScheduleBlock('```schedule\nnull\n```', NOW)).toBeNull();
  });

  it.each([
    '2026-02-30T09:00:00Z', '2027-02-29T09:00:00Z', '2026-13-01T09:00:00Z',
    '2026-11-31T09:00:00Z', '2026-12-01T24:00:00Z', '2026-12-01T09:60:00Z',
    '2026-12-01T09:00:60Z', '2026-12-01T09:00:00+24:00', '2026-12-01T09:00:00+09:60',
    '2026-12-01T09:00:00', '2026-12-01', '2026-11-03T00:00:00Z', '2026-11-02T09:00:00Z',
  ])('rejects invalid, ambiguous or nonfuture date %s', (runAt) => {
    expect(parseScheduleBlock(block({ ...INPUT, runAt }), NOW)).toBeNull();
  });

  it('accepts leap days and explicit offsets while comparing actual instants', () => {
    expect(validateScheduleInput({ ...INPUT, runAt: '2028-02-29T09:00Z' }, NOW)).not.toBeNull();
    expect(validateScheduleInput({ ...INPUT, runAt: '2026-11-03T09:00:00+09:00' }, NOW)).toBeNull();
    expect(validateScheduleInput({ ...INPUT, runAt: '2026-11-03T09:00:00.001+09:00' }, NOW)).not.toBeNull();
  });

  it.each([
    { ...INPUT, repeat: 'yearly' }, { ...INPUT, repeat: null }, { ...INPUT, title: '' },
    { ...INPUT, prompt: ' \n ' }, { ...INPUT, runAt: 1 }, { ...INPUT, extra: true },
    { ...INPUT, title: 'x'.repeat(SCHEDULE_LIMITS.title + 1) },
    { ...INPUT, prompt: 'x'.repeat(SCHEDULE_LIMITS.prompt + 1) }, [INPUT],
  ])('rejects invalid shapes and oversized fields', (value) => {
    expect(parseScheduleBlock(block(value), NOW)).toBeNull();
  });

  it('bounds block and response size before parsing', () => {
    expect(parseScheduleBlock(`\`\`\`schedule\n${' '.repeat(SCHEDULE_LIMITS.block)}${JSON.stringify(INPUT)}\n\`\`\``, NOW)).toBeNull();
    expect(parseScheduleBlock(' '.repeat(SCHEDULE_LIMITS.text) + block(), NOW)).toBeNull();
    expect(parseScheduleBlock(block({ ...INPUT, title: 'x'.repeat(SCHEDULE_LIMITS.title), prompt: 'x'.repeat(SCHEDULE_LIMITS.prompt) }), NOW)).not.toBeNull();
  });
});

const local = (year: number, month: number, day: number, hour = 9, minute = 15) => new Date(year, month - 1, day, hour, minute).getTime();

describe('local calendar recurrence', () => {
  it('ends once schedules and guards invalid inputs', () => {
    expect(nextScheduleRun(NOW, 'once', NOW)).toBeNull();
    expect(nextScheduleRun(NaN, 'daily', NOW)).toBeNull();
    expect(nextScheduleRun(NOW, 'daily', Infinity)).toBeNull();
    expect(nextScheduleRun(NOW, 'monthly', NOW, 32)).toBeNull();
  });

  it('skips missed daily and weekly runs and always advances past now', () => {
    const at = local(2026, 11, 3);
    expect(nextScheduleRun(at, 'daily', local(2026, 11, 7, 8))).toBe(local(2026, 11, 7));
    expect(nextScheduleRun(at, 'daily', local(2026, 11, 7))).toBe(local(2026, 11, 8));
    expect(nextScheduleRun(at, 'weekly', local(2026, 11, 24))).toBe(local(2026, 12, 1));
    expect(nextScheduleRun(at, 'daily', at - 1)).toBe(local(2026, 11, 4));
    expect(nextScheduleRun(at, 'daily', local(2096, 11, 7))).toBe(local(2096, 11, 8));
  });

  it('skips weekends even when the previous run was missed', () => {
    const friday = local(2026, 11, 6);
    expect(nextScheduleRun(friday, 'weekdays', friday)).toBe(local(2026, 11, 9));
    expect(nextScheduleRun(friday, 'weekdays', local(2026, 11, 13))).toBe(local(2026, 11, 16));
    expect(nextScheduleRun(friday, 'weekdays', local(2026, 11, 16, 8))).toBe(local(2026, 11, 16));
  });

  it('clamps short months and restores the original anchor day', () => {
    const jan31 = local(2027, 1, 31);
    const feb28 = nextScheduleRun(jan31, 'monthly', jan31, 31)!;
    expect(feb28).toBe(local(2027, 2, 28));
    expect(nextScheduleRun(feb28, 'monthly', feb28, 31)).toBe(local(2027, 3, 31));
    expect(nextScheduleRun(jan31, 'monthly', local(2028, 2, 28), 31)).toBe(local(2028, 2, 29));
    expect(nextScheduleRun(jan31, 'monthly', local(2028, 2, 29), 31)).toBe(local(2028, 3, 31));
    expect(nextScheduleRun(local(2026, 12, 31), 'monthly', local(2026, 12, 31), 31)).toBe(local(2027, 1, 31));
  });
});

describe('DST recurrence', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('preserves local hours rather than elapsed 24-hour periods', () => {
    vi.stubEnv('TZ', 'America/New_York');
    const at = local(2027, 3, 13);
    const next = nextScheduleRun(at, 'daily', at)!;
    expect(next).toBe(local(2027, 3, 14));
    expect(next - at).toBe(23 * 60 * 60 * 1000);
    const fall = local(2027, 11, 6);
    expect(nextScheduleRun(fall, 'daily', fall)! - fall).toBe(25 * 60 * 60 * 1000);
  });

  it('advances a nonexistent clock by the gap and restores it using originAt', () => {
    vi.stubEnv('TZ', 'America/New_York');
    const originAt = local(2027, 3, 13, 2, 30);
    const gap = nextScheduleRun(originAt, 'daily', originAt)!;
    expect(gap).toBe(local(2027, 3, 14, 3, 30));
    expect(nextScheduleRun(originAt, 'daily', gap)).toBe(local(2027, 3, 15, 2, 30));
  });
});

describe('conservative schedule intent', () => {
  it.each([
    '내일 오전 9시에 영어 퀴즈 내줘', '매일 아침 9시에 영어 단어 알려줘',
    '매주 월요일 대화 정리해줘', '매월 1일 복습 문제 만들어 주세요',
    '매일 오전9시에 AI를 설명해줘', 'Explain transformers every morning', '예약해줘', '알림 설정해줘', '30분 후에 다시 알려줘',
    '2026-12-01에 퀴즈 내줘', 'Remind me tomorrow at 9 to study',
    'Schedule my daily quiz', 'Every morning at 9 quiz me', 'Every weekday send me a word',
  ])('accepts %s', (text) => expect(hasScheduleIntent(text)).toBe(true));

  it.each([
    '내일 날씨 알려줘', '다음 주 여행 계획 만들어줘', 'Tell me tomorrow weather', '예약 기능 설명해줘', '매일 운동하면 어떤 효과가 있어?', '내일 날씨가 어때?',
    '예약하지 말아줘', '내일 알림 보내지 마', '내일 퀴즈 내주지 마', '예약 취소해줘',
    '예약 안 해줘도 돼', '알림 꺼줘', '예약 시스템 구현해줘', '퀴즈 내줘',
    '예약 없이 내일 오전 9시에 퀴즈 내줘', '내일 오전9시에 알려줘라는 문장의 뜻이 뭐야?',
    '"내일 9시에 알려줘" 번역해줘', '예시로 내일 9시에 퀴즈 내줘라고 쓸 수 있어?',
    'Explain how to schedule a quiz every day', "Don't remind me tomorrow", 'Cancel my daily quiz',
    'What is a daily schedule?', 'Every day is a new opportunity', '```\nRemind me tomorrow\n```',
    'What does remind me tomorrow mean?',
  ])('rejects %s', (text) => expect(hasScheduleIntent(text)).toBe(false));
});

describe('schedule builtin integration', () => {
  const originalLocale = getLocale();
  afterEach(() => setLocale(originalLocale));

  it('seeds once, preserves a removed builtin and never replaces a custom command', () => {
    const defaults = defaultSkills(1);
    const schedule = defaults.find((skill) => skill.id === SCHEDULE_SKILL_ID)!;
    expect(schedule).toMatchObject({ name: 'schedule', builtin: true, createdAt: 1, updatedAt: 1 });
    expect(schedule.prompt).toContain('```schedule');
    const old = defaults.filter((skill) => skill.id !== SCHEDULE_SKILL_ID);
    const seeded = old.map((skill) => skill.id);
    const migration = skillsToSeed(old, seeded);
    expect(migration.add.map((skill) => skill.id)).toEqual([SCHEDULE_SKILL_ID]);
    expect(skillsToSeed(old, migration.seeded).add).toEqual([]);
    expect(skillsToSeed([...old, { ...schedule, id: 'mine', builtin: undefined }], seeded).add).toEqual([]);
  });

  it('prioritizes future tasks above immediate quiz, voice and curriculum skills', () => {
    const skills = defaultSkills();
    expect(matchSkill('내일 오전 9시에 퀴즈 내줘', skills)?.name).toBe('schedule');
    expect(matchSkill('매일 아침 소리 내어 읽어 줘', skills)?.name).toBe('schedule');
    expect(matchSkill('매주 월요일 학습 계획 만들어줘', [...skills].reverse())?.name).toBe('schedule');
    expect(matchSkill('퀴즈 내줘', skills)?.name).toBe('quiz');
    expect(matchSkill('예약 기능 설명해줘', skills)).toBeNull();
    expect(matchSkill('schedule 이라는 단어의 뜻', skills)).toBeNull();
    expect(matchSkill('/schedule 내일 9시', skills)).toBeNull();
    expect(matchSkill('예약해줘', skills.filter((skill) => skill.name !== 'schedule'))).toBeNull();
  });

  it('uses a fresh clock and localized builtin copy', () => {
    setLocale('en');
    const english = scheduleSystemHint(NOW);
    expect(english).toContain('2026-11-03T00:00:00.000Z');
    expect(english).toContain(Intl.DateTimeFormat().resolvedOptions().timeZone);
    expect(english).toContain('weekdays');
    expect(defaultSkills().find((skill) => skill.id === SCHEDULE_SKILL_ID)!.title).toBe('Schedule a task');
    setLocale('ko');
    expect(scheduleSystemHint(NOW)).toContain('예약 요청');
    expect(defaultSkills().find((skill) => skill.id === SCHEDULE_SKILL_ID)!.title).toBe('작업 예약');
  });

  it('attaches an optional skill to a schedule (ADR-110)', () => {
    expect(validateScheduleInput({ ...INPUT, skill: '/Quiz ' }, NOW)).toMatchObject({ skill: 'quiz' });
    expect(validateScheduleInput({ ...INPUT, skill: null }, NOW)).not.toHaveProperty('skill');
    expect(validateScheduleInput({ ...INPUT, skill: '' }, NOW)).not.toHaveProperty('skill');
    expect(validateScheduleInput(INPUT, NOW)).not.toHaveProperty('skill');
    expect(validateScheduleInput({ ...INPUT, skill: 'schedule' }, NOW)).toBeNull();
    expect(validateScheduleInput({ ...INPUT, skill: 'bad name!' }, NOW)).toBeNull();
    expect(validateScheduleInput({ ...INPUT, skill: 3 }, NOW)).toBeNull();
    expect(validateScheduleInput({ ...INPUT, extra: 1 }, NOW)).toBeNull();
    expect(parseScheduleBlock(block({ ...INPUT, skill: 'quiz' }), NOW)?.skill).toBe('quiz');
  });

  it('infers the task skill and never the schedule skill', () => {
    const skills = defaultSkills();
    expect(matchTaskSkill('매일 3시 퀴즈 내줘', skills)?.name).toBe('quiz');
    expect(matchTaskSkill('영어 단어 퀴즈 3문제를 내줘', skills)?.name).toBe('quiz');
    expect(matchTaskSkill('내일 9시에 예약해줘', skills)).toBeNull();
  });

  it('lists usable skills in the hint, excluding schedule', () => {
    setLocale('ko');
    const hint = scheduleSystemHint(NOW, [
      { name: 'quiz', title: '퀴즈', description: '문제를 낸다' },
      { name: 'schedule', title: '작업 예약' },
    ]);
    expect(hint).toContain('- quiz: 퀴즈 — 문제를 낸다');
    expect(hint).not.toContain('- schedule:');
    expect(scheduleSystemHint(NOW)).toContain('skill은 넣지 않는다');
  });
});

describe('multi-skill requests (ADR-111)', () => {
  const names = (text: string) => matchTaskSkills(text, defaultSkills()).map((s) => s.name);

  it('a schedule with one task skill is not a multi-skill request', () => {
    for (const text of ['매일 3시 퀴즈 내줘', '매일 오전 9시에 퀴즈 내도록 예약해줘', '내일 3시에 영어 단어 퀴즈 내줘', '매주 월요일 복습 퀴즈 예약해줘']) {
      expect(names(text)).toEqual(['quiz']);
      expect(matchSkill(text, defaultSkills())?.name).toBe('schedule');
    }
    expect(names('오늘 배운 내용으로 퀴즈 내줘')).toEqual(['quiz']);
    expect(names('양자역학 설명해줘')).toEqual([]);
  });

  it('lists every task skill in request order, schedule excluded', () => {
    expect(names('퀴즈 내고 발음도 들려줘')).toEqual(['quiz', 'speak']);
    expect(names('커리큘럼 짜 주고 퀴즈도 내줘')).toEqual(['curriculum', 'quiz']);
    expect(names('매일 3시에 퀴즈 내고 발음 들려줘')).toEqual(['quiz', 'speak']);
    expect(names('퀴즈 풀기로 퀴즈 내줘')).toEqual(['quiz']);
  });

  it('the schedule hint pins the chosen skill', () => {
    const hint = scheduleSystemHint(0, [{ name: 'quiz', title: '퀴즈 풀기' }, { name: 'speak', title: '소리 내어 읽기' }], { name: 'quiz', title: '퀴즈 풀기' });
    expect(hint).toContain('"skill":"quiz"');
    expect(hint).not.toContain('- speak:');
  });
});

it('a schedule with two task skills is still a schedule request', () => {
  expect(hasScheduleIntent('매일 3시에 퀴즈 내고 발음 들려줘')).toBe(true);
  expect(matchSkill('매일 3시에 퀴즈 내고 발음 들려줘', defaultSkills())?.name).toBe('schedule');
});
