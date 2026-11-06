const STOP = new Set([
  'the', 'and', 'for', 'with', 'what', 'how', 'where', 'when', 'why', 'which', 'is', 'are', 'was', 'a', 'an', 'of',
  'to', 'in', 'on', 'at', 'this', 'that', 'it', 'by', 'from', 'or', 'be', 'do', 'does', 'can', 'please', 'show',
  'code', 'file', 'files', 'find', 'use', 'used', 'using',
]);

/** 한글 조사 (긴 것부터). 어간이 2글자 이상 남을 때만 뗀다 */
const KO_PARTICLES = ['에서는', '에서', '으로는', '으로', '에게', '까지', '부터', '에는', '이랑', '처럼', '은', '는', '이', '가', '을', '를', '의', '에', '로', '와', '과', '도', '만'];

const HANGUL = /[가-힣]/;

/** 질의 토큰의 조사 떼기 */
export function stemKo(tok: string): string {
  if (!HANGUL.test(tok) || tok.length < 3) return tok;
  for (const p of KO_PARTICLES) {
    if (tok.endsWith(p) && tok.length - p.length >= 2) return tok.slice(0, -p.length);
  }
  return tok;
}

/**
 * 검색 용어. 글자·숫자·_·$ 단위로 자르고, camel/snake 조각을 더하며, 소문자로 통일한다.
 * 2글자 미만과 흔한 불용어는 뺀다. 최대 12개.
 */
export function splitTerms(query: string, max = 12): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (t: string) => {
    if (t.length < 2 || STOP.has(t) || seen.has(t)) return;
    seen.add(t);
    out.push(t);
  };
  for (const raw of query.split(/[^\p{L}\p{N}_$]+/u)) {
    if (!raw) continue;
    const stemmed = stemKo(raw);
    add(stemmed.toLowerCase());
    const parts = stemmed.replace(/([a-z\d])([A-Z])/g, '$1 $2').split(/[_$\s]+/);
    if (parts.length > 1) for (const p of parts) add(p.toLowerCase());
  }
  return out.slice(0, max);
}

/** 식별자처럼 생긴 원문 토큰 (정의 찾기용) */
export function identifierTerms(query: string, max = 6): string[] {
  const out: string[] = [];
  for (const t of query.split(/[^A-Za-z0-9_$]+/)) {
    if (t.length >= 3 && /^[A-Za-z_$][\w$]*$/.test(t) && !out.includes(t)) out.push(t);
    if (out.length >= max) break;
  }
  return out;
}
