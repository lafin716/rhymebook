import { describe, expect, it } from 'vitest';
import { BASE_SYSTEM, BRANCH_INSTRUCTION, branchQuestion, buildChatRequest, buildSystemPrompt } from '../src/context';
import { createSeed, SEED_IDS } from '../src/seed';

describe('context inheritance', () => {
  const { sessions, messages } = createSeed(0);

  it('root session uses the base system prompt only', () => {
    expect(buildSystemPrompt({ sessions, messages, sessionId: SEED_IDS.root })).toBe(BASE_SYSTEM);
  });

  it('depth-3 branch includes ancestor anchor chain, parent dialog and instruction', () => {
    const sys = buildSystemPrompt({ sessions, messages, sessionId: SEED_IDS.cos });
    expect(sys).toContain('루트 주제: 트랜스포머 어텐션');
    const chain = ['"Query, Key, Value"', '"내적"', '"코사인 유사도"'].map((t) => sys.indexOf(t));
    expect(chain.every((i) => i > 0)).toBe(true);
    expect(chain).toEqual([...chain].sort((a, b) => a - b));
    expect(sys).toContain('[튜터] **내적(dot product)**');
    expect(sys).toContain(BRANCH_INSTRUCTION);
    expect(sys).toContain('현재 질문 대상: "코사인 유사도"');
  });

  it('parent dialog is limited to messages up to the anchor message, last N', () => {
    const sys = buildSystemPrompt({ sessions, messages, sessionId: SEED_IDS.softmax, contextWindow: 1 });
    expect(sys).toContain('최근 1개');
    expect(sys).not.toContain('멀티헤드');
    expect(sys).not.toContain('[학습자] 트랜스포머의 어텐션');
  });

  it('chat request carries session turns', () => {
    const req = buildChatRequest({ sessions, messages, sessionId: SEED_IDS.dot });
    expect(req.messages.map((m) => m.role)).toEqual(['user', 'assistant']);
  });

  it('branch question templates', () => {
    expect(branchQuestion('what', '내적')).toBe('"내적"이(가) 뭐야?');
    expect(branchQuestion('detail', '내적')).toBe('"내적"에 대해 더 자세히 설명해줘.');
  });
});
