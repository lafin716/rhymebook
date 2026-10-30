import { describe, expect, it } from 'vitest';
import { buildChatRequest, buildSummaryRequest, buildSystemPrompt, buildTitleRequest, BASE_SYSTEM } from '../src/context';
import { buildPageFillRequest, buildPageOrganizeRequest } from '../src/pageAssist';
import { buildSkillAssistRequest } from '../src/skillAssist';
import { BRANCH_SUGGEST_INSTRUCTION } from '../src/branch-suggest';
import { DEFAULT_PROMPTS, PROMPT_INFO, promptText, sanitizePromptOverrides } from '../src/prompts';
import { createSeed, SEED_IDS } from '../src/seed';

describe('custom system prompts (ADR-098)', () => {
  const { sessions, messages } = createSeed(0);

  it('every prompt key is listed once in the manager', () => {
    expect(PROMPT_INFO.map((p) => p.key).sort()).toEqual(Object.keys(DEFAULT_PROMPTS).sort());
  });

  it('falls back to the default for missing, blank or invalid overrides', () => {
    expect(promptText('base')).toBe(BASE_SYSTEM);
    expect(promptText('base', { base: '   ' })).toBe(BASE_SYSTEM);
    expect(promptText('base', { base: 3 as unknown as string })).toBe(BASE_SYSTEM);
    expect(promptText('base', { base: '너는 친절한 선생님이다.' })).toBe('너는 친절한 선생님이다.');
  });

  it('root and branch sessions use the custom base, branch and suggest prompts', () => {
    const prompts = { base: 'BASE!', branch: 'BRANCH!', branchSuggest: 'SUGGEST!' };
    expect(buildSystemPrompt({ sessions, messages, sessionId: SEED_IDS.root, prompts })).toBe('BASE!');
    const sub = buildSystemPrompt({ sessions, messages, sessionId: SEED_IDS.qkv, prompts });
    expect(sub.startsWith('BASE!')).toBe(true);
    expect(sub).toContain('BRANCH!');
    const chat = buildChatRequest({ sessions, messages, sessionId: SEED_IDS.root, prompts });
    expect(chat.system).toContain('SUGGEST!');
    expect(chat.system).not.toContain(BRANCH_SUGGEST_INSTRUCTION);
  });

  it('summary, title, page and skill assist requests use their overrides', () => {
    const prompts = { summary: 'S', title: 'T', pageOrganize: 'O', pageFill: 'F', skillAssist: 'K' };
    const root = sessions[SEED_IDS.root]!;
    expect(buildSummaryRequest(root, messages[SEED_IDS.root] ?? [], prompts).system).toBe('S');
    expect(buildTitleRequest(messages[SEED_IDS.root] ?? [], prompts).system).toBe('T');
    expect(buildPageOrganizeRequest({ title: 'a', content: 'b', prompts }).system).toBe('O');
    expect(buildPageFillRequest({ title: 'a', before: 'b', after: 'c', prompts }).system).toBe('F');
    expect(buildSkillAssistRequest({ request: 'x', prompts }).system).toBe('K');
  });

  it('sanitize keeps only known, non-default string values', () => {
    expect(sanitizePromptOverrides({ base: 'x', title: DEFAULT_PROMPTS.title, summary: ' ', bogus: 'y', pageFill: 1 })).toEqual({ base: 'x' });
    expect(sanitizePromptOverrides(null)).toEqual({});
  });
});
