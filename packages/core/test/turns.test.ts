import { describe, expect, it } from 'vitest';
import type { Message } from '../src/model';
import { createSeed, SEED_IDS } from '../src/seed';
import { buildTurns, plainPreview } from '../src/turns';

const m = (id: string, role: Message['role'], content: string, extra: Partial<Message> = {}): Message => ({
  id,
  sessionId: 's',
  role,
  content,
  createdAt: 0,
  ...extra,
});

describe('buildTurns', () => {
  it('pairs each question with the following answer', () => {
    const turns = buildTurns(createSeed(0).messages[SEED_IDS.root]!);
    expect(turns).toHaveLength(4);
    expect(turns[0]).toMatchObject({ index: 0, questionId: 's-root-m1', answerId: 's-root-m2' });
    expect(turns[0]!.answerPreview.startsWith('어텐션(Attention) 은')).toBe(true);
    expect(turns[3]!.index).toBe(3);
  });

  it('keeps unanswered questions and skips leading assistant messages', () => {
    const turns = buildTurns([
      m('a0', 'assistant', '안내'),
      m('q1', 'user', ' 첫 질문 '),
      m('a1', 'assistant', '', { status: 'streaming' }),
      m('q2', 'user', '두 번째'),
    ]);
    expect(turns.map((t) => t.questionId)).toEqual(['q1', 'q2']);
    expect(turns[0]).toMatchObject({ question: '첫 질문', answerId: 'a1', answerStatus: 'streaming' });
    expect(turns[1]!.answerId).toBeUndefined();
  });
});

describe('plainPreview', () => {
  it('strips markdown syntax and code blocks', () => {
    expect(plainPreview('**굵게** 와 `code`\n\n```py\nx=1\n```\n- 항목 [링크](http://x)')).toBe('굵게 와 code 항목 링크');
  });

  it('truncates long text with an ellipsis', () => {
    const out = plainPreview('가'.repeat(200), 10);
    expect(out).toHaveLength(10);
    expect(out.endsWith('…')).toBe(true);
  });
});
