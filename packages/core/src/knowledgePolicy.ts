/**
 * 지식베이스 유형별 검색 정책 (ADR-127). 플랫폼 무관한 순수 함수만 둔다.
 *
 * - codebase: Agentic 탐색만 쓴다 (경로·glob·grep·정의 찾기·부분 읽기). 임베딩·벡터 저장·벡터 검색·색인 작업은
 *   **예외 없이 금지**한다. 판단은 파일 확장자가 아니라 KB의 id와 유형으로 한다 — 코드베이스 안의 README.md도 마찬가지.
 * - document: Vector + BM25 하이브리드 (벡터가 꺼져 있거나 실패해도 BM25 키워드 검색은 동작).
 * - 미분류(undefined): 구버전에서 넘어와 유형을 확실히 판별하지 못한 KB. 임의로 분류하지 않고 사용자가 고를 때까지
 *   기존 동작(문서형)을 유지한다.
 */
import type { KnowledgeBase, KnowledgeKind, KnowledgeKindSuggestion } from './knowledge';
import type { KnowledgeIndexState, RetrievalMethod } from './rag/types';

export interface KnowledgeSearchPolicy {
  method: RetrievalMethod;
  /** 임베딩 생성·벡터 저장·벡터 검색 허용 */
  vectorAllowed: boolean;
  /** 색인 작업(큐·재색인·자동 색인) 허용 */
  indexAllowed: boolean;
}

export function searchPolicyOf(kind: KnowledgeKind | undefined): KnowledgeSearchPolicy {
  if (kind === 'codebase') return { method: 'agentic', vectorAllowed: false, indexAllowed: false };
  return { method: 'hybrid', vectorAllowed: true, indexAllowed: true };
}

export type KnowledgePolicyErrorCode =
  /** 코드베이스에 색인·임베딩·벡터 검색을 요청함 */
  | 'codebase_index_forbidden'
  /** 연결 폴더 코드베이스를 문서형으로 바꾸려 함 (원본을 복사해 오지 않으므로 불가) */
  | 'linked_kind_locked'
  /** 연결할 폴더가 허용 범위 밖 (루트·홈·시스템·앱 데이터 폴더 등) */
  | 'folder_not_allowed'
  /** meta.json이 없거나, 파싱되지 않거나, 알 수 없는 kind 값을 가짐. 판단할 수 없으므로 색인·벡터를 모두 막는다 (fail closed) */
  | 'kb_meta_unreadable';

/** 정책 위반. 메시지는 개발자용 영문, UI는 code로 문구를 고른다 */
export class KnowledgePolicyError extends Error {
  constructor(
    readonly code: KnowledgePolicyErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'KnowledgePolicyError';
  }
}

/** 색인 작업 전에 반드시 부른다. 코드베이스면 throw (큐·작업 실행·재개·IPC 모두) */
export function assertIndexAllowed(kbId: string, kind: KnowledgeKind | undefined): void {
  if (!searchPolicyOf(kind).indexAllowed) {
    throw new KnowledgePolicyError('codebase_index_forbidden', `indexing is not allowed for codebase knowledge base ${kbId}`);
  }
}

/** 임베딩·벡터 검색 전에 반드시 부른다. 코드베이스면 throw */
export function assertVectorAllowed(kbId: string, kind: KnowledgeKind | undefined): void {
  if (!searchPolicyOf(kind).vectorAllowed) {
    throw new KnowledgePolicyError('codebase_index_forbidden', `vector search is not allowed for codebase knowledge base ${kbId}`);
  }
}

/** 유형 변경 가능 여부. 연결 폴더 코드베이스는 문서형이 될 수 없다 (원본을 앱이 갖고 있지 않다) */
export function canChangeKind(kb: Pick<KnowledgeBase, 'kind' | 'linkedPath'>, to: KnowledgeKind): boolean {
  if (kb.kind === to) return true;
  if (kb.linkedPath && to === 'document') return false;
  return true;
}

// ── 코드베이스 제외 경로 ────────────────────────────────

/**
 * 코드베이스 기본 제외 (빌드 산출물·의존성·VCS·캐시). 사용자 excludes와 .gitignore가 여기에 더해진다.
 * 끝의 '/'는 폴더만, 그 밖은 이름 꼴(glob).
 */
export const DEFAULT_CODEBASE_EXCLUDES: readonly string[] = [
  '.git/',
  'node_modules/',
  'bower_components/',
  'vendor/bundle/',
  'dist/',
  'build/',
  'out/',
  'target/',
  '.next/',
  '.nuxt/',
  '.svelte-kit/',
  '.turbo/',
  '.cache/',
  'coverage/',
  '__pycache__/',
  '.venv/',
  'venv/',
  '.tox/',
  '.mypy_cache/',
  '.pytest_cache/',
  '.gradle/',
  '.idea/',
  '.vscode/',
  'Pods/',
  'DerivedData/',
  '*.min.js',
  '*.map',
  '*.lock',
  'package-lock.json',
  'pnpm-lock.yaml',
];

/** 바이너리로 보고 내용 검색에서 빼는 확장자 (내용 확인 전에 거른다) */
export const BINARY_EXTS: ReadonlySet<string> = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'icns', 'tif', 'tiff', 'psd', 'heic',
  'mp3', 'mp4', 'mov', 'avi', 'mkv', 'wav', 'flac', 'ogg', 'webm', 'm4a',
  'zip', 'gz', 'tgz', 'bz2', 'xz', '7z', 'rar', 'tar', 'jar', 'war', 'whl', 'dmg', 'iso', 'pkg', 'deb', 'rpm',
  'exe', 'dll', 'so', 'dylib', 'a', 'o', 'obj', 'lib', 'class', 'pyc', 'pyo', 'wasm', 'node', 'bin', 'dat',
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'key', 'numbers', 'pages',
  'ttf', 'otf', 'woff', 'woff2', 'eot', 'sqlite', 'db', 'sqlite3', 'pack', 'idx',
]);

export const EXCLUDES_MAX = 100;
const EXCLUDE_PATTERN_MAX = 200;

/** 사용자 제외 패턴 정리: 공백·주석·중복 제거, `..`·절대 경로·제어 문자 금지, 최대 EXCLUDES_MAX개 */
export function cleanExcludes(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const v of raw) {
    if (typeof v !== 'string') continue;
    // eslint-disable-next-line no-control-regex
    const s = v.replace(/[\u0000-\u001f\u007f]/g, '').trim().replace(/\\/g, '/');
    if (!s || s.startsWith('#') || s.length > EXCLUDE_PATTERN_MAX) continue;
    if (s.split('/').includes('..') || /^[A-Za-z]:/.test(s)) continue;
    const norm = s.replace(/^\.\//, '').replace(/^\/+/, '/');
    if (!norm || norm === '/' || out.includes(norm)) continue;
    out.push(norm);
    if (out.length >= EXCLUDES_MAX) break;
  }
  return out;
}

/** glob 한 조각을 정규식으로 (`*` = 경로 구분자 제외 아무거나, `?` = 한 글자, `**` = 여러 단계) */
function globToRegex(glob: string): string {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]!;
    if (c === '*') {
      if (glob[i + 1] === '*') {
        re += '.*';
        i++;
        if (glob[i + 1] === '/') i++;
      } else re += '[^/]*';
    } else if (c === '?') re += '[^/]';
    else if ('\\^$.|+()[]{}'.includes(c)) re += '\\' + c;
    else re += c;
  }
  return re;
}

export interface ExcludeMatcher {
  /** rel: 루트 기준 POSIX 경로, dir: 폴더인가 */
  (rel: string, dir: boolean): boolean;
}

/**
 * gitignore 꼴 패턴 묶음을 판정 함수로. 지원: `name`(어느 깊이든 이름 일치), `dir/`(폴더만),
 * `/root-only`, `a/b/*.ts`(경로 패턴, 루트 기준), `**`, `!negation`(뒤 규칙이 앞 규칙을 뒤집음).
 * 완전한 gitignore 구현은 아니지만 흔한 꼴은 맞춘다. 판정이 틀려도 결과에서 빠지거나 더 들어올 뿐 범위 밖으로 나가지는 않는다.
 */
export function compileExcludes(patterns: readonly string[]): ExcludeMatcher {
  const rules: { re: RegExp; dirOnly: boolean; negate: boolean }[] = [];
  for (const raw of patterns) {
    let p = raw.trim();
    if (!p || p.startsWith('#')) continue;
    let negate = false;
    if (p.startsWith('!')) {
      negate = true;
      p = p.slice(1);
    }
    let dirOnly = false;
    if (p.endsWith('/')) {
      dirOnly = true;
      p = p.replace(/\/+$/, '');
    }
    if (!p) continue;
    const anchored = p.startsWith('/') || p.slice(0, -1).includes('/');
    p = p.replace(/^\/+/, '');
    const body = globToRegex(p);
    const re = anchored ? new RegExp(`^${body}$`) : new RegExp(`(^|/)${body}$`);
    rules.push({ re, dirOnly, negate });
  }
  return (rel: string, dir: boolean): boolean => {
    let excluded = false;
    for (const r of rules) {
      if (r.dirOnly && !dir) continue;
      if (r.re.test(rel)) excluded = !r.negate;
    }
    return excluded;
  };
}

/** 파일 확장자 (소문자, 점 없이). 없으면 '' */
export function extOf(p: string): string {
  const base = p.slice(p.lastIndexOf('/') + 1);
  const i = base.lastIndexOf('.');
  return i > 0 ? base.slice(i + 1).toLowerCase() : '';
}

// ── 구버전 KB 유형 판별 (마이그레이션) ──────────────────────

/** 프로젝트 표지 파일 (최상위 또는 repos/<name>/ 바로 아래) */
export const PROJECT_MARKERS: readonly string[] = [
  'package.json', 'go.mod', 'Cargo.toml', 'pom.xml', 'build.gradle', 'build.gradle.kts', 'settings.gradle',
  'pyproject.toml', 'setup.py', 'requirements.txt', 'Gemfile', 'composer.json', 'Makefile', 'CMakeLists.txt',
  'mix.exs', 'Package.swift', 'pubspec.yaml', 'deno.json', 'tsconfig.json', '.csproj', 'WORKSPACE', 'BUILD.bazel',
];

/** 루트 안내 문서 (탐색 힌트, 지침이 아니다) */
export const GUIDE_FILES: readonly string[] = ['INFO.md', 'README.md', 'README', 'AGENTS.md', 'CLAUDE.md', 'CONTRIBUTING.md', 'ARCHITECTURE.md'];

const DOC_EXTS = new Set(['pdf', 'md', 'markdown', 'mdx', 'txt', 'text', 'rst', 'adoc', 'html', 'htm', 'csv', 'docx', 'epub']);
const CODE_EXTS = new Set([
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'py', 'go', 'rs', 'java', 'kt', 'kts', 'scala', 'c', 'h', 'cc', 'cpp', 'hpp', 'cxx',
  'cs', 'rb', 'php', 'swift', 'm', 'mm', 'lua', 'dart', 'ex', 'exs', 'erl', 'hs', 'clj', 'sh', 'bash', 'zsh', 'ps1',
  'sql', 'vue', 'svelte', 'r', 'jl', 'zig', 'nim', 'proto', 'gradle', 'tf', 'groovy', 'pl',
]);

export function isDocumentExt(ext: string): boolean {
  return DOC_EXTS.has(ext);
}
export function isCodeExt(ext: string): boolean {
  return CODE_EXTS.has(ext);
}

export interface LegacyKnowledgeFacts {
  /** meta.json sources의 type 목록 */
  sourceTypes: string[];
  /** files/ 기준 파일 경로 (표본이어도 된다) */
  paths: string[];
}

export interface LegacyClassification {
  /** certain일 때만 자동 적용한다 */
  certain: boolean;
  kind?: KnowledgeKind;
  /** 추정(자동 적용 안 함) */
  suggestion?: KnowledgeKindSuggestion;
}

/**
 * 구버전 KB 유형 판별 (ADR-132). 확실할 때만 certain:
 * - 파일이 모두 문서 확장자(pdf·md·txt 등)이고 GitHub 출처가 없으면 → document
 * - GitHub 저장소 출처만 있고, 문서 외 파일이 있으며, 코드 파일이 있으면 → codebase
 * - 출처 없이 최상위(또는 repos/x/)에 프로젝트 표지가 있고 코드 파일이 과반이면 → codebase
 * 그 밖(문서·코드 혼합, 웹 링크와 저장소 혼합, 빈 KB 등)은 미분류로 두고 추정만 돌려준다.
 */
export function classifyLegacyKnowledge(f: LegacyKnowledgeFacts): LegacyClassification {
  const files = f.paths.filter((p) => !p.endsWith('/'));
  if (files.length === 0) return { certain: false };
  let docs = 0;
  let code = 0;
  for (const p of files) {
    const e = extOf(p);
    if (DOC_EXTS.has(e)) docs++;
    else if (CODE_EXTS.has(e)) code++;
  }
  const other = files.length - docs - code;
  const types = new Set(f.sourceTypes);
  const hasGithub = types.has('github');
  const hasWeb = types.has('web');
  const markerAt = (p: string) => {
    const segs = p.split('/');
    const name = segs[segs.length - 1]!;
    const depthOk = segs.length === 1 || (segs.length === 3 && segs[0] === 'repos');
    return depthOk && PROJECT_MARKERS.some((m) => (m.startsWith('.') ? name.endsWith(m) : name === m));
  };
  const hasMarker = files.some(markerAt);

  if (docs === files.length && !hasGithub) return { certain: true, kind: 'document' };
  if (hasGithub && !hasWeb && code > 0 && [...types].every((t) => t === 'github')) {
    return { certain: true, kind: 'codebase' };
  }
  if (!hasWeb && !hasGithub && hasMarker && code > (docs + other) && code >= 3) {
    return { certain: true, kind: 'codebase' };
  }
  // 불확실: 추정만
  if (code > docs) return { certain: false, suggestion: { kind: 'codebase', reason: hasGithub ? 'github_source' : hasMarker ? 'project_marker' : 'code_majority' } };
  return { certain: false, suggestion: { kind: 'document', reason: 'docs_majority' } };
}

// ── 화면 상태 ─────────────────────────────────────────

/** 지식베이스 검색 준비 상태 (UI, 9.6) */
export type KnowledgeReadiness =
  /** 파일이 없다 */
  | 'empty'
  /** 상태를 아직 모른다 (조회 중) */
  | 'loading'
  | 'ready'
  /** 처음 색인 중 (아직 검색할 색인이 없다) */
  | 'indexing'
  /** 일부 문서만 검색 가능 (색인 일부 실패 · 갱신 필요 · 색인 중이지만 이전 색인으로 검색됨) */
  | 'partial'
  | 'failed'
  /** 전체 재생성 중 (이전 색인으로 계속 검색됨) */
  | 'rebuilding'
  /** 마지막 작업이 취소/중단됨 */
  | 'cancelled'
  /** 미분류: 유형을 골라야 한다 */
  | 'needsKind';

export interface ReadinessInfo {
  readiness: KnowledgeReadiness;
  /** 원인 코드 (i18n 키 접미사). 없으면 상태 기본 문구 */
  cause?: string;
  /** 권하는 조치 */
  action?: 'addFiles' | 'reindex' | 'retryFailed' | 'rebuild' | 'chooseKind' | 'relink' | 'openSettings';
}

/**
 * KB와 색인 상태로 화면 상태를 정한다 (순수 함수).
 * 코드베이스는 색인이 없으므로 파일·연결 폴더 상태만 본다.
 */
export function knowledgeReadiness(
  kb: Pick<KnowledgeBase, 'kind' | 'fileCount' | 'statsPending'>,
  state: KnowledgeIndexState | undefined,
): ReadinessInfo {
  if (kb.kind === 'codebase') {
    if (state?.status === 'error') return { readiness: 'failed', cause: state.error ? 'codebase_missing' : undefined, action: 'relink' };
    if (!kb.statsPending && kb.fileCount === 0) return { readiness: 'empty', action: 'addFiles' };
    return { readiness: 'ready' };
  }
  const needsKind = kb.kind === undefined;
  const wrap = (r: ReadinessInfo): ReadinessInfo => (needsKind && r.readiness === 'ready' ? { readiness: 'needsKind', action: 'chooseKind' } : r);
  if (!state) return { readiness: 'loading' };
  if (!kb.statsPending && kb.fileCount === 0 && state.docCount === 0) return { readiness: 'empty', action: 'addFiles' };
  const hasIndex = state.docCount > 0 || state.chunkCount > 0;
  if (state.status === 'queued' || state.status === 'indexing') {
    const mode = state.progress?.mode;
    if (!hasIndex) return { readiness: 'indexing' };
    return { readiness: mode === 'full' ? 'rebuilding' : 'partial', cause: 'updating' };
  }
  if (state.status === 'error') {
    if (hasIndex) return { readiness: 'partial', cause: 'last_failed', action: 'reindex' };
    return { readiness: 'failed', cause: state.error ? 'index_error' : undefined, action: state.error?.includes('key') ? 'openSettings' : 'reindex' };
  }
  if (state.lastJob && (state.lastJob.outcome === 'cancelled' || state.lastJob.outcome === 'interrupted') && state.status !== 'ready') {
    return { readiness: 'cancelled', cause: state.lastJob.outcome, action: 'reindex' };
  }
  if (state.status === 'empty') {
    if (state.lastJob?.outcome === 'cancelled' || state.lastJob?.outcome === 'interrupted') return { readiness: 'cancelled', cause: state.lastJob.outcome, action: 'reindex' };
    return { readiness: 'failed', cause: 'not_indexed', action: 'reindex' };
  }
  if (state.status === 'stale') return wrap({ readiness: 'partial', cause: 'stale', action: 'reindex' });
  if (state.failedDocs > 0) return wrap({ readiness: 'partial', cause: 'failed_docs', action: 'retryFailed' });
  return wrap({ readiness: 'ready' });
}
