import type { SearchChannel } from '@branch/core';
import { definitionPatterns } from './defs';
import { identifierTerms, splitTerms } from './terms';
import { scanText, type ScanOptions } from './scan';
import { CODEBASE_LIMITS, type CodebaseTarget, throwIfAborted } from './target';

export interface CodebaseSearchOptions extends ScanOptions {
  /** 결과 수 (기본 8) */
  limit?: number;
}

export interface CodebaseSearchResult {
  path: string;
  /** 1부터, 포함 */
  lineStart: number;
  lineEnd: number;
  text: string;
  score: number;
  matched: SearchChannel[];
  /** 정의 줄이 걸렸을 때 그 이름 */
  symbol?: string;
}

interface Span {
  start: number;
  end: number;
}

const POOL_MAX = 300;
const POOL_KEEP = 150;

/**
 * 질의로 실제 파일을 훑어 발췌 창을 돌려준다 (색인·임베딩 없음).
 * 점수: 경로에 용어 +2, 줄에 든 용어 종류 +1.5, 정의 줄 +3. 상위 창을 limit개.
 */
export async function searchCodebase(
  target: CodebaseTarget,
  query: string,
  opts: CodebaseSearchOptions = {},
): Promise<CodebaseSearchResult[]> {
  const terms = splitTerms(query);
  if (terms.length === 0) return [];
  const idents = identifierTerms(query);
  const defPats = idents.map((id) => ({ id, pats: definitionPatterns(id, true) }));
  const limit = opts.limit ?? 8;
  const pool: (CodebaseSearchResult & { _rank: number })[] = [];

  await scanText(target, opts, (f) => {
    throwIfAborted(opts.signal);
    const lower = f.lines.map((l) => l.slice(0, CODEBASE_LIMITS.regexLineMaxChars).toLowerCase());
    const pathLow = f.rel.toLowerCase();
    const pathTerms = terms.filter((t) => pathLow.includes(t));

    const lineTerms = new Map<number, string[]>();
    const defLines = new Map<number, string>();
    for (let i = 0; i < lower.length; i++) {
      if (f.overTime()) break;
      const hit = terms.filter((t) => lower[i]!.includes(t));
      if (hit.length) lineTerms.set(i, hit);
      if (defPats.length) {
        const probe = f.lines[i]!.slice(0, CODEBASE_LIMITS.regexLineMaxChars);
        for (const d of defPats) {
          if (!lower[i]!.includes(d.id.toLowerCase())) continue;
          if (d.pats.some((p) => p.re.test(probe))) {
            defLines.set(i, d.id);
            break;
          }
        }
      }
    }
    if (lineTerms.size === 0 && defLines.size === 0 && pathTerms.length === 0) return undefined;

    // 앵커: 정의 줄 우선, 그다음 용어가 많이 든 줄
    const anchors = [...defLines.keys(), ...[...lineTerms.keys()].sort((a, b) => lineTerms.get(b)!.length - lineTerms.get(a)!.length || a - b)];
    const uniq: number[] = [];
    for (const a of anchors) if (!uniq.includes(a) && uniq.length < 4) uniq.push(a);
    const wins: Span[] = [];
    for (const a of uniq) {
      const start = Math.max(0, a - 3);
      const end = Math.min(f.lines.length - 1, start + CODEBASE_LIMITS.windowLines - 1);
      wins.push({ start, end });
    }
    wins.sort((x, y) => x.start - y.start);
    const merged: Span[] = [];
    for (const w of wins) {
      const last = merged[merged.length - 1];
      if (last && w.start <= last.end + 1) last.end = Math.max(last.end, w.end);
      else merged.push({ ...w });
    }

    for (const w of merged) {
      let defCount = 0;
      let grepHit = false;
      let defSym: string | undefined;
      const seen = new Set<string>();
      for (let i = w.start; i <= w.end; i++) {
        const ts = lineTerms.get(i);
        if (ts) {
          grepHit = true;
          for (const t of ts) seen.add(t);
        }
        const d = defLines.get(i);
        if (d) {
          defCount++;
          defSym ??= d;
        }
      }
      const termCount = seen.size;
      const rank = pathTerms.length * 2 + termCount * 1.5 + defCount * 3;
      if (rank <= 0) continue;
      const matched: SearchChannel[] = [];
      if (pathTerms.length) matched.push('path');
      if (grepHit) matched.push('grep');
      if (defCount) matched.push('definition');
      const text = f.lines.slice(w.start, w.end + 1).join('\n').slice(0, CODEBASE_LIMITS.evidenceMaxChars);
      pool.push({
        path: f.rel,
        lineStart: w.start + 1,
        lineEnd: w.end + 1,
        text,
        score: Math.round(rank * 100) / 100,
        matched,
        ...(defSym ? { symbol: defSym } : {}),
        _rank: rank,
      });
    }
    if (pool.length > POOL_MAX) {
      pool.sort((a, b) => b._rank - a._rank || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
      pool.length = POOL_KEEP;
    }
    return undefined;
  });

  pool.sort((a, b) => b._rank - a._rank || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0) || a.lineStart - b.lineStart);
  return pool.slice(0, limit).map(({ _rank: _r, ...r }) => r);
}
