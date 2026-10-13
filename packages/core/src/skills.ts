import type { Skill, SkillRef } from './model';

/** 스킬 제한 (ADR-034) */
export const SKILL_LIMITS = {
  name: 32,
  title: 60,
  description: 200,
  prompt: 8000,
  count: 100,
} as const;

/** 슬래시 명령 이름: 영문 소문자·숫자·한글·-·_ (공백 없음) */
export const SKILL_NAME_RE = /^[a-z0-9가-힣][a-z0-9가-힣_-]{0,31}$/;

/** 입력한 이름을 명령 형식으로 맞춘다 (앞의 `/`·공백 제거, 소문자) */
export function normalizeSkillName(input: string): string {
  return input.trim().replace(/^\/+/, '').replace(/\s+/g, '-').toLowerCase();
}

export type SkillProblem = 'name' | 'name-taken' | 'title' | 'prompt' | 'too-long';

/** 저장 전 확인. 문제가 없으면 null */
export function validateSkill(s: Pick<Skill, 'id' | 'name' | 'title' | 'description' | 'prompt'>, others: readonly Skill[]): SkillProblem | null {
  if (!SKILL_NAME_RE.test(s.name)) return 'name';
  if (others.some((o) => o.id !== s.id && o.name === s.name)) return 'name-taken';
  if (!s.title.trim()) return 'title';
  if (!s.prompt.trim()) return 'prompt';
  if (s.title.length > SKILL_LIMITS.title || s.description.length > SKILL_LIMITS.description || s.prompt.length > SKILL_LIMITS.prompt) {
    return 'too-long';
  }
  return null;
}

/** 저장·동기화로 받은 스킬 사본 검증 */
export function isSkillRef(v: unknown): v is SkillRef {
  if (!v || typeof v !== 'object') return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r.id === 'string' &&
    /^[\w-]{1,64}$/.test(r.id) &&
    typeof r.name === 'string' &&
    SKILL_NAME_RE.test(r.name) &&
    typeof r.title === 'string' &&
    r.title.length <= SKILL_LIMITS.title &&
    typeof r.prompt === 'string' &&
    r.prompt.length <= SKILL_LIMITS.prompt &&
    Object.keys(r).every((k) => k === 'id' || k === 'name' || k === 'title' || k === 'prompt')
  );
}

export function isSkill(v: unknown): v is Skill {
  if (!v || typeof v !== 'object') return false;
  const s = v as Record<string, unknown>;
  return (
    isSkillRef({ id: s.id, name: s.name, title: s.title, prompt: s.prompt }) &&
    typeof s.description === 'string' &&
    typeof s.createdAt === 'number' &&
    typeof s.updatedAt === 'number'
  );
}

export function skillRef(s: Skill): SkillRef {
  return { id: s.id, name: s.name, title: s.title, prompt: s.prompt };
}

/**
 * 입력창의 슬래시 명령 해석. `/name 나머지` 형태면 { name, rest }, 아니면 null.
 * 이름 뒤가 끝이거나 공백일 때만 명령으로 본다.
 */
export function parseSlash(text: string): { name: string; rest: string } | null {
  const m = /^\/([^\s/]+)(?:\s+([\s\S]*))?$/.exec(text.trimStart());
  if (!m) return null;
  return { name: m[1]!.toLowerCase(), rest: (m[2] ?? '').trim() };
}

/** 입력 중인 슬래시 명령(공백 전) 접두어. 메뉴 필터용. 명령 입력 중이 아니면 null */
export function slashQuery(text: string): string | null {
  const m = /^\/([^\s/]*)$/.exec(text);
  return m ? m[1]!.toLowerCase() : null;
}

/** 접두어로 스킬 거르기 (이름 접두어 우선, 그다음 제목 포함) */
export function filterSkills(skills: readonly Skill[], query: string): Skill[] {
  const q = query.toLowerCase();
  const byName = skills.filter((s) => s.name.startsWith(q));
  const byTitle = skills.filter((s) => !s.name.startsWith(q) && (s.title.toLowerCase().includes(q) || s.name.includes(q)));
  return [...byName, ...byTitle];
}

/** 스킬 지시를 system 프롬프트에 붙인다 */
export function withSkill(system: string, skill: SkillRef | undefined): string {
  if (!skill) return system;
  return `${system}\n\n## 스킬: ${skill.title} (/${skill.name})\n이번 질문에는 아래 지시를 따른다.\n\n${skill.prompt.trim()}`;
}

/** 기본 제공 예시 스킬 id (처음 실행 시 한 번 넣는다. 지우면 다시 넣지 않는다) */
export const CURRICULUM_SKILL_ID = 'skill-curriculum';

export function defaultSkills(now = Date.now()): Skill[] {
  return [
    {
      id: CURRICULUM_SKILL_ID,
      name: 'curriculum',
      title: '커리큘럼 생성',
      description: '주제를 입력하면 단계별 학습 커리큘럼(목표·핵심 개념·실습·점검 질문)을 만들어요.',
      prompt: [
        '학습자가 준 주제로 단계별 학습 커리큘럼을 만든다.',
        '',
        '1. 먼저 한 문단으로 주제의 전체 그림과 이 커리큘럼을 마치면 할 수 있게 되는 것을 쓴다.',
        '2. 학습자 수준을 알 수 없으면 입문자 기준으로 하되, 첫머리에 "이미 아는 단계는 건너뛰어도 된다"고 알린다.',
        '3. 4~7개 단계(## 1단계. 제목)로 나누고, 각 단계에 다음을 쓴다:',
        '   - **목표**: 이 단계를 마치면 할 수 있는 것 (1~2줄)',
        '   - **핵심 개념**: 3~6개. 각 개념은 굵게 쓰고 한 줄로 설명한다 (학습자가 이 단어를 드래그해 가지로 더 물어볼 수 있게 짧고 명확한 용어로)',
        '   - **실습**: 직접 해 볼 과제 1~2개',
        '   - **점검 질문**: 이해했는지 스스로 확인할 질문 2개',
        '   - **예상 시간**',
        '4. 단계는 앞 단계의 개념 위에 쌓이도록 순서를 정하고, 선수 지식이 필요하면 표시한다.',
        '5. 마지막에 "## 다음으로" 아래 심화 주제 3개와 추천 학습 순서를 짧게 쓴다.',
        '',
        '주제가 비어 있으면 어떤 주제의 커리큘럼을 원하는지, 현재 수준과 목표 기간을 짧게 되묻는다.',
      ].join('\n'),
      builtin: true,
      createdAt: now,
      updatedAt: now,
    },
  ];
}
