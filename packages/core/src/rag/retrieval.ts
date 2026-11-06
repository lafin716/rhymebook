/**
 * 검색 결과 융합·재정렬·근거 선택. 색인 조회(FTS·벡터)는 bridge 몫이고, 여기서는 순수 계산만 한다.
 */
import { tokenize } from './tokenize';
import type { Chunk, DocKind, Evidence, QueryPlan, Reranker, RagSettings, SearchChannel, SearchHit } from './types';

/** 같은 문서에서 근거로 넣을 최대 청크 수 (한 문서가 근거를 독점하지 않도록) */
export const MAX_EVIDENCE_PER_DOC = 3;
/** 동적 상한의 하한: 강한 후보가 적어도 이만큼은 근거로 본다 */
export const MIN_DYNAMIC_TOP_K = 2;
/** 검색 채널 목록 (근거의 matched·디버그용). 순위가 있는 채널만 담는다 */
export function channelsOf(h: SearchHit): SearchChannel[] {
  const out: SearchChannel[] = [];
  if (h.keywordRank !== undefined) out.push('keyword');
  if (h.vectorRank !== undefined) out.push('vector');
  if (h.symbolRank !== undefined) out.push('symbol');
  if (h.pathRank !== undefined) out.push('path');
  if (h.folderMatch) out.push('folder');
  return out;
}

/** 최종 근거 하나 이하로 남기는 최소 남은 글자 수: 이보다 적으면 더 넣지 않는다 */
const MIN_BUDGET_CHARS = 200;

export interface RrfOptions {
  /** RRF 상수 (기본 60) */
  k?: number;
  /** 목록별 가중치 (기본 전부 1) */
  weights?: number[];
}

function hitKey(h: { kbId: string; chunkId: string }): string {
  return `${h.kbId}\u0000${h.chunkId}`;
}

/**
 * Reciprocal Rank Fusion: score = Σ weight / (k + rank), rank는 1부터.
 * 같은 청크가 여러 목록에 있으면 점수를 더하고 순위 필드(vectorRank·keywordRank)를 합친다.
 */
export function rrfFuse(lists: SearchHit[][], opts: number | RrfOptions = 60): SearchHit[] {
  const k = typeof opts === 'number' ? opts : (opts.k ?? 60);
  const weights = typeof opts === 'number' ? undefined : opts.weights;
  const acc = new Map<string, SearchHit>();

  lists.forEach((list, li) => {
    const w = weights?.[li] ?? 1;
    list.forEach((hit, idx) => {
      const add = w / (k + idx + 1);
      const key = hitKey(hit);
      const prev = acc.get(key);
      if (prev) {
        prev.score += add;
        if (prev.vectorRank === undefined) prev.vectorRank = hit.vectorRank;
        if (prev.keywordRank === undefined) prev.keywordRank = hit.keywordRank;
      } else {
        acc.set(key, { ...hit, score: add });
      }
    });
  });

  return [...acc.values()].sort((a, b) => b.score - a.score || (a.chunkId < b.chunkId ? -1 : a.chunkId > b.chunkId ? 1 : 0));
}

/**
 * 어휘 리랭커: 질의어(핵심어 1, 문맥어는 낮은 가중치)가 본문에 있는지, 제목·제목 경로에 있는지,
 * 핵심어 두 개가 가까이(10토큰 이내) 있는지로 0~1 점수를 준다.
 */
export const lexicalReranker: Reranker = {
  id: 'lexical',
  rerank(plan, items) {
    // 질의어 묶음: 핵심어는 토큰 하나, 문맥어(어절)는 그 하위 토큰 중 하나라도 있으면 맞은 것으로 본다
    const groups: { tokens: string[]; w: number }[] = [];
    const seen = new Set<string>();
    for (const t of plan.keywords) {
      if (seen.has(t)) continue;
      seen.add(t);
      groups.push({ tokens: [t], w: 1 });
    }
    const ctxWeight = plan.contextual ? 0.5 : 0.25;
    for (const t of plan.contextTerms) {
      if (seen.has(t)) continue;
      seen.add(t);
      groups.push({ tokens: [...new Set([t, ...tokenize(t)])], w: ctxWeight });
    }
    let total = 0;
    for (const g of groups) total += g.w;
    const keywordSet = new Set(plan.keywords);

    return items.map((item) => {
      if (total === 0) return { hit: item.hit, score: 0 };
      const bodyTokens = tokenize(item.text);
      const body = new Set(bodyTokens);
      const head = new Set(tokenize(`${item.title} ${item.headingPath.join(' ')}`));

      let got = 0;
      for (const g of groups) {
        if (g.tokens.some((t) => body.has(t))) got += g.w;
        if (g.tokens.some((t) => head.has(t))) got += 0.5 * g.w;
      }

      // 근접: 핵심어 서로 다른 두 개가 10토큰 안에 함께 나오면 보너스
      let proximity = 0;
      const positions: { idx: number; term: string }[] = [];
      bodyTokens.forEach((t, idx) => { if (keywordSet.has(t)) positions.push({ idx, term: t }); });
      for (let i = 0; i < positions.length && proximity === 0; i++) {
        const seen = new Set<string>();
        const first = positions[i];
        if (!first) break;
        for (const p of positions.slice(i)) {
          if (p.idx - first.idx > 10) break;
          seen.add(p.term);
        }
        if (seen.size >= 2) proximity = 0.1;
      }

      return { hit: item.hit, score: Math.min(1, got / total + proximity) };
    });
  },
};

/** selectEvidence 입력 한 건: 검색 후보 + 청크 + (있으면) 부모 섹션 + 문서 정보 */
export interface CandidateChunk {
  hit: SearchHit;
  chunk: Chunk;
  parent?: Chunk;
  doc: { path: string; title: string; kind: DocKind; url?: string };
  kbName: string;
}

/**
 * 최종 근거 선택.
 * 점수 = 0.5 × 상대 점수(RRF 최고점 대비) + 0.5 × 커버리지(리랭커; 없으면 상대 점수).
 * 순서: 점수순 → minScore 미만 제외 → 같은 내용(hash)·포함 관계 중복 제거 → 문서당 상한 →
 * 부모 섹션 확장(같은 부모는 한 번만) → 글자 예산(maxContextChars) 안에서 topK개.
 */
export function selectEvidence(
  plan: QueryPlan,
  cands: CandidateChunk[],
  settings: RagSettings,
  reranker?: Reranker,
): Evidence[] {
  if (cands.length === 0) return [];
  const scorer = settings.rerank ? (reranker ?? lexicalReranker) : undefined;

  const coverage = new Map<string, number>();
  if (scorer) {
    const scored = scorer.rerank(
      plan,
      cands.map((c) => ({ hit: c.hit, text: c.chunk.text, headingPath: c.chunk.headingPath, title: c.doc.title })),
    );
    for (const s of scored) coverage.set(hitKey(s.hit), s.score);
  }

  const maxRaw = Math.max(...cands.map((c) => c.hit.score), Number.EPSILON);
  const ranked = cands
    .map((c) => {
      const rel = c.hit.score / maxRaw;
      const cov = scorer ? (coverage.get(hitKey(c.hit)) ?? 0) : rel;
      return { c, score: 0.5 * rel + 0.5 * cov, cov };
    })
    // 본문 근거(키워드·심볼)가 없는 후보는 리랭커 커버리지가 있을 때만 남긴다.
    // 경로·폴더 가산 신호만 있는 후보는 RRF 점수가 1까지 오를 수 있지만 청크 본문은 질의와 무관할 수 있다 (ADR-121)
    .filter((r) => {
      const ch = channelsOf(r.c.hit);
      if (ch.includes('keyword') || ch.includes('symbol')) return true;
      if (scorer) return r.cov > 0;
      return ch.length === 0 || ch.includes('vector');
    })
    .sort((a, b) => b.score - a.score);

  // 동적 상한: 최고점의 60% 이상인 강한 후보 수만큼(최소 MIN_DYNAMIC_TOP_K, 최대 topK)만 근거로 쓴다 (ADR-121)
  const top = ranked[0]?.score ?? 0;
  const strong = ranked.filter((r) => r.score >= top * 0.6 && r.score >= settings.minScore).length;
  const limit = Math.min(settings.topK, Math.max(MIN_DYNAMIC_TOP_K, strong));

  const out: Evidence[] = [];
  // docId·parentId·hash는 KB마다 따로 본다: 같은 경로(d_ + sha256(path))·같은 내용이 두 KB에 있을 수 있다
  const seenHash = new Set<string>();
  const perDoc = new Map<string, number>();
  const usedParents = new Set<string>();
  let budget = settings.maxContextChars;

  for (const { c, score } of ranked) {
    if (out.length >= limit) break;
    if (score < settings.minScore) break;
    const kbScope = c.hit.kbId + '\u0000';
    const docKey = kbScope + c.chunk.docId;
    const parentKey = c.parent ? kbScope + c.parent.id : '';
    if (seenHash.has(kbScope + c.chunk.hash)) continue;
    if ((perDoc.get(docKey) ?? 0) >= MAX_EVIDENCE_PER_DOC) continue;
    if (out.some((e) => e.kbId === c.hit.kbId && e.text.includes(c.chunk.text))) continue;

    let text = c.chunk.text;
    let parentUsed = false;
    if (settings.expandParent && c.parent && !usedParents.has(parentKey) && c.parent.text.length <= budget) {
      text = c.parent.text;
      parentUsed = true;
    }
    if (text.length > budget) text = c.chunk.text;
    if (text.length > budget) {
      if (budget < MIN_BUDGET_CHARS) break;
      text = text.slice(0, budget);
    }

    if (parentUsed) usedParents.add(parentKey);
    seenHash.add(kbScope + c.chunk.hash);
    perDoc.set(docKey, (perDoc.get(docKey) ?? 0) + 1);
    budget -= text.length;

    out.push({
      n: out.length + 1,
      kbId: c.hit.kbId,
      kbName: c.kbName,
      chunkId: c.chunk.id,
      docId: c.chunk.docId,
      path: c.doc.path,
      title: c.doc.title,
      kind: c.doc.kind,
      headingPath: c.chunk.headingPath,
      url: c.doc.url,
      page: c.chunk.page,
      lineStart: c.chunk.lineStart,
      lineEnd: c.chunk.lineEnd,
      symbol: c.chunk.symbol,
      text,
      score: Math.round(score * 1000) / 1000,
      matched: channelsOf(c.hit),
    });
  }
  return out;
}
