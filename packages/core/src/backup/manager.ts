import type { StoredData } from '../persist';
import { backupToMarkdown } from './markdown';
import { applyBackup, createSnapshot, openBackup, serializeBackup, type BackupSnapshot, type RestoreMode } from './snapshot';
import type { BackupEntry, BackupTarget, BackupTargetId } from './target';

export interface BackupFailure {
  targetId: BackupTargetId;
  message: string;
}

export interface BackupRunResult {
  entries: BackupEntry[];
  failures: BackupFailure[];
}

export interface BackupManagerOptions {
  /** 이 기기의 백업 기록 (항상 사용, 복원 전 자동 백업도 여기에) */
  device: BackupTarget;
  /** 연결된 원격 대상 (드라이브/GitHub) */
  remotes(): BackupTarget[];
  /** 현재 데이터 (저장 대기 중인 쓰기가 반영된 스토어 상태) */
  getData(): StoredData;
  now?(): number;
}

export interface BackupOptions {
  /** 있으면 암호화. 저장하지 않는다 */
  passphrase?: string;
  /** 대상마다 최근 N개만 남긴다 */
  keep: number;
  /** 원격에도 올릴지 (복원 전 자동 백업은 기기에만) */
  remote?: boolean;
}

const failureOf = (t: BackupTarget, e: unknown): BackupFailure => ({
  targetId: t.id,
  message: e instanceof Error ? e.message : String(e),
});

/** 백업·복원 흐름 (플랫폼 무관). 대상 하나가 실패해도 나머지는 계속한다 */
export function createBackupManager(o: BackupManagerOptions) {
  const now = o.now ?? Date.now;
  const targets = (remote = true) => [o.device, ...(remote ? o.remotes() : [])];
  const targetOf = (id: BackupTargetId) => targets().find((t) => t.id === id);

  const prune = async (t: BackupTarget, keep: number) => {
    const list = await t.list();
    for (const old of list.slice(Math.max(1, keep))) await t.remove(old.id);
  };

  async function backupNow(opt: BackupOptions): Promise<BackupRunResult> {
    const snapshot = createSnapshot(o.getData(), now());
    const encrypted = !!opt.passphrase;
    const body = await serializeBackup(snapshot, opt.passphrase);
    // 암호화한 백업에는 평문 마크다운을 붙이지 않는다
    const markdown = encrypted ? undefined : backupToMarkdown(snapshot.data, snapshot.createdAt);
    const result: BackupRunResult = { entries: [], failures: [] };
    await Promise.all(
      targets(opt.remote !== false).map(async (t) => {
        try {
          result.entries.push(await t.put(body, { at: snapshot.createdAt, encrypted, ...(markdown !== undefined ? { markdown } : {}) }));
          await prune(t, opt.keep);
        } catch (e) {
          result.failures.push(failureOf(t, e));
        }
      }),
    );
    return result;
  }

  async function list(): Promise<BackupRunResult> {
    const result: BackupRunResult = { entries: [], failures: [] };
    await Promise.all(
      targets().map(async (t) => {
        try {
          result.entries.push(...(await t.list()));
        } catch (e) {
          result.failures.push(failureOf(t, e));
        }
      }),
    );
    result.entries.sort((a, b) => b.at - a.at);
    return result;
  }

  async function open(entry: BackupEntry, passphrase?: string): Promise<BackupSnapshot> {
    const t = targetOf(entry.targetId);
    if (!t) throw new Error('백업 위치가 연결되어 있지 않아요.');
    return openBackup(await t.get(entry.id), passphrase);
  }

  /**
   * 복원: 백업을 먼저 열어(암호 확인) 실패하면 아무것도 바꾸지 않는다.
   * 성공하면 현재 상태를 이 기기에 자동 백업한 뒤, 합치기/교체 결과를 돌려준다(적용은 호출자).
   */
  async function restore(
    entry: BackupEntry,
    mode: RestoreMode,
    opt: { passphrase?: string; keep: number; preBackupPassphrase?: string },
  ): Promise<{ data: StoredData; preBackup: BackupEntry | null }> {
    const snapshot = await open(entry, opt.passphrase);
    const pre = await backupNow({ keep: opt.keep + 1, remote: false, ...(opt.preBackupPassphrase ? { passphrase: opt.preBackupPassphrase } : {}) });
    if (pre.failures.length) throw new Error(`복원 전 자동 백업에 실패해 복원을 멈췄어요: ${pre.failures[0]!.message}`);
    return { data: applyBackup(o.getData(), snapshot.data, mode), preBackup: pre.entries[0] ?? null };
  }

  return { backupNow, list, open, restore };
}

export type BackupManager = ReturnType<typeof createBackupManager>;
