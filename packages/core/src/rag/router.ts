/**
 * Knowledge Router (ADR-131). 세션에 연결된 KB를 유형별로 나누고 질문 의도에 따라 검색 예산을 나눈다.
 * - 코드베이스만 → agentic(실시간 탐색), 문서만 → hybrid(Vector+BM25)
 * - 둘 다 → 두 엔진을 **항상 모두** 검색한다. 의도는 예산(가중치)만 바꾼다 — 모호한 질문에서 한쪽을 버리지 않는다.
 * 미분류 KB는 문서형으로 다룬다 (searchPolicyOf와 같은 규칙).
 */
import type { KnowledgeKind } from '../knowledge';
import { searchPolicyOf } from '../knowledgePolicy';
import type { QueryIntent } from './types';

export interface RoutableKb {
  id: string;
  kind?: KnowledgeKind;
}

export interface KnowledgeRoute {
  /** 코드베이스: 실시간 탐색만 (벡터·색인 금지) */
  agentic: string[];
  /** 문서·미분류: 하이브리드 */
  hybrid: string[];
  intent: QueryIntent;
  /** 근거 예산 비율 (합 1). 한쪽 유형만 있으면 그쪽이 1 */
  weights: { agentic: number; hybrid: number };
}

/** 코드 신호: 식별자 꼴(camelCase·snake_case·Foo.bar·foo()), 파일 경로·확장자, 코드 낱말 */
const CODE_PATTERNS: RegExp[] = [
  /\b[a-z]+[A-Z][A-Za-z0-9]*\b/, // camelCase
  /\b[A-Z][a-z0-9]+[A-Z][A-Za-z0-9]*\b/, // PascalCase (두 단어 이상)
  /\b[a-z0-9]+_[a-z0-9_]+\b/, // snake_case
  /\b\w+\(\)/, // foo()
  /\b[\w-]+\.(ts|tsx|js|jsx|py|go|rs|java|kt|c|cc|cpp|h|hpp|cs|rb|php|swift|vue|svelte|sh|sql|ya?ml|toml|json)\b/i,
  /(^|\s)[\w.-]+\/[\w./-]+/, // a/b/c 경로
  /`[^`]+`/, // 백틱 식별자
  /(함수|메서드|메소드|클래스|인터페이스|구조체|모듈|패키지|소스|코드|구현|호출|정의|변수|타입|리팩터|빌드|컴파일|테스트 코드|어디(에|서) (정의|구현|호출))/,
  /\b(function|method|class|interface|struct|module|package|implement(ation|ed)?|source code|codebase|call(s|ed)?|defin(e|ed|ition)|variable|refactor|compile|stack ?trace|exception)\b/i,
];

/** 문서 신호: 문서·페이지·정책·개념 설명 낱말 */
const DOC_PATTERNS: RegExp[] = [
  /(문서|자료|페이지|쪽|장|절|논문|보고서|매뉴얼|설명서|가이드|교재|책|규정|정책|약관|요약|개념|정의란|의미|배경|역사|원리|이론)/,
  /\b(document|docs?|pdf|page|chapter|section|paper|report|manual|guide|book|policy|summary|concept|overview|theory|meaning)\b/i,
  /\bp\.\s?\d+/i,
];

function score(q: string, pats: RegExp[]): number {
  let n = 0;
  for (const re of pats) if (re.test(q)) n++;
  return n;
}

/** 질문 의도 추정: 한쪽 신호가 뚜렷할 때만 code/document, 그 밖은 both */
export function queryIntentOf(question: string): QueryIntent {
  const c = score(question, CODE_PATTERNS);
  const d = score(question, DOC_PATTERNS);
  if (c > 0 && c >= d + 1) return 'code';
  if (d > 0 && d >= c + 1) return 'document';
  return 'both';
}

/** 의도별 예산. 한쪽으로 기울어도 다른 쪽을 0으로 만들지 않는다 (최소 0.3) */
const INTENT_WEIGHTS: Record<QueryIntent, { agentic: number; hybrid: number }> = {
  code: { agentic: 0.7, hybrid: 0.3 },
  document: { agentic: 0.3, hybrid: 0.7 },
  both: { agentic: 0.5, hybrid: 0.5 },
};

export function routeKnowledge(kbs: readonly RoutableKb[], question: string): KnowledgeRoute {
  const agentic: string[] = [];
  const hybrid: string[] = [];
  const seen = new Set<string>();
  for (const kb of kbs) {
    if (seen.has(kb.id)) continue;
    seen.add(kb.id);
    if (searchPolicyOf(kb.kind).method === 'agentic') agentic.push(kb.id);
    else hybrid.push(kb.id);
  }
  const intent = queryIntentOf(question);
  let weights = INTENT_WEIGHTS[intent];
  if (!agentic.length) weights = { agentic: 0, hybrid: hybrid.length ? 1 : 0 };
  else if (!hybrid.length) weights = { agentic: 1, hybrid: 0 };
  return { agentic, hybrid, intent, weights };
}

/**
 * 예산(최대 근거 수)을 가중치대로 나눈다. 해당 유형이 있으면 최소 1개.
 * 두 유형이 모두 있으면 예산이 1이어도 각 1개씩(합 2) — 한 엔진을 버리지 않는다.
 */
export function splitBudget(total: number, route: KnowledgeRoute): { agentic: number; hybrid: number } {
  const t = Math.max(1, Math.floor(total));
  if (!route.agentic.length) return { agentic: 0, hybrid: route.hybrid.length ? t : 0 };
  if (!route.hybrid.length) return { agentic: t, hybrid: 0 };
  if (t <= 2) return { agentic: 1, hybrid: 1 };
  const a = Math.min(t - 1, Math.max(1, Math.round(t * route.weights.agentic)));
  return { agentic: a, hybrid: t - a };
}
