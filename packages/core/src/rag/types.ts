/**
 * 지식베이스 RAG 공통 계약 (ADR-113).
 * core는 플랫폼 무관(DOM·Node import 금지). 저장소(SQLite)·Worker·IPC 구현은 bridge/desktop이 맡는다.
 * 사용자 학습 데이터(세션·메시지, Dexie)와 재생성 가능한 색인(<kb>/index.sqlite)은 분리한다.
 */

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

/** 'local-hash': 내장 오프라인 해시 임베딩(외부 전송 없음, 기본). 'openai': OpenAI Embeddings API(문서 본문이 OpenAI로 전송됨) */
export type EmbeddingProviderId = 'local-hash' | 'openai';

export interface EmbeddingModelInfo {
  provider: EmbeddingProviderId;
  model: string;
  dim: number;
}

/** 서로 다른 모델 벡터가 섞이지 않도록 색인에 기록하는 키: `${provider}:${model}:${dim}` */
export function embeddingKey(m: EmbeddingModelInfo): string {
  return `${m.provider}:${m.model}:${m.dim}`;
}

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
  ) {
    super(message);
    this.name = 'EmbeddingError';
  }
}

/** 지식베이스별 색인 설정 (meta.json에 저장, 사용자가 바꾼다) */
export interface KnowledgeIndexSettings {
  embedding: { provider: EmbeddingProviderId; model?: string };
  /** 파일을 넣을 때 바로 색인할지 (없으면 켜짐) */
  autoIndex?: boolean;
}

export const DEFAULT_INDEX_SETTINGS: KnowledgeIndexSettings = { embedding: { provider: 'local-hash' } };

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
  phase: 'scan' | 'parse' | 'embed' | 'write' | 'swap';
  done: number;
  total: number;
  /** 지금 처리 중인 파일 (files/ 기준) */
  current?: string;
}

export interface KnowledgeIndexState {
  kbId: string;
  status: IndexStatus;
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
}

export interface RetrievalResult {
  plan: QueryPlan;
  evidence: Evidence[];
  /** 색인이 없거나 실패해 건너뛴 KB와 이유 */
  skipped: { kbId: string; reason: string }[];
  tookMs: number;
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
