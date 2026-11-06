import { KbToolError, isSafeRegexSource } from '@branch/core';
import { scanText, type ScanOptions } from './scan';
import { CODEBASE_LIMITS, type CodebaseTarget, throwIfAborted } from './target';

export interface GrepHit {
  path: string;
  line: number;
  text: string;
}

export interface GrepOptions extends ScanOptions {
  /** true면 정규식 (안전성 검사 통과분만), false면 리터럴 (대소문자 무시) */
  regex?: boolean;
  limit?: number;
}

/**
 * 파일 내용 grep. 색인 없이 실제 파일을 한 번 훑는다.
 * 파일당 최대 maxHitsPerFile 줄, 전체 limit 줄에서 멈춘다.
 */
export async function grep(target: CodebaseTarget, pattern: string, opts: GrepOptions = {}): Promise<GrepHit[]> {
  const limit = opts.limit ?? 30;
  let test: (line: string) => boolean;
  if (opts.regex) {
    if (!isSafeRegexSource(pattern)) throw new KbToolError('bad_input', 'unsafe or invalid regex');
    let re: RegExp;
    try {
      re = new RegExp(pattern, 'i');
    } catch {
      throw new KbToolError('bad_input', 'invalid regex');
    }
    test = (line) => re.test(line);
  } else {
    const needle = pattern.toLowerCase();
    if (!needle) throw new KbToolError('bad_input', 'empty pattern');
    test = (line) => line.toLowerCase().includes(needle);
  }
  // 정규식은 더 짧은 줄 상한을 쓴다 (한 번의 실행을 끊을 수 없으므로 최악 비용을 줄인다)
  const lineCap = opts.regex ? CODEBASE_LIMITS.userRegexLineMaxChars : CODEBASE_LIMITS.lineTestMaxChars;
  const out: GrepHit[] = [];
  const started = Date.now();
  await scanText(target, opts, (f) => {
    throwIfAborted(opts.signal);
    if (Date.now() - started > CODEBASE_LIMITS.grepTotalMs) return 'stop';
    let perFile = 0;
    for (let i = 0; i < f.lines.length; i++) {
      // 파일 시간 예산(perFileMs)은 줄 사이에서만 확인한다. 한 번의 정규식 실행은 중간에 끊을 수 없다
      if (f.overTime()) break;
      const full = f.lines[i]!;
      // 리터럴·정규식 공통 검사 상한. 줄 앞부분만 본다 (ReDoS 피해 상한)
      if (!test(full.slice(0, lineCap))) continue;
      out.push({ path: f.rel, line: i + 1, text: full.slice(0, 300) });
      perFile++;
      if (out.length >= limit) return 'stop';
      if (perFile >= CODEBASE_LIMITS.maxHitsPerFile) break;
    }
    return undefined;
  });
  return out;
}
