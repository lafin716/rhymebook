import { backupFileName, BACKUP_TARGET_LABEL, BackupTargetError, byteLength, targetHttpMessage, type BackupTarget, type BackupTargetId } from '@branch/core';
import type { BranchDB } from '../persist/db';

/**
 * IndexedDB에 사본을 두는 대상.
 * - 'file': 이 기기의 백업 기록 (가져온 파일·복원 전 자동 백업 포함)
 * - 'gdrive': OAuth 클라이언트 ID가 없을 때의 모의 드라이브 (B-01)
 */
export function dexieBackupTarget(db: BranchDB, id: BackupTargetId, label = BACKUP_TARGET_LABEL[id]): BackupTarget {
  return {
    id,
    label,
    async available() {
      return true;
    },
    async list() {
      const rows = await db.backups.where('targetId').equals(id).toArray();
      return rows
        .map(({ body: _body, ...e }) => e)
        .sort((a, b) => b.at - a.at);
    },
    async put(body, meta) {
      const entry = { id: `${id}:${backupFileName(meta.at, meta.encrypted)}`, targetId: id, at: meta.at, size: byteLength(body), encrypted: meta.encrypted };
      await db.backups.put({ ...entry, body });
      return entry;
    },
    async get(entryId) {
      const row = await db.backups.get(entryId);
      if (!row) throw new BackupTargetError(id, 404, targetHttpMessage(label, 404));
      return row.body;
    },
    async remove(entryId) {
      await db.backups.delete(entryId);
    },
  };
}
