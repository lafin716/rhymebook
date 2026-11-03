import { afterEach, describe, expect, it, vi } from 'vitest';
import { setLocale } from '../src/i18n';
import { baseSystem, buildSummaryRequest, parseReorganized, reorganizeRequest } from '../src/context';
import { createSeed, SEED_IDS } from '../src/seed';
import { mockAnswer } from '../src/providers/mock';

import { createAppStore } from '../src/store';
import { ProviderRegistry } from '../src/provider';

const HANGUL = /[가-힣]/;

describe('locale switch changes runtime prompt text', () => {
  afterEach(() => setLocale('ko'));

  it('setLocale("en") makes the prompt builder return English', () => {
    setLocale('en');
    const sys = baseSystem();
    expect(sys.startsWith('You are a tutor')).toBe(true);
    expect(HANGUL.test(sys)).toBe(false);
    expect(HANGUL.test(reorganizeRequest())).toBe(false);
  });

  it('setLocale("ko") restores the Korean prompt', () => {
    setLocale('en');
    setLocale('ko');
    expect(baseSystem()).toContain('학습');
    expect(reorganizeRequest()).toContain('재정리');
  });

  it('English summary request is built in English', () => {
    setLocale('en');
    const { sessions, messages } = createSeed(0);
    const req = buildSummaryRequest(sessions[SEED_IDS.dot]!, messages[SEED_IDS.dot]!);
    expect(HANGUL.test(req.system)).toBe(false);
    expect(req.system).toContain('in English');
  });

  it('English reorganize output still parses (English alternatives in the regex)', () => {
    setLocale('en');
    const parsed = parseReorganized('Question: What is attention?\n---\nAttention weighs the inputs.', 'fallback');
    expect(parsed).toEqual({ question: 'What is attention?', answer: 'Attention weighs the inputs.' });
  });

  it('mock provider answers in English under en', () => {
    setLocale('en');
    const { sessions, messages } = createSeed(0);
    const req = buildSummaryRequest(sessions[SEED_IDS.dot]!, messages[SEED_IDS.dot]!);
    expect(HANGUL.test(mockAnswer(req))).toBe(false);
  });
});


describe('cross-locale draft title', () => {
  afterEach(() => setLocale('ko'));
  it('applies the generated title to an untouched draft created in another language', async () => {
    setLocale('ko');
    const registry = new ProviderRegistry().register({ id: 'mock', label: 'Mock', available: async () => ({ status: 'ready' }), async *stream(req) { yield { type: 'delta', text: req.purpose === 'title' ? 'Learning attention' : 'Answer' }; yield { type: 'done' }; } });
    const store = createAppStore({ registry });
    store.getState().updateSettings({ defaultProviderId: 'mock' });
    const id = store.getState().newRootSession() as string;
    expect(store.getState().sessions[id]!.title).toBe('새 학습');
    setLocale('en'); store.getState().sendMessage(id, 'Explain attention');
    await vi.waitFor(() => expect(store.getState().sessions[id]!.title).toBe('Learning attention'));
  });
});
