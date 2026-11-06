/**
 * 계층형 폴더 메타데이터 (ADR-123): 문서 목록에서 폴더별 요약·키워드·동의어·주요 문서를 만든다.
 * 플랫폼 무관 순수 로직이다. 파일 입출력(meta/ 쓰기·읽기)은 bridge가 맡는다.
 */
import { sha256Hex } from './hash';
import { tokenize } from './tokenize';
import {
  FOLDER_META_VERSION,
  type FolderHint,
  type FolderMeta,
  type FolderMetaFile,
  type QueryPlan,
} from './types';

/** 폴더 설명으로 쓰는 사용자 메모 파일 이름 (소문자 비교) */
export const FOLDER_NOTE_NAMES: readonly string[] = ['info.md', 'readme.md', 'agents.md'];

const MAX_KEY_DOCS = 10;
const MAX_TOPICS = 8;
const MAX_KEYWORDS = 12;
const MAX_SYNONYMS = 16;
const MAX_RELATED = 5;
const MAX_DESCRIPTION_CHARS = 200;
const MIN_RELATED_OVERLAP = 2;

/** 색인 한 문서의 메타데이터 입력. text는 본문 일부(긴 문서는 앞부분만 넘겨도 된다) */
export interface FolderDocInput {
  /** files/ 기준 상대 경로 (예: `api/auth/README.md`) */
  path: string;
  title: string;
  /** 문서 내용 해시 (content_hash) */
  hash: string;
  /** 문서의 헤딩 목록 */
  headings: string[];
  /** 본문 텍스트 (키워드 추출·사용자 메모 설명에 쓴다) */
  text: string;
}

export interface BuildFolderMetaOptions {
  /** 직전에 만든 메타데이터. 하위 해시가 같고 생성기 버전이 같으면 재사용한다 */
  previous?: FolderMeta[];
}

export interface BuildFolderMetaResult {
  folders: FolderMeta[];
  /** 이전 결과를 그대로 재사용한 폴더 수 (증분 효과 측정용) */
  reused: number;
}

// ── 경로 유틸 ─────────────────────────────────────────

export function normalizeFolderPath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\.?\/+/, '').replace(/\/+$/, '');
}

function dirOf(path: string): string {
  const i = path.lastIndexOf('/');
  return i < 0 ? '' : path.slice(0, i);
}

function baseOf(path: string): string {
  const i = path.lastIndexOf('/');
  return i < 0 ? path : path.slice(i + 1);
}

function parentOf(folder: string): string {
  return dirOf(folder);
}

/** 문서 경로가 폴더 아래(하위 포함)에 있는지. 루트('')는 모든 문서를 포함한다 */
function isUnder(path: string, folder: string): boolean {
  return folder === '' || path.startsWith(folder + '/');
}

/** 문서가 속한 폴더와 그 조상들: `a/b/c.md` → ['', 'a', 'a/b'] */
function foldersOfDoc(path: string): string[] {
  const out = [''];
  const parts = dirOf(path).split('/').filter(Boolean);
  let cur = '';
  for (const p of parts) {
    cur = cur ? `${cur}/${p}` : p;
    out.push(cur);
  }
  return out;
}

// ── 동의어 사전 (ko ↔ en, 양방향) ─────────────────────

/** 내장 동의어 쌍. 한 줄에 같은 뜻의 단어들을 적는다 (양방향으로 확장) */
const SYNONYM_GROUPS: string[][] = [
  ['인증', 'authentication', 'auth'],
  ['인가', 'authorization'],
  ['권한', 'permission', 'role'],
  ['로그인', 'login', 'signin'],
  ['로그아웃', 'logout', 'signout'],
  ['토큰', 'token'],
  ['세션', 'session'],
  ['쿠키', 'cookie'],
  ['배포', 'deploy', 'deployment'],
  ['설정', 'config', 'configuration', 'setting'],
  ['환경변수', 'env', 'environment'],
  ['데이터베이스', 'database', 'db'],
  ['테이블', 'table'],
  ['스키마', 'schema'],
  ['마이그레이션', 'migration'],
  ['백업', 'backup'],
  ['로그', 'log', 'logging'],
  ['모니터링', 'monitoring', 'observability'],
  ['알림', 'notification', 'notify'],
  ['경고', 'alert', 'alarm'],
  ['검색', 'search', 'retrieval'],
  ['색인', 'index', 'indexing'],
  ['임베딩', 'embedding', 'embed'],
  ['벡터', 'vector'],
  ['청크', 'chunk'],
  ['문서', 'document', 'doc'],
  ['테스트', 'test', 'testing'],
  ['빌드', 'build'],
  ['패키지', 'package'],
  ['의존성', 'dependency', 'dependencies'],
  ['라이브러리', 'library', 'lib'],
  ['모듈', 'module'],
  ['컴포넌트', 'component'],
  ['함수', 'function', 'func'],
  ['클래스', 'class'],
  ['인터페이스', 'interface'],
  ['오류', 'error', 'bug'],
  ['예외', 'exception'],
  ['응답', 'response'],
  ['요청', 'request'],
  ['라우터', 'router', 'routing', 'route'],
  ['엔드포인트', 'endpoint', 'api'],
  ['서버', 'server'],
  ['클라이언트', 'client'],
  ['캐시', 'cache', 'caching'],
  ['큐', 'queue'],
  ['워커', 'worker'],
  ['쿠버네티스', 'kubernetes', 'k8s'],
  ['도커', 'docker'],
  ['컨테이너', 'container'],
  ['파이프라인', 'pipeline'],
  ['보안', 'security'],
  ['암호화', 'encryption', 'crypto'],
  ['결제', 'payment', 'checkout'],
  ['주문', 'order'],
  ['사용자', 'user'],
  ['계약', 'contract'],
  ['청구', 'billing', 'invoice'],
  ['인프라', 'infrastructure', 'infra'],
  ['성능', 'performance'],
  ['가이드', 'guide', 'guideline'],
  ['규칙', 'rule', 'policy'],
  ['정책', 'policy'],
  ['절차', 'procedure', 'process'],
  ['요약', 'summary'],
  ['회의', 'meeting'],
  ['아키텍처', 'architecture'],
  ['디자인', 'design'],
];

const SYNONYM_INDEX: Map<string, string[]> = (() => {
  const map = new Map<string, Set<string>>();
  for (const group of SYNONYM_GROUPS) {
    const words = group.map((w) => w.toLowerCase());
    for (const w of words) {
      const set = map.get(w) ?? new Set<string>();
      for (const other of words) if (other !== w) set.add(other);
      map.set(w, set);
    }
  }
  return new Map([...map].map(([k, v]) => [k, [...v]]));
})();

/** 질의어·키워드에 대응하는 동의어 목록 (사전에 없으면 빈 배열) */
export function synonymsOf(term: string): string[] {
  return SYNONYM_INDEX.get(term.toLowerCase()) ?? [];
}

// ── 빌더 ──────────────────────────────────────────────

function topByCount(counts: Map<string, number>, limit: number): string[] {
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .slice(0, limit)
    .map(([k]) => k);
}

function isUsefulToken(t: string): boolean {
  if (t.length < 2) return false;
  return !/^\d+$/.test(t);
}

/** 사용자 메모(INFO.md/README.md/AGENTS.md)에서 제목(첫 헤딩)과 설명(첫 문단)을 뽑는다 */
function readNote(text: string): { title?: string; description?: string } {
  let title: string | undefined;
  let description: string | undefined;
  const para: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!title && /^#\s+/.test(line)) {
      title = line.replace(/^#\s+/, '').trim();
      continue;
    }
    if (line.startsWith('#')) {
      if (para.length > 0) break;
      continue;
    }
    if (line === '') {
      if (para.length > 0) break;
      continue;
    }
    para.push(line);
  }
  if (para.length > 0) description = para.join(' ').slice(0, MAX_DESCRIPTION_CHARS);
  return { title: title || undefined, description };
}

/**
 * 문서 목록으로 모든 폴더의 메타데이터를 만든다. 결과는 경로순(루트 먼저).
 * 증분: previous에서 같은 경로의 폴더가 하위 문서 해시 묶음(subtree hash)과 생성기 버전이 같으면 재사용한다.
 */
export function buildFolderMetas(docsIn: FolderDocInput[], opts: BuildFolderMetaOptions = {}): BuildFolderMetaResult {
  const docs = docsIn.map((d) => ({ ...d, path: normalizeFolderPath(d.path) }));

  const folderSet = new Set<string>();
  for (const d of docs) for (const f of foldersOfDoc(d.path)) folderSet.add(f);
  const folderList = [...folderSet].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

  const prevByPath = new Map((opts.previous ?? []).map((m) => [m.path, m]));
  let reused = 0;

  const built = new Map<string, FolderMeta>();
  const tokenSets = new Map<string, Set<string>>();

  for (const f of folderList) {
    const sub = docs.filter((d) => isUnder(d.path, f)).sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    const direct = sub.filter((d) => dirOf(d.path) === f);
    const childFolders = folderList.filter((g) => g !== '' && parentOf(g) === f);
    const subtreeHash = sha256Hex(
      [`v${FOLDER_META_VERSION}`, ...sub.map((d) => `${d.path}\u0000${d.hash}`)].join('\n'),
    );

    const prev = prevByPath.get(f);
    if (prev && prev.hash === subtreeHash && prev.generator === FOLDER_META_VERSION) {
      built.set(f, prev);
      reused += 1;
      tokenSets.set(f, new Set([...prev.keywords, ...prev.topics.flatMap((t) => tokenize(t).filter(isUsefulToken))]));
      continue;
    }

    const note = direct.find((d) => FOLDER_NOTE_NAMES.includes(baseOf(d.path).toLowerCase()));
    const noteInfo = note ? readNote(note.text) : {};

    // 헤딩·키워드: 하위 전체 문서에서 집계 (문서당 한 번씩 세서 긴 문서가 독점하지 않게 한다)
    const headingCounts = new Map<string, number>();
    const tokenDf = new Map<string, number>();
    for (const d of sub) {
      for (const h of new Set(d.headings.map((x) => x.trim()).filter(Boolean))) {
        headingCounts.set(h, (headingCounts.get(h) ?? 0) + 1);
      }
      const toks = new Set(tokenize(`${d.title} ${d.headings.join(' ')} ${d.text}`).filter(isUsefulToken));
      for (const t of toks) tokenDf.set(t, (tokenDf.get(t) ?? 0) + 1);
    }
    const topics = topByCount(headingCounts, MAX_TOPICS);
    const keywords = topByCount(tokenDf, MAX_KEYWORDS);

    const kwSet = new Set([...keywords, ...topics.flatMap((t) => tokenize(t).filter(isUsefulToken))]);
    const synonyms: string[] = [];
    for (const t of kwSet) {
      for (const s of synonymsOf(t)) {
        if (kwSet.has(s) || synonyms.includes(s)) continue;
        synonyms.push(s);
        if (synonyms.length >= MAX_SYNONYMS) break;
      }
      if (synonyms.length >= MAX_SYNONYMS) break;
    }

    const keyDocs = [...direct, ...sub.filter((d) => dirOf(d.path) !== f)]
      .slice(0, MAX_KEY_DOCS)
      .map((d) => ({ path: d.path, title: d.title }));

    const title = noteInfo.title ?? (f === '' ? '루트' : baseOf(f));
    const description =
      noteInfo.description ?? `${title} 폴더 · 문서 ${sub.length}개${topics.length ? ` · 주제: ${topics.slice(0, 3).join(', ')}` : ''}`;

    const meta: FolderMeta = {
      path: f,
      title,
      description,
      topics,
      keywords,
      synonyms,
      keyDocs,
      children: childFolders,
      related: [],
      docCount: direct.length,
      totalDocs: sub.length,
      hash: subtreeHash,
      ...(note ? { userNotes: direct.filter((d) => FOLDER_NOTE_NAMES.includes(baseOf(d.path).toLowerCase())).map((d) => d.path) } : {}),
      generator: FOLDER_META_VERSION,
    };
    built.set(f, meta);
    tokenSets.set(f, kwSet);
  }

  // 연관 폴더: 키워드가 여러 개 겹치는 다른 폴더 (상위·하위 관계 제외)
  for (const f of folderList) {
    const mine = built.get(f);
    const mySet = tokenSets.get(f);
    if (!mine || !mySet) continue;
    const scored: { path: string; overlap: number }[] = [];
    for (const g of folderList) {
      if (g === f || g === '') continue;
      if (isUnder(g, f) || isUnder(f, g)) continue;
      const other = tokenSets.get(g);
      if (!other) continue;
      let overlap = 0;
      for (const t of mySet) if (other.has(t)) overlap += 1;
      if (overlap >= MIN_RELATED_OVERLAP) scored.push({ path: g, overlap });
    }
    mine.related = scored
      .sort((a, b) => b.overlap - a.overlap || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
      .slice(0, MAX_RELATED)
      .map((s) => s.path);
  }

  return { folders: folderList.map((f) => built.get(f)).filter((m): m is FolderMeta => m !== undefined), reused };
}

export function toFolderMetaFile(folders: FolderMeta[], now: number = Date.now()): FolderMetaFile {
  return { version: FOLDER_META_VERSION, generatedAt: now, folders };
}

// ── 검증 (폴백 판단) ───────────────────────────────────

function isStr(v: unknown): v is string {
  return typeof v === 'string';
}
function isStrArr(v: unknown): v is string[] {
  return Array.isArray(v) && v.every(isStr);
}
function isNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function isFolderMeta(v: unknown): v is FolderMeta {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  const keyDocsOk =
    Array.isArray(o.keyDocs) &&
    o.keyDocs.every((k) => typeof k === 'object' && k !== null && isStr((k as { path?: unknown }).path) && isStr((k as { title?: unknown }).title));
  return (
    isStr(o.path) &&
    isStr(o.title) &&
    isStr(o.description) &&
    isStrArr(o.topics) &&
    isStrArr(o.keywords) &&
    isStrArr(o.synonyms) &&
    keyDocsOk &&
    isStrArr(o.children) &&
    isStrArr(o.related) &&
    isNum(o.docCount) &&
    isNum(o.totalDocs) &&
    isStr(o.hash) &&
    isNum(o.generator) &&
    (o.userNotes === undefined || isStrArr(o.userNotes))
  );
}

/**
 * 디스크에서 읽은 값을 검증한다. 형식이 틀리거나 버전이 다르면 null을 돌려준다 (호출자는 원문 검색만 쓴다).
 */
export function parseFolderMetaFile(raw: unknown): FolderMetaFile | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const o = raw as Record<string, unknown>;
  if (o.version !== FOLDER_META_VERSION || !isNum(o.generatedAt) || !Array.isArray(o.folders)) return null;
  if (!o.folders.every(isFolderMeta)) return null;
  return { version: FOLDER_META_VERSION, generatedAt: o.generatedAt, folders: o.folders };
}

// ── 검색 연계 ──────────────────────────────────────────

/**
 * 질의에 맞는 폴더 후보. 제목 일치는 가중치 3, 주제·키워드 2, 동의어·설명 1.
 * 루트('')는 후보로 내지 않는다. 점수 0인 폴더는 빼고, 질의 어휘 크기로 나눠 0~1 근처 점수를 준다.
 */
export function matchFolders(folders: FolderMeta[], plan: QueryPlan, kbId: string, limit = 3): FolderHint[] {
  const qTerms = new Set<string>();
  for (const t of [...plan.keywords, ...plan.contextTerms]) {
    for (const tok of tokenize(t)) qTerms.add(tok);
    qTerms.add(t.toLowerCase());
  }
  for (const tok of tokenize(plan.original)) qTerms.add(tok);
  for (const t of [...qTerms]) for (const s of synonymsOf(t)) qTerms.add(s);
  if (qTerms.size === 0) return [];

  const hints: FolderHint[] = [];
  for (const f of folders) {
    if (f.path === '') continue;
    const titleToks = new Set(tokenize(f.title));
    const kwToks = new Set([...f.keywords, ...f.topics].flatMap((x) => [x.toLowerCase(), ...tokenize(x)]));
    const synToks = new Set(f.synonyms.map((x) => x.toLowerCase()));
    const descToks = new Set(tokenize(f.description));
    let score = 0;
    for (const q of qTerms) {
      if (titleToks.has(q)) score += 3;
      else if (kwToks.has(q)) score += 2;
      else if (synToks.has(q)) score += 1;
      else if (descToks.has(q)) score += 1;
    }
    if (score > 0) {
      hints.push({ kbId, path: f.path, title: f.title, score: Math.round((score / qTerms.size) * 1000) / 1000 });
    }
  }
  return hints.sort((a, b) => b.score - a.score || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)).slice(0, limit);
}

// ── 렌더링 (사람이 읽는 미러) ──────────────────────────

/** meta/INDEX.md: 폴더 트리 요약 */
export function renderFolderIndexMd(folders: FolderMeta[]): string {
  const lines = ['# 폴더 색인', '', '> 자동 생성 파일입니다. 직접 고쳐도 다음 색인에서 덮어써집니다.', ''];
  for (const f of folders) {
    const depth = f.path === '' ? 0 : f.path.split('/').length;
    const indent = '  '.repeat(depth);
    const label = f.path === '' ? '/ (루트)' : `${f.path}/`;
    lines.push(`${indent}- \`${label}\` ${f.title} — ${f.description} (문서 ${f.totalDocs}개)`);
  }
  return lines.join('\n') + '\n';
}

/** meta/tree/<folder>/INFO.md: 폴더 하나의 설명 */
export function renderFolderInfoMd(f: FolderMeta): string {
  const list = (items: string[]) => (items.length ? items.map((x) => `- ${x}`).join('\n') : '- (없음)');
  const lines = [
    `# ${f.title}`,
    '',
    `경로: \`${f.path === '' ? '/' : f.path + '/'}\``,
    '',
    f.description,
    '',
    '## 주요 주제',
    list(f.topics),
    '',
    '## 키워드',
    list(f.keywords),
    '',
    '## 동의어',
    list(f.synonyms),
    '',
    '## 주요 문서',
    f.keyDocs.length ? f.keyDocs.map((k) => `- ${k.title} (\`${k.path}\`)`).join('\n') : '- (없음)',
    '',
    '## 하위 폴더',
    list(f.children),
    '',
    '## 관련 폴더',
    list(f.related),
    '',
    `문서 ${f.docCount}개 (하위 포함 ${f.totalDocs}개) · 생성기 v${f.generator}`,
    '',
  ];
  return lines.join('\n');
}
