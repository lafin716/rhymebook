import { defaultFetch, type FetchLike } from '../providers/http';
import { base64ToUtf8, utf8ToBase64 } from './crypto';
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
 * GitHub 저장소 대상 (fine-grained PAT, 저장소 하나에 Contents 읽기/쓰기만).
 * `<dir>/branch-learn-<시각>.json`과 읽기용 `<dir>/latest.md`를 Contents API로 커밋한다.
 * 토큰은 getter로만 읽고 로그/스냅샷에 남기지 않는다.
 */
export interface GithubTargetOptions {
  repo: string; // owner/repo
  getToken(): Promise<string | null>;
  fetch?: FetchLike;
  baseUrl?: string;
  dir?: string;
}

export const GITHUB_REPO_RE = /^[\w.-]+\/[\w.-]+$/;
const LABEL = 'GitHub';

export function createGithubTarget(o: GithubTargetOptions): BackupTarget & { verify(): Promise<void> } {
  const f = o.fetch ?? defaultFetch();
  const base = (o.baseUrl ?? 'https://api.github.com').replace(/\/+$/, '');
  const dir = o.dir ?? 'branch-learn';
  const repoPath = o.repo.split('/').map(encodeURIComponent).join('/');
  const contents = (path: string) => `${base}/repos/${repoPath}/contents/${path.split('/').map(encodeURIComponent).join('/')}`;

  const request = async (url: string, init: RequestInit = {}, accept = 'application/vnd.github+json') => {
    const token = await o.getToken();
    if (!token) throw new BackupTargetError('github', 401, targetHttpMessage(LABEL, 401));
    let res: Response;
    try {
      res = await f(url, {
        ...init,
        headers: {
          Accept: accept,
          Authorization: `Bearer ${token}`,
          'X-GitHub-Api-Version': '2022-11-28',
          ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        },
      });
    } catch {
      throw new BackupTargetError('github', 0, targetHttpMessage(LABEL, 0));
    }
    return res;
  };
  const fail = (res: Response): never => {
    throw new BackupTargetError('github', res.status, targetHttpMessage(LABEL, res.status));
  };
  const shaOf = async (path: string): Promise<string | undefined> => {
    const res = await request(contents(path));
    if (res.status === 404) return undefined;
    if (!res.ok) fail(res);
    return ((await res.json()) as { sha?: string }).sha;
  };
  const putFile = async (path: string, text: string, message: string) => {
    const sha = await shaOf(path);
    const res = await request(contents(path), {
      method: 'PUT',
      body: JSON.stringify({ message, content: utf8ToBase64(text), ...(sha ? { sha } : {}) }),
    });
    if (!res.ok) fail(res);
  };

  return {
    id: 'github',
    label: LABEL,
    async available() {
      return GITHUB_REPO_RE.test(o.repo) && !!(await o.getToken());
    },
    /** 연결 시 저장소 접근·쓰기 권한 확인 */
    async verify() {
      const res = await request(`${base}/repos/${repoPath}`);
      if (!res.ok) fail(res);
      const body = (await res.json()) as { permissions?: { push?: boolean } };
      if (body.permissions && body.permissions.push === false) throw new BackupTargetError('github', 403, targetHttpMessage(LABEL, 403));
    },
    async list() {
      const res = await request(contents(dir));
      if (res.status === 404) return [];
      if (!res.ok) fail(res);
      const items = (await res.json()) as { name: string; size: number; type: string }[];
      const out: BackupEntry[] = [];
      for (const it of Array.isArray(items) ? items : []) {
        const p = it.type === 'file' ? parseBackupFileName(it.name) : null;
        if (p) out.push({ id: it.name, targetId: 'github', at: p.at, size: it.size, encrypted: p.encrypted });
      }
      return out.sort((a, b) => b.at - a.at);
    },
    async put(body, meta) {
      const name = backupFileName(meta.at, meta.encrypted);
      const stamp = new Date(meta.at).toISOString();
      await putFile(`${dir}/${name}`, body, `backup: ${stamp}`);
      if (meta.markdown !== undefined) await putFile(`${dir}/latest.md`, meta.markdown, `backup: ${stamp} (md)`);
      return { id: name, targetId: 'github', at: meta.at, size: byteLength(body), encrypted: meta.encrypted };
    },
    async get(name) {
      const res = await request(contents(`${dir}/${name}`));
      if (!res.ok) fail(res);
      const body = (await res.json()) as { content?: string; encoding?: string; download_url?: string };
      if (body.encoding === 'base64' && body.content) return base64ToUtf8(body.content);
      // 1MB 초과 파일은 content가 비어 있다 → raw로 다시 받는다
      const raw = await request(contents(`${dir}/${name}`), {}, 'application/vnd.github.raw+json');
      if (!raw.ok) fail(raw);
      return raw.text();
    },
    async remove(name) {
      const path = `${dir}/${name}`;
      const sha = await shaOf(path);
      if (!sha) return;
      const res = await request(contents(path), { method: 'DELETE', body: JSON.stringify({ message: `backup: prune ${name}`, sha }) });
      if (!res.ok && res.status !== 404) fail(res);
    },
  };
}
