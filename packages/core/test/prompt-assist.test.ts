import { describe, expect, it } from 'vitest';
import { buildPromptAssistRequest, defaultPrompt, finalizePromptAssist, parsePromptAssist, PROMPT_MAX_CHARS, promptInfo } from '../src';

describe('prompt assist (ADR-112)', () => {
  it('builds a request with the target, current text, and request', () => {
    const req = buildPromptAssistRequest({ key: 'summary', current: '요약해라.', request: '세 줄로' });
    expect(req.purpose).toBe('skill');
    expect(req.system).toBe(defaultPrompt('promptAssist'));
    const content = req.messages[0]!.content as string;
    expect(content).toContain('<prompt>\n요약해라.\n</prompt>');
    expect(content).toContain('세 줄로');
    expect(content).toContain(promptInfo().find((p) => p.key === 'summary')!.label);
  });

  it('falls back to the default text and a default request', () => {
    const req = buildPromptAssistRequest({ key: 'title', current: '  ', request: '' });
    const content = req.messages[0]!.content as string;
    expect(content).toContain(defaultPrompt('title'));
    expect(content.trim().endsWith('##')).toBe(false);
  });

  it('uses an edited assistant prompt', () => {
    expect(buildPromptAssistRequest({ key: 'base', current: 'x', request: 'y', prompts: { promptAssist: '내 도우미' } }).system).toBe('내 도우미');
  });

  it('parses final and partial output', () => {
    expect(parsePromptAssist('<prompt>\n새 문구\n둘째 줄\n</prompt>\n<note>간결하게 했어요.</note>')).toEqual({ prompt: '새 문구\n둘째 줄', note: '간결하게 했어요.' });
    expect(parsePromptAssist('<prompt>\n쓰는 중</pro', true)).toEqual({ prompt: '쓰는 중' });
    expect(parsePromptAssist('설명만', true)).toEqual({});
    // a <note> inside the prompt body stays part of the prompt
    expect(parsePromptAssist('<prompt>\n<note>는 태그다\n</prompt>\n<note>메모</note>')).toEqual({ prompt: '<note>는 태그다', note: '메모' });
  });

  it('finalizes: null when empty, capped length', () => {
    expect(finalizePromptAssist({})).toBeNull();
    expect(finalizePromptAssist({ prompt: '  ' })).toBeNull();
    expect(finalizePromptAssist({ prompt: 'a'.repeat(PROMPT_MAX_CHARS + 5) })!.length).toBe(PROMPT_MAX_CHARS);
  });
});
