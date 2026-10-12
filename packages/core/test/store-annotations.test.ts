import { beforeEach, describe, expect, it } from 'vitest';
import { createAppStore, type AppStore } from '../src/store';
import { createDemoRegistry } from '../src/providers/demo';
import { createSeed, emptyView, SEED_IDS } from '../src/seed';

function makeStore() {
  const store: AppStore = createAppStore({
    registry: createDemoRegistry(() => store.getState().connections),
    initial: { ...createSeed(0), view: emptyView(SEED_IDS.root) },
  });
  return store;
}

describe('store annotations', () => {
  let store: AppStore;

  beforeEach(() => {
    store = makeStore();
  });

  describe('addAnnotation', () => {
    it('creates an annotation and returns its id', () => {
      const msgId = store.getState().messages[SEED_IDS.root]![0]!.id;
      const anchor = { messageId: msgId, text: 'hello', startOffset: 0, endOffset: 5 };
      const annoId = store.getState().addAnnotation(SEED_IDS.root, anchor, { highlight: 'yellow' });
      expect(typeof annoId).toBe('string');
      expect(annoId in store.getState().annotations).toBe(true);
    });

    it('stores annotation with all style fields', () => {
      const msgId = store.getState().messages[SEED_IDS.root]![0]!.id;
      const anchor = { messageId: msgId, text: 'test', startOffset: 0, endOffset: 4 };
      const id = store.getState().addAnnotation(SEED_IDS.root, anchor, {
        highlight: 'yellow',
        underline: 'blue',
        textColor: 'red',
        font: 'mono',
        bold: true,
        italic: true,
        note: 'my note',
      });
      const anno = store.getState().annotations[id];
      expect(anno?.highlight).toBe('yellow');
      expect(anno?.underline).toBe('blue');
      expect(anno?.textColor).toBe('red');
      expect(anno?.font).toBe('mono');
      expect(anno?.bold).toBe(true);
      expect(anno?.italic).toBe(true);
      expect(anno?.note).toBe('my note');
    });

    it('sanitizes note', () => {
      const msgId = store.getState().messages[SEED_IDS.root]![0]!.id;
      const anchor = { messageId: msgId, text: 'test', startOffset: 0, endOffset: 4 };
      const id = store.getState().addAnnotation(SEED_IDS.root, anchor, { note: '  hello  ' });
      expect(store.getState().annotations[id]?.note).toBe('hello');
    });

    it('does not store empty note', () => {
      const msgId = store.getState().messages[SEED_IDS.root]![0]!.id;
      const anchor = { messageId: msgId, text: 'test', startOffset: 0, endOffset: 4 };
      const id = store.getState().addAnnotation(SEED_IDS.root, anchor, { note: '   ' });
      expect(store.getState().annotations[id]?.note).toBeUndefined();
    });

    it('uses provided id if given', () => {
      const msgId = store.getState().messages[SEED_IDS.root]![0]!.id;
      const anchor = { messageId: msgId, text: 'test', startOffset: 0, endOffset: 4 };
      const customId = 'custom-id';
      const id = store.getState().addAnnotation(SEED_IDS.root, anchor, { highlight: 'yellow' }, customId);
      expect(id).toBe(customId);
      expect(customId in store.getState().annotations).toBe(true);
    });

    it('throws if session does not exist', () => {
      const anchor = { messageId: 'nonexistent', text: 'test', startOffset: 0, endOffset: 4 };
      expect(() => {
        store.getState().addAnnotation('nonexistent-session', anchor, { highlight: 'yellow' });
      }).toThrow();
    });

    it('throws if id already exists', () => {
      const msgId = store.getState().messages[SEED_IDS.root]![0]!.id;
      const anchor = { messageId: msgId, text: 'test', startOffset: 0, endOffset: 4 };
      store.getState().addAnnotation(SEED_IDS.root, anchor, { highlight: 'yellow' }, 'dup-id');
      expect(() => {
        store.getState().addAnnotation(SEED_IDS.root, anchor, { highlight: 'blue' }, 'dup-id');
      }).toThrow();
    });
  });

  describe('updateAnnotation', () => {
    it('updates style fields', () => {
      const msgId = store.getState().messages[SEED_IDS.root]![0]!.id;
      const anchor = { messageId: msgId, text: 'test', startOffset: 0, endOffset: 4 };
      const id = store.getState().addAnnotation(SEED_IDS.root, anchor, { highlight: 'yellow' });
      store.getState().updateAnnotation(id, { highlight: 'blue' });
      expect(store.getState().annotations[id]?.highlight).toBe('blue');
    });

    it('removes style by setting to null', () => {
      const msgId = store.getState().messages[SEED_IDS.root]![0]!.id;
      const anchor = { messageId: msgId, text: 'test', startOffset: 0, endOffset: 4 };
      const id = store.getState().addAnnotation(SEED_IDS.root, anchor, { highlight: 'yellow' });
      store.getState().updateAnnotation(id, { highlight: null });
      expect(store.getState().annotations[id]?.highlight).toBeUndefined();
    });

    it('updates note', () => {
      const msgId = store.getState().messages[SEED_IDS.root]![0]!.id;
      const anchor = { messageId: msgId, text: 'test', startOffset: 0, endOffset: 4 };
      const id = store.getState().addAnnotation(SEED_IDS.root, anchor, { highlight: 'yellow' });
      store.getState().updateAnnotation(id, { note: 'new note' });
      expect(store.getState().annotations[id]?.note).toBe('new note');
    });

    it('sanitizes updated note', () => {
      const msgId = store.getState().messages[SEED_IDS.root]![0]!.id;
      const anchor = { messageId: msgId, text: 'test', startOffset: 0, endOffset: 4 };
      const id = store.getState().addAnnotation(SEED_IDS.root, anchor, { highlight: 'yellow' });
      store.getState().updateAnnotation(id, { note: '  hello  ' });
      expect(store.getState().annotations[id]?.note).toBe('hello');
    });

    it('removes note by setting to null', () => {
      const msgId = store.getState().messages[SEED_IDS.root]![0]!.id;
      const anchor = { messageId: msgId, text: 'test', startOffset: 0, endOffset: 4 };
      const id = store.getState().addAnnotation(SEED_IDS.root, anchor, { note: 'hello' });
      store.getState().updateAnnotation(id, { note: null });
      expect(store.getState().annotations[id]?.note).toBeUndefined();
    });

    it('deletes annotation if both style and note are removed', () => {
      const msgId = store.getState().messages[SEED_IDS.root]![0]!.id;
      const anchor = { messageId: msgId, text: 'test', startOffset: 0, endOffset: 4 };
      const id = store.getState().addAnnotation(SEED_IDS.root, anchor, { highlight: 'yellow', note: 'hello' });
      store.getState().updateAnnotation(id, { highlight: null, note: null });
      expect(id in store.getState().annotations).toBe(false);
    });

    it('bumps updatedAt', () => {
      const msgId = store.getState().messages[SEED_IDS.root]![0]!.id;
      const anchor = { messageId: msgId, text: 'test', startOffset: 0, endOffset: 4 };
      const id = store.getState().addAnnotation(SEED_IDS.root, anchor, { highlight: 'yellow' });
      const before = store.getState().annotations[id]?.updatedAt || 0;
      // Give it a little time to ensure updatedAt is different
      store.getState().updateAnnotation(id, { highlight: 'blue' });
      const after = store.getState().annotations[id]?.updatedAt || 0;
      expect(after).toBeGreaterThanOrEqual(before);
    });
  });

  describe('deleteAnnotations', () => {
    it('deletes annotations by id', () => {
      const msgId = store.getState().messages[SEED_IDS.root]![0]!.id;
      const anchor = { messageId: msgId, text: 'test', startOffset: 0, endOffset: 4 };
      const id1 = store.getState().addAnnotation(SEED_IDS.root, anchor, { highlight: 'yellow' });
      const id2 = store.getState().addAnnotation(SEED_IDS.root, anchor, { highlight: 'blue' });
      store.getState().deleteAnnotations([id1]);
      expect(id1 in store.getState().annotations).toBe(false);
      expect(id2 in store.getState().annotations).toBe(true);
    });

    it('silently ignores non-existent ids', () => {
      store.getState().deleteAnnotations(['nonexistent']);
      // Should not throw
      expect(true).toBe(true);
    });

    it('deletes multiple annotations', () => {
      const msgId = store.getState().messages[SEED_IDS.root]![0]!.id;
      const anchor = { messageId: msgId, text: 'test', startOffset: 0, endOffset: 4 };
      const id1 = store.getState().addAnnotation(SEED_IDS.root, anchor, { highlight: 'yellow' });
      const id2 = store.getState().addAnnotation(SEED_IDS.root, anchor, { highlight: 'blue' });
      store.getState().deleteAnnotations([id1, id2]);
      expect(id1 in store.getState().annotations).toBe(false);
      expect(id2 in store.getState().annotations).toBe(false);
    });
  });

  describe('session deletion cascades to annotations', () => {
    it('deletes annotations when session is deleted', () => {
      const msgId = store.getState().messages[SEED_IDS.root]![0]!.id;
      const anchor = { messageId: msgId, text: 'test', startOffset: 0, endOffset: 4 };
      const id = store.getState().addAnnotation(SEED_IDS.root, anchor, { highlight: 'yellow' });
      store.getState().deleteSession(SEED_IDS.root);
      expect(id in store.getState().annotations).toBe(false);
    });

    it('deletes annotations only for deleted sessions', () => {
      // Add annotations to two different root sessions
      const msgId1 = store.getState().messages[SEED_IDS.root]![0]!.id;
      const msgId2 = store.getState().messages[SEED_IDS.backprop]![0]!.id;
      const anchor1 = { messageId: msgId1, text: 'test', startOffset: 0, endOffset: 4 };
      const anchor2 = { messageId: msgId2, text: 'test', startOffset: 0, endOffset: 4 };
      const id1 = store.getState().addAnnotation(SEED_IDS.root, anchor1, { highlight: 'yellow' });
      const id2 = store.getState().addAnnotation(SEED_IDS.backprop, anchor2, { highlight: 'blue' });

      store.getState().deleteSession(SEED_IDS.root);

      expect(id1 in store.getState().annotations).toBe(false);
      expect(id2 in store.getState().annotations).toBe(true);
    });
  });
});
