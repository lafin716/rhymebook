/**
 * 파일 스캔 → 파싱 → 청킹 → 임베딩 → 저장. 문서 단위로 트랜잭션을 나눠 중단·재개에 강하게 한다.
 */
import { createHash } from 'node:crypto';
import type { Dirent } from 'node:fs';
import { lstat, readdir, readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { setImmediate as yieldTick } from 'node:timers/promises';
import {
  chunkDocument,
  docKindOf,
  embeddingKey,
  EmbeddingError,
  isIndexablePath,
  parseDocument,
  tokenize,
  type Chunk,
  type DocKind,
  type EmbeddingProvider,
} from '@branch/core';
import { t } from '@branch/core';
import { REGEX_CHUNKER_ID, type CodeParser, type CodeSymbol } from './codeParser';
import type { ChunkInsert, DocRow, IndexRepository, SymbolInsert } from './sqliteRepository';

export const LIMITS = {
  maxFileBytes: 20 * 1024 * 1024,
} as const;

/** 디스크 공간·용량 한도 등 작업을 중단해야 하는 실패 */
export class IndexFatalError extends Error {
  constructor(
    readonly code: 'disk_full' | 'embed_failed' | 'key_missing',
    message: string,
  ) {
    super(message);
    this.name = 'IndexFatalError';
  }
}

export interface IngestProgress {
  phase: 'scan' | 'parse' | 'embed' | 'write';
  done: number;
  total: number;
  current?: string;
}

export interface IngestOptions {
  kbId: string;
  /** <root>/<kbId>/files */
  filesDir: string;
  repo: IndexRepository;
  provider: EmbeddingProvider;
  mode: 'incremental' | 'full';
  /** PDF 페이지 텍스트 추출기 (없으면 PDF는 건너뛴다) */
  pdfExtract?: (bytes: Uint8Array) => Promise<string[]>;
  /** 코드 파일 AST 청커 (ADR-115). 없거나 실패하면 정규식 파서를 쓴다 */
  codeParser?: CodeParser;
  signal?: AbortSignal;
  onProgress?: (p: IngestProgress) => void;
  /** 임베딩 재시도 간격 기본 500ms (테스트에서 0) */
  retryDelayMs?: number;
  /** 임베딩 재시도 횟수 기본 3 */
  maxRetries?: number;
  now?: () => number;
  /**
   * 부분 재색인 범위 (files/ 기준 상대 경로). 주어지면 incremental에서 이 목록의 파일만 검사하고 나머지는 그대로 둔다.
   * full 모드에서는 무시한다.
   */
  onlyPaths?: ReadonlySet<string>;
}

export interface IngestResult {
  scanned: number;
  /** 스캔된 원본 파일 크기 합 */
  sourceBytes: number;
  indexed: number;
  unchanged: number;
  failed: number;
  skipped: number;
  pruned: number;
  chunks: number;
  embedCalls: number;
  cacheHits: number;
}

export function docIdOf(rel: string): string {
  return `d_${createHash('sha256').update(rel).digest('hex').slice(0, 20)}`;
}

export function sha256Bytes(data: Uint8Array | string): string {
  return createHash('sha256').update(data).digest('hex');
}

export function textHashOf(text: string): string {
  return sha256Bytes(text).slice(0, 32);
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    const err = new Error('aborted');
    err.name = 'AbortError';
    throw err;
  }
}

interface ScannedFile {
  rel: string;
  abs: string;
  size: number;
  mtime: number;
  ctime: number;
}

/** files/ 아래 색인 대상 파일 수집. 바깥을 가리키는 심볼릭 링크는 건너뛴다 */
export async function scanFiles(filesDir: string): Promise<{ files: ScannedFile[]; skippedLinks: number }> {
  const files: ScannedFile[] = [];
  let skippedLinks = 0;
  const rootReal = await realpath(filesDir).catch(() => null);
  if (!rootReal) return { files, skippedLinks };

  const walk = async (dir: string): Promise<void> => {
    let entries: Dirent[];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      const abs = path.join(dir, e.name);
      const rel = path.relative(filesDir, abs).split(path.sep).join('/');
      const st = await lstat(abs).catch(() => null);
      if (!st) continue;
      if (st.isSymbolicLink()) {
        const target = await realpath(abs).catch(() => null);
        if (!target || !(target === rootReal || target.startsWith(rootReal + path.sep))) {
          skippedLinks++;
          continue;
        }
      }
      const real = st.isSymbolicLink() ? await stat(abs).catch(() => null) : st;
      if (!real) continue;
      if (real.isDirectory()) {
        await walk(abs);
      } else if (real.isFile()) {
        if (!isIndexablePath(rel)) continue;
        files.push({ rel, abs, size: real.size, mtime: Math.floor(real.mtimeMs), ctime: Math.floor(real.ctimeMs) });
      }
    }
  };
  await walk(filesDir);
  return { files, skippedLinks };
}

function skippedDoc(rel: string, size: number, error: string, now: number): DocRow {
  return {
    docId: docIdOf(rel),
    path: rel,
    title: path.posix.basename(rel),
    kind: docKindOf(rel) ?? 'text',
    bytes: size,
    mtime: 0,
    contentHash: '',
    chunkCount: 0,
    status: 'skipped',
    error,
    indexedAt: now,
  };
}

async function embedWithRetry(
  provider: EmbeddingProvider,
  texts: string[],
  opts: { signal?: AbortSignal; retryDelayMs: number; maxRetries: number },
): Promise<Float32Array[]> {
  let attempt = 0;
  for (;;) {
    throwIfAborted(opts.signal);
    try {
      return await provider.embed(texts, opts.signal);
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') throw err;
      const retryable = err instanceof EmbeddingError && err.retryable;
      if (!retryable || attempt >= opts.maxRetries) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new IndexFatalError('embed_failed', t('bridge.knowledge.index.embedFailed', { message: msg }));
      }
      attempt++;
      await new Promise((r) => setTimeout(r, opts.retryDelayMs * 2 ** (attempt - 1)));
    }
  }
}

/** 청크 목록의 leaf 임베딩을 캐시 우선으로 채운다 */
async function embedLeaves(
  repo: IndexRepository,
  provider: EmbeddingProvider,
  leaves: Chunk[],
  opts: { signal?: AbortSignal; retryDelayMs: number; maxRetries: number },
): Promise<{ vecs: Map<string, Float32Array>; calls: number; hits: number }> {
  // 벡터 없음('none'): 캐시도 호출도 하지 않는다
  if (provider.info.provider === 'none') return { vecs: new Map(), calls: 0, hits: 0 };
  const modelKey = embeddingKey(provider.info);
  const hashes = [...new Set(leaves.map((c) => textHashOf(c.embedText)))];
  const cached = repo.getCachedVectors(hashes, modelKey);
  const vecs = new Map<string, Float32Array>();
  let calls = 0;
  let hits = 0;
  const missing: { h: string; text: string }[] = [];
  const seen = new Set<string>();
  for (const c of leaves) {
    const h = textHashOf(c.embedText);
    const hit = cached.get(h);
    if (hit) {
      vecs.set(h, hit);
      hits++;
    } else if (!seen.has(h)) {
      seen.add(h);
      missing.push({ h, text: c.embedText });
    }
  }
  const batch = Math.max(1, provider.batchSize);
  const fresh: [string, Float32Array][] = [];
  for (let i = 0; i < missing.length; i += batch) {
    const part = missing.slice(i, i + batch);
    const out = await embedWithRetry(provider, part.map((p) => p.text), opts);
    calls++;
    if (out.length !== part.length) {
      throw new IndexFatalError('embed_failed', t('bridge.knowledge.index.embedFailed', { message: 'length mismatch' }));
    }
    part.forEach((p, j) => {
      const v = out[j];
      if (!v) return;
      vecs.set(p.h, v);
      fresh.push([p.h, v]);
    });
    await yieldTick();
  }
  repo.putCachedVectors(fresh, modelKey);
  return { vecs, calls, hits };
}

/** 한 파일을 색인 행으로 바꾼다 (파싱·청킹만, 임베딩 전) */
function toInserts(docId: string, chunks: Chunk[], vecs: Map<string, Float32Array> | null): ChunkInsert[] {
  return chunks.map((c) => {
    const leaf = c.level === 'leaf';
    const vec = leaf && vecs ? vecs.get(textHashOf(c.embedText)) : undefined;
    return {
      chunkId: c.id,
      docId,
      parentId: c.parentId,
      level: c.level,
      ordinal: c.ordinal,
      headingPath: c.headingPath,
      text: c.text,
      tokens: leaf ? tokenize(c.embedText).join(' ') : '',
      page: c.page,
      lineStart: c.lineStart,
      lineEnd: c.lineEnd,
      symbol: c.symbol,
      hash: c.hash,
      vec,
    };
  });
}

/** 메타 키: 코드 문서를 만든 청커 id. 바뀌면 코드 문서를 다시 청킹한다 */
export const CHUNKER_META_KEY = 'chunker';

/** 각 심볼을 시작 줄을 담은 가장 작은 leaf에 잇는다. 담는 leaf가 없으면 뺀다 */
export function mapSymbols(symbols: CodeSymbol[], chunks: Chunk[]): SymbolInsert[] {
  const leaves = chunks.filter((c) => c.level === 'leaf' && c.lineStart !== undefined && c.lineEnd !== undefined);
  const out: SymbolInsert[] = [];
  for (const s of symbols) {
    let best: Chunk | undefined;
    for (const c of leaves) {
      if (c.lineStart! <= s.lineStart && s.lineStart <= c.lineEnd!) {
        if (!best || c.lineEnd! - c.lineStart! < best.lineEnd! - best.lineStart!) best = c;
      }
    }
    if (best) out.push({ ...s, chunkId: best.id });
  }
  return out;
}

/**
 * 파일 목록과 저장소를 맞춘다. incremental은 바뀐 파일만, full은 전부 다시 만든다.
 * 실패·취소 시 이미 끝난 문서는 저장돼 있어 다음 실행에서 이어진다.
 */
export async function ingestKnowledge(opts: IngestOptions): Promise<IngestResult> {
  const now = opts.now ?? (() => Date.now());
  const retryDelayMs = opts.retryDelayMs ?? 500;
  const maxRetries = opts.maxRetries ?? 3;
  const { repo, provider } = opts;
  const result: IngestResult = {
    scanned: 0,
    sourceBytes: 0,
    indexed: 0,
    unchanged: 0,
    failed: 0,
    skipped: 0,
    pruned: 0,
    chunks: 0,
    embedCalls: 0,
    cacheHits: 0,
  };

  opts.onProgress?.({ phase: 'scan', done: 0, total: 0 });
  const { files } = await scanFiles(opts.filesDir);
  result.scanned = files.length;
  result.sourceBytes = files.reduce((s, f) => s + f.size, 0);
  throwIfAborted(opts.signal);

  // 목록에 없는 문서 정리 (건너뛴 문서 기록은 유지)
  const keep = new Set(files.map((f) => f.rel));
  result.pruned = repo.pruneDocs(keep).length;

  const existingLive = new Map(repo.listDocs().map((d) => [d.path, d]));
  repo.setModel(provider.info);
  // 청커가 바뀌면(정규식 → AST 등) 코드 문서는 내용이 같아도 다시 청킹한다. 임베딩은 캐시로 대부분 재사용된다
  const chunker = opts.codeParser ? await opts.codeParser.chunkerId() : REGEX_CHUNKER_ID;
  const rechunkCode = (repo.getMeta(CHUNKER_META_KEY) ?? REGEX_CHUNKER_ID) !== chunker;

  for (let i = 0; i < files.length; i++) {
    throwIfAborted(opts.signal);
    const f = files[i];
    if (!f) continue;
    if (opts.mode === 'incremental' && opts.onlyPaths && !opts.onlyPaths.has(f.rel)) {
      result.unchanged++;
      continue;
    }
    opts.onProgress?.({ phase: 'parse', done: i, total: files.length, current: f.rel });
    const prev = existingLive.get(f.rel);
    const docId = docIdOf(f.rel);

    if (f.size > LIMITS.maxFileBytes) {
      const row = skippedDoc(f.rel, f.size, t('bridge.knowledge.index.fileTooLarge'), now());
      repo.replaceDocument(row, []);
      result.skipped++;
      continue;
    }

    const kind: DocKind = docKindOf(f.rel) ?? 'text';
    const forced = rechunkCode && kind === 'code';
    if (opts.mode === 'incremental' && !forced && prev && prev.status === 'ok' && prev.mtime === f.mtime && prev.ctime === f.ctime && prev.bytes === f.size) {
      result.unchanged++;
      continue;
    }

    const bytes = new Uint8Array(await readFile(f.abs));
    const contentHash = sha256Bytes(bytes);
    if (opts.mode === 'incremental' && !forced && prev && prev.status === 'ok' && prev.contentHash === contentHash) {
      repo.touchDoc(docId, f.mtime, f.size, f.ctime);
      result.unchanged++;
      continue;
    }

    let chunks: Chunk[] = [];
    let symbols: SymbolInsert[] = [];
    let title = path.posix.basename(f.rel);
    let docError: string | undefined;
    let codeSymbols: CodeSymbol[] | undefined;
    try {
      let parsed: ReturnType<typeof parseDocument>;
      if (kind === 'pdf') {
        if (!opts.pdfExtract) throw new Error(t('bridge.knowledge.index.pdfUnavailable'));
        const pages = await opts.pdfExtract(bytes);
        parsed = parseDocument({ path: f.rel, pages });
      } else {
        const text = new TextDecoder('utf-8').decode(bytes);
        parsed = parseDocument({ path: f.rel, text });
        if (kind === 'code' && opts.codeParser) {
          const ast = await opts.codeParser.parse(f.rel, text);
          if (ast) {
            const base = parsed;
            parsed = { ...base, blocks: ast.blocks.map((b) => ({ ...b, lang: base.lang })) };
            codeSymbols = ast.symbols;
          }
        }
      }
      title = parsed.title || title;
      chunks = chunkDocument(parsed, docId);
      if (codeSymbols) symbols = mapSymbols(codeSymbols, chunks);
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') throw err;
      docError = err instanceof Error ? err.message : String(err);
    }

    const row: DocRow = {
      docId,
      path: f.rel,
      title,
      kind,
      bytes: f.size,
      mtime: f.mtime,
      ctime: f.ctime,
      contentHash,
      chunkCount: chunks.length,
      status: docError ? 'error' : 'ok',
      error: docError,
      indexedAt: now(),
    };

    if (docError) {
      repo.replaceDocument(row, []);
      result.failed++;
      continue;
    }

    const leaves = chunks.filter((c) => c.level === 'leaf');

    const emb = await embedLeaves(repo, provider, leaves, { signal: opts.signal, retryDelayMs, maxRetries });
    result.embedCalls += emb.calls;
    result.cacheHits += emb.hits;
    opts.onProgress?.({ phase: 'write', done: i + 1, total: files.length, current: f.rel });
    repo.replaceDocument(row, toInserts(docId, chunks, emb.vecs), symbols);
    result.indexed++;
    result.chunks += chunks.length;
    await yieldTick();
  }
  // 끝까지 돈 실행만 청커 id를 남긴다 (중간 취소면 다음 실행이 남은 코드 문서를 이어서 다시 청킹)
  repo.setMeta(CHUNKER_META_KEY, chunker);
  opts.onProgress?.({ phase: 'write', done: files.length, total: files.length });
  return result;
}
