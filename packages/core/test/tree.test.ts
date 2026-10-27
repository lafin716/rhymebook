import { describe, expect, it } from 'vitest';
import { createSeed, SEED_IDS } from '../src/seed';
import type { Session } from '../src/model';
import { branchesOfMessage, breadcrumb, depthOf, descendantIds, draftSessionIds, findDraftSession, footnoteChildren, listedRootSessions, pathToRoot, subSessionTitle } from '../src/tree';

describe('session tree', () => {
  const { sessions, messages } = createSeed(0);

  it('seed has a depth-3 chain and two summaries', () => {
    expect(depthOf(sessions, SEED_IDS.cos)).toBe(3);
    expect(Object.values(sessions).filter((s) => s.summary)).toHaveLength(2);
    expect(pathToRoot(sessions, SEED_IDS.cos).map((s) => s.id)).toEqual([
      SEED_IDS.root,
      SEED_IDS.qkv,
      SEED_IDS.dot,
      SEED_IDS.cos,
    ]);
  });

  it('seed anchors point at their literal text', () => {
    for (const s of Object.values(sessions)) {
      if (!s.anchor || !s.parentId) continue;
      const msg = messages[s.parentId]!.find((m) => m.id === s.anchor!.messageId)!;
      expect(msg.content.slice(s.anchor.startOffset, s.anchor.endOffset)).toBe(s.anchor.text);
    }
  });

  it('branches of a message are ordered by offset', () => {
    const msgId = sessions[SEED_IDS.qkv]!.anchor!.messageId;
    expect(branchesOfMessage(sessions, msgId).map((s) => s.id)).toEqual([
      SEED_IDS.qkv,
      SEED_IDS.scale,
      SEED_IDS.softmax,
    ]);
  });

  it('descendants and breadcrumb', () => {
    expect(descendantIds(sessions, SEED_IDS.qkv)).toEqual([SEED_IDS.qkv, SEED_IDS.dot, SEED_IDS.cos]);
    const bc = breadcrumb(sessions, SEED_IDS.cos, 3);
    expect(bc.map((b) => b.title)).toEqual(['트랜스포머 어텐션', '…', '코사인 유사도']);
    expect(breadcrumb(sessions, SEED_IDS.cos).map((b) => b.title)).toHaveLength(4);
  });

  it('footnoteChildren returns only anchorless children; subSessionTitle trims to one line', () => {
    const free = { ...sessions[SEED_IDS.root]!, id: 'f1', parentId: SEED_IDS.root, anchor: undefined, createdAt: 99 };
    const map = { ...sessions, f1: free };
    expect(footnoteChildren(map, SEED_IDS.root).map((s) => s.id)).toEqual(['f1']);
    expect(subSessionTitle('  첫  줄\n둘째 줄')).toBe('첫 줄');
    expect(subSessionTitle('가'.repeat(30))).toBe(`${'가'.repeat(24)}…`);
  });
});

describe('draft sessions (ADR-074)', () => {
  const at = (id: string, t: number, extra: Partial<Session> = {}): Session => ({ id, parentId: null, rootId: id, title: id, createdAt: t, updatedAt: t, ...extra });
  const sessions: Record<string, Session> = {
    talk: at('talk', 1),
    empty: at('empty', 2),
    newer: at('newer', 3),
    page: at('page', 4, { kind: 'page' }),
    parent: at('parent', 5),
    child: { ...at('child', 6), parentId: 'parent', rootId: 'parent' },
    remote: at('remote', 7),
  };
  const messages = {
    talk: [{ id: 'm1', sessionId: 'talk', role: 'user' as const, content: 'q', createdAt: 1, status: 'done' as const }],
    empty: [],
    newer: [],
    page: [],
    parent: [],
    child: [],
    // remote: 아직 불러오지 않음
  };

  it('빈 루트 대화만 초안이다 — 페이지·자식 있는 세션·불러오지 않은 세션은 아니다', () => {
    expect([...draftSessionIds(sessions, messages)].sort()).toEqual(['empty', 'newer']);
    expect(listedRootSessions(sessions, messages).map((s) => s.id)).toEqual(['remote', 'parent', 'page', 'talk']);
  });

  it('다시 쓸 초안은 가장 최근에 만든 것', () => {
    expect(findDraftSession(sessions, messages)).toBe('newer');
    expect(findDraftSession({ talk: sessions.talk! }, messages)).toBeUndefined();
  });
});
