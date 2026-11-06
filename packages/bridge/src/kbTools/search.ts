import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { KB_TOOL_LIMITS, type KbSearchItem } from '@branch/core';
import { resolveInside } from './files';

/** 검색 한도: 키워드 스캔이 이 범위를 넘지 않게 한다 */
export const SEARCH_LIMITS = {
  maxFiles: 5000,
  maxFileBytes: 1024 * 1024,
  maxTotalBytes: 64 * 1024 * 1024,
  deadlineMs: 4000,
  maxTerms: 12,
  contextLines: 3,
} as const;

export interface SearchKb {
  kbId: string;
  kbName: string;
  filesRoot: string;
}

/** 질의를 검색어로 쪼갠다. 짧은 토큰은 버린다 */
export function queryTerms(query: string): string[] {
  const terms = new Set<string>();
  for (const t of query.toLowerCase().split(/[^\p{L}\p{N}_$]+/u)) {
    if (t.length >= 2) terms.add(t);
    if (terms.size >= SEARCH_LIMITS.maxTerms) break;
  }
  return [...terms];
}

async function* walkFiles(dir: string, rel: string): AsyncGenerator<{ abs: string; rel: string }> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const e of entries) {
    if (e.name.startsWith('.') || e.isSymbolicLink()) continue;
    const abs = path.join(dir, e.name);
    const childRel = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) yield* walkFiles(abs, childRel);
    else if (e.isFile()) yield { abs, rel: childRel };
  }
}

/**
 * 키워드 기반 검색. 색인을 열지 않고 files/를 직접 훑는다 (읽기 전용, 쓰기 없음).
 * 파일마다 일치한 검색어 수로 점수를 매기고, 가장 먼저 일치한 줄 주변을 발췌한다.
 */
export async function keywordSearch(
  kbs: SearchKb[],
  query: string,
  opts: { limit: number; pathPrefix?: string; now?: () => number },
): Promise<{ results: KbSearchItem[]; skipped: { kbId: string; reason: string }[] }> {
  const terms = queryTerms(query);
  const now = opts.now ?? Date.now;
  const deadline = now() + SEARCH_LIMITS.deadlineMs;
  const results: KbSearchItem[] = [];
  const skipped: { kbId: string; reason: string }[] = [];
  if (!terms.length) return { results, skipped };
  let files = 0;
  let bytes = 0;
  for (const kb of kbs) {
    // pathPrefix가 심볼릭 링크로 KB 밖을 가리키지 못하게 realpath 포함 검사를 거친다 (readText와 같은 규칙)
    const target = await resolveInside(kb.filesRoot, opts.pathPrefix ?? '').catch(() => undefined);
    if (!target?.isDir) {
      skipped.push({ kbId: kb.kbId, reason: 'no indexed files' });
      continue;
    }
    const start = target.abs;
    for await (const f of walkFiles(start, opts.pathPrefix ?? '')) {
      if (now() > deadline || files >= SEARCH_LIMITS.maxFiles || bytes >= SEARCH_LIMITS.maxTotalBytes) break;
      const fst = await stat(f.abs).catch(() => undefined);
      if (!fst || fst.size > SEARCH_LIMITS.maxFileBytes) continue;
      files++;
      bytes += fst.size;
      const buf = await readFile(f.abs).catch(() => undefined);
      if (!buf || buf.includes(0)) continue;
      const lines = buf.toString('utf8').split('\n');
      const lower = lines.map((l) => l.toLowerCase());
      const matched = new Set<string>();
      let firstHit = -1;
      lower.forEach((l, i) => {
        for (const t of terms) {
          if (l.includes(t)) {
            matched.add(t);
            if (firstHit < 0) firstHit = i;
          }
        }
      });
      if (!matched.size) continue;
      const from = Math.max(0, firstHit - SEARCH_LIMITS.contextLines);
      const to = Math.min(lines.length - 1, firstHit + SEARCH_LIMITS.contextLines);
      const snippet = lines
        .slice(from, to + 1)
        .map((l) => l.replace(/\r$/, ''))
        .join('\n')
        .slice(0, KB_TOOL_LIMITS.searchSnippetChars);
      results.push({
        kbId: kb.kbId,
        kbName: kb.kbName,
        path: f.rel,
        title: path.posix.basename(f.rel),
        startLine: from + 1,
        endLine: to + 1,
        score: matched.size / terms.length,
        snippet,
      });
    }
  }
  results.sort((a, b) => b.score - a.score || (a.kbId < b.kbId ? -1 : a.kbId > b.kbId ? 1 : 0) || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return { results: results.slice(0, opts.limit), skipped };
}
