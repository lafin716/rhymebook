/**
 * 지식베이스 색인 저장소 (<kb>/index.sqlite). node:sqlite + FTS5.
 * 원본 파일은 건드리지 않는다. 색인은 언제든 재생성할 수 있다.
 */
import { existsSync, statSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import type { DocKind, EmbeddingModelInfo } from '@branch/core';

export const SCHEMA_VERSION = 3;

/** 벡터 행렬 메모리 캐시 상한 */
const VECTOR_CACHE_LIMIT_BYTES = 256 * 1024 * 1024;
const SQL_IN_CHUNK = 500;

export interface DocRow {
  docId: string;
  path: string;
  title: string;
  kind: DocKind;
  url?: string;
  bytes: number;
  mtime: number;
  /** 변경 시각(ctime). mtime을 되돌려도 바뀌므로 증분 건너뛰기 판단에 쓴다 */
  ctime?: number;
  contentHash: string;
  chunkCount: number;
  status: 'ok' | 'error' | 'skipped';
  error?: string;
  indexedAt: number;
}

export interface ChunkRow {
  rowid: number;
  chunkId: string;
  docId: string;
  parentId: string | null;
  level: 'section' | 'leaf';
  ordinal: number;
  headingPath: string[];
  text: string;
  page?: number;
  lineStart?: number;
  lineEnd?: number;
  symbol?: string;
  hash: string;
}

/** 저장할 청크 한 건 (leaf만 vec을 가진다) */
export interface ChunkInsert {
  chunkId: string;
  docId: string;
  parentId: string | null;
  level: 'section' | 'leaf';
  ordinal: number;
  headingPath: string[];
  text: string;
  /** 키워드 색인용 토큰 문자열 (공백 구분) */
  tokens: string;
  page?: number;
  lineStart?: number;
  lineEnd?: number;
  symbol?: string;
  hash: string;
  vec?: Float32Array;
}

/** 코드 심볼 한 건 (ADR-115). chunkId는 심볼 시작 줄을 담은 leaf */
export interface SymbolInsert {
  name: string;
  kind: string;
  lineStart: number;
  lineEnd: number;
  signature: string;
  doc?: string;
  chunkId: string;
}

export interface SymbolHit {
  chunkRowid: number;
  chunkId: string;
  docId: string;
  name: string;
  /** 일치한 검색어 수 */
  matched: number;
}

/** 심볼 검색 키: 마지막 이름 조각을 소문자·영숫자만 남긴 것 (`UserService.getById` → `getbyid`) */
export function symbolKey(name: string): string {
  const last = name.split(/[.:#]+|->/).filter(Boolean).at(-1) ?? name;
  return last.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
}

export interface JobRow {
  id: string;
  kind: 'index' | 'reindex';
  state: 'queued' | 'running' | 'done' | 'failed' | 'cancelled';
  startedAt: number;
  updatedAt: number;
  done: number;
  total: number;
  error?: string;
}

export interface KeywordHit {
  chunkRowid: number;
  chunkId: string;
  docId: string;
  /** bm25 점수 (작을수록 관련 높음, FTS5 rank) */
  rank: number;
}

export interface SearchFilter {
  pathPrefix?: string;
  kinds?: DocKind[];
}

export class IndexSchemaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IndexSchemaError';
  }
}

const MIGRATIONS: ((db: DatabaseSync) => void)[] = [
  (db) => {
    db.exec(`
      CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE docs (
        doc_id TEXT PRIMARY KEY,
        path TEXT NOT NULL UNIQUE,
        title TEXT NOT NULL,
        kind TEXT NOT NULL,
        url TEXT,
        bytes INTEGER NOT NULL,
        mtime INTEGER NOT NULL,
        content_hash TEXT NOT NULL,
        chunk_count INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL,
        error TEXT,
        indexed_at INTEGER NOT NULL
      );
      CREATE TABLE chunks (
        rowid INTEGER PRIMARY KEY,
        chunk_id TEXT NOT NULL UNIQUE,
        doc_id TEXT NOT NULL REFERENCES docs(doc_id) ON DELETE CASCADE,
        parent_id TEXT,
        level TEXT NOT NULL,
        ordinal INTEGER NOT NULL,
        heading_path TEXT NOT NULL,
        text TEXT NOT NULL,
        page INTEGER,
        line_start INTEGER,
        line_end INTEGER,
        symbol TEXT,
        hash TEXT NOT NULL
      );
      CREATE INDEX chunks_doc ON chunks(doc_id);
      CREATE TABLE vectors (
        chunk_rowid INTEGER PRIMARY KEY REFERENCES chunks(rowid) ON DELETE CASCADE,
        dim INTEGER NOT NULL,
        vec BLOB NOT NULL
      );
      CREATE VIRTUAL TABLE fts USING fts5(tokens, tokenize = 'unicode61');
      CREATE TABLE emb_cache (
        text_hash TEXT NOT NULL,
        model_key TEXT NOT NULL,
        vec BLOB NOT NULL,
        PRIMARY KEY (text_hash, model_key)
      );
      CREATE TABLE jobs (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        state TEXT NOT NULL,
        started_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        done INTEGER NOT NULL DEFAULT 0,
        total INTEGER NOT NULL DEFAULT 0,
        error TEXT
      );
    `);
  },
  (db) => {
    db.exec('ALTER TABLE docs ADD COLUMN ctime INTEGER NOT NULL DEFAULT 0');
  },
  // ADR-115: 코드 심볼 표
  (db) => {
    db.exec(`
      CREATE TABLE symbols (
        id INTEGER PRIMARY KEY,
        doc_id TEXT NOT NULL,
        chunk_id TEXT NOT NULL,
        name TEXT NOT NULL,
        key TEXT NOT NULL,
        kind TEXT NOT NULL,
        line_start INTEGER NOT NULL,
        line_end INTEGER NOT NULL,
        signature TEXT NOT NULL,
        doc TEXT
      );
      CREATE INDEX symbols_key ON symbols(key);
      CREATE INDEX symbols_doc ON symbols(doc_id);
    `);
  },
];

function toBlob(vec: Float32Array): Uint8Array {
  return new Uint8Array(vec.buffer, vec.byteOffset, vec.byteLength);
}

/** SQLite BLOB → Float32Array (정렬 보장을 위해 복사) */
export function blobToVector(buf: Uint8Array): Float32Array {
  const copy = new Uint8Array(buf.byteLength);
  copy.set(buf);
  return new Float32Array(copy.buffer);
}

function ftsQuery(tokens: string[]): string {
  return tokens.map((t) => `"${t.replace(/"/g, '""')}"`).join(' OR ');
}

function filterSql(filter: SearchFilter | undefined): { sql: string; params: (string | number)[] } {
  const parts: string[] = [];
  const params: (string | number)[] = [];
  if (filter?.pathPrefix) {
    parts.push("d.path LIKE ? ESCAPE '\\'");
    params.push(`${filter.pathPrefix.replace(/[\\%_]/g, (m) => `\\${m}`)}%`);
  }
  if (filter?.kinds?.length) {
    parts.push(`d.kind IN (${filter.kinds.map(() => '?').join(',')})`);
    params.push(...filter.kinds);
  }
  return { sql: parts.length ? ` AND ${parts.join(' AND ')}` : '', params };
}

function rowToChunk(r: Record<string, unknown>): ChunkRow {
  return {
    rowid: Number(r.rowid),
    chunkId: String(r.chunk_id),
    docId: String(r.doc_id),
    parentId: (r.parent_id as string | null) ?? null,
    level: r.level as 'section' | 'leaf',
    ordinal: Number(r.ordinal),
    headingPath: JSON.parse(String(r.heading_path)) as string[],
    text: String(r.text),
    page: r.page == null ? undefined : Number(r.page),
    lineStart: r.line_start == null ? undefined : Number(r.line_start),
    lineEnd: r.line_end == null ? undefined : Number(r.line_end),
    symbol: r.symbol == null ? undefined : String(r.symbol),
    hash: String(r.hash),
  };
}

function rowToDoc(r: Record<string, unknown>): DocRow {
  return {
    docId: String(r.doc_id),
    path: String(r.path),
    title: String(r.title),
    kind: r.kind as DocKind,
    url: r.url == null ? undefined : String(r.url),
    bytes: Number(r.bytes),
    mtime: Number(r.mtime),
    ctime: Number(r.ctime ?? 0),
    contentHash: String(r.content_hash),
    chunkCount: Number(r.chunk_count),
    status: r.status as DocRow['status'],
    error: r.error == null ? undefined : String(r.error),
    indexedAt: Number(r.indexed_at),
  };
}

export class IndexRepository {
  private generation = 0;
  private matrix: { gen: number; rowids: Float64Array; dim: number; data: Float32Array } | null = null;
  private matrixTooLarge = false;

  private constructor(
    readonly file: string,
    private readonly db: DatabaseSync,
  ) {}

  /** 열기 (없으면 생성, 스키마 마이그레이션). 더 새로운 스키마면 IndexSchemaError */
  static open(file: string): IndexRepository {
    const db = new DatabaseSync(file);
    try {
      db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
      const current = Number((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version);
      if (current > SCHEMA_VERSION) throw new IndexSchemaError(`index schema ${current} is newer than ${SCHEMA_VERSION}`);
      for (let v = current; v < SCHEMA_VERSION; v++) {
        db.exec('BEGIN IMMEDIATE');
        try {
          MIGRATIONS[v]?.(db);
          db.exec(`PRAGMA user_version = ${v + 1}`);
          db.exec('COMMIT');
        } catch (err) {
          db.exec('ROLLBACK');
          throw err;
        }
      }
      return new IndexRepository(file, db);
    } catch (err) {
      db.close();
      throw err;
    }
  }

  close(): void {
    this.matrix = null;
    this.db.close();
  }

  /** WAL을 본 파일로 합친다 (교체 전 호출) */
  checkpoint(): void {
    this.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  }

  /** 트랜잭션 한 덩어리. 실패하면 롤백 */
  transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const out = fn();
      this.db.exec('COMMIT');
      this.generation++;
      return out;
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  // ── meta ──────────────────────────────────────────

  getMeta(key: string): string | undefined {
    const r = this.db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as { value: string } | undefined;
    return r?.value;
  }

  setMeta(key: string, value: string): void {
    this.db.prepare('INSERT INTO meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
  }

  getModel(): EmbeddingModelInfo | undefined {
    const raw = this.getMeta('model');
    return raw ? (JSON.parse(raw) as EmbeddingModelInfo) : undefined;
  }

  setModel(model: EmbeddingModelInfo): void {
    this.setMeta('model', JSON.stringify(model));
  }

  // ── docs ──────────────────────────────────────────

  listDocs(): DocRow[] {
    return (this.db.prepare('SELECT * FROM docs ORDER BY path').all() as Record<string, unknown>[]).map(rowToDoc);
  }

  docByPath(p: string): DocRow | undefined {
    const r = this.db.prepare('SELECT * FROM docs WHERE path = ?').get(p) as Record<string, unknown> | undefined;
    return r ? rowToDoc(r) : undefined;
  }

  docById(docId: string): DocRow | undefined {
    const r = this.db.prepare('SELECT * FROM docs WHERE doc_id = ?').get(docId) as Record<string, unknown> | undefined;
    return r ? rowToDoc(r) : undefined;
  }

  /** 문서 메타만 갱신 (내용 해시 동일, mtime만 바뀐 경우) */
  touchDoc(docId: string, mtime: number, bytes: number, ctime: number): void {
    this.db.prepare('UPDATE docs SET mtime = ?, bytes = ?, ctime = ? WHERE doc_id = ?').run(mtime, bytes, ctime, docId);
  }

  /**
   * 문서 하나를 통째로 교체한다 (한 트랜잭션). 기존 청크·벡터·키워드 행을 지운다.
   * 중간 실패 시 이전 상태가 그대로 남는다.
   */
  replaceDocument(doc: DocRow, chunks: ChunkInsert[], symbols: SymbolInsert[] = []): void {
    this.transaction(() => {
      this.deleteDocRows(doc.docId);
      this.db
        .prepare(
          `INSERT INTO docs (doc_id, path, title, kind, url, bytes, mtime, ctime, content_hash, chunk_count, status, error, indexed_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(doc_id) DO UPDATE SET path = excluded.path, title = excluded.title, kind = excluded.kind,
             url = excluded.url, bytes = excluded.bytes, mtime = excluded.mtime, ctime = excluded.ctime, content_hash = excluded.content_hash,
             chunk_count = excluded.chunk_count, status = excluded.status, error = excluded.error, indexed_at = excluded.indexed_at`,
        )
        .run(
          doc.docId,
          doc.path,
          doc.title,
          doc.kind,
          doc.url ?? null,
          doc.bytes,
          doc.mtime,
          doc.ctime ?? 0,
          doc.contentHash,
          chunks.length,
          doc.status,
          doc.error ?? null,
          doc.indexedAt,
        );
      const insChunk = this.db.prepare(
        `INSERT INTO chunks (chunk_id, doc_id, parent_id, level, ordinal, heading_path, text, page, line_start, line_end, symbol, hash)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      const insFts = this.db.prepare('INSERT INTO fts(rowid, tokens) VALUES (?, ?)');
      const insVec = this.db.prepare('INSERT INTO vectors(chunk_rowid, dim, vec) VALUES (?, ?, ?)');
      for (const c of chunks) {
        const info = insChunk.run(
          c.chunkId,
          c.docId,
          c.parentId,
          c.level,
          c.ordinal,
          JSON.stringify(c.headingPath),
          c.text,
          c.page ?? null,
          c.lineStart ?? null,
          c.lineEnd ?? null,
          c.symbol ?? null,
          c.hash,
        );
        const rowid = Number(info.lastInsertRowid);
        if (c.level === 'leaf') {
          insFts.run(rowid, c.tokens);
          if (c.vec) insVec.run(rowid, c.vec.length, toBlob(c.vec));
        }
      }
      if (symbols.length) {
        const insSym = this.db.prepare(
          `INSERT INTO symbols (doc_id, chunk_id, name, key, kind, line_start, line_end, signature, doc)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        );
        for (const s of symbols) {
          const key = symbolKey(s.name);
          if (!key) continue;
          insSym.run(doc.docId, s.chunkId, s.name, key, s.kind, s.lineStart, s.lineEnd, s.signature, s.doc ?? null);
        }
      }
    });
  }

  /** 문서와 그 청크·벡터·키워드 행 삭제 */
  deleteDocument(docId: string): void {
    this.transaction(() => {
      this.deleteDocRows(docId);
      this.db.prepare('DELETE FROM docs WHERE doc_id = ?').run(docId);
    });
  }

  /** 경로 집합에 없는 문서를 지운다. 지운 doc_id 목록 반환 */
  pruneDocs(keepPaths: Set<string>): string[] {
    const stale = (this.db.prepare('SELECT doc_id, path FROM docs').all() as { doc_id: string; path: string }[])
      .filter((r) => !keepPaths.has(r.path))
      .map((r) => r.doc_id);
    if (stale.length === 0) return [];
    this.transaction(() => {
      for (const id of stale) {
        this.deleteDocRows(id);
        this.db.prepare('DELETE FROM docs WHERE doc_id = ?').run(id);
      }
    });
    return stale;
  }

  private deleteDocRows(docId: string): void {
    const rowids = (this.db.prepare('SELECT rowid FROM chunks WHERE doc_id = ?').all(docId) as { rowid: number }[]).map((r) => r.rowid);
    const delFts = this.db.prepare('DELETE FROM fts WHERE rowid = ?');
    for (const rid of rowids) delFts.run(rid);
    this.db.prepare('DELETE FROM chunks WHERE doc_id = ?').run(docId);
    this.db.prepare('DELETE FROM symbols WHERE doc_id = ?').run(docId);
  }

  stats(): { docCount: number; chunkCount: number; leafCount: number; failedDocs: number } {
    const d = this.db
      .prepare("SELECT COUNT(*) AS n, SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) AS f FROM docs")
      .get() as { n: number; f: number | null };
    const c = this.db.prepare("SELECT COUNT(*) AS n, SUM(CASE WHEN level = 'leaf' THEN 1 ELSE 0 END) AS l FROM chunks").get() as {
      n: number;
      l: number | null;
    };
    return { docCount: Number(d.n), chunkCount: Number(c.n), leafCount: Number(c.l ?? 0), failedDocs: Number(d.f ?? 0) };
  }

  // ── chunks ────────────────────────────────────────

  getChunk(chunkId: string): (ChunkRow & { path: string; title: string; kind: DocKind; url?: string }) | undefined {
    const r = this.db
      .prepare(
        `SELECT c.*, d.path, d.title, d.kind, d.url FROM chunks c JOIN docs d ON d.doc_id = c.doc_id WHERE c.chunk_id = ?`,
      )
      .get(chunkId) as Record<string, unknown> | undefined;
    if (!r) return undefined;
    return {
      ...rowToChunk(r),
      path: String(r.path),
      title: String(r.title),
      kind: r.kind as DocKind,
      url: r.url == null ? undefined : String(r.url),
    };
  }

  /** 섹션(부모) 청크 본문 */
  getSection(chunkId: string): ChunkRow | undefined {
    const r = this.db.prepare("SELECT * FROM chunks WHERE chunk_id = ? AND level = 'section'").get(chunkId) as
      | Record<string, unknown>
      | undefined;
    return r ? rowToChunk(r) : undefined;
  }

  getChunksByRowids(rowids: number[]): Map<number, ChunkRow> {
    const out = new Map<number, ChunkRow>();
    for (let i = 0; i < rowids.length; i += SQL_IN_CHUNK) {
      const part = rowids.slice(i, i + SQL_IN_CHUNK);
      const rows = this.db
        .prepare(`SELECT * FROM chunks WHERE rowid IN (${part.map(() => '?').join(',')})`)
        .all(...part) as Record<string, unknown>[];
      for (const r of rows) {
        const c = rowToChunk(r);
        out.set(c.rowid, c);
      }
    }
    return out;
  }

  // ── keyword search (FTS5) ─────────────────────────

  keywordSearch(tokens: string[], limit: number, filter?: SearchFilter): KeywordHit[] {
    if (tokens.length === 0) return [];
    const f = filterSql(filter);
    const rows = this.db
      .prepare(
        `SELECT c.rowid AS rowid, c.chunk_id AS chunk_id, c.doc_id AS doc_id, fts.rank AS rank
         FROM fts JOIN chunks c ON c.rowid = fts.rowid JOIN docs d ON d.doc_id = c.doc_id
         WHERE fts MATCH ? AND c.level = 'leaf'${f.sql}
         ORDER BY fts.rank LIMIT ?`,
      )
      .all(ftsQuery(tokens), ...f.params, limit) as Record<string, unknown>[];
    return rows.map((r) => ({
      chunkRowid: Number(r.rowid),
      chunkId: String(r.chunk_id),
      docId: String(r.doc_id),
      rank: Number(r.rank),
    }));
  }

  // ── symbol search (ADR-115) ──────────────────────

  /**
   * 심볼 이름 키가 검색어와 정확히 같은 leaf 청크. 너무 흔한 키(maxPerTerm 초과)는 신호가 약해 버린다.
   * 일치 검색어 수 → 짧은 이름 순.
   */
  symbolSearch(terms: string[], limit: number, filter?: SearchFilter, maxPerTerm = 20): SymbolHit[] {
    const keys = [...new Set(terms.map((t) => t.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')).filter((t) => t.length >= 3))];
    if (keys.length === 0) return [];
    const f = filterSql(filter);
    const q = this.db.prepare(
      `SELECT c.rowid AS rowid, c.chunk_id AS chunk_id, c.doc_id AS doc_id, s.name AS name
       FROM symbols s JOIN chunks c ON c.chunk_id = s.chunk_id JOIN docs d ON d.doc_id = s.doc_id
       WHERE s.key = ? AND c.level = 'leaf'${f.sql}
       LIMIT ?`,
    );
    const byRow = new Map<number, SymbolHit>();
    for (const key of keys) {
      const rows = q.all(key, ...f.params, maxPerTerm + 1) as Record<string, unknown>[];
      if (rows.length > maxPerTerm) continue;
      for (const r of rows) {
        const rowid = Number(r.rowid);
        const hit = byRow.get(rowid);
        if (hit) hit.matched++;
        else byRow.set(rowid, { chunkRowid: rowid, chunkId: String(r.chunk_id), docId: String(r.doc_id), name: String(r.name), matched: 1 });
      }
    }
    return [...byRow.values()].sort((a, b) => b.matched - a.matched || a.name.length - b.name.length).slice(0, limit);
  }

  /** 문서의 심볼 목록 (줄 순) */
  listSymbols(docId: string): (SymbolInsert & { key: string })[] {
    const rows = this.db
      .prepare('SELECT chunk_id, name, key, kind, line_start, line_end, signature, doc FROM symbols WHERE doc_id = ? ORDER BY line_start, id')
      .all(docId) as Record<string, unknown>[];
    return rows.map((r) => ({
      chunkId: String(r.chunk_id),
      name: String(r.name),
      key: String(r.key),
      kind: String(r.kind),
      lineStart: Number(r.line_start),
      lineEnd: Number(r.line_end),
      signature: String(r.signature),
      doc: (r.doc as string | null) ?? undefined,
    }));
  }

  // ── vector search (brute force, unit vectors → dot = cosine) ──

  /**
   * 질의 벡터와 가장 가까운 leaf 청크 limit개. 행렬은 256MB 이하일 때 메모리에 캐시한다.
   */
  vectorSearch(query: Float32Array, limit: number, filter?: SearchFilter): { chunkRowid: number; score: number }[] {
    const f = filterSql(filter);
    const m = this.loadMatrix();
    if (m && f.sql === '') {
      const n = m.rowids.length;
      const dim = m.dim;
      const scores = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        let s = 0;
        const off = i * dim;
        for (let k = 0; k < dim; k++) s += (m.data[off + k] ?? 0) * (query[k] ?? 0);
        scores[i] = s;
      }
      const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => (scores[b] ?? 0) - (scores[a] ?? 0));
      return order.slice(0, limit).map((i) => ({ chunkRowid: Number(m.rowids[i]), score: scores[i] ?? 0 }));
    }
    const rows = this.db
      .prepare(
        `SELECT v.chunk_rowid AS rowid, v.vec AS vec FROM vectors v JOIN chunks c ON c.rowid = v.chunk_rowid JOIN docs d ON d.doc_id = c.doc_id
         WHERE 1 = 1${f.sql}`,
      )
      .iterate(...f.params) as Iterable<{ rowid: number; vec: Uint8Array }>;
    // 색인이 커도 메모리에는 상위 limit개만 둔다 (점수 내림차순 유지)
    const top: { chunkRowid: number; score: number }[] = [];
    for (const r of rows) {
      const v = blobToVector(r.vec);
      let s = 0;
      for (let k = 0; k < v.length; k++) s += (v[k] ?? 0) * (query[k] ?? 0);
      if (top.length >= limit && s <= (top[top.length - 1]?.score ?? -Infinity)) continue;
      let at = top.length;
      while (at > 0 && (top[at - 1]?.score ?? 0) < s) at--;
      top.splice(at, 0, { chunkRowid: Number(r.rowid), score: s });
      if (top.length > limit) top.pop();
    }
    return top;
  }

  private loadMatrix(): { gen: number; rowids: Float64Array; dim: number; data: Float32Array } | null {
    if (this.matrix && this.matrix.gen === this.generation) return this.matrix;
    if (this.matrixTooLarge) return null;
    const n = (this.db.prepare('SELECT COUNT(*) AS n, COALESCE(MAX(dim), 0) AS d FROM vectors').get() as { n: number; d: number });
    const count = Number(n.n);
    const dim = Number(n.d);
    if (count === 0 || dim === 0) return null;
    if (count * dim * 4 > VECTOR_CACHE_LIMIT_BYTES) {
      this.matrixTooLarge = true;
      return null;
    }
    const rowids = new Float64Array(count);
    const data = new Float32Array(count * dim);
    let i = 0;
    const rows = this.db.prepare('SELECT v.chunk_rowid AS rowid, v.vec AS vec FROM vectors v ORDER BY v.chunk_rowid').iterate() as Iterable<{
      rowid: number;
      vec: Uint8Array;
    }>;
    for (const r of rows) {
      if (i >= count) break;
      const v = blobToVector(r.vec);
      if (v.length !== dim) continue;
      rowids[i] = r.rowid;
      data.set(v, i * dim);
      i++;
    }
    this.matrix = { gen: this.generation, rowids: rowids.subarray(0, i), dim, data: data.subarray(0, i * dim) };
    return this.matrix;
  }

  // ── embedding cache ───────────────────────────────

  getCachedVectors(hashes: string[], modelKey: string): Map<string, Float32Array> {
    const out = new Map<string, Float32Array>();
    for (let i = 0; i < hashes.length; i += SQL_IN_CHUNK) {
      const part = hashes.slice(i, i + SQL_IN_CHUNK);
      const rows = this.db
        .prepare(`SELECT text_hash, vec FROM emb_cache WHERE model_key = ? AND text_hash IN (${part.map(() => '?').join(',')})`)
        .all(modelKey, ...part) as { text_hash: string; vec: Uint8Array }[];
      for (const r of rows) out.set(r.text_hash, blobToVector(r.vec));
    }
    return out;
  }

  putCachedVectors(entries: [string, Float32Array][], modelKey: string): void {
    if (entries.length === 0) return;
    this.transaction(() => {
      const ins = this.db.prepare('INSERT OR REPLACE INTO emb_cache(text_hash, model_key, vec) VALUES (?, ?, ?)');
      for (const [h, v] of entries) ins.run(h, modelKey, toBlob(v));
    });
  }

  /** 다른 색인 파일의 같은 모델 캐시를 가져온다 (전체 재색인용) */
  importEmbeddingCache(otherFile: string, modelKey: string): void {
    if (!existsSync(otherFile)) return;
    this.db.exec('PRAGMA busy_timeout = 5000');
    this.db.prepare('ATTACH DATABASE ? AS old').run(otherFile);
    try {
      this.transaction(() => {
        this.db
          .prepare('INSERT OR IGNORE INTO emb_cache(text_hash, model_key, vec) SELECT text_hash, model_key, vec FROM old.emb_cache WHERE model_key = ?')
          .run(modelKey);
      });
    } finally {
      this.db.exec('DETACH DATABASE old');
    }
  }

  // ── jobs ──────────────────────────────────────────

  saveJob(job: JobRow): void {
    this.db
      .prepare(
        `INSERT INTO jobs (id, kind, state, started_at, updated_at, done, total, error) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET state = excluded.state, updated_at = excluded.updated_at, done = excluded.done,
           total = excluded.total, error = excluded.error`,
      )
      .run(job.id, job.kind, job.state, job.startedAt, job.updatedAt, job.done, job.total, job.error ?? null);
  }

  /** 끝나지 않은 작업 (queued/running) — 앱 재시작 후 이어하기용 */
  unfinishedJobs(): JobRow[] {
    return (this.db.prepare("SELECT * FROM jobs WHERE state IN ('queued', 'running') ORDER BY started_at").all() as Record<string, unknown>[]).map(
      (r) => ({
        id: String(r.id),
        kind: r.kind as JobRow['kind'],
        state: r.state as JobRow['state'],
        startedAt: Number(r.started_at),
        updatedAt: Number(r.updated_at),
        done: Number(r.done),
        total: Number(r.total),
        error: r.error == null ? undefined : String(r.error),
      }),
    );
  }

  /** 파일 크기 (바이트). WAL 포함 여부와 무관하게 본 파일만 본다 */
  fileBytes(): number {
    return existsSync(this.file) ? statSync(this.file).size : 0;
  }
}
