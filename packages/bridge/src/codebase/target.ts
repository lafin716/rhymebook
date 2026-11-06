import { lstat, open, realpath } from 'node:fs/promises';
import path from 'node:path';
import {
  BINARY_EXTS,
  compileExcludes,
  DEFAULT_CODEBASE_EXCLUDES,
  extOf,
  KB_TOOL_LIMITS,
  normalizeKbPath,
  type ExcludeMatcher,
  type KbDirEntry,
} from '@branch/core';

/**
 * 코드베이스 탐색 대상. root는 원본 폴더의 realpath (연결 폴더 또는 files/).
 * 이 모듈의 함수는 임베딩·벡터·색인을 쓰지 않는다 (ADR-128).
 */
export interface CodebaseTarget {
  kbId: string;
  kbName: string;
  /** 원본 폴더 (realpath). 이 아래만 읽는다 */
  root: string;
  /** 사용자 제외 패턴 (cleanExcludes 결과) */
  excludes: string[];
}

export const CODEBASE_LIMITS = {
  /** 목록에 올리는 파일 수 상한 */
  maxFiles: 20_000,
  /** 내용을 읽는 파일 크기 상한 (검색·grep·정의) */
  maxScanFileBytes: 1024 * 1024,
  /** 한 번의 검색에서 내용을 읽는 총 바이트 상한 */
  maxScanBytes: 64 * 1024 * 1024,
  /** 일치 줄 주변 발췌 (앞뒤 줄) */
  windowLines: 12,
  /** 경로만 맞은 파일을 보여줄 때 앞쪽 줄 수 */
  headLines: 25,
  /** 한 파일에서 모을 일치 줄 상한 */
  maxHitsPerFile: 40,
  /** 검색 결과 한 조각의 문자 상한 */
  evidenceMaxChars: 2_000,
  /** 검색 후보 파일 상한 (창을 만드는 대상) */
  maxCandidates: 30,
  /** 범위 읽기: 한 번에 줄 수 · 문자 수 · 파일 크기 */
  rangeMaxLines: 400,
  rangeMaxChars: 40_000,
  rangeMaxFileBytes: KB_TOOL_LIMITS.readMaxFileBytes,
  /** git ls-files 제한 시간·출력 상한 */
  gitTimeoutMs: 15_000,
  gitMaxBuffer: 256 * 1024 * 1024,
  /** 정규식 한 파일 검사 시간 상한 (넘으면 그 파일은 남은 줄을 건너뜀) */
  perFileMs: 200,
  /** 검색어 검사(리터럴·정규식 공통)에 쓰는 줄 길이 상한. 넘는 부분은 보지 않는다 */
  lineTestMaxChars: 4_000,
  /** 정규식 검사에 쓰는 줄 길이 상한 (검색 점수용) */
  regexLineMaxChars: 1_000,
  /** 사용자(에이전트) 정규식 grep의 줄 길이 상한. 한 번의 실행은 끊을 수 없어 최악 비용(다항식 역추적)을 줄인다 */
  userRegexLineMaxChars: 300,
  /** grep 전체 시간 상한. 넘으면 그때까지 찾은 결과만 돌려준다 */
  grepTotalMs: 5_000,
  /** 안내 문서 힌트를 읽는 크기 상한 */
  guideMaxBytes: 64 * 1024,
} as const;

export class CodebaseAbortError extends Error {
  constructor() {
    super('codebase search aborted');
    this.name = 'AbortError';
  }
}

export function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new CodebaseAbortError();
}

/** 경로 정규화 (core 규칙과 같음). 잘못된 경로면 undefined */
export function relPathOf(p: string | undefined): string | undefined {
  if (p === undefined || p === '') return '';
  try {
    return normalizeKbPath(p);
  } catch {
    return undefined;
  }
}

/** 파일이 건너뛸 대상인가: 제외 패턴(조상 폴더 포함), 점으로 시작하는 폴더, 민감 env 파일, 바이너리 확장자 */
export function isSkippedRel(rel: string, matcher: ExcludeMatcher): boolean {
  const segs = rel.split('/');
  for (let i = 0; i < segs.length - 1; i++) {
    if (segs[i]!.startsWith('.')) return true;
    if (matcher(segs.slice(0, i + 1).join('/'), true)) return true;
  }
  const name = segs[segs.length - 1] ?? '';
  if (name.startsWith('.env')) return true;
  if (BINARY_EXTS.has(extOf(name))) return true;
  return matcher(rel, false);
}

/** 대상의 제외 판정 함수 (기본 제외 + 사용자 제외 + 추가 패턴) */
export function matcherFor(target: CodebaseTarget, extra: readonly string[] = []): ExcludeMatcher {
  return compileExcludes([...DEFAULT_CODEBASE_EXCLUDES, ...extra, ...target.excludes]);
}

/** KB 항목 제외 여부 (폴더 목록·개요 필터용). 폴더면 dir=true */
export function isExcludedEntry(rel: string, dir: boolean, matcher: ExcludeMatcher): boolean {
  if (!dir) return isSkippedRel(rel, matcher);
  const segs = rel.split('/');
  for (let i = 0; i < segs.length; i++) {
    if (segs[i]!.startsWith('.')) return true;
    if (matcher(segs.slice(0, i + 1).join('/'), true)) return true;
  }
  return false;
}

/** 목록 필터 빌더 (listDir의 filter 인자로 쓴다) */
export function entryFilterFor(target: CodebaseTarget): (rel: string, dir: boolean) => boolean {
  const m = matcherFor(target);
  return (rel, dir) => !isExcludedEntry(rel, dir, m);
}

export type OpenResult =
  | { ok: true; text: string; buf: Buffer }
  | { ok: false; reason: 'not_found' | 'bad_path' | 'too_large' | 'binary_file' };

/**
 * 안전하게 연다: 상대 경로 → 심볼릭 링크 아님(lstat) → realpath가 root 안 → 크기 → 바이너리 아님.
 * 링크는 따라가지 않는다 (lstat은 링크 자체를 본다).
 */
export async function openSafe(target: CodebaseTarget, rel: string, maxBytes: number): Promise<OpenResult> {
  if (!rel) return { ok: false, reason: 'bad_path' };
  const rootReal = await realpath(target.root).catch(() => undefined);
  if (!rootReal) return { ok: false, reason: 'not_found' };
  const abs = path.join(rootReal, ...rel.split('/'));
  const st = await lstat(abs).catch(() => undefined);
  if (!st) return { ok: false, reason: 'not_found' };
  if (st.isSymbolicLink()) return { ok: false, reason: 'bad_path' };
  if (!st.isFile()) return { ok: false, reason: 'not_found' };
  if (st.size > maxBytes) return { ok: false, reason: 'too_large' };
  const real = await realpath(abs).catch(() => undefined);
  if (!real || !real.startsWith(rootReal + path.sep)) return { ok: false, reason: 'bad_path' };
  const fh = await open(real, 'r').catch(() => undefined);
  if (!fh) return { ok: false, reason: 'not_found' };
  let buf: Buffer;
  try {
    buf = Buffer.alloc(st.size);
    const { bytesRead } = await fh.read(buf, 0, st.size, 0);
    buf = buf.subarray(0, bytesRead);
  } finally {
    await fh.close();
  }
  if (buf.includes(0)) return { ok: false, reason: 'binary_file' };
  return { ok: true, buf, text: buf.toString('utf8') };
}

/** 텍스트를 줄 배열로 (CRLF 제거, 마지막 빈 줄 제거) */
export function splitLines(text: string): string[] {
  const lines = text.split('\n').map((l) => (l.endsWith('\r') ? l.slice(0, -1) : l));
  if (lines.length && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

export function dirEntryOf(rel: string, dir: boolean): KbDirEntry {
  return { name: rel.slice(rel.lastIndexOf('/') + 1), path: rel, type: dir ? 'directory' : 'file' };
}
