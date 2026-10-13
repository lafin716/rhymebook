import { describe, expect, it } from 'vitest';
import { validateSyncClientMsg } from '../src/bridge/sync';
import type { Skill, StreamRequest } from '../src';
import { ProviderRegistry } from '../src/provider';
import { createSeed, DEFAULT_SETTINGS, defaultConnections, emptyView, SEED_IDS } from '../src/seed';
import { diffSkillFolders, mergeSkillMd, parseSkillMd, skillFromFolder, toSkillFolder, toSkillMd } from '../src/skillFolder';
import {
  chatTarget,
  isSkill,
  isSkillFilePath,
  isSkillRef,
  makeSkillOptions,
  normalizeSkillFilePath,
  sanitizeSkillFiles,
  SKILL_FILE_LIMITS,
  skillRef,
  validateSkillFiles,
  withSkill,
} from '../src/skills';
import { createAppStore } from '../src/store';

const skill = (over: Partial<Skill> = {}): Skill => ({
  id: 'k1',
  name: 'quiz',
  title: '퀴즈',
  description: '퀴즈를 내요: 3문제',
  prompt: '세 문제를 낸다.\n\nreferences/rubric.md 기준으로 채점한다.',
  createdAt: 1,
  updatedAt: 1,
  ...over,
});

describe('스킬 파일 경로', () => {
  it('안전한 상대 경로만 받는다', () => {
    for (const ok of ['references/guide.md', 'scripts/run.py', 'a.txt', 'assets/템플릿.md', 'a/b/c/d.md']) expect(isSkillFilePath(ok)).toBe(true);
    for (const bad of ['../x.md', '/etc/passwd', 'a//b', 'C:/x', '.hidden', 'a/./b', 'SKILL.md', 'skill.md', 'a b.md', 'a/b/c/d/e.md', 'x\\y.md', ''])
      expect(isSkillFilePath(bad)).toBe(false);
    expect(normalizeSkillFilePath(' ./references\\my guide.md ')).toBe('references/my-guide.md');
  });

  it('목록 검증: 중복(대소문자 무시)·개수·크기', () => {
    expect(validateSkillFiles([{ path: 'a.md', content: 'x' }])).toBeNull();
    expect(validateSkillFiles([{ path: 'a.md', content: '' }, { path: 'A.md', content: '' }])).toBe('duplicate');
    expect(validateSkillFiles([{ path: '../a', content: '' }])).toBe('path');
    expect(validateSkillFiles([{ path: 'a.md', content: 'x'.repeat(SKILL_FILE_LIMITS.file + 1) }])).toBe('size');
    expect(validateSkillFiles(Array.from({ length: SKILL_FILE_LIMITS.count + 1 }, (_, i) => ({ path: `f${i}.md`, content: '' })))).toBe('count');
  });

  it('sanitize: 잘못된 경로·중복을 빼고 합계 크기에 맞춰 자르고 경로순', () => {
    const big = 'x'.repeat(SKILL_FILE_LIMITS.file);
    const out = sanitizeSkillFiles([
      { path: 'z.md', content: 'z' },
      { path: '../bad', content: '' },
      { path: 'a.md', content: big },
      { path: 'A.md', content: 'dup' },
      { path: 'b.md', content: big },
      { path: 'c.md', content: big },
      { path: 'd.md', content: big },
    ]);
    expect(out.map((f) => f.path)).toEqual(['a.md', 'b.md', 'c.md', 'd.md', 'z.md']);
    expect(out.reduce((n, f) => n + f.content.length, 0)).toBeLessThanOrEqual(SKILL_FILE_LIMITS.total);
  });
});

describe('스킬 사본 검증·system 프롬프트', () => {
  const files = [{ path: 'references/rubric.md', content: '# 기준\n```js\nx\n```' }];

  it('files·options가 있는 사본도 유효, 잘못된 옵션·파일은 거부', () => {
    const s = skill({ files, options: { providerId: 'claude-cli', model: 'opus', effort: 'high' } });
    expect(isSkill(s)).toBe(true);
    expect(isSkillRef(skillRef(s))).toBe(true);
    expect(isSkillRef({ ...skillRef(s), options: { providerId: 'nope' } })).toBe(false);
    expect(isSkillRef({ ...skillRef(s), options: { providerId: 'claude-cli', model: '--danger' } })).toBe(false);
    expect(isSkillRef({ ...skillRef(s), files: [{ path: '../x', content: '' }] })).toBe(false);
    // 동기화 send 메시지에도 실린다
    const msg = { type: 'act', reqId: 'r1', op: { kind: 'send', sessionId: 's1', text: 'hi', messageId: 'm1', skill: skillRef(s) } };
    expect(validateSyncClientMsg(msg)).not.toBeNull();
    // 파일·옵션이 없으면 사본에 키를 넣지 않는다
    expect(Object.keys(skillRef(skill()))).toEqual(['id', 'name', 'title', 'prompt']);
  });

  it('withSkill은 파일을 경로별로, 본문 펜스보다 긴 펜스로 싣는다', () => {
    const sys = withSkill('BASE', skillRef(skill({ files })));
    expect(sys).toContain('### 스킬 파일');
    expect(sys).toContain('#### references/rubric.md\n````markdown\n# 기준\n```js\nx\n```\n````');
    expect(withSkill('BASE', skillRef(skill()))).not.toContain('### 스킬 파일');
  });

  it('makeSkillOptions: provider가 없으면 undefined, 맞지 않는 노력치·API 노력치는 버린다', () => {
    expect(makeSkillOptions('', 'opus', 'high')).toBeUndefined();
    expect(makeSkillOptions('claude-cli', ' opus ', 'high')).toEqual({ providerId: 'claude-cli', model: 'opus', effort: 'high' });
    expect(makeSkillOptions('claude-cli', '', 'ultra')).toEqual({ providerId: 'claude-cli' });
    expect(makeSkillOptions('anthropic-api', 'claude-opus-5-5', 'high')).toEqual({ providerId: 'anthropic-api', model: 'claude-opus-5-5' });
  });
});

describe('chatTarget (스킬 전용 provider·모델·노력치)', () => {
  const base = () => {
    const seed = createSeed(0);
    const connections = defaultConnections();
    connections['claude-cli'] = { ...connections['claude-cli'], model: 'sonnet', effort: 'low' };
    seed.sessions[SEED_IDS.root] = { ...seed.sessions[SEED_IDS.root]!, providerId: 'codex-cli', modelPref: { providerId: 'codex-cli', model: 'gpt-6-sol' } };
    return { ...seed, connections, settings: DEFAULT_SETTINGS };
  };
  const withSkillMsg = (state: ReturnType<typeof base>, options?: Skill['options']) => {
    const msgs = state.messages[SEED_IDS.root] ?? [];
    state.messages[SEED_IDS.root] = [...msgs, { id: 'mx', sessionId: SEED_IDS.root, role: 'user', content: 'q', createdAt: 9, skill: skillRef(skill(options ? { options } : {})) }];
    return state;
  };
  const all = { usable: () => true };

  it('스킬 설정이 없으면 세션 설정', () => {
    expect(chatTarget(withSkillMsg(base()), SEED_IDS.root, all)).toEqual({ providerId: 'codex-cli', options: { model: 'gpt-6-sol' }, bySkill: false });
  });

  it('스킬이 provider·모델·노력치를 정하면 그대로, 비운 값은 그 provider 연결 기본값', () => {
    const st = withSkillMsg(base(), { providerId: 'claude-cli', model: 'opus', effort: 'max' });
    expect(chatTarget(st, SEED_IDS.root, all)).toEqual({ providerId: 'claude-cli', options: { model: 'opus', effort: 'max' }, bySkill: true });
    const onlyProvider = withSkillMsg(base(), { providerId: 'claude-cli' });
    expect(chatTarget(onlyProvider, SEED_IDS.root, all).options).toEqual({ model: 'sonnet', effort: 'low' });
  });

  it('쓸 수 없는 provider이거나 ignoreSkill이면 세션 설정', () => {
    const st = withSkillMsg(base(), { providerId: 'claude-cli', model: 'opus' });
    expect(chatTarget(st, SEED_IDS.root, { usable: (id) => id !== 'claude-cli' }).providerId).toBe('codex-cli');
    expect(chatTarget(st, SEED_IDS.root, { ...all, ignoreSkill: true }).providerId).toBe('codex-cli');
  });

  it('store: 스킬 provider로 답하고 그 턴의 assistant providerId에 남는다. 다음 일반 질문은 세션 provider', async () => {
    const seen: { id: string; req: StreamRequest }[] = [];
    const registry = new ProviderRegistry();
    for (const id of ['mock', 'claude-cli'] as const) {
      registry.register({
        id,
        label: id,
        available: async () => ({ status: 'ready' }),
        async *stream(req) {
          seen.push({ id, req });
          yield { type: 'delta', text: '답' };
          yield { type: 'done' };
        },
      });
    }
    const store = createAppStore({ registry, initial: { ...createSeed(0), view: emptyView(SEED_IDS.root) } });
    const sid = store.getState().newRootSession() as string;
    store.getState().sendMessage(sid, '퀴즈', undefined, { skill: skillRef(skill({ options: { providerId: 'claude-cli', model: 'opus' } })) });
    await new Promise((r) => setTimeout(r, 20));
    expect(seen[0]).toMatchObject({ id: 'claude-cli', req: { model: 'opus' } });
    expect(store.getState().messages[sid]!.at(-1)).toMatchObject({ role: 'assistant', providerId: 'claude-cli', status: 'done' });
    store.getState().sendMessage(sid, '그냥 질문');
    await new Promise((r) => setTimeout(r, 20));
    expect(seen.filter((s) => s.req.purpose === 'chat').at(-1)!.id).toBe(store.getState().settings.defaultProviderId);
  });
});

describe('스킬 폴더 SKILL.md', () => {
  it('왕복: 쓴 그대로 읽으면 같은 스킬', () => {
    const s = skill({
      files: [{ path: 'references/rubric.md', content: '# 기준' }],
      options: { providerId: 'codex-cli', model: 'gpt-6.1-sol', effort: 'ultra' },
    });
    const f = skillFromFolder(toSkillFolder(s))!;
    expect(f).toEqual({ name: 'quiz', title: '퀴즈', description: s.description, prompt: s.prompt, files: s.files, options: s.options });
    expect(diffSkillFolders([s], [toSkillFolder(s)])).toEqual({ update: [], create: [] });
  });

  it('frontmatter: 따옴표가 필요한 값은 JSON 문자열로, 빈 설명도 읽는다', () => {
    const md = toSkillMd(skill({ description: '' }));
    expect(md).toContain('description: ""');
    expect(md).toContain('title: 퀴즈');
    expect(toSkillMd(skill())).toContain('description: "퀴즈를 내요: 3문제"');
    expect(parseSkillMd(md).meta.description).toBe('');
  });

  it('Claude 형식 스킬 폴더(블록 설명·title 없음·CRLF)를 가져온다', () => {
    const md = '---\r\nname: pdf-helper\r\ndescription: >\r\n  PDF를 다루는\r\n  도우미\r\nallowed-tools: Read\r\n---\r\n\r\n# PDF\r\n\r\n본문\r\n';
    expect(skillFromFolder({ name: 'pdf-helper', skillMd: md, files: [{ path: 'scripts/x.py', content: 'print(1)' }] })).toEqual({
      name: 'pdf-helper',
      title: 'pdf-helper',
      description: 'PDF를 다루는 도우미',
      prompt: '# PDF\n\n본문',
      files: [{ path: 'scripts/x.py', content: 'print(1)' }],
    });
    // 본문이 없거나 이름이 맞지 않으면 무시
    expect(skillFromFolder({ name: 'x', skillMd: '---\nname: x\n---\n', files: [] })).toBeNull();
    expect(skillFromFolder({ name: 'Bad Name!', skillMd: '본문', files: [] })).toBeNull();
  });

  it('mergeSkillMd: 모르는 frontmatter 키(들여쓴 줄 포함)를 유지하고 앱 키는 새 값', () => {
    const old = '---\r\nname: quiz\r\ndescription: 옛 설명\r\nallowed-tools: Read\r\nmetadata:\r\n  owner: me\r\nmodel: old\r\n---\r\n옛 본문';
    const merged = mergeSkillMd(old, toSkillMd(skill()));
    const { meta, body } = parseSkillMd(merged);
    expect(meta['allowed-tools']).toBe('Read');
    expect(merged).toContain('metadata:\n  owner: me');
    expect(meta.description).toBe(skill().description);
    expect(meta.model).toBeUndefined();
    expect(body).toBe(skill().prompt);
    expect(mergeSkillMd(null, 'x')).toBe('x');
  });

  it('diff: 지운 스킬(묘비)은 되살리지 않고, 고쳐야 하는 폴더 이름은 가져오지 않으며, 자른 값도 다시 바뀌지 않는다', () => {
    const fresh = { name: 'new-one', skillMd: '---\nname: new-one\n---\n지시', files: [] };
    expect(diffSkillFolders([], [fresh], new Set(['new-one'])).create).toEqual([]);
    expect(diffSkillFolders([], [{ ...fresh, name: 'My Skill' }]).create).toEqual([]);
    const long = { name: 'long', skillMd: `---\nname: long\n---\n${'가 '.repeat(20_000)}`, files: [] };
    const [created] = diffSkillFolders([], [long]).create;
    const saved = { ...created!, id: 'k9', createdAt: 0, updatedAt: 0 };
    expect(diffSkillFolders([saved], [long])).toEqual({ update: [], create: [] });
  });

  it('diff: 폴더에서 바뀐 스킬은 update, 앱에 없는 폴더는 create', () => {
    const s = skill();
    const changed = { ...toSkillFolder(s), skillMd: toSkillMd({ ...s, prompt: '바뀐 지시' }) };
    const fresh = { name: 'new-one', skillMd: '---\nname: new-one\ndescription: 새것\n---\n지시', files: [] };
    const d = diffSkillFolders([s], [changed, fresh]);
    expect(d.update).toEqual([expect.objectContaining({ id: 'k1', prompt: '바뀐 지시' })]);
    expect(d.create).toEqual([expect.objectContaining({ name: 'new-one', description: '새것', prompt: '지시' })]);
  });
});
