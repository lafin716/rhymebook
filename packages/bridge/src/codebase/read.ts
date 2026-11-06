import { KB_TOOL_LIMITS, KbToolError } from '@branch/core';
import { CODEBASE_LIMITS, type CodebaseTarget, isSkippedRel, matcherFor, openSafe, splitLines, throwIfAborted } from './target';

export interface CodebaseRange {
  path: string;
  startLine: number;
  endLine: number;
  totalLines: number;
  content: string;
  truncated: boolean;
}

export interface ReadRangeOptions {
  /** 1부터 시작 (기본 1) */
  startLine?: number;
  /** 포함 (기본: 시작 + rangeMaxLines - 1) */
  endLine?: number;
  signal?: AbortSignal;
}

const ERR_FOR: Record<string, 'bad_path' | 'not_found' | 'too_large' | 'binary_file'> = {
  bad_path: 'bad_path',
  not_found: 'not_found',
  too_large: 'too_large',
  binary_file: 'binary_file',
};

/**
 * 코드베이스 파일의 줄 범위 읽기. 제외 대상(.env·바이너리·숨김)·심볼릭 링크·대상 밖은 거부한다.
 * 한 번에 rangeMaxLines 줄, rangeMaxChars 문자까지만 돌려준다 (truncated).
 */
export async function readCodebaseRange(target: CodebaseTarget, rel: string, opts: ReadRangeOptions = {}): Promise<CodebaseRange> {
  throwIfAborted(opts.signal);
  if (!rel) throw new KbToolError('not_a_file', 'path is a directory');
  if (isSkippedRel(rel, matcherFor(target))) throw new KbToolError('bad_path', 'excluded path');
  const r = await openSafe(target, rel, KB_TOOL_LIMITS.readMaxFileBytes);
  if (!r.ok) throw new KbToolError(ERR_FOR[r.reason] ?? 'not_found', `cannot read: ${rel}`);
  const lines = splitLines(r.text);
  const total = lines.length;
  const start = Math.max(1, opts.startLine ?? 1);
  let end = Math.min(total, opts.endLine ?? start + CODEBASE_LIMITS.rangeMaxLines - 1);
  end = Math.min(end, start + CODEBASE_LIMITS.rangeMaxLines - 1);
  if (start > total) {
    return { path: rel, startLine: start, endLine: start - 1, totalLines: total, content: '', truncated: false };
  }
  let content = '';
  let lastLine = start - 1;
  for (let i = start; i <= end; i++) {
    const piece = (i > start ? '\n' : '') + lines[i - 1]!;
    if (content.length + piece.length > CODEBASE_LIMITS.rangeMaxChars) {
      break;
    }
    content += piece;
    lastLine = i;
  }
  // 첫 줄 하나가 글자 한도를 넘으면 그 줄의 앞부분만 돌려준다 (빈 내용 금지)
  if (lastLine < start && end >= start) {
    return {
      path: rel,
      startLine: start,
      endLine: start,
      totalLines: total,
      content: lines[start - 1]!.slice(0, CODEBASE_LIMITS.rangeMaxChars),
      truncated: true,
    };
  }
  // 요청 범위 밖이든 글자 한도 때문이든, 파일에 돌려주지 않은 줄이 남았으면 잘림
  return { path: rel, startLine: start, endLine: lastLine, totalLines: total, content, truncated: lastLine < total };
}

/** 파일 전체 줄 (개요용). 읽기 규칙은 readCodebaseRange와 같다 */
export async function readCodebaseLines(target: CodebaseTarget, rel: string, signal?: AbortSignal): Promise<string[]> {
  throwIfAborted(signal);
  if (!rel) throw new KbToolError('not_a_file', 'path is a directory');
  if (isSkippedRel(rel, matcherFor(target))) throw new KbToolError('bad_path', 'excluded path');
  const r = await openSafe(target, rel, KB_TOOL_LIMITS.readMaxFileBytes);
  if (!r.ok) throw new KbToolError(ERR_FOR[r.reason] ?? 'not_found', `cannot read: ${rel}`);
  return splitLines(r.text);
}
