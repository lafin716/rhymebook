/**
 * 코드베이스 KB 검색·출처 어댑터 (ADR-128). 색인·임베딩 없이 실제 폴더를 실시간으로 훑는다.
 * 결과를 Evidence/SourceView 모양으로 바꿔 문서 검색 결과와 같은 Context Builder로 합친다.
 */
import path from 'node:path';
import type { Evidence, SourceView } from '@branch/core';
import { readCodebaseRange, searchCodebase, type CodebaseTarget } from '../codebase';

export const CODE_CHUNK_PREFIX = 'code:';

/** 코드 청크 id: code:<상대경로>:<시작>-<끝>. 경로에 ':'가 있어도 마지막 ':' 기준으로 나눈다 */
export function codeChunkId(rel: string, lineStart: number, lineEnd: number): string {
  return `${CODE_CHUNK_PREFIX}${rel}:${lineStart}-${lineEnd}`;
}

export function parseCodeChunkId(chunkId: string): { rel: string; lineStart: number; lineEnd: number } | undefined {
  if (!chunkId.startsWith(CODE_CHUNK_PREFIX)) return undefined;
  const body = chunkId.slice(CODE_CHUNK_PREFIX.length);
  const cut = body.lastIndexOf(':');
  if (cut <= 0) return undefined;
  const m = /^(\d+)-(\d+)$/.exec(body.slice(cut + 1));
  if (!m) return undefined;
  return { rel: body.slice(0, cut), lineStart: Number(m[1]), lineEnd: Number(m[2]) };
}

export interface CodebaseSearchInput {
  kbId: string;
  kbName: string;
  root: string;
  excludes: string[];
  query: string;
  limit: number;
  signal?: AbortSignal;
}

/** 코드베이스 KB를 실시간으로 검색해 근거 목록을 돌려준다 (method: agentic) */
export async function searchCodebaseEvidence(input: CodebaseSearchInput): Promise<Evidence[]> {
  const target: CodebaseTarget = { kbId: input.kbId, kbName: input.kbName, root: input.root, excludes: input.excludes };
  const hits = await searchCodebase(target, input.query, { limit: input.limit, signal: input.signal });
  return hits.map((h) => ({
    n: 0,
    kbId: input.kbId,
    kbName: input.kbName,
    chunkId: codeChunkId(h.path, h.lineStart, h.lineEnd),
    docId: `code:${h.path}`,
    path: h.path,
    title: path.posix.basename(h.path),
    kind: 'code',
    headingPath: [],
    lineStart: h.lineStart,
    lineEnd: h.lineEnd,
    symbol: h.symbol,
    text: h.text,
    score: h.score,
    matched: h.matched,
    method: 'agentic',
  }));
}

/** 코드 청크 출처 보기: 해당 줄 범위를 읽는다 (제외·바이너리·대상 밖은 거부) */
export async function codebaseSourceView(
  target: CodebaseTarget,
  chunkId: string,
  signal?: AbortSignal,
): Promise<SourceView | undefined> {
  const parsed = parseCodeChunkId(chunkId);
  if (!parsed) return undefined;
  const range = await readCodebaseRange(target, parsed.rel, {
    startLine: parsed.lineStart,
    endLine: parsed.lineEnd,
    signal,
  });
  return {
    kbId: target.kbId,
    path: range.path,
    title: path.posix.basename(range.path),
    kind: 'code',
    lineStart: range.startLine,
    lineEnd: range.endLine,
    headingPath: [],
    chunkText: range.content,
    sectionText: range.content,
  };
}
