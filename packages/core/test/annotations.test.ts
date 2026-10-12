import { beforeEach, describe, expect, it } from 'vitest';
import {
  annotationsForMessage,
  findAnnotationsOverlapping,
  findExactAnnotation,
  isEmptyAnnotation,
  sanitizeNote,
} from '../src/annotations';
import type { Annotation } from '../src/model';
import { MAX_NOTE_LENGTH } from '../src/model';

describe('annotations helpers', () => {
  const msgId = 'msg1';
  let annotations: Record<string, Annotation> = {};

  beforeEach(() => {
    annotations = {};
  });

  describe('sanitizeNote', () => {
    it('trims whitespace and clamps to MAX_NOTE_LENGTH', () => {
      expect(sanitizeNote('  hello  ')).toBe('hello');
      expect(sanitizeNote('   ')).toBeUndefined();
      expect(sanitizeNote(null)).toBeUndefined();
      expect(sanitizeNote(undefined)).toBeUndefined();
      expect(sanitizeNote('')).toBeUndefined();
    });

    it('clamps note to MAX_NOTE_LENGTH', () => {
      const long = 'a'.repeat(MAX_NOTE_LENGTH + 100);
      const result = sanitizeNote(long);
      expect(result).toBe('a'.repeat(MAX_NOTE_LENGTH));
    });
  });

  describe('isEmptyAnnotation', () => {
    it('returns true if no style and no note', () => {
      const a: Annotation = {
        id: 'a1',
        sessionId: 's1',
        anchor: { messageId: msgId, text: 'test', startOffset: 0, endOffset: 4 },
        createdAt: 0,
        updatedAt: 0,
      };
      expect(isEmptyAnnotation(a)).toBe(true);
    });

    it('returns false if any style is present', () => {
      const a: Annotation = {
        id: 'a1',
        sessionId: 's1',
        anchor: { messageId: msgId, text: 'test', startOffset: 0, endOffset: 4 },
        highlight: 'yellow',
        createdAt: 0,
        updatedAt: 0,
      };
      expect(isEmptyAnnotation(a)).toBe(false);
    });

    it('returns false if note is present', () => {
      const a: Annotation = {
        id: 'a1',
        sessionId: 's1',
        anchor: { messageId: msgId, text: 'test', startOffset: 0, endOffset: 4 },
        note: 'my note',
        createdAt: 0,
        updatedAt: 0,
      };
      expect(isEmptyAnnotation(a)).toBe(false);
    });
  });

  describe('annotationsForMessage', () => {
    it('returns annotations for a message sorted by startOffset', () => {
      const a2: Annotation = {
        id: 'a2',
        sessionId: 's1',
        anchor: { messageId: msgId, text: 'world', startOffset: 5, endOffset: 10 },
        highlight: 'blue',
        createdAt: 0,
        updatedAt: 0,
      };
      const a1: Annotation = {
        id: 'a1',
        sessionId: 's1',
        anchor: { messageId: msgId, text: 'hello', startOffset: 0, endOffset: 5 },
        highlight: 'yellow',
        createdAt: 0,
        updatedAt: 0,
      };
      annotations = { a1, a2 };

      const result = annotationsForMessage(annotations, msgId);
      expect(result).toEqual([a1, a2]);
    });

    it('returns empty array if no annotations for message', () => {
      expect(annotationsForMessage(annotations, msgId)).toEqual([]);
    });

    it('ignores annotations from other messages', () => {
      const a1: Annotation = {
        id: 'a1',
        sessionId: 's1',
        anchor: { messageId: msgId, text: 'test', startOffset: 0, endOffset: 4 },
        highlight: 'yellow',
        createdAt: 0,
        updatedAt: 0,
      };
      const a2: Annotation = {
        id: 'a2',
        sessionId: 's1',
        anchor: { messageId: 'other', text: 'test', startOffset: 0, endOffset: 4 },
        highlight: 'blue',
        createdAt: 0,
        updatedAt: 0,
      };
      annotations = { a1, a2 };

      const result = annotationsForMessage(annotations, msgId);
      expect(result).toEqual([a1]);
    });
  });

  describe('findAnnotationsOverlapping', () => {
    beforeEach(() => {
      const a1: Annotation = {
        id: 'a1',
        sessionId: 's1',
        anchor: { messageId: msgId, text: 'hello', startOffset: 0, endOffset: 5 },
        highlight: 'yellow',
        createdAt: 0,
        updatedAt: 0,
      };
      const a2: Annotation = {
        id: 'a2',
        sessionId: 's1',
        anchor: { messageId: msgId, text: ' world', startOffset: 5, endOffset: 11 },
        highlight: 'blue',
        createdAt: 0,
        updatedAt: 0,
      };
      annotations = { a1, a2 };
    });

    it('finds annotations that overlap with range', () => {
      // [3, 7) overlaps with [0, 5) and [5, 11)
      const result = findAnnotationsOverlapping(annotations, msgId, 3, 7);
      expect(result).toHaveLength(2);
    });

    it('does not find non-overlapping annotations', () => {
      // [11, 20) does not overlap with [0, 5) or [5, 11)
      const result = findAnnotationsOverlapping(annotations, msgId, 11, 20);
      expect(result).toHaveLength(0);
    });

    it('finds annotation at exact start', () => {
      // [0, 2) overlaps with [0, 5)
      const result = findAnnotationsOverlapping(annotations, msgId, 0, 2);
      expect(result).toHaveLength(1);
    });

    it('finds annotation at exact end', () => {
      // [4, 6) overlaps with [0, 5) and [5, 11)
      const result = findAnnotationsOverlapping(annotations, msgId, 4, 6);
      expect(result).toHaveLength(2);
    });
  });

  describe('findExactAnnotation', () => {
    beforeEach(() => {
      const a1: Annotation = {
        id: 'a1',
        sessionId: 's1',
        anchor: { messageId: msgId, text: 'hello', startOffset: 0, endOffset: 5 },
        highlight: 'yellow',
        createdAt: 0,
        updatedAt: 0,
      };
      const a2: Annotation = {
        id: 'a2',
        sessionId: 's1',
        anchor: { messageId: msgId, text: ' world', startOffset: 5, endOffset: 11 },
        highlight: 'blue',
        createdAt: 0,
        updatedAt: 0,
      };
      annotations = { a1, a2 };
    });

    it('finds exact annotation', () => {
      const result = findExactAnnotation(annotations, msgId, 0, 5);
      expect(result?.id).toBe('a1');
    });

    it('returns undefined if no exact match', () => {
      const result = findExactAnnotation(annotations, msgId, 2, 7);
      expect(result).toBeUndefined();
    });

    it('returns undefined for non-existent message', () => {
      const result = findExactAnnotation(annotations, 'nonexistent', 0, 5);
      expect(result).toBeUndefined();
    });
  });
});
