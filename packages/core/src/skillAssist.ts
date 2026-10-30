import { DEFAULT_PROMPTS, promptText, type PromptOverrides } from './prompts';
import type { StreamRequest } from './provider';
import { normalizeSkillFilePath, normalizeSkillName, sanitizeSkillFiles, SKILL_LIMITS, SKILL_NAME_RE } from './skills';
import type { Skill, SkillFile } from './model';

/**
 * AI로 스킬 만들기·고치기 (IMP-11, ADR-037).
 * 모델에게 태그 형식으로 스킬 네 필드를 받아, 스트리밍 중에도 부분 결과를 편집 칸에 채운다.
 * 필요하면 부수 파일(references/·scripts/·assets/)도 만들거나 고치거나 지운다 (IMP-12, ADR-038).
 */
export interface SkillFields {
  name: string;
  title: string;
  description: string;
  prompt: string;
  files: SkillFile[];
}

export interface SkillAssistInput {
  /** 사용자가 원하는 것 (새 스킬 설명 또는 고칠 점) */
  request: string;
  /** 고칠 스킬(편집 중인 내용). 비어 있으면 새로 만든다 */
  current?: SkillFields;
  /** 겹치면 안 되는 다른 스킬의 명령 이름 */
  takenNames?: readonly string[];
  /** 사용자가 고친 시스템 프롬프트 (ADR-098) */
  prompts?: PromptOverrides;
}

export const SKILL_ASSIST_SYSTEM = DEFAULT_PROMPTS.skillAssist;

/** 요청에 싣는 기존 파일 한 개의 최대 길이 (넘으면 앞부분만) */
const FILE_IN_REQUEST = 6000;

function fieldsBlock(f: SkillFields): string {
  const lines = [`<name>${f.name}</name>`, `<title>${f.title}</title>`, `<description>${f.description}</description>`, '<prompt>', f.prompt, '</prompt>'];
  for (const file of f.files) {
    // 긴 파일은 앞부분만 보여 주고 고치지 못하게 한다 (잘린 내용으로 덮어쓰지 않도록 mergeSkillFiles도 막는다)
    if (file.content.length > FILE_IN_REQUEST) {
      lines.push(`<file path="${file.path}" readonly>`, `${file.content.slice(0, FILE_IN_REQUEST)}\n…(이하 ${file.content.length - FILE_IN_REQUEST}자 생략 — 길어서 고칠 수 없음, 출력하지 말 것)`, '</file>');
    } else lines.push(`<file path="${file.path}">`, file.content, '</file>');
  }
  return lines.join('\n');
}

const hasContent = (f: SkillFields | undefined): f is SkillFields =>
  !!f && !!(f.name.trim() || f.title.trim() || f.prompt.trim() || f.description.trim() || f.files.length);

export function buildSkillAssistRequest(input: SkillAssistInput): StreamRequest {
  const parts: string[] = [];
  if (hasContent(input.current)) parts.push('## 현재 스킬 (이것을 고친다)', fieldsBlock(input.current), '');
  else parts.push('## 새 스킬을 만든다', '');
  const taken = (input.takenNames ?? []).filter((n) => n !== input.current?.name);
  if (taken.length) parts.push('## 이미 있는 명령 이름', taken.join(', '), '');
  parts.push('## 요청', input.request.trim() || (hasContent(input.current) ? '전체적으로 더 명확하고 쓰기 좋게 다듬어 줘.' : '학습에 도움이 되는 스킬을 하나 만들어 줘.'));
  return { system: promptText('skillAssist', input.prompts), messages: [{ role: 'user', content: parts.join('\n') }], purpose: 'skill' };
}

export type SkillAssistResult = Partial<Omit<SkillFields, 'files'>> & {
  note?: string;
  /** 새로 만들거나 고친 파일 (스트리밍 중에는 마지막 파일이 덜 왔을 수 있다) */
  files?: SkillFile[];
  /** 지울 파일 경로 */
  deletes?: string[];
};

const TAGS = ['name', 'title', 'description', 'prompt', 'note'] as const;

/** 끝에 걸린 미완성 태그(`</pro`, `<`)를 떼어 낸다 */
const stripPartialTag = (s: string) => s.replace(/<\/?[a-z]*$/i, '');

/** 필드 태그·파일 태그의 시작 (닫는 태그를 빠뜨린 출력에서 끊을 자리) */
const NEXT_TAG = /\n?<(name|title|description|prompt|note)>|\n?<(file|delete) path="/;

/** <file path="…">…</file> 들. partial이면 닫히지 않은 마지막 파일도 지금까지만큼 */
function parseFiles(raw: string, partial: boolean): SkillFile[] {
  const out: SkillFile[] = [];
  const re = /<file path="([^"\n]{1,200})"[^>\n]*>\n?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) {
    const start = m.index + m[0].length;
    let close = raw.indexOf('</file>', start);
    // 닫는 태그를 빠뜨리고 다음 파일이 시작되면 그 앞까지 (다음 파일의 닫는 태그를 가져가지 않게)
    const nextFile = raw.indexOf('<file path="', start);
    if (close >= 0 && nextFile >= 0 && nextFile < close) close = -1;
    let content: string;
    if (close >= 0) content = raw.slice(start, close);
    else {
      // 닫는 태그 없이 다음 태그가 나오면 거기까지, 끝까지 열려 있으면 partial일 때만
      const rest = raw.slice(start);
      const next = rest.search(NEXT_TAG);
      if (next >= 0) content = rest.slice(0, next);
      else if (partial) content = stripPartialTag(rest);
      else continue;
    }
    out.push({ path: normalizeSkillFilePath(m[1]!), content: content.replace(/\n$/, '') });
    if (close >= 0) re.lastIndex = close + 7;
  }
  return out;
}

/**
 * 모델 출력에서 필드를 읽는다. 스트리밍 중(partial)에는 닫히지 않은 태그의 내용도 지금까지만큼 돌려준다.
 * 코드 블록으로 감싸거나 앞뒤에 말을 붙여도 태그만 본다.
 */
export function parseSkillAssist(raw: string, partial = false): SkillAssistResult {
  const out: SkillAssistResult = {};
  // 파일 본문 안의 태그 모양 글자를 필드로 읽지 않도록, 필드는 파일 블록을 뺀 곳에서 찾는다
  const head = raw.replace(/<file path="[^"\n]*"[^>\n]*>[\s\S]*?(<\/file>|$)/g, '');
  for (const tag of TAGS) {
    const open = head.indexOf(`<${tag}>`);
    if (open < 0) continue;
    const start = open + tag.length + 2;
    const close = head.indexOf(`</${tag}>`, start);
    let value = close < 0 ? head.slice(start) : head.slice(start, close);
    // 다음 태그가 먼저 시작되면 거기서 끊는다 (닫는 태그를 빠뜨린 출력)
    const next = value.search(NEXT_TAG);
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
  const files = parseFiles(raw, partial);
  if (files.length) out.files = files;
  const deletes = [...head.matchAll(/<delete path="([^"\n]{1,200})"\s*\/?>/g)].map((m) => normalizeSkillFilePath(m[1]!));
  if (deletes.length) out.deletes = deletes;
  return out;
}

/**
 * 현재 파일에 AI 결과(새로 쓴 파일·지운 파일)를 합친다.
 * 요청에 앞부분만 보낸 긴 파일은 AI가 다시 써도 무시한다(잘린 내용으로 덮어쓰지 않게). 지우기는 따른다
 */
export function mergeSkillFiles(current: readonly SkillFile[], result: Pick<SkillAssistResult, 'files' | 'deletes'>): SkillFile[] {
  const del = new Set((result.deletes ?? []).map((p) => p.toLowerCase()));
  const locked = new Set(current.filter((f) => f.content.length > FILE_IN_REQUEST).map((f) => f.path.toLowerCase()));
  const written = new Map((result.files ?? []).filter((f) => !locked.has(f.path.toLowerCase())).map((f) => [f.path.toLowerCase(), f]));
  const kept = current.filter((f) => !del.has(f.path.toLowerCase()) && !written.has(f.path.toLowerCase()));
  return sanitizeSkillFiles([...kept, ...written.values()].filter((f) => !del.has(f.path.toLowerCase())));
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
    files: mergeSkillFiles(current.files, result),
  };
}
