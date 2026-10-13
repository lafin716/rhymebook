import { isCliId, isValidEffort, isValidModelName, resolveModelOptions, type ModelOptions } from './cli-options';
import type { ConnectionState, ID, Message, ProviderId, Session, Skill, SkillFile, SkillOptions, SkillRef } from './model';
import { PROVIDER_LABELS } from './provider';

/** 스킬 제한 (ADR-034) */
export const SKILL_LIMITS = {
  name: 32,
  title: 60,
  description: 1024,
  prompt: 20000,
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

/* ── 스킬 부수 파일 (IMP-12, ADR-038) ───────────────────── */

/** 부수 파일 제한: 텍스트만, 질문마다 시스템 지시에 실리므로 합계를 묶는다 */
export const SKILL_FILE_LIMITS = {
  count: 30,
  path: 120,
  depth: 4,
  file: 40_000,
  total: 120_000,
} as const;

const SEGMENT_RE = /^[A-Za-z0-9가-힣_][A-Za-z0-9가-힣._-]{0,63}$/;

/** 스킬 폴더 기준 상대 경로인지: `references/guide.md`처럼 `/`로 나눈 안전한 이름들. SKILL.md는 예약 */
export function isSkillFilePath(path: string): boolean {
  if (path.length > SKILL_FILE_LIMITS.path) return false;
  const parts = path.split('/');
  if (parts.length > SKILL_FILE_LIMITS.depth || !parts.every((p) => SEGMENT_RE.test(p) && !/^\.+$/.test(p))) return false;
  return path.toLowerCase() !== 'skill.md';
}

/** 입력한 경로를 상대 경로 형식으로 맞춘다 (`\` → `/`, 앞의 `./`·`/` 제거, 공백 → -) */
export function normalizeSkillFilePath(input: string): string {
  return input
    .trim()
    .replace(/\\/g, '/')
    .replace(/^(\.?\/)+/, '')
    .replace(/\/{2,}/g, '/')
    .replace(/\s+/g, '-');
}

export type SkillFilesProblem = 'path' | 'duplicate' | 'count' | 'size';

/** 부수 파일 목록 확인. 문제가 없으면 null */
export function validateSkillFiles(files: readonly SkillFile[]): SkillFilesProblem | null {
  if (files.length > SKILL_FILE_LIMITS.count) return 'count';
  const seen = new Set<string>();
  let total = 0;
  for (const f of files) {
    if (!isSkillFilePath(f.path)) return 'path';
    const key = f.path.toLowerCase();
    if (seen.has(key)) return 'duplicate';
    seen.add(key);
    if (f.content.length > SKILL_FILE_LIMITS.file) return 'size';
    total += f.content.length;
  }
  return total > SKILL_FILE_LIMITS.total ? 'size' : null;
}

/** 받은 파일 목록을 쓸 수 있게 맞춘다: 경로 정리, 잘못된 경로·중복 제외, 크기 제한, 경로순 */
export function sanitizeSkillFiles(files: readonly SkillFile[]): SkillFile[] {
  const out: SkillFile[] = [];
  const seen = new Set<string>();
  let total = 0;
  for (const f of files) {
    const path = normalizeSkillFilePath(f.path);
    if (!isSkillFilePath(path) || seen.has(path.toLowerCase()) || out.length >= SKILL_FILE_LIMITS.count) continue;
    const content = f.content.slice(0, Math.min(SKILL_FILE_LIMITS.file, SKILL_FILE_LIMITS.total - total));
    seen.add(path.toLowerCase());
    total += content.length;
    out.push({ path, content });
  }
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

function isSkillFileList(v: unknown): v is SkillFile[] {
  return (
    Array.isArray(v) &&
    v.every(
      (f) =>
        !!f &&
        typeof f === 'object' &&
        typeof (f as SkillFile).path === 'string' &&
        typeof (f as SkillFile).content === 'string' &&
        Object.keys(f as object).every((k) => k === 'path' || k === 'content'),
    ) &&
    validateSkillFiles(v as SkillFile[]) === null
  );
}

/* ── 스킬 전용 provider·모델·노력치 (IMP-12, ADR-038) ───── */

export function isSkillOptions(v: unknown): v is SkillOptions {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  if (typeof o.providerId !== 'string' || !(o.providerId in PROVIDER_LABELS)) return false;
  if (o.model !== undefined && (typeof o.model !== 'string' || !isValidModelName(o.model))) return false;
  // 노력치가 그 CLI·모델에 맞는지는 쓸 때(resolveModelOptions) 다시 거른다
  if (o.effort !== undefined && (typeof o.effort !== 'string' || !/^[a-z]{1,16}$/.test(o.effort))) return false;
  return Object.keys(o).every((k) => k === 'providerId' || k === 'model' || k === 'effort');
}

/** 편집 값으로 옵션을 만든다. provider를 고르지 않았으면 undefined(세션 설정 따름) */
export function makeSkillOptions(providerId: ProviderId | '' | undefined, model?: string, effort?: string): SkillOptions | undefined {
  if (!providerId) return undefined;
  const m = model?.trim();
  const out: SkillOptions = { providerId, ...(m && isValidModelName(m) ? { model: m } : {}) };
  if (effort && isCliId(providerId) && isValidEffort(providerId, effort, out.model)) out.effort = effort;
  return out;
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
    (r.files === undefined || isSkillFileList(r.files)) &&
    (r.options === undefined || isSkillOptions(r.options)) &&
    Object.keys(r).every((k) => ['id', 'name', 'title', 'prompt', 'files', 'options'].includes(k))
  );
}

export function isSkill(v: unknown): v is Skill {
  if (!v || typeof v !== 'object') return false;
  const s = v as Record<string, unknown>;
  return (
    isSkillRef({
      id: s.id,
      name: s.name,
      title: s.title,
      prompt: s.prompt,
      ...(s.files !== undefined ? { files: s.files } : {}),
      ...(s.options !== undefined ? { options: s.options } : {}),
    }) &&
    typeof s.description === 'string' &&
    typeof s.createdAt === 'number' &&
    typeof s.updatedAt === 'number'
  );
}

export function skillRef(s: Skill): SkillRef {
  return {
    id: s.id,
    name: s.name,
    title: s.title,
    prompt: s.prompt,
    ...(s.files?.length ? { files: s.files } : {}),
    ...(s.options ? { options: s.options } : {}),
  };
}

/**
 * 이 질문을 답할 provider·모델·노력치 (IMP-12).
 * 마지막 사용자 메시지에 전용 설정이 있는 스킬이 있고 그 provider를 쓸 수 있으면 그 설정을,
 * 아니면 세션 설정(세션 provider → 세션 모델 덮어쓰기 → 연결 기본값)을 쓴다.
 * 스킬이 provider만 정하고 모델·노력치를 비우면 그 provider 연결의 기본값이다.
 */
export function chatTarget(
  state: {
    sessions: Record<ID, Session>;
    messages: Record<ID, Message[]>;
    connections: Record<ProviderId, ConnectionState>;
    settings: { defaultProviderId: ProviderId };
  },
  sessionId: ID,
  opts: { usable(id: ProviderId): boolean; ignoreSkill?: boolean },
): { providerId: ProviderId; options: ModelOptions; bySkill: boolean } {
  const session = state.sessions[sessionId];
  const own = opts.ignoreSkill ? undefined : state.messages[sessionId]?.findLast((m) => m.role === 'user')?.skill?.options;
  if (own && opts.usable(own.providerId)) {
    return { providerId: own.providerId, options: resolveModelOptions(own.providerId, own, state.connections[own.providerId]), bySkill: true };
  }
  const providerId = session?.providerId ?? state.settings.defaultProviderId;
  return { providerId, options: resolveModelOptions(providerId, session?.modelPref, state.connections[providerId]), bySkill: false };
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

/** 본문에 나오는 가장 긴 ``` 보다 긴 펜스 */
function fenceFor(content: string): string {
  const longest = Math.max(0, ...[...content.matchAll(/`{3,}/g)].map((m) => m[0].length));
  return '`'.repeat(Math.max(3, longest + 1));
}

const FENCE_LANG: Record<string, string> = { md: 'markdown', py: 'python', js: 'javascript', ts: 'typescript', sh: 'bash', json: 'json', yaml: 'yaml', yml: 'yaml' };

/** 스킬 지시를 system 프롬프트에 붙인다. 부수 파일은 경로별 코드 블록으로 함께 싣는다 */
export function withSkill(system: string, skill: SkillRef | undefined): string {
  if (!skill) return system;
  const out = [`${system}\n\n## 스킬: ${skill.title} (/${skill.name})\n이번 질문에는 아래 지시를 따른다.\n\n${skill.prompt.trim()}`];
  if (skill.files?.length) {
    out.push(
      '',
      '### 스킬 파일',
      '이 스킬 폴더에 딸린 파일이다. 지시가 경로로 가리키는 파일을 참고한다. 스크립트는 여기서 실행할 수 없으니 필요하면 내용·실행 방법·예상 결과를 설명한다.',
    );
    for (const f of skill.files) {
      const fence = fenceFor(f.content);
      const ext = /\.([a-z0-9]+)$/i.exec(f.path)?.[1]?.toLowerCase() ?? '';
      out.push('', `#### ${f.path}`, `${fence}${FENCE_LANG[ext] ?? ext}`, f.content.replace(/\n+$/, ''), fence);
    }
  }
  return out.join('\n');
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
