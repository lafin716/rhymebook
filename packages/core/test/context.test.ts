import { describe, expect, it } from 'vitest';
import { BASE_SYSTEM, BRANCH_INSTRUCTION, branchQuestion, buildChatRequest, buildReorganizeRequest, buildSystemPrompt, parseReorganized, REORGANIZE_REQUEST } from '../src/context';
import { defaultReorganizeSkill } from '../src/store';
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

describe('reorganize request', () => {
  const { sessions, messages } = createSeed(0);
  const skill = defaultReorganizeSkill();

  it('sends the whole session with numbered footnotes and the reorganize skill', () => {
    const req = buildReorganizeRequest({ sessions, messages, sessionId: SEED_IDS.root }, messages[SEED_IDS.root]!, [
      { title: 'Query, Key, Value', anchorText: 'Query, Key, Value', summary: '요약 A' },
      { title: '자유 질문' },
    ], skill);
    expect(req.messages).toHaveLength(1);
    const text = req.messages[0]!.content;
    expect(text).toContain('### 질문 1');
    expect(text).toContain('### 질문 4');
    expect(text).toContain('[1] Query, Key, Value');
    expect(text).toContain('요약 A');
    expect(text).toContain('[2] 자유 질문');
    expect(text).toContain(REORGANIZE_REQUEST);
    expect(req.system).toContain('## 스킬: 세션 재정리 (/reorganize)');
  });

  it('parses the question line and the answer, or falls back', () => {
    expect(parseReorganized('질문: 어텐션이란?\n---\n본문 [1]', 'x')).toEqual({ question: '어텐션이란?', answer: '본문 [1]' });
    expect(parseReorganized('**질문:** 어텐션이란?\n\n---\n본문', 'x')).toEqual({ question: '어텐션이란?', answer: '본문' });
    expect(parseReorganized('그냥 본문', '원래 질문')).toEqual({ question: '원래 질문', answer: '그냥 본문' });
    expect(parseReorganized('  ', 'x')).toBeNull();
  });
});
