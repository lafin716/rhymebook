import { describe, expect, it } from 'vitest';
import { createSeed, emptyView, SEED_IDS } from '../src/seed';
import { createAppStore, type AppStore } from '../src/store';
import { createDemoRegistry } from '../src/providers/demo';
import { appendPageLink, filterPageBlocks, PAGE_BLOCKS, pageLinkHref, pageLinkId, pageLinkMarkdown, renamePageLinks } from '../src/page';
import { draftSessionIds } from '../src/tree';
import type { ID } from '../src/model';

function makeStore() {
  const store: AppStore = createAppStore({
    registry: createDemoRegistry(() => store.getState().connections),
    initial: { ...createSeed(0), view: emptyView(SEED_IDS.root) },
  });
  return store;
}

describe('page links', () => {
  it('href and id round-trip; invalid ids are rejected', () => {
    expect(pageLinkHref('s-1' as ID)).toBe('#page:s-1');
    expect(pageLinkId('#page:s-1')).toBe('s-1');
    expect(pageLinkId('#page:')).toBeNull();
    expect(pageLinkId('#page:../x')).toBeNull();
    expect(pageLinkId('https://x')).toBeNull();
    expect(pageLinkId(undefined)).toBeNull();
    expect(pageLinkId('#page:' + 'a'.repeat(65))).toBeNull();
  });

  it('pageLinkMarkdown falls back to the default title for blank titles and escapes brackets', () => {
    expect(pageLinkMarkdown('   ', 's-1' as ID)).toBe('[새 페이지](#page:s-1)');
    expect(pageLinkMarkdown(' a  [b]\n c ', 's-1' as ID)).toBe('[a \\[b\\] c](#page:s-1)');
  });

  it('renamePageLinks changes only the link to the given id', () => {
    const src = '앞 [옛](#page:s-1) 중간 [다른](#page:s-2) [옛2](#page:s-10)';
    expect(renamePageLinks(src, 's-1' as ID, '새')).toBe('앞 [새](#page:s-1) 중간 [다른](#page:s-2) [옛2](#page:s-10)');
  });

  it('renamePageLinks returns the same string when nothing matches', () => {
    const src = '본문 [글](https://x) 그리고 [a](#page:s-9)';
    expect(renamePageLinks(src, 's-1' as ID, '새')).toBe(src);
  });

  it('appendPageLink adds a separate paragraph, also to a blank body', () => {
    expect(appendPageLink('', '제목', 's-1' as ID)).toBe('[제목](#page:s-1)\n');
    expect(appendPageLink('본문\n\n', '제목', 's-1' as ID)).toBe('본문\n\n[제목](#page:s-1)\n');
  });
});

describe('page slash block', () => {
  it('the page block is listed and found by page/link/페이지 keywords', () => {
    const page = PAGE_BLOCKS.find((b) => b.id === 'page');
    expect(page).toBeDefined();
    expect(page?.text).toBe('');
    for (const q of ['페이지', 'page', '하위', 'link']) {
      expect(filterPageBlocks(q).map((b) => b.id)).toContain('page');
    }
  });
});

describe('store subpages', () => {
  it('newPage with parentId makes a child page that shares the root and touches the parent', () => {
    const store = makeStore();
    const parent = store.getState().newPage() as ID;
    const parentBefore = store.getState().sessions[parent]!.updatedAt;
    const child = store.getState().newPage(undefined, { parentId: parent, focus: false }) as ID;
    expect(child).toBeTruthy();
    const s = store.getState();
    expect(s.sessions[child]).toMatchObject({ parentId: parent, rootId: s.sessions[parent]!.rootId, kind: 'page' });
    expect(s.sessions[child]!.anchor).toBeUndefined();
    expect(s.sessions[parent]!.updatedAt).toBeGreaterThanOrEqual(parentBefore);
    expect(s.view.activeSessionId).not.toBe(child);
  });

  it('newPage with a missing parentId returns false', () => {
    const store = makeStore();
    expect(store.getState().newPage(undefined, { parentId: 's-missing' as ID })).toBe(false);
  });

  it('newSubSession inherits provider settings, starts empty and focuses when asked', () => {
    const store = makeStore();
    const sub = store.getState().newSubSession(SEED_IDS.root, undefined, { focus: true }) as ID;
    expect(sub).toBeTruthy();
    const s = store.getState();
    const sess = s.sessions[sub]!;
    const root = s.sessions[SEED_IDS.root]!;
    expect(sess).toMatchObject({ parentId: SEED_IDS.root, rootId: root.rootId, title: '새 학습' });
    if (root.providerId) expect(sess.providerId).toBe(root.providerId);
    expect(sess.webSearch).toBeUndefined(); // 기본(켜짐)은 상속하지 않는다
    expect(s.messages[sub]).toEqual([]);
    expect(s.view.activeSessionId).toBe(sub);
    // 빈 하위 대화도 루트 드래프트 목록에는 끼지 않는다
    expect(draftSessionIds(s.sessions, s.messages).has(sub)).toBe(false);
  });

  it('newSubSession inherits web search off from the parent', () => {
    const store = makeStore();
    store.getState().setSessionWebSearch(SEED_IDS.root, false);
    const sub = store.getState().newSubSession(SEED_IDS.root, undefined, { focus: false }) as ID;
    expect(store.getState().sessions[sub]!.webSearch).toBe(false);
  });

  it('newSubSession with focus false keeps the current view; unknown parent returns false', () => {
    const store = makeStore();
    const before = store.getState().view.activeSessionId;
    const sub = store.getState().newSubSession(SEED_IDS.root, undefined, { focus: false }) as ID;
    expect(sub).toBeTruthy();
    expect(store.getState().view.activeSessionId).toBe(before);
    expect(store.getState().newSubSession('s-missing' as ID)).toBe(false);
  });

  it('renaming a child page rewrites its link in the parent page body', () => {
    const store = makeStore();
    const parent = store.getState().newPage() as ID;
    const child = store.getState().newPage(undefined, { parentId: parent, focus: false }) as ID;
    store.getState().updatePage(parent, appendPageLink('소개', '옛', child));
    store.getState().renameSession(child, '새 제목');
    expect(store.getState().sessions[child]!.title).toBe('새 제목');
    expect(store.getState().messages[parent]![0]!.content).toBe(`소개\n\n[새 제목](#page:${child})\n`);
  });

  it('renaming to a blank title is ignored', () => {
    const store = makeStore();
    const sub = store.getState().newSubSession(SEED_IDS.root, undefined, { focus: false }) as ID;
    const before = store.getState().sessions[sub]!.title;
    store.getState().renameSession(sub, '   ');
    expect(store.getState().sessions[sub]!.title).toBe(before);
  });
});
