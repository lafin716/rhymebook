import { describe, expect, it } from 'vitest';
import {
  ATTACHMENT_LIMITS,
  attachmentKindOf,
  binaryNote,
  canAddAttachment,
  isAttachment,
  isAttachmentList,
  isLongPaste,
  withTextAttachments,
} from '../src/attachments';
import { buildChatRequest, toTurns } from '../src/context';
import type { Attachment, Message } from '../src/model';
import { anthropicContent } from '../src/providers/anthropic';
import { openaiContent } from '../src/providers/openai';
import { validateSyncClientMsg } from '../src/bridge/sync';
import {
  BOOK_SKILL_ID,
  QUIZ_SKILL_ID,
  SPEAK_SKILL_ID,
  REORGANIZE_SKILL_ID,
  CURRICULUM_SKILL_ID,
  LEGACY_CURRICULUM_PROMPTS,
  defaultSkills,
  filterSkills,
  isSkillRef,
  normalizeSkillName,
  parseSlash,
  skillRef,
  skillsToSeed,
  slashQuery,
  upgradeBuiltinSkills,
  validateSkill,
  withSkill,
} from '../src/skills';

const img: Attachment = { id: 'a1', kind: 'image', name: 'cat.png', mime: 'image/png', size: 3, data: 'AAAA' };
const txt: Attachment = { id: 'a2', kind: 'text', name: 'note.md', mime: 'text/markdown', size: 5, data: '# 메모', pasted: false };

describe('attachments', () => {
  it('classifies files by mime/extension', () => {
    expect(attachmentKindOf('a.png', 'image/png')).toBe('image');
    expect(attachmentKindOf('a.pdf', '')).toBe('pdf');
    expect(attachmentKindOf('main.ts', '')).toBe('text');
    expect(attachmentKindOf('data.csv', 'text/csv')).toBe('text');
    expect(attachmentKindOf('x.zip', 'application/zip')).toBeNull();
    expect(attachmentKindOf('x.bmp', 'image/bmp')).toBeNull();
  });

  it('detects long pastes by length or line count', () => {
    expect(isLongPaste('짧은 글')).toBe(false);
    expect(isLongPaste('x'.repeat(ATTACHMENT_LIMITS.pasteChars))).toBe(true);
    expect(isLongPaste('a\n'.repeat(ATTACHMENT_LIMITS.pasteLines))).toBe(true);
  });

  it('enforces count and size limits', () => {
    expect(canAddAttachment([], { size: ATTACHMENT_LIMITS.fileBytes + 1 })).toBe('file-size');
    const big = { ...img, size: ATTACHMENT_LIMITS.fileBytes };
    expect(canAddAttachment([big], { size: ATTACHMENT_LIMITS.totalBytes - ATTACHMENT_LIMITS.fileBytes + 1 })).toBe('total-size');
    expect(canAddAttachment(Array(ATTACHMENT_LIMITS.count).fill(img), { size: 1 })).toBe('count');
    expect(canAddAttachment([img], { size: 10 })).toBeNull();
  });

  it('validates attachment shape', () => {
    expect(isAttachment(img)).toBe(true);
    expect(isAttachment(txt)).toBe(true);
    expect(isAttachment({ ...img, data: 'not base64!' })).toBe(false);
    expect(isAttachment({ ...img, mime: 'image/svg+xml' })).toBe(false);
    expect(isAttachment({ ...img, id: '../x' })).toBe(false);
    expect(isAttachmentList([img, txt])).toBe(true);
    expect(isAttachmentList(Array(ATTACHMENT_LIMITS.count + 1).fill(img))).toBe(false);
  });

  it('inlines text attachments and keeps binaries on the turn', () => {
    expect(withTextAttachments('질문', [txt])).toBe('<attachment name="note.md">\n# 메모\n</attachment>\n\n질문');
    const msgs: Message[] = [
      { id: 'm1', sessionId: 's', role: 'user', content: '', createdAt: 0, attachments: [img, txt] },
      { id: 'm2', sessionId: 's', role: 'assistant', content: '답', createdAt: 0, status: 'done' },
      { id: 'm3', sessionId: 's', role: 'user', content: '', createdAt: 0, attachments: [img] },
    ];
    const turns = toTurns(msgs);
    expect(turns[0]!.content).toContain('# 메모');
    expect(turns[0]!.attachments).toEqual([img]);
    // 텍스트가 없으면 기본 문구
    expect(turns[2]!.content).toBe('첨부한 내용을 봐 줘.');
    expect(binaryNote([img, txt])).toContain('cat.png');
    expect(binaryNote([txt])).toBe('');
  });

  it('assistant 이미지는 첨부 대신 메모로 넘긴다 (ADR-041)', () => {
    const turns = toTurns([
      { id: 'm1', sessionId: 's', role: 'user', content: '그려 줘', createdAt: 0 },
      { id: 'm2', sessionId: 's', role: 'assistant', content: '완성!', createdAt: 0, status: 'done', attachments: [img, img] },
    ]);
    expect(turns[1]!.attachments).toBeUndefined();
    expect(turns[1]!.content).toContain('완성!');
    expect(turns[1]!.content).toContain('[이미지 2장을 만들어 보여 줌]');
  });

  it('maps attachments to provider content blocks', () => {
    const turn = { role: 'user' as const, content: '이건 뭐야?', attachments: [img, { ...img, id: 'p', kind: 'pdf' as const, mime: 'application/pdf', name: 'a.pdf' }] };
    expect(anthropicContent(turn)).toEqual([
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } },
      { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: 'AAAA' } },
      { type: 'text', text: '이건 뭐야?' },
    ]);
    expect(anthropicContent({ role: 'user', content: 'x' })).toBe('x');
    const oa = openaiContent(turn) as Record<string, unknown>[];
    expect(oa[1]).toEqual({ type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } });
    expect(oa[2]).toMatchObject({ type: 'file', file: { filename: 'a.pdf' } });
  });

  it('sync send op accepts valid attachments/skill and rejects junk', () => {
    const base = { kind: 'send', sessionId: 's1', text: '', messageId: 'm1' };
    expect(validateSyncClientMsg({ type: 'act', reqId: 'r', op: { ...base, attachments: [img], skill: { id: 'k', name: 'curriculum', title: 't', prompt: 'p' } } })).toBeTruthy();
    expect(validateSyncClientMsg({ type: 'act', reqId: 'r', op: { ...base, attachments: [{ ...img, kind: 'exe' }] } })).toBeNull();
    expect(validateSyncClientMsg({ type: 'act', reqId: 'r', op: { ...base, skill: { id: 'k', name: 'Bad Name', title: 't', prompt: 'p' } } })).toBeNull();
    expect(validateSyncClientMsg({ type: 'act', reqId: 'r', op: { ...base, extra: 1 } })).toBeNull();
  });
});

describe('skills', () => {
  const skills = defaultSkills(0);

  it('ships curriculum, book, quiz, speak and reorganize example skills', () => {
    expect(skills).toHaveLength(5);
    expect(skills[0]).toMatchObject({ name: 'curriculum', title: '커리큘럼 생성', builtin: true });
    expect(skills[1]).toMatchObject({ name: 'book', title: '책으로 만들기', builtin: true });
    expect(isSkillRef(skillRef(skills[0]!))).toBe(true);
    expect(skills[2]).toMatchObject({ name: 'quiz', title: '퀴즈 풀기', builtin: true });
    expect(skills[3]).toMatchObject({ name: 'speak', title: '음성으로 읽기', builtin: true });
    expect(skills[4]).toMatchObject({ id: REORGANIZE_SKILL_ID, name: 'reorganize', title: '세션 재정리', builtin: true });
    expect(skills.every((s) => isSkillRef(skillRef(s)))).toBe(true);
  });

  it('parses slash commands', () => {
    expect(parseSlash('/curriculum 러스트 입문')).toEqual({ name: 'curriculum', rest: '러스트 입문' });
    expect(parseSlash('/커리큘럼')).toEqual({ name: '커리큘럼', rest: '' });
    expect(parseSlash('경로 /usr/bin')).toBeNull();
    expect(slashQuery('/cur')).toBe('cur');
    expect(slashQuery('/')).toBe('');
    expect(slashQuery('/cur 공부')).toBeNull();
    expect(filterSkills(skills, 'cur').map((s) => s.name)).toEqual(['curriculum']);
    expect(filterSkills(skills, '커리')).toHaveLength(1);
    expect(filterSkills(skills, 'zzz')).toHaveLength(0);
  });

  it('validates names and duplicates', () => {
    expect(normalizeSkillName(' /My Skill ')).toBe('my-skill');
    const draft = { id: 'n', name: 'curriculum', title: 'x', description: '', prompt: 'p' };
    expect(validateSkill(draft, skills)).toBe('name-taken');
    expect(validateSkill({ ...draft, name: 'ok-name' }, skills)).toBeNull();
    expect(validateSkill({ ...draft, name: 'has space' }, skills)).toBe('name');
    expect(validateSkill({ ...draft, name: 'ok', prompt: ' ' }, skills)).toBe('prompt');
  });

  it('adds the skill of the last question to the system prompt', () => {
    const ref = skillRef(skills[0]!);
    expect(withSkill('BASE', undefined)).toBe('BASE');
    expect(withSkill('BASE', ref)).toContain('## 스킬: 커리큘럼 생성 (/curriculum)');
    const sessions = { s: { id: 's', parentId: null, rootId: 's', title: 't', createdAt: 0, updatedAt: 0 } };
    const req = buildChatRequest({
      sessions,
      messages: { s: [{ id: 'm', sessionId: 's', role: 'user', content: '러스트', createdAt: 0, skill: ref }] },
      sessionId: 's',
    });
    expect(req.system).toContain('책 목차처럼 구성한 학습 커리큘럼');
    const later = buildChatRequest({
      sessions,
      messages: {
        s: [
          { id: 'm', sessionId: 's', role: 'user', content: '러스트', createdAt: 0, skill: ref },
          { id: 'a', sessionId: 's', role: 'assistant', content: '커리큘럼', createdAt: 0, status: 'done' },
          { id: 'm2', sessionId: 's', role: 'user', content: '2단계 더', createdAt: 0 },
        ],
      },
      sessionId: 's',
    });
    expect(later.system).not.toContain('## 스킬');
  });

  it('seeds new builtin skills and tracks seeded ids', () => {
    const defaults = defaultSkills();
    const all = [BOOK_SKILL_ID, CURRICULUM_SKILL_ID, QUIZ_SKILL_ID, REORGANIZE_SKILL_ID, SPEAK_SKILL_ID];
    // 신규: 아무 스킬도 없고, 아무것도 시드되지 않음
    const { add: add1, seeded: seeded1 } = skillsToSeed([], undefined);
    expect(add1.map((s) => s.name)).toEqual(['curriculum', 'book', 'quiz', 'speak', 'reorganize']);
    expect(seeded1).toEqual(all);

    // 호환성: 기존 true 값은 [CURRICULUM_SKILL_ID]로 변환
    const { add: add2, seeded: seeded2 } = skillsToSeed([], true);
    expect(add2.map((s) => s.name)).toEqual(['book', 'quiz', 'speak', 'reorganize']);
    expect(seeded2).toEqual(all);

    // 이미 시드됨: 모든 것이 있으면 추가 없음
    const { add: add3, seeded: seeded3 } = skillsToSeed(defaults, all);
    expect(add3).toHaveLength(0);
    expect(seeded3).toEqual(all);

    // 이전 버전 사용자: 새로 생긴 quiz·speak만 추가
    const { add: add4, seeded: seeded4 } = skillsToSeed(defaults.slice(0, 2), [CURRICULUM_SKILL_ID, BOOK_SKILL_ID]);
    expect(add4.map((s) => s.name)).toEqual(['quiz', 'speak', 'reorganize']);

    // v0.13 사용자: speak·reorganize만 추가
    expect(skillsToSeed(defaults.slice(0, 3), [CURRICULUM_SKILL_ID, BOOK_SKILL_ID, QUIZ_SKILL_ID]).add.map((s) => s.name)).toEqual(['speak', 'reorganize']);
    // v0.22 사용자: reorganize만 추가
    expect(skillsToSeed(defaults.slice(0, 4), [CURRICULUM_SKILL_ID, BOOK_SKILL_ID, QUIZ_SKILL_ID, SPEAK_SKILL_ID]).add.map((s) => s.name)).toEqual(['reorganize']);
    expect(seeded4).toEqual(all);

    // 사용자가 지운 스킬은 다시 넣지 않는다
    const { add: add5 } = skillsToSeed([defaults[0]!], all);
    expect(add5).toHaveLength(0);

    // 같은 이름의 사용자 스킬이 있으면 넣지 않는다
    const own = { ...defaults[2]!, id: 'mine', builtin: undefined };
    const { add: add6 } = skillsToSeed([own], [CURRICULUM_SKILL_ID, BOOK_SKILL_ID]);
    expect(add6.map((s) => s.name)).toEqual(['speak', 'reorganize']);
  });
});

describe('upgradeBuiltinSkills', () => {
  it('고치지 않은 예전 커리큘럼 스킬만 책 목차 형식으로 올린다', () => {
    const cur = defaultSkills(1).find((s) => s.id === CURRICULUM_SKILL_ID)!;
    expect(cur.prompt).toContain('## 1장.');
    expect(cur.prompt).toContain('하위 챕터는 제목과 목적 한 줄만');
    const legacy = { ...cur, prompt: `${LEGACY_CURRICULUM_PROMPTS[0]!}\n`, description: '옛 설명' };
    const [up, ...rest] = upgradeBuiltinSkills([legacy], 5);
    expect(rest).toEqual([]);
    expect(up).toMatchObject({ id: CURRICULUM_SKILL_ID, prompt: cur.prompt, description: cur.description, updatedAt: 5 });
    // 사용자가 고친 것·이미 새 버전·다른 스킬은 그대로
    expect(upgradeBuiltinSkills([{ ...legacy, prompt: `${legacy.prompt} 내 규칙` }, cur, ...defaultSkills(1).slice(1)])).toEqual([]);
  });
});
