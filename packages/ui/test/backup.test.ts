import 'fake-indexeddb/auto';
import { createBackupManager, createSeed, memoryBackupTarget, type StoredData } from '@branch/core';
import { describe, expect, it } from 'vitest';
import { dexieBackupTarget } from '../src/backup/targets';
import { BranchDB, createDexieRepository } from '../src/persist/db';

let n = 0;
const freshDb = () => new BranchDB(`backup-test-${++n}`);

describe('dexieBackupTarget', () => {
  it('puts, lists newest first, gets and removes per target', async () => {
    const db = freshDb();
    const file = dexieBackupTarget(db, 'file');
    const drive = dexieBackupTarget(db, 'gdrive', '모의 드라이브');
    const a = await file.put('{"a":1}', { at: 1_000, encrypted: false });
    const b = await file.put('{"b":2}', { at: 2_000, encrypted: true });
    await drive.put('{"c":3}', { at: 3_000, encrypted: false });

    expect((await file.list()).map((e) => e.id)).toEqual([b.id, a.id]);
    expect(await drive.list()).toHaveLength(1);
    expect(a.size).toBe(7);
    expect(b.encrypted).toBe(true);
    expect(await file.get(a.id)).toBe('{"a":1}');

    await file.remove(a.id);
    expect((await file.list()).map((e) => e.id)).toEqual([b.id]);
    await expect(file.get(a.id)).rejects.toThrow();
  });
});

describe('replaceAll', () => {
  it('keeps backup prefs and backup history', async () => {
    const db = freshDb();
    const repo = createDexieRepository(db);
    await db.kv.put({ key: 'backup', value: { keep: 5 } });
    await dexieBackupTarget(db, 'file').put('{}', { at: 1, encrypted: false });
    await repo.replaceAll({ sessions: [], messages: [] });
    expect((await db.kv.get('backup'))?.value).toEqual({ keep: 5 });
    expect(await db.backups.count()).toBe(1);
  });
});

describe('backup → restore round trip on IndexedDB', () => {
  it('replace restores the backed-up tree and keeps a pre-restore backup', async () => {
    const db = freshDb();
    const repo = createDexieRepository(db);
    const s = createSeed();
    const seed: StoredData = { sessions: Object.values(s.sessions), messages: Object.values(s.messages).flat() };
    let current: StoredData = seed;
    const manager = createBackupManager({
      device: dexieBackupTarget(db, 'file'),
      remotes: () => [memoryBackupTarget('github')],
      getData: () => current,
    });
    await manager.backupNow({ keep: 10, passphrase: 'pw' });
    current = { ...seed, sessions: seed.sessions.slice(0, 1), messages: [] };

    const [entry] = (await manager.list()).entries;
    await expect(manager.restore(entry!, 'replace', { keep: 10 })).rejects.toThrow('암호');
    const { data, preBackup } = await manager.restore(entry!, 'replace', { keep: 10, passphrase: 'pw' });
    await repo.replaceAll(data);

    expect(await db.sessions.count()).toBe(seed.sessions.length);
    expect(await db.messages.count()).toBe(seed.messages.length);
    expect(preBackup?.targetId).toBe('file');
  });
});
