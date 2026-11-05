/**
 * 문맥 기반 질의 재작성. 짧거나 지시어(그럼·그거·it 등)가 든 질문은 세션 문맥의 핵심어를 붙여
 * 검색이 빗나가지 않게 한다. LLM을 쓰지 않는 결정적 규칙이다.
 */
import type { Message, Session } from '../model';
import { tokenize } from './tokenize';
import type { QueryPlan } from './types';

export interface RewriteContext {
  question: string;
  /** 가지의 선택 텍스트 (anchor) */
  anchorText?: string;
  sessionTitle?: string;
  rootTitle?: string;
  /** 부모 가지 제목 (가까운 순) */
  parentTitles: string[];
  summary?: string;
  /** 부모 가지 요약 (가까운 순) */
  parentSummaries: string[];
  /** 최근 사용자 질문 (최신 순) */
  recentUser: string[];
  /** 최근 assistant 응답 (최신 순) */
  recentAssistant: string[];
  kbNames: string[];
}

const RECENT_TURNS = 4;
const DECAY = 0.7;
const MAX_CONTEXT_TERMS = 8;
const SHORT_CHARS = 25;
const SHORT_TOKENS = 6;

/** 지시어 (한국어·영어). 단어 경계로 찾는다 */
const DEICTIC_KO = ['그럼', '그거', '이거', '저거', '그건', '여기서', '거기', '그때', '이때', '걔'];
const DEICTIC_EN = ['it', 'that', 'this', 'they', 'those', 'then'];

const FIELD_WEIGHT = {
  anchorText: 3,
  sessionTitle: 3,
  rootTitle: 2,
  parentTitles: 2,
  summary: 1.5,
  parentSummaries: 1,
  recentUser: 1.5,
  recentAssistant: 1,
} as const;

/** 세션 가지 조상을 따라 RewriteContext를 만든다 */
export function buildRewriteContext(
  sessions: Record<string, Session>,
  messages: Record<string, Message[]>,
  sessionId: string,
  question: string,
  kbNames: string[] = [],
): RewriteContext {
  const current = sessions[sessionId];
  const parentTitles: string[] = [];
  const parentSummaries: string[] = [];
  let rootTitle: string | undefined;
  const anchorText: string | undefined = current?.anchor?.text;

  let p: Session | undefined = current?.parentId ? sessions[current.parentId] : undefined;
  const guard = new Set<string>();
  while (p && !guard.has(p.id)) {
    guard.add(p.id);
    if (p.parentId === null) rootTitle = p.title;
    else parentTitles.push(p.title);
    if (p.summary) parentSummaries.push(p.summary);
    p = p.parentId ? sessions[p.parentId] : undefined;
  }
  const root = current ? sessions[current.rootId] : undefined;
  if (root && root.id !== current?.id) rootTitle = root.title;

  const list = messages[sessionId] ?? [];
  const recentUser: string[] = [];
  const recentAssistant: string[] = [];
  for (let i = list.length - 1; i >= 0 && recentUser.length + recentAssistant.length < RECENT_TURNS * 2; i--) {
    const m = list[i];
    if (!m || m.status === 'error' || !m.content.trim()) continue;
    if (m.role === 'user' && recentUser.length < RECENT_TURNS) recentUser.push(m.content);
    if (m.role === 'assistant' && recentAssistant.length < RECENT_TURNS) recentAssistant.push(m.content);
  }

  return {
    question,
    anchorText,
    sessionTitle: current?.title,
    rootTitle,
    parentTitles,
    summary: current?.summary,
    parentSummaries,
    recentUser,
    recentAssistant,
    kbNames,
  };
}

function isContextual(question: string, keywords: string[]): boolean {
  if (question.trim().length < SHORT_CHARS || keywords.length < SHORT_TOKENS) return true;
  const lower = question.toLowerCase();
  if (DEICTIC_KO.some((d) => lower.includes(d))) return true;
  const words = new Set(tokenize(question));
  return DEICTIC_EN.some((d) => words.has(d));
}

/**
 * 문맥어 후보: 토큰에서 같은 글 안의 더 긴 CJK 어절에 들어 있는 2-gram을 뺀다.
 * (쿠버네티스 하나가 쿠버·버네·네티·티스로 문맥어 자리를 다 차지하지 않게)
 */
function wordsOf(text: string): Set<string> {
  const tokens = new Set(tokenize(text));
  const long = [...tokens].filter((t) => [...t].length > 2 && CJK_WORD.test(t));
  const out = new Set<string>();
  for (const t of tokens) {
    if (!CJK_WORD.test(t)) {
      out.add(t);
      continue;
    }
    if ([...t].length === 2 && long.some((w) => w.includes(t))) continue;
    out.add(stripParticle(t));
  }
  return out;
}

const CJK_WORD = /^[\p{Script=Hangul}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]+$/u;
const PARTICLES = ['에서', '으로', '에게', '에는', '까지', '부터', '처럼', '보다', '은', '는', '이', '가', '을', '를', '의', '에', '도', '와', '과', '로'];

/** 어절 끝 조사를 뗀다 (네트워킹은 → 네트워킹). 남는 말이 두 글자 이상일 때만 */
function stripParticle(word: string): string {
  const chars = [...word];
  for (const p of PARTICLES) {
    const n = [...p].length;
    if (chars.length - n >= 2 && word.endsWith(p)) return chars.slice(0, -n).join('');
  }
  return word;
}

/** 필드별 가중치로 문맥어를 고른다. 최근 대화는 뒤로 갈수록 감쇠한다 */
function contextTermsOf(ctx: RewriteContext, exclude: Set<string>): string[] {
  const score = new Map<string, number>();
  const firstSeen = new Map<string, number>();
  let order = 0;
  const add = (text: string | undefined, weight: number) => {
    if (!text) return;
    for (const t of wordsOf(text)) {
      if (exclude.has(t)) continue;
      score.set(t, (score.get(t) ?? 0) + weight);
      if (!firstSeen.has(t)) firstSeen.set(t, order++);
    }
  };
  const addAll = (texts: string[], weight: number, decay: boolean) =>
    texts.forEach((text, i) => add(text, decay ? weight * DECAY ** i : weight));

  add(ctx.anchorText, FIELD_WEIGHT.anchorText);
  add(ctx.sessionTitle, FIELD_WEIGHT.sessionTitle);
  add(ctx.rootTitle, FIELD_WEIGHT.rootTitle);
  addAll(ctx.parentTitles, FIELD_WEIGHT.parentTitles, false);
  add(ctx.summary, FIELD_WEIGHT.summary);
  addAll(ctx.parentSummaries, FIELD_WEIGHT.parentSummaries, false);
  addAll(ctx.recentUser, FIELD_WEIGHT.recentUser, true);
  addAll(ctx.recentAssistant, FIELD_WEIGHT.recentAssistant, true);

  return [...score.entries()]
    .sort((a, b) => b[1] - a[1] || (firstSeen.get(a[0]) ?? 0) - (firstSeen.get(b[0]) ?? 0))
    .slice(0, MAX_CONTEXT_TERMS)
    .map(([t]) => t);
}

/**
 * 질의 계획. 문맥이 필요 없는 질문이면 rewritten은 질문 그대로이고,
 * 필요하면 `질문 (문맥어1, 문맥어2, ...)` 형태로 만든다.
 */
export function rewriteQuery(ctx: RewriteContext): QueryPlan {
  const keywords = [...new Set(tokenize(ctx.question))];
  const contextual = isContextual(ctx.question, keywords);
  const contextTerms = contextTermsOf(ctx, new Set(keywords));
  const useTerms = contextual ? contextTerms : [];
  const rewritten = useTerms.length > 0
    ? `${ctx.question} (${useTerms.slice(0, 5).join(', ')})`
    : ctx.question;

  return {
    original: ctx.question,
    rewritten,
    keywords,
    contextTerms,
    vectorText: rewritten,
    // 문맥어(어절)는 색인과 같은 방식으로 다시 쪼개 FTS에 넣는다 (네트워킹은 → 네트·트워·워킹…)
    keywordQuery: [...new Set([...keywords, ...useTerms.flatMap((t) => [t, ...tokenize(t)])])],
    contextual,
  };
}
