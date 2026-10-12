import { describe, expect, it } from 'vitest';
import { applyBackup, createSnapshot } from '../src/backup/snapshot';
import type { StoredData } from '../src/persist';
import type { Annotation } from '../src/model';

describe('backup annotations support', () => {
  describe('createSnapshot', () => {
    it('includes annotations in snapshot', () => {
      const anno: Annotation = {
        id: 'a1',
        sessionId: 's1',
        anchor: { messageId: 'm1', text: 'test', startOffset: 0, endOffset: 4 },
        highlight: 'yellow',
        createdAt: 0,
        updatedAt: 0,
      };
      const data: StoredData = {
        sessions: [],
        messages: [],
        annotations: [anno],
      };
      const snapshot = createSnapshot(data, 1000);
      expect(snapshot.data.annotations).toEqual([anno]);
    });

    it('omits annotations field if empty', () => {
      const data: StoredData = {
        sessions: [],
        messages: [],
        annotations: [],
      };
      const snapshot = createSnapshot(data, 1000);
      expect('annotations' in snapshot.data).toBe(false);
    });

    it('omits annotations field if not provided', () => {
      const data: StoredData = {
        sessions: [],
        messages: [],
      };
      const snapshot = createSnapshot(data, 1000);
      expect('annotations' in snapshot.data).toBe(false);
    });
  });

  describe('applyBackup with replace mode', () => {
    it('replaces annotations', () => {
      const localAnno: Annotation = {
        id: 'a1',
        sessionId: 's1',
        anchor: { messageId: 'm1', text: 'old', startOffset: 0, endOffset: 3 },
        highlight: 'yellow',
        createdAt: 0,
        updatedAt: 0,
      };
      const backupAnno: Annotation = {
        id: 'a2',
        sessionId: 's2',
        anchor: { messageId: 'm2', text: 'new', startOffset: 0, endOffset: 3 },
        highlight: 'blue',
        createdAt: 0,
        updatedAt: 0,
      };
      const local: StoredData = {
        sessions: [{ id: 's1', parentId: null, rootId: 's1', title: 'old', createdAt: 0, updatedAt: 0 }],
        messages: [],
        annotations: [localAnno],
      };
      const backup = {
        sessions: [{ id: 's2', parentId: null, rootId: 's2', title: 'new', createdAt: 0, updatedAt: 0 }],
        messages: [],
        annotations: [backupAnno],
      };
      const result = applyBackup(local, backup, 'replace');
      expect(result.annotations).toEqual([backupAnno]);
    });
  });

  describe('applyBackup with merge mode', () => {
    it('merges annotations based on session updatedAt', () => {
      const now = Date.now();
      const localSession = { id: 's1', parentId: null, rootId: 's1', title: 'old', createdAt: 0, updatedAt: now - 1000 };
      const backupSession = { id: 's1', parentId: null, rootId: 's1', title: 'new', createdAt: 0, updatedAt: now };
      const localAnno: Annotation = {
        id: 'a1',
        sessionId: 's1',
        anchor: { messageId: 'm1', text: 'old', startOffset: 0, endOffset: 3 },
        highlight: 'yellow',
        createdAt: 0,
        updatedAt: 0,
      };
      const backupAnno: Annotation = {
        id: 'a2',
        sessionId: 's1',
        anchor: { messageId: 'm1', text: 'new', startOffset: 0, endOffset: 3 },
        highlight: 'blue',
        createdAt: 0,
        updatedAt: 0,
      };
      const local: StoredData = {
        sessions: [localSession],
        messages: [],
        annotations: [localAnno],
      };
      const backup = {
        sessions: [backupSession],
        messages: [],
        annotations: [backupAnno],
      };
      const result = applyBackup(local, backup, 'merge');
      // Backup session is newer, so backup annotations should be used
      expect(result.annotations).toEqual([backupAnno]);
    });

    it('keeps local annotations for older sessions', () => {
      const now = Date.now();
      const localSession = { id: 's1', parentId: null, rootId: 's1', title: 'local', createdAt: 0, updatedAt: now };
      const backupSession = { id: 's2', parentId: null, rootId: 's2', title: 'backup', createdAt: 0, updatedAt: now };
      const localAnno: Annotation = {
        id: 'a1',
        sessionId: 's1',
        anchor: { messageId: 'm1', text: 'local', startOffset: 0, endOffset: 5 },
        highlight: 'yellow',
        createdAt: 0,
        updatedAt: 0,
      };
      const backupAnno: Annotation = {
        id: 'a2',
        sessionId: 's2',
        anchor: { messageId: 'm2', text: 'backup', startOffset: 0, endOffset: 6 },
        highlight: 'blue',
        createdAt: 0,
        updatedAt: 0,
      };
      const local: StoredData = {
        sessions: [localSession],
        messages: [],
        annotations: [localAnno],
      };
      const backup = {
        sessions: [backupSession],
        messages: [],
        annotations: [backupAnno],
      };
      const result = applyBackup(local, backup, 'merge');
      // Local session is not in backup, so local annotations should be kept
      // Backup session is new, so backup annotations should be added
      expect(result.annotations).toEqual([localAnno, backupAnno]);
    });

    it('drops annotations for sessions replaced by backup', () => {
      const now = Date.now();
      const localSession = { id: 's1', parentId: null, rootId: 's1', title: 'old', createdAt: 0, updatedAt: now - 1000 };
      const backupSession = { id: 's1', parentId: null, rootId: 's1', title: 'new', createdAt: 0, updatedAt: now };
      const localAnno: Annotation = {
        id: 'a1',
        sessionId: 's1',
        anchor: { messageId: 'm1', text: 'old', startOffset: 0, endOffset: 3 },
        highlight: 'yellow',
        createdAt: 0,
        updatedAt: 0,
      };
      const backupAnno: Annotation = {
        id: 'a2',
        sessionId: 's1',
        anchor: { messageId: 'm2', text: 'new', startOffset: 0, endOffset: 3 },
        highlight: 'blue',
        createdAt: 0,
        updatedAt: 0,
      };
      const local: StoredData = {
        sessions: [localSession],
        messages: [],
        annotations: [localAnno],
      };
      const backup = {
        sessions: [backupSession],
        messages: [],
        annotations: [backupAnno],
      };
      const result = applyBackup(local, backup, 'merge');
      // Local annotations for this session should be dropped since backup is newer
      expect(result.annotations).toEqual([backupAnno]);
    });
  });

  describe('backward compatibility', () => {
    it('handles old backups without annotations', () => {
      const local: StoredData = {
        sessions: [{ id: 's1', parentId: null, rootId: 's1', title: 'local', createdAt: 0, updatedAt: 0 }],
        messages: [],
        annotations: [
          {
            id: 'a1',
            sessionId: 's1',
            anchor: { messageId: 'm1', text: 'local', startOffset: 0, endOffset: 5 },
            highlight: 'yellow',
            createdAt: 0,
            updatedAt: 0,
          },
        ],
      };
      const backup = {
        sessions: [{ id: 's2', parentId: null, rootId: 's2', title: 'backup', createdAt: 0, updatedAt: 0 }],
        messages: [],
        // No annotations field
      };
      const result = applyBackup(local, backup, 'merge');
      expect(result.annotations).toHaveLength(1);
      expect(result.annotations?.[0]?.id).toBe('a1');
    });
  });
});
