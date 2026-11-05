/**
 * 학습별 지식베이스 (ADR-107). 파일은 PC 디스크 `<userData>/knowledge/<id>/files/`에 있고,
 * 학습(루트 세션)이 knowledgeId로 하나를 가리킨다. 가지는 루트의 지식베이스를 함께 쓴다.
 * 이 모듈은 플랫폼 무관한 타입·검증만 둔다 (파일 처리는 bridge의 knowledgeStore).
 */

/** 지식베이스 id: `kb` + newId 꼴. 경로에 그대로 쓰이므로 엄격히 확인한다 */
export const KNOWLEDGE_ID_RE = /^kb[a-z0-9]{6,40}$/;

export function isKnowledgeId(v: unknown): v is string {
  return typeof v === 'string' && KNOWLEDGE_ID_RE.test(v);
}

/** 이름 최대 길이 (문자) */
export const KNOWLEDGE_NAME_MAX = 80;

/** 지식베이스 이름 정리: 앞뒤 공백·제어 문자 제거, 길이 제한. 비면 null */
export function cleanKnowledgeName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  // eslint-disable-next-line no-control-regex
  const s = raw.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, KNOWLEDGE_NAME_MAX).trim();
  return s || null;
}

export interface KnowledgeBase {
  id: string;
  name: string;
  /** 지식베이스 설명 (없으면 생략) */
  description?: string;
  createdAt: number;
  updatedAt: number;
  /** files/ 아래 파일 수 */
  fileCount: number;
  /** files/ 아래 파일 크기 합 (바이트) */
  totalBytes: number;
}

/** 지식베이스 안의 항목. path는 files/ 기준 POSIX 상대 경로 */
export interface KnowledgeEntry {
  path: string;
  dir: boolean;
  /** 파일 크기 (바이트, 파일만) */
  size?: number;
}

/** 소스 추가 결과 */
export interface KnowledgeAddResult {
  /** 추가된 최상위 항목 경로 (files/ 기준) */
  added: string[];
  /** 크기·개수 한도나 형식 때문에 건너뛴 파일 수 */
  skipped: number;
}

export interface KnowledgePreview {
  /** 텍스트 앞부분. 바이너리면 null */
  text: string | null;
  size: number;
  truncated: boolean;
}

/** 한도 (main 프로세스가 다시 적용한다) */
export const KNOWLEDGE_LIMITS = {
  /** 파일 하나 최대 크기 */
  fileBytes: 20 * 1024 * 1024,
  /** 지식베이스 하나 최대 크기 */
  totalBytes: 500 * 1024 * 1024,
  /** 미리보기 최대 길이 (문자) */
  previewChars: 20_000,
  /** 답변용 파일 목록에 넣을 최대 경로 수 */
  indexPaths: 200,
} as const;

/** 상대 경로 확인: 빈 조각·`.`·`..`·역슬래시·절대 경로·제어 문자 금지 */
export function isKnowledgePath(p: unknown): p is string {
  if (typeof p !== 'string' || !p || p.length > 1024) return false;
  // eslint-disable-next-line no-control-regex
  if (p.startsWith('/') || p.includes('\\') || /[\u0000-\u001f]/.test(p)) return false;
  return p.split('/').every((s) => s !== '' && s !== '.' && s !== '..');
}

/** 링크 소스 URL 확인 (http/https만) */
export function isKnowledgeLinkUrl(raw: unknown): raw is string {
  if (typeof raw !== 'string' || raw.length > 2048) return false;
  try {
    const u = new URL(raw.trim());
    return (u.protocol === 'https:' || u.protocol === 'http:') && !!u.hostname && !u.username && !u.password;
  } catch {
    return false;
  }
}

/**
 * GitHub 저장소 URL을 https 클론 주소로 정리한다. `owner/repo`, `github.com/owner/repo`,
 * `https://github.com/owner/repo(.git)(/tree/...)`를 받는다. 다른 호스트·자격 증명 포함 URL은 null.
 */
export function parseGitHubRepo(raw: unknown): { owner: string; repo: string; url: string } | null {
  if (typeof raw !== 'string') return null;
  let s = raw.trim();
  if (!s || s.length > 300) return null;
  if (/^[\w.-]+\/[\w.-]+$/.test(s)) s = `https://github.com/${s}`;
  else if (/^(www\.)?github\.com\//i.test(s)) s = `https://${s}`;
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' || u.username || u.password) return null;
  if (!/^(www\.)?github\.com$/i.test(u.hostname)) return null;
  const [owner, repoRaw] = u.pathname.split('/').filter(Boolean);
  if (!owner || !repoRaw) return null;
  const repo = repoRaw.replace(/\.git$/i, '');
  const seg = /^[A-Za-z0-9_.-]{1,100}$/;
  if (!seg.test(owner) || !seg.test(repo) || owner.startsWith('.') || repo.startsWith('.') || repo === '..') return null;
  return { owner, repo, url: `https://github.com/${owner}/${repo}.git` };
}

/** 가져오기 진행 단계 */
export type KnowledgeProgressPhase = 'copy' | 'download' | 'clone' | 'save';

/** 가져오기 진행 상황 (main → 렌더러). ratio가 없으면 진행률을 모르는 상태 */
export interface KnowledgeProgress {
  phase: KnowledgeProgressPhase;
  /** 0~1 */
  ratio?: number;
  /** 지금까지 처리한 파일 수 */
  files?: number;
  /** 지금까지 처리한 바이트 */
  bytes?: number;
}

/** git clone `--progress` 단계별 전체 진행률 구간 */
const GIT_PROGRESS_SPANS: [RegExp, number, number][] = [
  [/Receiving objects:\s+(\d{1,3})%/, 0, 0.85],
  [/Resolving deltas:\s+(\d{1,3})%/, 0.85, 0.95],
  [/Updating files:\s+(\d{1,3})%/, 0.95, 1],
];

/**
 * git stderr 진행 줄 하나를 전체 진행률(0~1)로 바꾼다.
 * 진행률이 없는 진행 줄(remote: Counting 등)은 undefined, 진행 줄이 아니면 null.
 */
export function parseGitProgress(line: string): number | undefined | null {
  for (const [re, from, to] of GIT_PROGRESS_SPANS) {
    const m = re.exec(line);
    if (m) {
      const pct = Math.min(100, Number(m[1]));
      return from + ((to - from) * pct) / 100;
    }
  }
  if (/^(remote:\s*)?(Enumerating|Counting|Compressing|Total)\b/.test(line.trim())) return undefined;
  if (/^Cloning into\b/.test(line.trim())) return undefined;
  return null;
}
