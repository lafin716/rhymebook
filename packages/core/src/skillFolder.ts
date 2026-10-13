import type { ProviderId, Skill, SkillFile } from './model';
import { PROVIDER_LABELS } from './provider';
import { makeSkillOptions, normalizeSkillName, sanitizeSkillFiles, SKILL_LIMITS, SKILL_NAME_RE } from './skills';

/**
 * 데스크톱 스킬 폴더 (IMP-12, ADR-038).
 * `<userData>/skills/<name>/SKILL.md` + 부수 파일. Claude·Codex 스킬과 같은 모양이라
 * 그 스킬 폴더를 넣으면 가져오고, 앱 스킬도 폴더째 다른 도구에 옮길 수 있다.
 * SKILL.md frontmatter: name·description(공통) + title·provider·model·effort(이 앱).
 */
export interface SkillFolder {
  /** 폴더 이름 (= 명령 이름) */
  name: string;
  skillMd: string;
  files: SkillFile[];
}

/** YAML 한 줄 값: 안전하면 그대로, 아니면 JSON 문자열(YAML 큰따옴표 문자열과 호환) */
function yamlValue(v: string): string {
  return /^[^\s"'#&*!|>%@`{}[\],?:-][^\n#:]*$/.test(v) && !/\s$/.test(v) ? v : JSON.stringify(v);
}

export function toSkillMd(s: Pick<Skill, 'name' | 'title' | 'description' | 'prompt' | 'options'>): string {
  const fm = [`name: ${yamlValue(s.name)}`, `description: ${yamlValue(s.description)}`, `title: ${yamlValue(s.title)}`];
  if (s.options) {
    fm.push(`provider: ${s.options.providerId}`);
    if (s.options.model) fm.push(`model: ${yamlValue(s.options.model)}`);
    if (s.options.effort) fm.push(`effort: ${s.options.effort}`);
  }
  return `---\n${fm.join('\n')}\n---\n\n${s.prompt.trim()}\n`;
}

/** 이 앱이 쓰는 frontmatter 키. 나머지(allowed-tools·license 등)는 다시 쓸 때 그대로 둔다 */
const OWN_KEYS = new Set(['name', 'description', 'title', 'provider', 'model', 'effort']);

/**
 * 새 SKILL.md에 기존 SKILL.md의 모르는 frontmatter 키(그 아래 들여쓴 줄 포함)를 이어 붙인다.
 * Claude·Codex에서 가져온 스킬을 앱에서 고쳐도 그 도구용 설정을 잃지 않게 한다.
 */
export function mergeSkillMd(existing: string | null, next: string): string {
  if (!existing) return next;
  const m = /^---\n([\s\S]*?)\n---/.exec(existing.replace(/^\u{FEFF}/u, '').replace(/\r\n?/g, '\n'));
  if (!m) return next;
  const extra: string[] = [];
  let keep = false;
  for (const line of m[1]!.split('\n')) {
    const kv = /^([A-Za-z][\w-]*):/.exec(line);
    if (kv) keep = !OWN_KEYS.has(kv[1]!.toLowerCase());
    else if (!/^\s/.test(line) && line.trim()) keep = false;
    if (keep) extra.push(line);
  }
  if (!extra.length) return next;
  return next.replace(/^---\n([\s\S]*?)\n---/, (_all, fm: string) => `---\n${fm}\n${extra.join('\n')}\n---`);
}

function unquote(raw: string): string {
  const v = raw.trim();
  if (v.startsWith('"')) {
    try {
      return String(JSON.parse(v));
    } catch {
      return v.slice(1, v.endsWith('"') ? -1 : undefined);
    }
  }
  if (v.startsWith("'")) return v.slice(1, v.endsWith("'") ? -1 : undefined).replace(/''/g, "'");
  return v.replace(/\s+#.*$/, '');
}

/** SKILL.md를 frontmatter 키·값과 본문으로 나눈다. 블록 값(`|`·`>`)과 따옴표 문자열을 읽는다 */
export function parseSkillMd(text: string): { meta: Record<string, string>; body: string } {
  const src = text.replace(/^\u{FEFF}/u, '').replace(/\r\n?/g, '\n');
  const m = /^---\n([\s\S]*?)\n---[ \t]*(?:\n|$)/.exec(src);
  if (!m) return { meta: {}, body: src.trim() };
  const meta: Record<string, string> = {};
  const lines = m[1]!.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const kv = /^([A-Za-z][\w-]*):[ \t]*(.*)$/.exec(lines[i]!);
    if (!kv) continue;
    const key = kv[1]!.toLowerCase();
    const raw = kv[2]!;
    if (/^[|>][+-]?\s*$/.test(raw)) {
      const block: string[] = [];
      while (i + 1 < lines.length && (/^\s/.test(lines[i + 1]!) || lines[i + 1] === '')) block.push(lines[++i]!.trim());
      meta[key] = raw.startsWith('>') ? block.filter(Boolean).join(' ') : block.join('\n').trim();
    } else meta[key] = unquote(raw);
  }
  return { meta, body: src.slice(m[0].length).trim() };
}

export type SkillFolderFields = Pick<Skill, 'name' | 'title' | 'description' | 'prompt' | 'files' | 'options'>;

/** 폴더를 스킬 필드로 읽는다. 이름·지시가 맞지 않으면 null */
export function skillFromFolder(folder: SkillFolder): SkillFolderFields | null {
  const { meta, body } = parseSkillMd(folder.skillMd);
  const name = normalizeSkillName(folder.name);
  // 폴더 이름이 곧 명령 이름: 고쳐야 쓸 수 있는 이름(공백 등)이면 앱이 다른 폴더를 만들게 되므로 가져오지 않는다
  if (!SKILL_NAME_RE.test(name) || name !== folder.name.toLowerCase() || !body) return null;
  const provider = meta.provider && meta.provider in PROVIDER_LABELS ? (meta.provider as ProviderId) : undefined;
  const options = makeSkillOptions(provider, meta.model, meta.effort);
  const files = sanitizeSkillFiles(folder.files);
  return {
    name,
    // 자른 뒤 다시 trim: 앱이 저장할 때 trim하므로 그래야 다음 비교에서 같다
    title: (meta.title || meta.name || name).slice(0, SKILL_LIMITS.title).trim(),
    description: (meta.description ?? '').slice(0, SKILL_LIMITS.description).trim(),
    prompt: body.slice(0, SKILL_LIMITS.prompt).trim(),
    ...(files.length ? { files } : {}),
    ...(options ? { options } : {}),
  };
}

export function toSkillFolder(s: Skill): SkillFolder {
  return { name: s.name, skillMd: toSkillMd(s), files: s.files ?? [] };
}

const sameFiles = (a: readonly SkillFile[] = [], b: readonly SkillFile[] = []) =>
  a.length === b.length && a.every((f, i) => f.path === b[i]!.path && f.content === b[i]!.content);

const sameOptions = (a: Skill['options'], b: Skill['options']) =>
  a?.providerId === b?.providerId && a?.model === b?.model && a?.effort === b?.effort;

/** 폴더 내용이 스킬과 같은지 (앱이 쓴 그대로면 같다) */
export function sameAsFolder(s: Skill, f: SkillFolderFields): boolean {
  return (
    s.title === f.title &&
    s.description === f.description &&
    s.prompt.trim() === f.prompt &&
    sameFiles(sanitizeSkillFiles(s.files ?? []), f.files) &&
    sameOptions(s.options, f.options)
  );
}

/**
 * 폴더에서 바뀐 것을 찾는다: 이름이 같은 스킬과 내용이 다르면 update, 앱에 없는 이름이면 create.
 * 앱에만 있는 스킬(폴더가 없음)은 건드리지 않는다.
 */
export function diffSkillFolders(
  skills: readonly Skill[],
  folders: readonly SkillFolder[],
  /** 앱에서 지웠지만 폴더가 아직 남은 이름 (다시 가져오지 않는다) */
  removed: ReadonlySet<string> = new Set(),
): { update: (SkillFolderFields & { id: Skill['id'] })[]; create: SkillFolderFields[] } {
  const byName = new Map(skills.map((s) => [s.name, s]));
  const update: (SkillFolderFields & { id: Skill['id'] })[] = [];
  const create: SkillFolderFields[] = [];
  let room = SKILL_LIMITS.count - skills.length;
  for (const folder of folders) {
    const f = skillFromFolder(folder);
    if (!f || removed.has(f.name)) continue;
    const s = byName.get(f.name);
    if (s) {
      if (!sameAsFolder(s, f)) update.push({ ...f, id: s.id });
    } else if (room > 0) {
      create.push(f);
      byName.set(f.name, { ...f, id: '', createdAt: 0, updatedAt: 0 });
      room--;
    }
  }
  return { update, create };
}
