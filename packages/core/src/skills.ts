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

const sameSkillContent = (a: Skill, b: Skill) =>
  a.title === b.title &&
  a.description === b.description &&
  a.prompt === b.prompt &&
  JSON.stringify(a.files ?? []) === JSON.stringify(b.files ?? []) &&
  JSON.stringify(a.options ?? null) === JSON.stringify(b.options ?? null);

/**
 * PC 스킬을 이 기기 스킬에 합친다 (웹·모바일 스킬 동기화). 명령 이름이 같으면 PC 내용으로 고치고(이 기기 id 유지),
 * 없으면 더한다. 이 기기에만 있는 스킬은 그대로 둔다. 개수 제한을 넘는 새 스킬은 넣지 않는다.
 */
export function mergeSkills(
  local: readonly Skill[],
  incoming: readonly Skill[],
  makeId: () => ID,
): { skills: Skill[]; added: number; updated: number; skipped: number } {
  const out = [...local];
  const ids = new Set(local.map((s) => s.id));
  let added = 0;
  let updated = 0;
  let skipped = 0;
  for (const raw of incoming) {
    // 받은 내용은 그대로 믿지 않는다: 예시 표시(builtin)는 이 기기 것만, 설명은 길이 제한
    const { builtin: _pcBuiltin, ...plain } = raw;
    const pc: Skill = { ...plain, description: raw.description.slice(0, SKILL_LIMITS.description) };
    const i = out.findIndex((s) => s.name === pc.name);
    if (i >= 0) {
      const cur = out[i]!;
      if (sameSkillContent(cur, pc)) continue;
      const { files, options, ...rest } = pc;
      out[i] = {
        ...rest,
        id: cur.id,
        ...(files?.length ? { files } : {}),
        ...(options ? { options } : {}),
        ...(cur.builtin ? { builtin: true } : {}),
        createdAt: cur.createdAt,
      };
      updated++;
    } else if (out.length >= SKILL_LIMITS.count) {
      skipped++;
    } else {
      const id = ids.has(pc.id) ? makeId() : pc.id;
      ids.add(id);
      out.push({ ...pc, id });
      added++;
    }
  }
  return { skills: out, added, updated, skipped };
}

/** 기본 제공 예시 스킬 id (처음 실행 시 한 번 넣는다. 지우면 다시 넣지 않는다) */
export const CURRICULUM_SKILL_ID = 'skill-curriculum';
export const BOOK_SKILL_ID = 'skill-book';
export const QUIZ_SKILL_ID = 'skill-quiz';
export const SPEAK_SKILL_ID = 'skill-speak';
/** 세션 [재정리] 버튼이 쓰는 기본 스킬 */
export const REORGANIZE_SKILL_ID = 'skill-reorganize';

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
    {
      id: BOOK_SKILL_ID,
      name: 'book',
      title: '책으로 만들기',
      description: '학습 기록(이해 노트의 [책으로 만들기] 첨부 또는 현재 대화)을 구조적으로 분석해 목차부터 잡고 한 권의 책으로 엮어요.',
      prompt: [
        '학습자의 학습 기록(이해 노트의 첨부 학습 원문 또는 현재 대화)을 책 한 권으로 엮는다.',
        '',
        '## 1단계: 구조 분석 (짧게)',
        '첨부된 학습 원문(rhymebook 세션 트리: 번호 매긴 가지 예: "1.2", anchors = 학습자가 선택한 원문, summaries = 학습자의 이해, 전체 Q&A)을 읽거나, 첨부가 없으면 현재 대화를 분석한다.',
        '- 핵심 주제 한 줄',
        '- 학습자의 질문·가지들을 개념 군집으로 묶기 (예: 기본 개념 3개, 실전 활용 2개)',
        '- 선수 지식 순서 (무엇부터 먼저 와야 하는가)',
        '- 약점 찾기 (요약 없는 가지, 반복된 질문)',
        '',
        '## 2단계: 목차 잡기',
        '- 책 제목 정하기 (학습 주제를 담은 한 제목)',
        '- 3~8개 장 계획: `## 목차` 아래 각 장의 제목과 한 줄 목표',
        '  - 예: `## 1장. 기초 개념 — 이 장을 읽으면 핵심 용어를 알 수 있어요`',
        '  - 각 장은 1.1, 1.2, 1.3 같은 절(sections) 포함',
        '  - 원문 가지 번호 명시: `(가지 1.2, 2.1)` 형태로 각 절이 어느 원문에서 나왔는지 표시',
        '- 대화 순서가 아니라 개념 의존성(앞 장이 뒷장의 기초)에 따라 재정렬',
        '',
        '## 3단계: 본문 쓰기',
        '- 본문은 `# 책 제목` 한 줄로 시작한다 (이 줄 앞의 구조 분석·목차 계획은 책 PDF에서 빠진다)',
        '- **머리말**: `## 머리말` — 이 책을 읽은 후 할 수 있게 될 것 (1~2문단)',
        '- 각 장 `## N장. 제목`으로 시작',
        '  - `### N.M 절 제목` (각 절)',
        '  - 학습자 이해(summaries)를 바탕으로 흐르는 산문으로 설명 (채팅 기록 그대로가 아니라 책다운 문체)',
        '  - 원문에서 헷갈렸던 용어(anchors)를 **굵은 글씨**로 표시하고 명확한 정의·예시로 설명',
        '  - 장 끝에 **핵심 정리**: 2~4개의 핵심 내용을 글머리 기호로',
        '  - 장 끝에 **확인 문제**: 2~3개의 점검 질문 (학습자가 이해했는지 확인)',
        '- **맺음말**: `## 맺음말` — 이 책을 읽은 후 다음 학습 방향 제안 (1문단)',
        '- **용어 찾아보기**: `## 용어 찾아보기` — 책에서 굵게 표시한 용어들의 간단한 정의 (한 줄씩, 가나다순)',
        '',
        '## 주의',
        '- 원문에 없는 사실을 만들지 않는다. 명백한 빈틈을 채울 때만 "(보충)"이라고 표시한다.',
        '- 한 번의 답변에 책 전체가 안 나오면 완성한 장까지만 마친 후 끝에 이 줄을 쓴다:',
        '  "— N장까지 썼어요. \'계속\'이라고 보내면 다음 장부터 이어서 씁니다."',
        '- "계속" 요청이 오면 목차 반복 없이 다음 장부터 이어 쓴다.',
        '',
        '## 산출물 형식',
        '- 순수 마크다운 (한국어). 학습자가 [책 PDF로 저장]으로 실제 책처럼 엮는다',
        '- 제목 단계를 지킨다: `#` 책 제목(한 번), `##` 머리말·N장·맺음말·용어 찾아보기, `###` 절. 본문 안에서 `#`·`##`를 따로 쓰지 않는다',
        '- 이어 쓸 때도 `## N장. 제목`으로 시작하고, 인사말·안내 문장은 쓰지 않는다',
      ].join('\n'),
      builtin: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: QUIZ_SKILL_ID,
      name: 'quiz',
      title: '퀴즈 풀기',
      description: '주제나 지금까지의 대화로 OX·객관식·주관식 퀴즈를 내요. 대화창에서 카드로 한 문제씩 풀고 정답과 해설을 바로 확인해요.',
      prompt: [
        '학습자가 준 주제(비어 있으면 지금까지의 대화에서 다룬 내용)로 이해도를 점검하는 퀴즈를 낸다.',
        '',
        '## 출제',
        '- 학습자가 개수·유형·난이도를 정하면 따른다. 정하지 않으면 5문제, 유형을 섞는다 (OX 1~2, 객관식 2~3, 주관식 1~2).',
        '- 단순 암기보다 개념 이해·적용을 묻는다. 쉬운 문제에서 어려운 문제 순으로 낸다.',
        '- 객관식 보기는 4개, 오답 보기도 그럴듯하게. "모두 맞다/틀리다" 보기는 피한다.',
        '- 주관식은 한 단어나 짧은 구로 답할 수 있게 묻고, 같은 뜻의 다른 표기(영문·약어·띄어쓰기)를 accept에 넣는다.',
        '- 해설은 왜 정답인지와 흔한 오해를 1~3문장으로 쓴다. 원문 대화에 없는 사실을 지어내지 않는다.',
        '',
        '## 출력 형식 (반드시 지킨다)',
        '앱이 아래 코드 블록을 퀴즈 카드로 보여 주고 채점한다. 블록 앞에 한 줄 안내만 쓰고, 정답·해설을 블록 밖에 따로 쓰지 않는다.',
        '',
        '```quiz',
        '{',
        '  "title": "퀴즈 제목",',
        '  "questions": [',
        '    { "type": "ox", "question": "문장", "answer": true, "explanation": "해설" },',
        '    { "type": "choice", "question": "질문", "choices": ["보기1", "보기2", "보기3", "보기4"], "answer": 2, "explanation": "해설" },',
        '    { "type": "short", "question": "질문", "answer": "대표 정답", "accept": ["다른 표기"], "explanation": "해설" }',
        '  ]',
        '}',
        '```',
        '',
        '- 언어 이름은 `quiz`, 본문은 올바른 JSON(큰따옴표, 끝 쉼표 없음)이다.',
        '- ox의 answer는 true(O) 또는 false(X), choice의 answer는 1부터 센 정답 번호다.',
        '- 문자열 안에 마크다운(굵게, `코드`, $수식$)을 쓸 수 있다. 줄바꿈은 \\n으로 쓴다.',
      ].join('\n'),
      builtin: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: SPEAK_SKILL_ID,
      name: 'speak',
      title: '음성으로 읽기',
      description: '단어·문장·지금까지의 대화를 소리 내어 읽어 줘요. 대화창의 재생 카드에서 한 줄씩 또는 모두 이어 들어요.',
      prompt: [
        '학습자가 소리로 듣고 싶은 내용(비어 있으면 지금까지의 대화에서 핵심 표현)을 읽어 줄 문장 목록으로 만든다.',
        '',
        '## 고르기',
        '- 학습자가 준 문장이 있으면 그대로 읽는다. 주제만 주면 발음 연습에 좋은 단어·짧은 문장 3~10개를 고른다.',
        '- 한 줄은 한 번에 듣기 좋은 길이(한 문장, 길어도 두 문장)로 나눈다. 마크다운·괄호 설명·발음 기호는 text에 넣지 않는다.',
        '- 외국어 문장에는 note에 뜻(한국어)과 발음 요령을 짧게 쓴다. note는 화면에만 보이고 읽지 않는다.',
        '- lang은 text의 언어다: 베트남어 "vi", 영어 "en", 한국어 "ko". 앱이 이 언어 음성으로 읽는다.',
        '',
        '## 출력 형식 (반드시 지킨다)',
        '앱이 아래 코드 블록을 재생 카드로 보여 주고 읽어 준다. 블록 앞에 한 줄 안내만 쓰고, 같은 문장을 블록 밖에 다시 쓰지 않는다.',
        '',
        '```speak',
        '{',
        '  "title": "카드 제목",',
        '  "items": [',
        '    { "text": "Xin chào", "lang": "vi", "note": "안녕하세요 — 짜오는 내려가는 성조" },',
        '    { "text": "Nice to meet you.", "lang": "en", "note": "만나서 반가워요" }',
        '  ]',
        '}',
        '```',
        '',
        '- 언어 이름은 `speak`, 본문은 올바른 JSON(큰따옴표, 끝 쉼표 없음)이다. 항목은 최대 50개.',
      ].join('\n'),
      builtin: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: REORGANIZE_SKILL_ID,
      name: 'reorganize',
      title: '세션 재정리',
      description: '세션의 질문·답변 전체를 하나의 질문과 깔끔한 답변으로 정리해요. 세션의 [재정리] 버튼이 이 스킬을 써요.',
      prompt: [
        '학습자가 이 세션에서 나눈 질문·답변 전체를 하나의 질문과 하나의 답변으로 다시 정리한다.',
        '',
        '## 정리 규칙',
        '- 질문은 세션 전체를 아우르는 한 문장으로 쓴다.',
        '- 답변은 개념이 이어지는 순서로 다시 구성한다(대화 순서를 그대로 따를 필요 없음). 소제목(##)·목록·표·코드 블록을 알맞게 쓴다.',
        '- 겹치는 설명은 하나로 합치고, 틀렸다가 바로잡은 내용은 바로잡은 쪽만 남긴다.',
        '- 대화에 없던 사실을 새로 지어내지 않는다. 빠진 연결 설명은 짧게만 보탠다.',
        '- 각주 목록이 주어지면 관련 문장 끝에 [1], [2]처럼 번호로 가리킨다. 각주 내용을 본문에 길게 옮기지 않는다.',
        '- 인사·서두·"정리했습니다" 같은 말은 쓰지 않는다.',
        '',
        '## 출력 형식 (반드시 지킨다)',
        '첫 줄: `질문: <정리한 질문 한 문장>`',
        '둘째 줄: `---`',
        '셋째 줄부터: 정리한 답변(마크다운)',
      ].join('\n'),
      builtin: true,
      createdAt: now,
      updatedAt: now,
    },
  ];
}

/**
 * 기존 스킬 중 새로 시드해야 할 스킬 목록과 갱신된 시드 id 목록을 반환한다.
 * existing: 현재 DB의 스킬들
 * seeded: 이미 시드한 builtin id들 (unknown이면 호환성 처리: `true`면 [CURRICULUM_SKILL_ID], 배열이면 그대로)
 */
export function skillsToSeed(
  existing: readonly Skill[],
  seeded: unknown,
): { add: Skill[]; seeded: string[] } {
  // 호환성: 기존 true 값을 변환
  const oldSeeded = Array.isArray(seeded) ? seeded : seeded === true ? [CURRICULUM_SKILL_ID] : [];
  const seedSet = new Set(oldSeeded.filter((id) => typeof id === 'string'));
  const nameSet = new Set(existing.map((s) => s.name));

  const defaults = defaultSkills();
  const add: Skill[] = [];
  for (const def of defaults) {
    if (!seedSet.has(def.id) && !nameSet.has(def.name)) {
      add.push(def);
      seedSet.add(def.id);
    }
  }

  return { add, seeded: Array.from(seedSet).sort() };
}
