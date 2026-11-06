/**
 * LLM 질의 확장 (ADR-119). 한국어·일본어·중국어 질문은 영어로 쓰인 소스 코드와 키워드·심볼 검색이 맞지 않는다.
 * 세션 모델에 "코드에서 찾을 영어 식별자·키워드"를 짧게 물어 질의 계획에 덧붙인다.
 * 순수 함수만 둔다 (호출·시간 제한은 store).
 */
import { t } from '../i18n';
import type { StreamRequest } from '../provider';
import { tokenize } from './tokenize';
import type { QueryPlan } from './types';

/** 확장어 최대 개수 */
export const EXPAND_MAX_TERMS = 16;

/** 확장 응답 대기 상한. 넘으면 확장 없이 검색한다 (답변 시작이 늦어지지 않게 짧게) */
export const EXPAND_TIMEOUT_MS = 8_000;

/** 리랭커 핵심어(가중치 1)로 쓸 확장 토큰 수. 나머지는 문맥어(낮은 가중치)로 — 적합도 분모가 커져 근거가 걸러지지 않게 */
export const EXPAND_KEYWORDS = 6;

/** 거의 모든 코드 청크에 나오는 말: FTS·리랭커에서 뺀다 */
const CODE_STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'from', 'this', 'that', 'code', 'source', 'file', 'func', 'function', 'return',
  'err', 'error', 'nil', 'null', 'true', 'false', 'var', 'let', 'const', 'type', 'struct', 'class', 'interface',
  'import', 'package', 'pkg', 'src', 'lib', 'test', 'tests', 'main', 'new', 'get', 'set', 'string', 'int',
]);

const CJK_RE = /[\p{Script=Hangul}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;
/** 식별자·경로 조각: 영문자로 시작, 영숫자와 _ . - / : 만 (2~64자) */
const TERM_RE = /^[A-Za-z_][A-Za-z0-9_./:-]{1,63}$/;

/** 확장이 필요한 질문인가: 한글·한자·가나가 들어 있으면 (영어 질문은 그대로도 코드와 맞는다) */
export function needsExpansion(question: string): boolean {
  return CJK_RE.test(question);
}

/** 확장 요청. 도구·지식베이스·웹 없이 짧게 답하게 한다 */
export function buildExpandRequest(plan: QueryPlan): StreamRequest {
  const question = plan.rewritten.trim() || plan.original.trim();
  return {
    purpose: 'search',
    system: t('rag.expand.system', { max: EXPAND_MAX_TERMS }),
    messages: [{ role: 'user', content: question }],
  };
}

/** 응답에서 확장어를 뽑는다: 줄·쉼표로 나누고 목록 기호·따옴표·백틱을 벗긴 뒤 형식이 맞는 것만, 대소문자 무시 중복 제거 */
export function parseExpandTerms(raw: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const piece of raw.split(/[\n,;]+/)) {
    const term = piece
      .trim()
      .replace(/^(?:[-*•]|\d+[.)])\s*/, '')
      .replace(/^[`'"]+|[`'"]+$/g, '')
      .replace(/\(\)$/, '')
      .trim();
    if (!TERM_RE.test(term)) continue;
    const key = term.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(term);
    if (out.length >= EXPAND_MAX_TERMS) break;
  }
  return out;
}

/**
 * 확장어를 질의 계획에 합친다.
 * - rewritten·vectorText 끝에 덧붙인다 (심볼 검색은 rewritten에서 식별자를 뽑는다).
 * - 확장어 토큰(3자 이상, 흔한 코드 낱말 제외)을 keywordQuery에 모두, keywords에는 앞 EXPAND_KEYWORDS개만 더하고 나머지는 문맥어로.
 * - 원래 CJK 핵심어는 문맥어로 옮긴다: 영어 코드 청크의 적합도가 한국어 2-gram 때문에 묽어지지 않게. FTS 질의에는 남긴다.
 */
export function expandPlan(plan: QueryPlan, terms: readonly string[]): QueryPlan {
  if (terms.length === 0) return plan;
  const extra = [...new Set(terms.flatMap((term) => tokenize(term)))].filter((tok) => tok.length >= 3 && !CODE_STOPWORDS.has(tok));
  if (extra.length === 0) return plan;
  const known = new Set(plan.keywords);
  const fresh = extra.filter((tok) => !known.has(tok));
  const cjkAll = plan.keywords.filter((k) => CJK_RE.test(k));
  // 문맥어 묶음은 어절의 2-gram까지 함께 맞춰 보므로, 다른 어절에 들어 있는 조각(2-gram)은 따로 옮기지 않는다 (분모가 커지지 않게)
  const cjk = cjkAll.filter((k) => !cjkAll.some((o) => o !== k && o.length > k.length && o.includes(k)));
  const latin = plan.keywords.filter((k) => !CJK_RE.test(k));
  const suffix = terms.join(' ');
  return {
    ...plan,
    rewritten: `${plan.rewritten} ${suffix}`,
    vectorText: `${plan.vectorText} ${suffix}`,
    keywords: [...new Set([...latin, ...fresh.slice(0, EXPAND_KEYWORDS)])],
    contextTerms: [...new Set([...plan.contextTerms, ...cjk, ...fresh.slice(EXPAND_KEYWORDS)])],
    keywordQuery: [...new Set([...plan.keywordQuery, ...extra])],
  };
}
