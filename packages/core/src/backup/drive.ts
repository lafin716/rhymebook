import { defaultFetch, type FetchLike } from '../providers/http';
import {
  BackupTargetError,
  backupFileName,
  byteLength,
  parseBackupFileName,
  targetHttpMessage,
  type BackupEntry,
  type BackupTarget,
} from './target';

/**
 * 구글 드라이브 대상: `drive.appdata` 범위의 앱 전용 숨김 폴더(appDataFolder)만 쓴다.
 * 액세스 토큰은 앱이 공식 Google Identity Services로 받아 getter로 넘긴다 (OAuth 클라이언트 ID는 B-01).
 */
export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';

export interface DriveTargetOptions {
  getToken(): Promise<string | null>;
  fetch?: FetchLike;
  apiBase?: string;
  uploadBase?: string;
}

const LABEL = '구글 드라이브';

export function createDriveTarget(o: DriveTargetOptions): BackupTarget & { account(): Promise<string> } {
  const f = o.fetch ?? defaultFetch();
  const api = (o.apiBase ?? 'https://www.googleapis.com/drive/v3').replace(/\/+$/, '');
  const upload = (o.uploadBase ?? 'https://www.googleapis.com/upload/drive/v3').replace(/\/+$/, '');

  const request = async (url: string, init: RequestInit = {}) => {
    const token = await o.getToken();
    if (!token) throw new BackupTargetError('gdrive', 401, targetHttpMessage(LABEL, 401));
    let res: Response;
    try {
      res = await f(url, { ...init, headers: { Authorization: `Bearer ${token}`, ...(init.headers as Record<string, string> | undefined) } });
    } catch {
      throw new BackupTargetError('gdrive', 0, targetHttpMessage(LABEL, 0));
    }
    if (!res.ok && !(init.method === 'DELETE' && res.status === 404)) {
      throw new BackupTargetError('gdrive', res.status, targetHttpMessage(LABEL, res.status));
    }
    return res;
  };

  return {
    id: 'gdrive',
    label: LABEL,
    async available() {
      return !!(await o.getToken());
    },
    /** 연결된 계정 이메일 (appdata 범위로 about 조회 가능) */
    async account() {
      const res = await request(`${api}/about?fields=user(emailAddress)`);
      return ((await res.json()) as { user?: { emailAddress?: string } }).user?.emailAddress ?? '';
    },
    async list() {
      const q = encodeURIComponent("name contains 'branch-learn-' and trashed = false");
      const res = await request(`${api}/files?spaces=appDataFolder&pageSize=100&fields=files(id,name,size)&q=${q}`);
      const files = ((await res.json()) as { files?: { id: string; name: string; size?: string }[] }).files ?? [];
      const out: BackupEntry[] = [];
      for (const it of files) {
        const p = parseBackupFileName(it.name);
        if (p) out.push({ id: it.id, targetId: 'gdrive', at: p.at, size: Number(it.size ?? 0), encrypted: p.encrypted });
      }
      return out.sort((a, b) => b.at - a.at);
    },
    async put(body, meta) {
      const boundary = `branch-${meta.at.toString(36)}`;
      const metadata = { name: backupFileName(meta.at, meta.encrypted), parents: ['appDataFolder'], mimeType: 'application/json' };
      const multipart =
        `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
        `--${boundary}\r\nContent-Type: application/json\r\n\r\n${body}\r\n--${boundary}--`;
      const res = await request(`${upload}/files?uploadType=multipart&fields=id`, {
        method: 'POST',
        headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
        body: multipart,
      });
      const { id } = (await res.json()) as { id: string };
      return { id, targetId: 'gdrive', at: meta.at, size: byteLength(body), encrypted: meta.encrypted };
    },
    async get(id) {
      const res = await request(`${api}/files/${encodeURIComponent(id)}?alt=media`);
      return res.text();
    },
    async remove(id) {
      await request(`${api}/files/${encodeURIComponent(id)}`, { method: 'DELETE' });
    },
  };
}
