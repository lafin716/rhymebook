import { t } from '../i18n';
/** 백업 대상 식별자: 파일(이 기기) / 구글 드라이브 / GitHub */
export type BackupTargetId = 'file' | 'gdrive' | 'github';

export interface BackupEntry {
  /** 대상 안에서의 식별자 (파일 이름 또는 드라이브 파일 id) */
  id: string;
  targetId: BackupTargetId;
  /** 스냅샷 생성 시각 */
  at: number;
  /** 바이트 수 */
  size: number;
  encrypted: boolean;
}

export interface BackupPutMeta {
  at: number;
  encrypted: boolean;
  /** 사람이 읽는 마크다운 (지원하는 대상만 함께 저장, 암호화 백업에는 없음) */
  markdown?: string;
}

/**
 * 플러그형 백업 대상 (ADR-010). 실시간 동기화가 아니라 시점별 사본 저장소다.
 * 인증 값은 대상 생성 시 주입된 getter로만 읽고, 스냅샷에는 절대 넣지 않는다.
 */
export interface BackupTarget {
  readonly id: BackupTargetId;
  readonly label: string;
  available(): Promise<boolean>;
  /** 최신순 */
  list(): Promise<BackupEntry[]>;
  put(body: string, meta: BackupPutMeta): Promise<BackupEntry>;
  get(id: string): Promise<string>;
  remove(id: string): Promise<void>;
}

export const BACKUP_TARGET_LABEL: Record<BackupTargetId, string> = {
  get file() { return t('core.backupTargets.file'); },
  get gdrive() { return t('core.backupTargets.gdrive'); },
  github: 'GitHub',
};

const NAME_RE = /^branch-learn-(\d{10,})(\.enc)?\.json$/;

/** 백업 파일 이름에 시각과 암호 여부를 담아, 목록만으로 표시할 수 있게 한다 */
export function backupFileName(at: number, encrypted: boolean): string {
  return `branch-learn-${at}${encrypted ? '.enc' : ''}.json`;
}

export function parseBackupFileName(name: string): { at: number; encrypted: boolean } | null {
  const m = NAME_RE.exec(name);
  return m ? { at: Number(m[1]), encrypted: !!m[2] } : null;
}

export function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

/** 대상 오류 (네트워크/인증/권한). message는 화면에 그대로 보여도 되는 문구 */
export class BackupTargetError extends Error {
  constructor(
    readonly targetId: BackupTargetId,
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'BackupTargetError';
  }
}

export function targetHttpMessage(label: string, status: number): string {
  if (status === 401) return t('core.targetHttp.unauthorized', { label });
  if (status === 403) return t('core.targetHttp.forbidden', { label });
  if (status === 404) return t('core.targetHttp.notFound', { label });
  if (status === 0) return t('core.targetHttp.network', { label });
  return t('core.targetHttp.failed', { label, status });
}

/** 메모리 대상 (테스트·개발용 모의) */
export function memoryBackupTarget(id: BackupTargetId, label = BACKUP_TARGET_LABEL[id]): BackupTarget & { files: Map<string, string> } {
  const files = new Map<string, string>();
  const meta = new Map<string, BackupEntry>();
  return {
    id,
    label,
    files,
    async available() {
      return true;
    },
    async list() {
      return [...meta.values()].sort((a, b) => b.at - a.at);
    },
    async put(body, m) {
      const name = backupFileName(m.at, m.encrypted);
      const entry: BackupEntry = { id: name, targetId: id, at: m.at, size: byteLength(body), encrypted: m.encrypted };
      files.set(name, body);
      meta.set(name, entry);
      if (m.markdown !== undefined) files.set('latest.md', m.markdown);
      return entry;
    },
    async get(name) {
      const body = files.get(name);
      if (body === undefined) throw new BackupTargetError(id, 404, targetHttpMessage(label, 404));
      return body;
    },
    async remove(name) {
      files.delete(name);
      meta.delete(name);
    },
  };
}
