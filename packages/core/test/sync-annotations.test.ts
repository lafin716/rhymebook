import { describe, expect, it } from 'vitest';
import { validateSyncClientMsg } from '../src/bridge/sync';
import { MAX_NOTE_LENGTH } from '../src/model';

describe('sync annotation validation', () => {
  describe('annot.set validation', () => {
    it('rejects invalid color', () => {
      const msg = {
        type: 'act' as const,
        reqId: 'req1',
        op: {
          kind: 'annot.set' as const,
          annotation: {
            id: 'a1',
            sessionId: 's1',
            anchor: { messageId: 'm1', text: 'test', startOffset: 0, endOffset: 4 },
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            highlight: 'invalid-color' as any,
            createdAt: 0,
            updatedAt: 0,
          },
        },
      };
      expect(validateSyncClientMsg(msg)).toBeNull();
    });

    it('rejects invalid font', () => {
      const msg = {
        type: 'act' as const,
        reqId: 'req1',
        op: {
          kind: 'annot.set' as const,
          annotation: {
            id: 'a1',
            sessionId: 's1',
            anchor: { messageId: 'm1', text: 'test', startOffset: 0, endOffset: 4 },
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            font: 'invalid-font' as any,
            createdAt: 0,
            updatedAt: 0,
          },
        },
      };
      expect(validateSyncClientMsg(msg)).toBeNull();
    });

    it('rejects negative startOffset', () => {
      const msg = {
        type: 'act' as const,
        reqId: 'req1',
        op: {
          kind: 'annot.set' as const,
          annotation: {
            id: 'a1',
            sessionId: 's1',
            anchor: { messageId: 'm1', text: 'test', startOffset: -1, endOffset: 4 },
            highlight: 'yellow' as const,
            createdAt: 0,
            updatedAt: 0,
          },
        },
      };
      expect(validateSyncClientMsg(msg)).toBeNull();
    });

    it('rejects endOffset <= startOffset', () => {
      const msg = {
        type: 'act' as const,
        reqId: 'req1',
        op: {
          kind: 'annot.set' as const,
          annotation: {
            id: 'a1',
            sessionId: 's1',
            anchor: { messageId: 'm1', text: 'test', startOffset: 4, endOffset: 4 },
            highlight: 'yellow' as const,
            createdAt: 0,
            updatedAt: 0,
          },
        },
      };
      expect(validateSyncClientMsg(msg)).toBeNull();
    });

    it('rejects note longer than MAX_NOTE_LENGTH', () => {
      const msg = {
        type: 'act' as const,
        reqId: 'req1',
        op: {
          kind: 'annot.set' as const,
          annotation: {
            id: 'a1',
            sessionId: 's1',
            anchor: { messageId: 'm1', text: 'test', startOffset: 0, endOffset: 4 },
            note: 'a'.repeat(MAX_NOTE_LENGTH + 1),
            createdAt: 0,
            updatedAt: 0,
          },
        },
      };
      expect(validateSyncClientMsg(msg)).toBeNull();
    });

    it('accepts valid annotation with all styles', () => {
      const msg = {
        type: 'act' as const,
        reqId: 'req1',
        op: {
          kind: 'annot.set' as const,
          annotation: {
            id: 'a1',
            sessionId: 's1',
            anchor: { messageId: 'm1', text: 'test', startOffset: 0, endOffset: 4 },
            highlight: 'yellow' as const,
            underline: 'blue' as const,
            textColor: 'red' as const,
            font: 'mono' as const,
            bold: true,
            italic: true,
            note: 'my note',
            createdAt: 0,
            updatedAt: 0,
          },
        },
      };
      expect(validateSyncClientMsg(msg)).not.toBeNull();
    });

    it('accepts annotation with no styles', () => {
      const msg = {
        type: 'act' as const,
        reqId: 'req1',
        op: {
          kind: 'annot.set' as const,
          annotation: {
            id: 'a1',
            sessionId: 's1',
            anchor: { messageId: 'm1', text: 'test', startOffset: 0, endOffset: 4 },
            createdAt: 0,
            updatedAt: 0,
          },
        },
      };
      expect(validateSyncClientMsg(msg)).not.toBeNull();
    });

    it('accepts annotation with only note', () => {
      const msg = {
        type: 'act' as const,
        reqId: 'req1',
        op: {
          kind: 'annot.set' as const,
          annotation: {
            id: 'a1',
            sessionId: 's1',
            anchor: { messageId: 'm1', text: 'test', startOffset: 0, endOffset: 4 },
            note: 'my note',
            createdAt: 0,
            updatedAt: 0,
          },
        },
      };
      expect(validateSyncClientMsg(msg)).not.toBeNull();
    });

    it('rejects invalid id format', () => {
      const msg = {
        type: 'act' as const,
        reqId: 'req1',
        op: {
          kind: 'annot.set' as const,
          annotation: {
            id: 'a'.repeat(65), // too long
            sessionId: 's1',
            anchor: { messageId: 'm1', text: 'test', startOffset: 0, endOffset: 4 },
            createdAt: 0,
            updatedAt: 0,
          },
        },
      };
      expect(validateSyncClientMsg(msg)).toBeNull();
    });

    it('rejects anchor text longer than limit', () => {
      const longText = 'a'.repeat(10001);
      const msg = {
        type: 'act' as const,
        reqId: 'req1',
        op: {
          kind: 'annot.set' as const,
          annotation: {
            id: 'a1',
            sessionId: 's1',
            anchor: { messageId: 'm1', text: longText, startOffset: 0, endOffset: 10001 },
            createdAt: 0,
            updatedAt: 0,
          },
        },
      };
      expect(validateSyncClientMsg(msg)).toBeNull();
    });
  });

  describe('annot.delete validation', () => {
    it('accepts valid id array', () => {
      const msg = {
        type: 'act' as const,
        reqId: 'req1',
        op: {
          kind: 'annot.delete' as const,
          ids: ['a1', 'a2', 'a3'],
        },
      };
      expect(validateSyncClientMsg(msg)).not.toBeNull();
    });

    it('rejects empty id array', () => {
      const msg = {
        type: 'act' as const,
        reqId: 'req1',
        op: {
          kind: 'annot.delete' as const,
          ids: [],
        },
      };
      expect(validateSyncClientMsg(msg)).toBeNull();
    });

    it('rejects ids array with more than SYNC_LIMITS.id items', () => {
      const ids = Array.from({ length: 65 }, (_, i) => `a${i}`);
      const msg = {
        type: 'act' as const,
        reqId: 'req1',
        op: {
          kind: 'annot.delete' as const,
          ids,
        },
      };
      expect(validateSyncClientMsg(msg)).toBeNull();
    });

    it('rejects ids array with invalid id format', () => {
      const msg = {
        type: 'act' as const,
        reqId: 'req1',
        op: {
          kind: 'annot.delete' as const,
          ids: ['a1', 'a'.repeat(65)], // second one is too long
        },
      };
      expect(validateSyncClientMsg(msg)).toBeNull();
    });
  });
});
