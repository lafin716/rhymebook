import { normalizeText } from './tokenize';
import type { Evidence, EvidenceAssessment, QueryPlan } from './types';

/**
 * 근거 충분성 판단 (ADR-122). 상대 정규화 점수 하나가 아니라 다음 신호를 함께 본다.
 * - 강한 용어(영문 식별자·파일명·경로·약어)가 근거의 경로·제목·심볼·본문에 실제로 있는가
 * - 질문 핵심어가 근거에 얼마나 덮이는가
 * - 정확한 제목·파일명·심볼 일치(path/symbol 채널)
 * - 서로 다른 문서 수 (비교 질문)
 * 결과가 부족하면 store가 질의 확장(LLM)·재검색을 한다. 충분하면 LLM 호출 없이 끝난다.
 */

/** 영문 식별자·파일명·경로·약어 (2자 이상) */
const STRONG_RE = /[A-Za-z_][A-Za-z0-9_]*(?:[./:-][A-Za-z0-9_]+)*/g;
const COMPARE_RE = /(비교|차이|vs\.?|versus|compare|difference|각각|둘 다|모두)/i;
const STRONG_STOP = new Set(['the', 'and', 'for', 'what', 'how', 'why', 'is', 'are', 'of', 'in', 'to', 'a', 'an', 'vs']);

/** 질문의 강한 용어 (소문자) */
export function strongTermsOf(question: string): string[] {
  const out = new Set<string>();
  for (const m of question.matchAll(STRONG_RE)) {
    const t = m[0].toLowerCase();
    if (t.length < 2 || STRONG_STOP.has(t)) continue;
    out.add(t);
  }
  return [...out];
}

/** 비교·여러 문서 질문인가 */
export function isComparative(question: string): boolean {
  return COMPARE_RE.test(question);
}

function haystackOf(e: Evidence): string {
  return normalizeText([e.path, e.title, e.symbol ?? '', e.headingPath.join(' '), e.text].join('\n')).toLowerCase();
}

export function assessEvidence(plan: QueryPlan, evidence: readonly Evidence[]): EvidenceAssessment {
  const reasons: string[] = [];
  if (!evidence.length) return { sufficient: false, reasons: ['no_evidence'], confidence: 0 };

  const hay = evidence.map(haystackOf);
  const all = hay.join('\n');
  const strong = strongTermsOf(plan.original);
  const strongHit = strong.filter((t) => all.includes(t));
  const keywords = plan.keywords.map((k) => k.toLowerCase()).filter((k) => k.length >= 2);
  const kwHit = keywords.filter((k) => all.includes(k));
  const kwCover = keywords.length ? kwHit.length / keywords.length : 1;
  const exact = evidence.some((e) => e.matched?.includes('path') || e.matched?.includes('symbol'));
  const docs = new Set(evidence.map((e) => `${e.kbId}:${e.docId}`)).size;
  const top = evidence[0]!;
  // 상위 근거 하나가 핵심어를 절반 이상 덮는가 (흩어진 우연 일치 방지)
  const topHay = hay[0]!;
  const topCover = keywords.length ? keywords.filter((k) => topHay.includes(k)).length / keywords.length : 1;

  let confidence = 0;
  if (strong.length) {
    const r = strongHit.length / strong.length;
    confidence += 0.4 * r;
    reasons.push(r === 1 ? 'strong_terms_all' : r > 0 ? 'strong_terms_some' : 'strong_terms_none');
  } else confidence += 0.15;
  confidence += 0.3 * kwCover;
  reasons.push(kwCover >= 0.6 ? 'keywords_covered' : 'keywords_sparse');
  confidence += 0.15 * topCover;
  if (exact) {
    confidence += 0.15;
    reasons.push('exact_match');
  }
  if (top.score >= 0.5) confidence += 0.05;

  const comparative = isComparative(plan.original);
  if (comparative) {
    if (docs < 2) {
      confidence -= 0.2;
      reasons.push('single_doc_for_comparison');
    } else reasons.push('multi_doc');
  }
  confidence = Math.max(0, Math.min(1, confidence));

  // 강한 용어가 있는데 하나도 근거에 없으면 부족 (영문 코드 용어가 확실한 신호)
  const missingStrong = strong.length > 0 && strongHit.length === 0;
  const sufficient = !missingStrong && confidence >= 0.5 && !(comparative && docs < 2);
  return { sufficient, reasons, confidence: Math.round(confidence * 100) / 100 };
}
