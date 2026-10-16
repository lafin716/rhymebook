import { describe, expect, it } from 'vitest';
import { createSeed, SEED_IDS } from '../src/seed';
import { branchesOfMessage, breadcrumb, depthOf, descendantIds, footnoteChildren, pathToRoot, subSessionTitle } from '../src/tree';

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
