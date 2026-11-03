import { describe, expect, it } from 'vitest';
import { nextUnread, visibleSessionIds } from '../src/unread';
import type { ViewState } from '../src/model';

const all = () => true;

describe('unread indicator', () => {
  it('marks a session unread when streaming ends while it is not visible', () => {
    expect(nextUnread([], { a: 'm1' }, {}, new Set(), all)).toEqual(['a']);
  });
  it('does not mark a visible session', () => {
    expect(nextUnread([], { a: 'm1' }, {}, new Set(['a']), all)).toEqual([]);
  });
  it('clears once the session becomes visible', () => {
    expect(nextUnread(['a', 'b'], {}, {}, new Set(['a']), all)).toEqual(['b']);
  });
  it('keeps the same array when nothing changes', () => {
    const prev = ['a'];
    expect(nextUnread(prev, { b: 'm' }, { b: 'm' }, new Set(), all)).toBe(prev);
  });
  it('drops deleted sessions', () => {
    expect(nextUnread(['a'], { b: 'm' }, {}, new Set(), (id) => id !== 'a' && id !== 'b')).toEqual([]);
  });
  it('collects visible sessions from every surface', () => {
    const v: ViewState = { mode: 'split', activeSessionId: 'a', splitSessionIds: ['b'], focusedSplitIndex: 0, popups: [{ sessionId: 'c' } as ViewState['popups'][number]], sheetSessionIds: ['d'] };
    expect([...visibleSessionIds(v)].sort()).toEqual(['a', 'b', 'c', 'd']);
  });
});
