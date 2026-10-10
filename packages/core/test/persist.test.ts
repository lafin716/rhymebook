import { describe, expect, it } from 'vitest';
import type { Message, Session } from '../src/model';
import { connectionPrefs, restoreData, sanitizeView, toStoredData } from '../src/persist';
import { createSeed, DEFAULT_SETTINGS, emptyView, initialConnections, SEED_IDS } from '../src/seed';

const sess = (id: string, parentId: string | null, updatedAt = 1): Session => ({
  id,
  parentId,
  rootId: parentId ? 'r' : id,
  title: id,
  createdAt: 1,
  updatedAt,
});
const msg = (id: string, sessionId: string, extra: Partial<Message> = {}): Message => ({
  id,
  sessionId,
  role: 'assistant',
  content: id,
  createdAt: 1,
  ...extra,
});

describe('persist', () => {
  it('round-trips the seed tree, anchors and summaries', () => {
    const seed = createSeed(0);
    const data = { ...seed, view: emptyView(SEED_IDS.cos), settings: DEFAULT_SETTINGS, connections: initialConnections() };
    const back = restoreData(toStoredData(data));
    expect(back.sessions).toEqual(seed.sessions);
    expect(back.messages).toEqual(seed.messages);
    expect(back.view.activeSessionId).toBe(SEED_IDS.cos);
    expect(Object.values(back.sessions).filter((s) => s.summary).length).toBeGreaterThanOrEqual(2);
    expect(Object.values(back.sessions).filter((s) => s.anchor).length).toBeGreaterThanOrEqual(3);
  });

  it('turns interrupted streaming messages into stopped ones', () => {
    const back = restoreData({
      sessions: [sess('r', null)],
      messages: [msg('a', 'r', { role: 'user' }), msg('b', 'r', { status: 'streaming', content: '부분' })],
    });
    expect(back.messages.r!.map((m) => m.status)).toEqual([undefined, 'stopped']);
    expect(back.messages.r![1]!.content).toBe('부분');
  });

  it('drops orphan sessions and their messages', () => {
    const back = restoreData({
      sessions: [sess('r', null), sess('c', 'r'), sess('o', 'missing'), sess('oo', 'o')],
      messages: [msg('1', 'c'), msg('2', 'o'), msg('3', 'gone')],
    });
    expect(Object.keys(back.sessions).sort()).toEqual(['c', 'r']);
    expect(back.messages).toEqual({ r: [], c: [msg('1', 'c')] });
  });

  it('keeps only connection preferences, not runtime status or masked keys', () => {
    const prefs = connectionPrefs([
      { providerId: 'anthropic-api', status: 'ready', detail: 'sk-ant-…7Q2c', enabled: false, model: 'claude-x' },
    ]);
    expect(prefs).toEqual([{ providerId: 'anthropic-api', enabled: false, model: 'claude-x' }]);
    const back = restoreData({ sessions: [sess('r', null)], messages: [], connections: prefs });
    expect(back.connections['anthropic-api']).toEqual({
      providerId: 'anthropic-api',
      status: 'checking',
      enabled: false,
      model: 'claude-x',
    });
  });

  it('repairs a view that points at deleted sessions', () => {
    const sessions = { r: sess('r', null, 5), q: sess('q', null, 9), c: sess('c', 'r') };
    const v = sanitizeView(
      {
        mode: 'split',
        activeSessionId: 'x',
        splitSessionIds: ['x', 'y'],
        splitSizes: [50, 50],
        focusedSplitIndex: 1,
        popups: [
          { id: 'p1', sessionId: 'c', x: 0, y: 0, w: 1, h: 1, z: 1 },
          { id: 'p2', sessionId: 'x', x: 0, y: 0, w: 1, h: 1, z: 2 },
        ],
        sheetSessionIds: ['c', 'x'],
      },
      sessions,
    );
    expect(v.activeSessionId).toBe('q');
    expect(v.mode).toBe('single');
    expect(v.splitSessionIds).toEqual([]);
    expect(v.splitSizes).toBeUndefined();
    expect(v.focusedSplitIndex).toBe(0);
    expect(v.popups.map((p) => p.id)).toEqual(['p1']);
    expect(v.sheetSessionIds).toEqual(['c']);
    expect(sanitizeView(undefined, sessions).activeSessionId).toBe('q');
  });
});
