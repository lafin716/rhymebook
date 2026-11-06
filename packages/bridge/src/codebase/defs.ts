import { scanText, type ScanOptions } from './scan';
import { CODEBASE_LIMITS, type CodebaseTarget, throwIfAborted } from './target';

export interface DefinitionHit {
  path: string;
  line: number;
  text: string;
  /** 선언 종류 (함수·클래스·변수·메서드 등) */
  kind: string;
}

const MODS = '(?:(?:export|default|public|private|protected|static|async|pub|abstract|declare|unsafe|final)\\s+)*';

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 언어에 상관없는 선언 패턴. 여러 언어의 흔한 키워드를 모은 근사치다 (정확한 파서가 아님).
 * ci=true면 대소문자 무시 (검색용), false면 정확히 (정의 찾기용).
 */
export function definitionPatterns(symbol: string, ci: boolean): { re: RegExp; kind: string }[] {
  const s = escapeRe(symbol);
  const name = `${s}(?![\\w$])`;
  const flags = ci ? 'i' : '';
  return [
    { kind: 'function', re: new RegExp(`^\\s*${MODS}(?:function|def|fn|func|fun|sub|proc)\\s+\\*?\\s*${name}`, flags) },
    { kind: 'class', re: new RegExp(`^\\s*${MODS}(?:class|interface|struct|trait|enum|object|protocol|record|module|namespace|impl)\\s+${name}`, flags) },
    { kind: 'type', re: new RegExp(`^\\s*${MODS}type\\s+${name}\\s*(?:=|<|\\{)`, flags) },
    { kind: 'variable', re: new RegExp(`^\\s*${MODS}(?:const|let|var|val)\\s+${name}\\s*(?::[^=]+)?=`, flags) },
    { kind: 'method', re: new RegExp(`^\\s*${MODS}(?:async\\s+)?${name}\\s*(?:<[^>]*>)?\\s*\\([^)]*\\)\\s*(?::[^{;]+)?\\{`, flags) },
    { kind: 'method', re: new RegExp(`^\\s*func\\s+\\([^)]*\\)\\s*${name}\\s*\\(`, flags) },
    { kind: 'assignment', re: new RegExp(`^\\s*(?:export\\s+)?${name}\\s*[:=]\\s*(?:async\\s*)?(?:function\\b|\\([^)]*\\)\\s*=>|[A-Za-z_$][\\w$]*\\s*=>)`, flags) },
  ];
}

/** 정의가 있는 줄 찾기. 소스 파일 기준, 파일당 시간 예산을 넘으면 그 파일의 남은 줄은 건너뛴다 */
export async function findDefinitions(
  target: CodebaseTarget,
  symbol: string,
  opts: ScanOptions & { limit?: number; ci?: boolean } = {},
): Promise<DefinitionHit[]> {
  const pats = definitionPatterns(symbol, opts.ci ?? false);
  const limit = opts.limit ?? 20;
  const needle = opts.ci ? symbol.toLowerCase() : symbol;
  const out: DefinitionHit[] = [];
  await scanText(target, opts, (f) => {
    throwIfAborted(opts.signal);
    for (let i = 0; i < f.lines.length; i++) {
      if (f.overTime()) break;
      const full = f.lines[i]!;
      const probe = full.slice(0, CODEBASE_LIMITS.regexLineMaxChars);
      const cand = opts.ci ? probe.toLowerCase() : probe;
      if (!cand.includes(needle)) continue;
      const hit = pats.find((p) => p.re.test(probe));
      if (hit) {
        out.push({ path: f.rel, line: i + 1, text: full.slice(0, 300), kind: hit.kind });
        if (out.length >= limit) return 'stop';
      }
    }
    return undefined;
  });
  return out;
}
