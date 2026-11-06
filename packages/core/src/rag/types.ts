/**
 * 지식베이스 RAG 공통 계약 (ADR-113).
 * core는 플랫폼 무관(DOM·Node import 금지). 저장소(SQLite)·Worker·IPC 구현은 bridge/desktop이 맡는다.
 * 사용자 학습 데이터(세션·메시지, Dexie)와 재생성 가능한 색인(<kb>/index.sqlite)은 분리한다.
 */
import type { KnowledgeKind } from '../knowledge';

// ── 문서·청크 ─────────────────────────────────────────

/** 문서 종류. 청킹 전략 선택에 쓴다 */
export type DocKind = 'markdown' | 'text' | 'html' | 'pdf' | 'code' | 'config';

/** 파싱 결과의 구조 블록. 제목 계층·코드·페이지를 보존한다 */
export interface ParsedBlock {
  type: 'heading' | 'paragraph' | 'code' | 'list' | 'table' | 'symbol';
  /** heading 깊이(1~6) */
  depth?: number;
  text: string;
  /** 코드 블록 언어 또는 code 문서 언어 */
  lang?: string;
  /** symbol 블록: 함수·클래스·구조체 이름 */
  symbol?: string;
  /** PDF 페이지(1부터) */
  page?: number;
  /** 원본 줄 범위(1부터, 포함) */
  lineStart?: number;
  lineEnd?: number;
}

export interface ParsedDocument {
  /** files/ 기준 상대 경로 ('/' 구분) */
  path: string;
  kind: DocKind;
  title: string;
  /** 링크로 가져온 문서의 원본 URL (links/*.md 머리말 `source:` 등) */
  url?: string;
  lang?: string;
  blocks: ParsedBlock[];
}

/**
 * 계층형 청크. level 'section'은 부모(큰 문맥), 'leaf'는 검색 단위(작은 청크).
 * Small-to-Big: leaf로 찾고 parentId의 section으로 넓힌다.
 */
export interface Chunk {
  /** 문서 안에서 안정적인 id: `${docId}:${ordinal}` */
  id: string;
  docId: string;
  parentId: string | null;
  level: 'section' | 'leaf';
  ordinal: number;
  /** 제목 경로 ['Concepts', 'Networking', 'IPAM'] */
  headingPath: string[];
  /** 검색·임베딩에 쓰는 본문 (leaf는 제목 경로 접두를 포함한 텍스트를 embedText로) */
  text: string;
  /** 임베딩·키워드 색인에 넣는 텍스트: 문서 제목 + 제목 경로 + 본문 */
  embedText: string;
  page?: number;
  lineStart?: number;
  lineEnd?: number;
  symbol?: string;
  /** 본문 정규화 해시(SHA-256 hex 앞 32자). 중복 청크 감지 */
  hash: string;
}

export interface ChunkingOptions {
  /** leaf 목표 글자 수 (기본 900) */
  leafChars?: number;
  /** leaf 최대 글자 수 (기본 1600) */
  maxLeafChars?: number;
  /** section 최대 글자 수 (기본 6000, 넘으면 잘라 부모 문맥으로만 쓴다) */
  maxSectionChars?: number;
  /** leaf 겹침 글자 수 (기본 120) */
  overlapChars?: number;
}

/** 문서 종류별 청킹 전략 (교체 가능) */
export interface ChunkingStrategy {
  readonly id: string;
  supports(doc: ParsedDocument): boolean;
  chunk(doc: ParsedDocument, docId: string, opts?: ChunkingOptions): Chunk[];
}

/** 파일 바이트 → ParsedDocument. PDF는 플랫폼이 페이지 텍스트 추출기를 주입한다 */
export interface DocumentParser {
  supports(path: string): boolean;
  parse(input: { path: string; text?: string; pages?: string[]; url?: string }): ParsedDocument;
}

// ── 임베딩 ────────────────────────────────────────────

/**
 * 'none': 벡터 없음 — 키워드(FTS5)·심볼·폴더 메타데이터만 (신규 KB 기본, ADR-121).
 * 'local-hash': 내장 오프라인 해시 임베딩(외부 전송 없음, 예전 기본 — 기존 KB 호환용).
 * 'openai': OpenAI Embeddings API(문서 본문이 OpenAI로 전송됨).
 */
export type EmbeddingProviderId = 'none' | 'local-hash' | 'openai';

export interface EmbeddingModelInfo {
  provider: EmbeddingProviderId;
  model: string;
  dim: number;
}

/** 서로 다른 모델 벡터가 섞이지 않도록 색인에 기록하는 키: `${provider}:${model}:${dim}` */
export function embeddingKey(m: EmbeddingModelInfo): string {
  return `${m.provider}:${m.model}:${m.dim}`;
}

/** 벡터 없는 색인의 모델 정보 ('none'). dim 0 — 벡터를 저장·검색하지 않는다 */
export const NONE_EMBEDDING: EmbeddingModelInfo = { provider: 'none', model: 'none', dim: 0 };

/** OpenAI 임베딩 모델과 기본 차원 (ADR-125). dimensions 파라미터로 줄일 수 있다 */
export const OPENAI_EMBEDDING_MODELS: Record<string, { dim: number; usdPer1MTokens: number }> = {
  'text-embedding-3-small': { dim: 1536, usdPer1MTokens: 0.02 },
  'text-embedding-3-large': { dim: 3072, usdPer1MTokens: 0.13 },
};
export const DEFAULT_OPENAI_EMBEDDING_MODEL = 'text-embedding-3-small';

export interface EmbeddingProvider {
  readonly info: EmbeddingModelInfo;
  /** 배치 크기 (호출자가 이 크기로 나눠 부른다) */
  readonly batchSize: number;
  /** texts와 같은 순서·길이의 단위 벡터. 실패는 EmbeddingError로 throw */
  embed(texts: string[], signal?: AbortSignal): Promise<Float32Array[]>;
}

export class EmbeddingError extends Error {
  constructor(
    message: string,
    /** true면 재시도할 만하다 (429, 5xx, 네트워크) */
    readonly retryable: boolean,
    /** 서버가 알려준 대기 시간(Retry-After, ms). 있으면 백오프보다 우선한다 */
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = 'EmbeddingError';
  }
}

/** 지식베이스별 색인 설정 (meta.json에 저장, 사용자가 바꾼다) */
export interface KnowledgeIndexSettings {
  /** dimensions: OpenAI 출력 차원 (없으면 모델 기본). 바꾸면 새 색인을 만든다 */
  embedding: { provider: EmbeddingProviderId; model?: string; dimensions?: number };
  /** 파일을 넣을 때 바로 색인할지 (없으면 켜짐) */
  autoIndex?: boolean;
}

/**
 * meta.json에 설정이 없는 KB(예전 KB)의 기본: local-hash — 기존 색인을 그대로 쓰도록 바꾸지 않는다.
 */
export const DEFAULT_INDEX_SETTINGS: KnowledgeIndexSettings = { embedding: { provider: 'local-hash' } };

/** 새로 만드는 KB의 기본: 벡터 없음 (평가 결과 local-hash 기여가 작음, ADR-121) */
export const NEW_KB_INDEX_SETTINGS: KnowledgeIndexSettings = { embedding: { provider: 'none' } };

/**
 * 새 문서형 KB의 기본 (ADR-129): 키가 필요 없는 로컬 벡터(local-hash) + BM25 하이브리드.
 * OpenAI 임베딩은 사용자가 고를 때만 쓴다 (API 키를 강제하지 않는다). 코드베이스는 색인 설정 자체가 없다.
 */
export const NEW_DOCUMENT_INDEX_SETTINGS: KnowledgeIndexSettings = { embedding: { provider: 'local-hash' } };

/** 색인 파일 형식 버전 (sqliteRepository 스키마). 상태·무결성 검사에 노출한다 */
export const INDEX_FORMAT_VERSION = 4;

// ── 색인 상태·작업 ────────────────────────────────────

export type IndexStatus =
  /** 아직 색인 안 함 */
  | 'empty'
  /** 대기/진행 중 */
  | 'queued'
  | 'indexing'
  /** 색인이 파일과 일치 */
  | 'ready'
  /** 파일이 바뀌었거나 임베딩 모델 변경 → 재색인 필요 (기존 색인은 계속 검색됨) */
  | 'stale'
  /** 마지막 작업 실패 (기존 정상 색인은 보존되어 계속 검색됨) */
  | 'error';

export interface IndexJobProgress {
  kbId: string;
  /** 작업 종류 (ADR-130): 증분 · 전체 재생성 · 일부 파일 · 실패 재시도 */
  mode?: IndexJobMode;
  phase: 'scan' | 'parse' | 'embed' | 'write' | 'meta' | 'swap';
  done: number;
  total: number;
  /** 지금 처리 중인 파일 (files/ 기준) */
  current?: string;
}

/** 색인 작업 종류 (ADR-130) */
export type IndexJobMode = 'incremental' | 'full' | 'partial' | 'retry';

/** 마지막으로 끝난 색인 작업 결과 (상태 복구·UI 안내) */
export interface IndexJobOutcome {
  mode: IndexJobMode;
  outcome: 'completed' | 'cancelled' | 'failed' | 'interrupted';
  at: number;
}

export interface KnowledgeIndexState {
  kbId: string;
  status: IndexStatus;
  /**
   * 코드베이스는 색인이 없다 (ADR-127): status는 항상 'ready'(또는 경로를 못 찾으면 'error'),
   * docCount 등은 0. UI는 kind로 화면을 나눈다. 미분류(undefined)는 기존 문서형 동작.
   */
  kind?: KnowledgeKind;
  /** 마지막으로 끝난 작업 (취소·중단 표시용) */
  lastJob?: IndexJobOutcome;
  /** 색인 파일 형식 버전 (INDEX_FORMAT_VERSION과 다르면 재생성 필요) */
  formatVersion?: number;
  /** 색인된 문서 수·청크 수·색인 파일 크기 */
  docCount: number;
  chunkCount: number;
  indexBytes: number;
  /** 원본 파일 크기 합 (files/) */
  sourceBytes: number;
  /** 지금 색인의 임베딩 모델 */
  model?: EmbeddingModelInfo;
  /** 마지막 성공 색인 시각 */
  indexedAt?: number;
  progress?: IndexJobProgress;
  /** 마지막 실패 원인 (보여줄 문구) */
  error?: string;
  /** 파싱 실패한 파일 수 (상세는 docs의 error) */
  failedDocs: number;
  /** 폴더 메타데이터 수 (INDEX/INFO, ADR-123) */
  folderCount?: number;
  /** 마지막 색인의 임베딩 사용량 (OpenAI만): 토큰 수 */
  embedTokens?: number;
}

/** 지식베이스 문서 목록 한 줄 */
export interface KnowledgeDoc {
  docId: string;
  path: string;
  title: string;
  kind: DocKind;
  url?: string;
  bytes: number;
  chunkCount: number;
  /** 'ok' | 'error'(파싱 실패) | 'skipped'(바이너리·너무 큼 등) */
  status: 'ok' | 'error' | 'skipped';
  error?: string;
  indexedAt: number;
}

/** 지식베이스 출처 (갱신 버튼으로 다시 받는다) */
export interface KnowledgeSource {
  id: string;
  type: 'files' | 'folder' | 'github' | 'web';
  /** 원본 위치: 로컬 경로(표시용)·URL */
  location: string;
  /** files/ 안에 저장된 위치 */
  dest: string;
  addedAt: number;
  updatedAt: number;
}

// ── 검색 ──────────────────────────────────────────────

/**
 * 검색 모드 (ADR-122).
 * - auto: 기본. 로컬 빠른 검색(FTS5·심볼·폴더) + KB에 유효한 OpenAI 색인이 있으면 의미 검색, 근거가 부족할 때만 질의 확장, CLI는 필요할 때만 추가 탐색.
 * - fast: 로컬 빠른 검색만. CLI 추가 탐색 도구 없음.
 * - deep: 빠른 검색 + CLI 추가 탐색 적극 사용.
 * - semantic: 의미 검색 우선 (OpenAI 색인 없으면 빠른 검색으로 대체하고 알린다) + 추가 탐색 허용.
 */
export type RagMode = 'auto' | 'fast' | 'deep' | 'semantic';
export const RAG_MODES: readonly RagMode[] = ['auto', 'fast', 'deep', 'semantic'];

/** 검색 설정 (Settings.rag에 저장) */
export interface RagSettings {
  /** 지식베이스 검색 사용 (기본 true) */
  enabled: boolean;
  /** 벡터·키워드 각각 가져올 후보 수 (기본 30) */
  candidates: number;
  /** RRF k (기본 60) */
  rrfK: number;
  /** 키워드 검색 가중치 (기본 1), 벡터 가중치 (기본 1) */
  keywordWeight: number;
  vectorWeight: number;
  /** 경량 리랭커 사용 (기본 true) */
  rerank: boolean;
  /** 최종 근거 수 (기본 6) */
  topK: number;
  /** LLM에 넣을 근거 전체 최대 글자 수 (기본 9000) */
  maxContextChars: number;
  /** 부모 섹션 확장 (기본 true) */
  expandParent: boolean;
  /** 최소 관련도(0~1). 이보다 낮은 근거는 넣지 않는다 (기본 0.15) */
  minScore: number;
  /** 한국어 등 질문을 세션 모델로 영어 코드 식별자·키워드까지 넓혀 검색 (기본 true, ADR-119). ADR-122부터 근거가 부족할 때만 */
  expandQuery: boolean;
  /** 검색 모드 (기본 auto, ADR-122). 없으면 auto */
  mode?: RagMode;
  /** 디버그: 검색 단계별 시간·후보를 결과에 담아 화면에 보인다 (기본 false) */
  debug?: boolean;
}

export const DEFAULT_RAG_SETTINGS: RagSettings = {
  enabled: true,
  candidates: 30,
  rrfK: 60,
  keywordWeight: 1,
  vectorWeight: 1,
  rerank: true,
  topK: 6,
  maxContextChars: 9000,
  expandParent: true,
  minScore: 0.15,
  expandQuery: true,
  mode: 'auto',
  debug: false,
};

/** 문맥 기반 질의 계획 (core rewriteQuery 결과) */
export interface QueryPlan {
  /** 사용자가 쓴 질문 그대로 */
  original: string;
  /** 문맥을 반영해 다시 쓴 검색 질의 (사람이 읽을 수 있는 한 줄) */
  rewritten: string;
  /** 질문에서 뽑은 핵심어 */
  keywords: string[];
  /** 세션 문맥(주제·요약·부모 가지·최근 대화)에서 뽑은 문맥어 */
  contextTerms: string[];
  /** 벡터 검색에 넣을 텍스트 */
  vectorText: string;
  /** 키워드(FTS) 검색 질의 토큰 */
  keywordQuery: string[];
  /** 질문이 문맥에 기대는가(대명사·생략) */
  contextual: boolean;
}

/** 검색 요청 (renderer → main → worker). 질의 계획만 보내고 임베딩은 worker가 KB별 모델로 한다 */
export interface RetrievalRequest {
  kbIds: string[];
  plan: QueryPlan;
  settings: RagSettings;
  /** 메타데이터 필터: 경로 접두·문서 종류 */
  filter?: { pathPrefix?: string; kinds?: DocKind[] };
}

/** 검색 후보 한 건 (엔진 내부·리랭커 입력) */
export interface SearchHit {
  kbId: string;
  chunkId: string;
  docId: string;
  score: number;
  /** 어느 검색에서 몇 위였나 */
  vectorRank?: number;
  keywordRank?: number;
  /** 코드 심볼 이름 일치 순위 (ADR-115) */
  symbolRank?: number;
  /** 파일명·경로·제목 일치 순위 (ADR-122) */
  pathRank?: number;
  /** 폴더 메타데이터(INFO) 후보 폴더 안의 청크인가 (ADR-123) */
  folderMatch?: boolean;
}

/** 최종 근거 한 건 = 답변 출처 */
export interface Evidence {
  /** 답변 안 인용 번호 [1], [2] … */
  n: number;
  kbId: string;
  kbName: string;
  chunkId: string;
  docId: string;
  path: string;
  title: string;
  kind: DocKind;
  headingPath: string[];
  url?: string;
  page?: number;
  lineStart?: number;
  lineEnd?: number;
  symbol?: string;
  /** LLM에 넣은 텍스트 (부모 확장 포함) */
  text: string;
  /** 0~1 관련도 */
  score: number;
  /** 어느 검색 채널이 이 청크를 찾았나 (충분성 판단·디버그, ADR-122) */
  matched?: SearchChannel[];
  /** 검색 방식 (ADR-127): 코드베이스 실시간 탐색 · 문서 하이브리드 */
  method?: RetrievalMethod;
}

/**
 * 검색 채널. grep·definition·file은 코드베이스 실시간 탐색(Agentic, ADR-128) 전용,
 * vector는 문서형 전용이다.
 */
export type SearchChannel = 'keyword' | 'vector' | 'symbol' | 'path' | 'folder' | 'grep' | 'definition' | 'file';

/** 지식베이스 검색 방식: agentic = 코드베이스 실시간 탐색(색인·벡터 없음), hybrid = 문서 Vector+BM25 */
export type RetrievalMethod = 'agentic' | 'hybrid';

/** 검색 단계별 시간(ms). 측정은 항상 하되 로그는 남기지 않는다 (디버그 화면·평가용) */
export interface RetrievalTimings {
  /** 질의 임베딩 (OpenAI) */
  embedMs?: number;
  keywordMs?: number;
  vectorMs?: number;
  symbolMs?: number;
  pathMs?: number;
  folderMs?: number;
  /** 후보 청크·문서 조회 */
  fetchMs?: number;
  /** 근거 선택(리랭크·중복 제거·예산) */
  selectMs?: number;
  /** 질의 확장 (store) */
  expandMs?: number;
  totalMs?: number;
}

/** 사용자에게 알릴 검색 동작 (fallback·확장 등). 문구는 화면이 i18n으로 만든다 */
export type RetrievalNoticeCode =
  /** semantic 모드인데 OpenAI 색인이 없거나 키가 없어 빠른 검색으로 대체 */
  | 'semantic_unavailable'
  /** 질의 임베딩 실패 → 키워드 검색만 */
  | 'embed_failed'
  /** 근거가 부족해 질의를 넓혀 다시 찾음 */
  | 'expanded'
  /** 근거 부족 (관련 문서를 찾지 못함) */
  | 'insufficient'
  /** 일부 KB를 건너뜀 (skipped 참조) */
  | 'kb_skipped'
  /** 검색 시간 초과 → 근거 없이 답함 */
  | 'timeout'
  /** 문서형 KB의 벡터 색인이 없거나 꺼져 키워드(BM25)만 썼다 */
  | 'keyword_only'
  /** 코드베이스·문서 결과 사이에 버전 표기가 서로 다르다 (Context Builder, ADR-131) */
  | 'version_conflict'
  /** 코드베이스 폴더를 찾지 못했다 (연결 폴더가 옮겨졌거나 지워짐) */
  | 'codebase_missing';

export interface RetrievalNotice {
  code: RetrievalNoticeCode;
  kbId?: string;
}

/** 근거 충분성 판단 결과 (core assessEvidence, ADR-122) */
export interface EvidenceAssessment {
  sufficient: boolean;
  /** 판단 근거 (디버그·평가용 코드) */
  reasons: string[];
  /** 0~1 신뢰도 (참고용) */
  confidence: number;
}

/** 폴더 후보 (INFO 메타데이터 검색 결과, ADR-123) */
export interface FolderHint {
  kbId: string;
  /** files/ 기준 폴더 경로 ('' = 루트) */
  path: string;
  title: string;
  score: number;
}

export interface RetrievalResult {
  plan: QueryPlan;
  evidence: Evidence[];
  /** 색인이 없거나 실패해 건너뛴 KB와 이유 */
  skipped: { kbId: string; reason: string }[];
  tookMs: number;
  /** 단계별 시간 (ADR-122) */
  timings?: RetrievalTimings;
  /** 실제로 의미(벡터) 검색을 한 KB */
  semanticKbIds?: string[];
  /** 관련 폴더 후보 (추가 탐색 안내용) */
  folders?: FolderHint[];
  /** 근거 충분성 */
  assessment?: EvidenceAssessment;
  notices?: RetrievalNotice[];
  /** 유형별 검색 라우팅 (ADR-131 Knowledge Router) */
  routed?: { agentic: string[]; hybrid: string[]; intent: QueryIntent };
  /** 디버그 모드에서만: 융합 전 후보 수 등 */
  debug?: { candidates: number; perList: Record<string, number> };
}

/**
 * 메시지에 남기는 검색 과정 요약 (ADR-122). 화면의 "검색 과정" 표시에 쓴다.
 * 문서 본문은 넣지 않는다 (출처는 citations).
 */
export interface RagTrace {
  mode: RagMode;
  kbIds: string[];
  /** 질의 확장을 했는가 */
  expanded: boolean;
  semanticKbIds?: string[];
  notices: RetrievalNotice[];
  /** 주요 문서 경로 (중복 없이 최대 5개) */
  topPaths: string[];
  /** CLI가 추가로 부른 지식베이스 도구 횟수 (스트림에서 센다) */
  toolCalls?: number;
  /** 유형별로 실제 검색한 KB (ADR-131 Knowledge Router). 구버전 메시지에는 없다 */
  routed?: { agentic: string[]; hybrid: string[]; intent: QueryIntent };
  timings?: RetrievalTimings;
  sufficient?: boolean;
}

/** 리랭커 (교체 가능, 없어도 동작) */
export interface Reranker {
  readonly id: string;
  rerank(plan: QueryPlan, items: { hit: SearchHit; text: string; headingPath: string[]; title: string }[]): { hit: SearchHit; score: number }[];
}

/** 메시지에 저장하는 출처 (답변 생성에 실제로 넣은 청크) */
export interface Citation {
  n: number;
  kbId: string;
  kbName: string;
  chunkId: string;
  docId: string;
  path: string;
  title: string;
  headingPath: string[];
  url?: string;
  page?: number;
  lineStart?: number;
  lineEnd?: number;
  symbol?: string;
  /** 짧은 미리보기 (최대 280자) */
  snippet: string;
  score: number;
  /** 검색 방식 (ADR-127). 구버전 메시지에는 없다 */
  method?: RetrievalMethod;
}

/** 질문 의도 (Knowledge Router, ADR-131) */
export type QueryIntent = 'code' | 'document' | 'both';

/** 색인 무결성 검사 결과 (ADR-130) */
export interface IndexIntegrityReport {
  kbId: string;
  checkedAt: number;
  ok: boolean;
  /** 색인 파일 형식 버전 / 기대 버전 */
  formatVersion?: number;
  expectedFormatVersion: number;
  model?: EmbeddingModelInfo;
  /** 설정의 임베딩과 색인의 임베딩이 다르면 true (재색인 필요) */
  modelMismatch: boolean;
  /** 원본은 있는데 색인에 없는 파일 · 색인에는 있는데 원본이 없는 파일 · 내용이 바뀐 파일 수 */
  missing: number;
  orphaned: number;
  changed: number;
  failedDocs: number;
  /** SQLite integrity_check 결과가 ok가 아니면 false */
  storageOk: boolean;
  /** 예시 경로 (최대 20) */
  samples: { path: string; issue: 'missing' | 'orphaned' | 'changed' | 'failed' }[];
}

/** 출처 열기 결과: 해당 위치 주변 원문 */
export interface SourceView {
  kbId: string;
  path: string;
  title: string;
  kind: DocKind;
  url?: string;
  page?: number;
  lineStart?: number;
  lineEnd?: number;
  headingPath: string[];
  /** 청크 본문(강조 대상) */
  chunkText: string;
  /** 부모 섹션 본문(주변 문맥) */
  sectionText: string;
}

// ── 서비스 경계 (클라우드 확장 대비 최소 인터페이스) ──────────

/** 지식베이스 검색 (로컬: worker+SQLite, 향후 원격 Retrieval API로 교체 가능) */
export interface RetrievalService {
  retrieve(req: RetrievalRequest, signal?: AbortSignal): Promise<RetrievalResult>;
  /** 출처 보기 */
  source(kbId: string, chunkId: string): Promise<SourceView>;
}

// ── 계층형 폴더 메타데이터 (ADR-123) ─────────────────────

/** 메타데이터 생성기 버전. 바뀌면 전체 다시 만든다 */
export const FOLDER_META_VERSION = 1;

/**
 * 폴더 하나의 자동 생성 메타데이터 (INFO.md의 원천).
 * 저장 위치: 앱 관리 폴더 `<kbRoot>/<kbId>/meta/` (사용자 원본 files/에는 쓰지 않는다).
 * - `meta/folders.json`: FolderMetaFile (검색·도구가 읽는 원천)
 * - `meta/INDEX.md`, `meta/tree/<folder>/INFO.md`: 사람이 읽는 미러 (내보내기 확장용)
 */
export interface FolderMeta {
  /** files/ 기준 폴더 경로 ('' = 루트) */
  path: string;
  /** 사람이 읽을 제목 (폴더 이름 또는 README/INFO 첫 헤딩) */
  title: string;
  /** 짧은 설명 (사용자 INFO.md/README 첫 문단 또는 자동 요약) */
  description: string;
  /** 주요 주제 (자주 나오는 헤딩·핵심어) */
  topics: string[];
  /** 기술 키워드 (식별자·약어·심볼) */
  keywords: string[];
  /** 관련 용어·동의어 (내장 사전 ko↔en) */
  synonyms: string[];
  /** 주요 문서 (files/ 기준 경로, 최대 10) */
  keyDocs: { path: string; title: string }[];
  /** 하위 폴더 경로 */
  children: string[];
  /** 연관 폴더 (키워드 겹침) */
  related: string[];
  /** 바로 아래 문서 수 / 하위 전체 문서 수 */
  docCount: number;
  totalDocs: number;
  /** 하위 문서 해시들로 만든 폴더 해시 (증분 갱신 판단) */
  hash: string;
  /** 사용자가 원본에 둔 INFO.md/AGENTS.md/README 경로 (사용자 작성 데이터로 구분) */
  userNotes?: string[];
  generator: number;
}

export interface FolderMetaFile {
  version: number;
  generatedAt: number;
  folders: FolderMeta[];
}
