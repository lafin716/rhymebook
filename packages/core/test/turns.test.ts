import { describe, expect, it } from 'vitest';
import type { Message, Session } from '../src/model';
import { createSeed, SEED_IDS } from '../src/seed';
import { buildTurns, canDeleteTurn, plainPreview, planTurnSplit, turnMessageIds } from '../src/turns';

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

describe('turnMessageIds', () => {
  const list = [
    m('a0', 'assistant', '안내'),
    m('q1', 'user', '첫 질문'),
    m('a1', 'assistant', '답1'),
    m('q2', 'user', '둘째'),
    m('a2', 'assistant', '답2'),
    m('a2b', 'assistant', '덧붙임'),
    m('q3', 'user', '셋째'),
  ];

  it('returns the question and its answers up to the next question', () => {
    expect(turnMessageIds(list, 'q2')).toEqual(['q2', 'a2', 'a2b']);
    expect(turnMessageIds(list, 'q3')).toEqual(['q3']);
  });

  it('never allows deleting the first question', () => {
    expect(turnMessageIds(list, 'q1')).toBeNull();
    expect(canDeleteTurn(list, 'q1')).toBe(false);
    expect(canDeleteTurn(list, 'q2')).toBe(true);
  });

  it('rejects answers and unknown ids', () => {
    expect(turnMessageIds(list, 'a2')).toBeNull();
    expect(turnMessageIds(list, 'nope')).toBeNull();
  });
});

describe('planTurnSplit', () => {
  const list = [
    m('q1', 'user', '첫 질문', { createdAt: 10 }),
    m('a1', 'assistant', '답1', { createdAt: 11 }),
    m('q2', 'user', ' 둘째 ', { createdAt: 20 }),
    m('a2', 'assistant', '답2', { createdAt: 21 }),
    m('q3', 'user', '셋째', { createdAt: 30 }),
  ];
  const sess = (id: string, extra: Partial<Session>): Session => ({ id, parentId: 's', rootId: 's', title: id, createdAt: 0, updatedAt: 0, ...extra });
  const sessions = {
    onA2: sess('onA2', { anchor: { messageId: 'a2', text: '답', startOffset: 0, endOffset: 1 }, createdAt: 40 }),
    onA1: sess('onA1', { anchor: { messageId: 'a1', text: '답', startOffset: 0, endOffset: 1 }, createdAt: 40 }),
    noteInQ2: sess('noteInQ2', { createdAt: 25 }),
    noteBefore: sess('noteBefore', { createdAt: 15 }),
    other: sess('other', { parentId: 'x', anchor: { messageId: 'a2', text: '답', startOffset: 0, endOffset: 1 } }),
  };

  it('moves the turn, its branches and footnotes made during it', () => {
    expect(planTurnSplit(sessions, list, 's', 'q2')).toEqual({
      messageIds: ['q2', 'a2'],
      childIds: ['onA2', 'noteInQ2'],
      question: '둘째',
      createdAt: 19,
    });
  });

  it('never splits the first question', () => {
    expect(planTurnSplit(sessions, list, 's', 'q1')).toBeNull();
    expect(planTurnSplit(sessions, list, 's', 'a2')).toBeNull();
  });

  it('names attachment-only questions by their files', () => {
    const withFile = [...list, m('q4', 'user', '', { createdAt: 50, attachments: [{ id: 'f', kind: 'text', name: 'a.txt', mime: 'text/plain', size: 1, data: 'x' }] })];
    expect(planTurnSplit({}, withFile, 's', 'q4')?.question).toBe('[첨부] a.txt');
  });
});
