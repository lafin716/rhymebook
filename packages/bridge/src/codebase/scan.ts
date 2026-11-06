import { CODEBASE_LIMITS, type CodebaseTarget, openSafe, splitLines, throwIfAborted, type OpenResult } from './target';
import { listCodebaseFiles } from './listing';

export interface ScanStats {
  scannedFiles: number;
  /** 파일별 시간 예산을 넘긴 파일 수 */
  timedOutFiles: number;
  /** 총 바이트 예산에 걸려 중단했는가 */
  byteBudgetHit: boolean;
}

export interface ScanOptions {
  signal?: AbortSignal;
  /** 채워 주면 스캔 결과를 적는다 */
  stats?: ScanStats;
  maxFiles?: number;
  /** 파일 하나 읽기 상한 (기본 CODEBASE_LIMITS.maxScanFileBytes) */
  maxReadBytes?: number;
  /** 한 번의 스캔에서 읽는 총 바이트 상한 */
  maxTotalBytes?: number;
  pathPrefix?: string;
  /** 시각 (ms). 테스트에서 주입 */
  now?: () => number;
}

export interface ScanFile {
  rel: string;
  lines: string[];
  /** 이 파일의 시간 예산(perFileMs)을 넘었는가 */
  overTime: () => boolean;
}

/**
 * 목록의 텍스트 파일을 하나씩 읽어 visit에 준다. visit이 'stop'을 돌려주면 멈춘다.
 * 파일당 시간·총 바이트 예산을 넘으면 그 파일 또는 전체를 건너뛴다.
 * 반환: 실제로 읽은 파일 수.
 */
export async function scanText(
  target: CodebaseTarget,
  opts: ScanOptions,
  visit: (f: ScanFile) => 'stop' | void,
): Promise<number> {
  const now = opts.now ?? Date.now;
  const files = await listCodebaseFiles(target, {
    signal: opts.signal,
    maxFiles: opts.maxFiles,
    pathPrefix: opts.pathPrefix,
  });
  const maxRead = opts.maxReadBytes ?? CODEBASE_LIMITS.maxScanFileBytes;
  const maxTotal = opts.maxTotalBytes ?? CODEBASE_LIMITS.maxScanBytes;
  let total = 0;
  let scanned = 0;
  for (const rel of files) {
    throwIfAborted(opts.signal);
    if (total >= maxTotal) {
      if (opts.stats) opts.stats.byteBudgetHit = true;
      break;
    }
    const r: OpenResult = await openSafe(target, rel, maxRead);
    if (!r.ok) continue;
    total += r.buf.length;
    scanned++;
    const started = now();
    const overTime = () => now() - started > CODEBASE_LIMITS.perFileMs;
    const lines = splitLines(r.text);
    const r2 = visit({ rel, lines, overTime });
    if (opts.stats && overTime()) opts.stats.timedOutFiles++;
    if (opts.stats) opts.stats.scannedFiles++;
    if (r2 === 'stop') break;
  }
  return scanned;
}
