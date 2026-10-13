import type { StreamRequest } from './provider';
import { normalizeSkillName, SKILL_LIMITS, SKILL_NAME_RE } from './skills';
import type { Skill } from './model';

/**
 * AI로 스킬 만들기·고치기 (IMP-11, ADR-037).
 * 모델에게 태그 형식으로 스킬 네 필드를 받아, 스트리밍 중에도 부분 결과를 편집 칸에 채운다.
 */
export interface SkillFields {
  name: string;
  title: string;
  description: string;
  prompt: string;
}

export interface SkillAssistInput {
  /** 사용자가 원하는 것 (새 스킬 설명 또는 고칠 점) */
  request: string;
  /** 고칠 스킬(편집 중인 내용). 비어 있으면 새로 만든다 */
  current?: SkillFields;
  /** 겹치면 안 되는 다른 스킬의 명령 이름 */
  takenNames?: readonly string[];
}

export const SKILL_ASSIST_SYSTEM = [
  '너는 학습 채팅앱의 "스킬" 작성 도우미다.',
  '스킬은 학습자가 채팅에서 /명령으로 고르면 그 질문 하나에 시스템 지시로 더해지는 재사용 지시문이다.',
  '이 앱의 학습자는 답변 속 용어를 드래그해 가지(하위 질문)로 더 파고든다.',
  '',
  '요청에 맞게 스킬을 새로 만들거나, 주어진 현재 스킬을 고친다. 아래 형식으로만 출력하고 다른 말은 쓰지 않는다:',
  '',
  '<name>명령 이름</name>',
  '<title>제목</title>',
  '<description>설명</description>',
  '<prompt>',
  '지시',
  '</prompt>',
  '<note>무엇을 만들었거나 바꿨는지 한두 문장</note>',
  '',
  '규칙:',
  '- name: 영문 소문자·숫자·-·_ 로 2~24자, 공백 없이. 짧고 기억하기 쉽게. 이미 있는 명령 이름은 쓰지 않는다.',
  '- title: 한국어 20자 이내.',
  '- description: 무엇을 해 주는 스킬인지 한국어 한 문장(80자 이내).',
  '- prompt: 모델이 따를 지시. "~한다" 체의 번호 목록으로 진행 단계, 출력 형식(제목·목록·표), 분량, 입력이 비었거나 모호할 때의 처리를 구체적으로 쓴다.',
  '  학습자가 드래그해 더 물어볼 수 있게 핵심 용어는 굵게 쓰라는 지시를 알맞게 넣는다. 4000자 이내.',
  '- 고칠 때는 요청한 부분만 바꾸고 나머지는 그대로 둔다. 바꾸지 않은 필드도 모두 출력한다.',
].join('\n');

function fieldsBlock(f: SkillFields): string {
  return [`<name>${f.name}</name>`, `<title>${f.title}</title>`, `<description>${f.description}</description>`, '<prompt>', f.prompt, '</prompt>'].join('\n');
}

const hasContent = (f: SkillFields | undefined): f is SkillFields => !!f && !!(f.name.trim() || f.title.trim() || f.prompt.trim() || f.description.trim());

export function buildSkillAssistRequest(input: SkillAssistInput): StreamRequest {
  const parts: string[] = [];
  if (hasContent(input.current)) parts.push('## 현재 스킬 (이것을 고친다)', fieldsBlock(input.current), '');
  else parts.push('## 새 스킬을 만든다', '');
  const taken = (input.takenNames ?? []).filter((n) => n !== input.current?.name);
  if (taken.length) parts.push('## 이미 있는 명령 이름', taken.join(', '), '');
  parts.push('## 요청', input.request.trim() || (hasContent(input.current) ? '전체적으로 더 명확하고 쓰기 좋게 다듬어 줘.' : '학습에 도움이 되는 스킬을 하나 만들어 줘.'));
  return { system: SKILL_ASSIST_SYSTEM, messages: [{ role: 'user', content: parts.join('\n') }], purpose: 'skill' };
}

export type SkillAssistResult = Partial<SkillFields> & { note?: string };

const TAGS = ['name', 'title', 'description', 'prompt', 'note'] as const;

/** 끝에 걸린 미완성 태그(`</pro`, `<`)를 떼어 낸다 */
const stripPartialTag = (s: string) => s.replace(/<\/?[a-z]*$/i, '');

/**
 * 모델 출력에서 필드를 읽는다. 스트리밍 중(partial)에는 닫히지 않은 태그의 내용도 지금까지만큼 돌려준다.
 * 코드 블록으로 감싸거나 앞뒤에 말을 붙여도 태그만 본다.
 */
export function parseSkillAssist(raw: string, partial = false): SkillAssistResult {
  const out: SkillAssistResult = {};
  for (const tag of TAGS) {
    const open = raw.indexOf(`<${tag}>`);
    if (open < 0) continue;
    const start = open + tag.length + 2;
    const close = raw.indexOf(`</${tag}>`, start);
    let value = close < 0 ? raw.slice(start) : raw.slice(start, close);
    // 다음 태그가 먼저 시작되면 거기서 끊는다 (닫는 태그를 빠뜨린 출력)
    const next = value.search(/\n?<(name|title|description|prompt|note)>/);
    const ended = close >= 0 || next >= 0;
    if (next >= 0) value = value.slice(0, next);
    else if (!ended) {
      if (!partial) continue;
      value = stripPartialTag(value);
    }
    value = tag === 'prompt' ? value.replace(/^\n+|\s+$/g, '') : value.replace(/\s+/g, ' ').trim();
    if (tag === 'name') value = normalizeSkillName(value);
    if (value || ended) out[tag] = value;
  }
  return out;
}

/** 명령 형식에 맞지 않는 글자를 빼고, 겹치면 -2, -3…을 붙인다 */
export function uniqueSkillName(name: string, others: readonly Pick<Skill, 'id' | 'name'>[], selfId?: string): string {
  let base = normalizeSkillName(name)
    .replace(/[^a-z0-9가-힣_-]/g, '')
    .replace(/^[-_]+/, '')
    .slice(0, SKILL_LIMITS.name);
  if (!SKILL_NAME_RE.test(base)) base = 'skill';
  const taken = new Set(others.filter((o) => o.id !== selfId).map((o) => o.name));
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) {
    const suffix = `-${i}`;
    const candidate = `${base.slice(0, SKILL_LIMITS.name - suffix.length)}${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/**
 * 최종 결과를 편집 칸 값으로 만든다. 빠진 필드는 현재 값을 쓰고, 길이 제한에 맞춘다.
 * 지시를 끝내 읽지 못하면 null
 */
export function finalizeSkillAssist(
  result: SkillAssistResult,
  current: SkillFields,
  others: readonly Pick<Skill, 'id' | 'name'>[],
  selfId?: string,
): SkillFields | null {
  const prompt = (result.prompt ?? '').trim() || current.prompt.trim();
  if (!prompt) return null;
  const title = (result.title || current.title || '새 스킬').slice(0, SKILL_LIMITS.title);
  return {
    name: uniqueSkillName(result.name || current.name || title, others, selfId),
    title,
    description: (result.description ?? current.description).slice(0, SKILL_LIMITS.description),
    prompt: prompt.slice(0, SKILL_LIMITS.prompt),
  };
}
