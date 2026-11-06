/**
 * 검색 근거를 시스템 프롬프트 블록으로 만들고, 응답에 남길 출처(Citation)를 만든다.
 * 문서 본문은 신뢰하지 않는 데이터이므로 < > & 를 이스케이프해 태그를 흉내 낼 수 없게 한다.
 */
import { t } from '../i18n';
import type { Citation, Evidence, QueryPlan } from './types';

export const SNIPPET_MAX_CHARS = 280;

function escapeText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttr(s: string): string {
  return escapeText(s).replace(/"/g, '&quot;');
}

function locationOf(e: Evidence): string {
  const parts: string[] = [];
  if (e.page !== undefined) parts.push(`p.${e.page}`);
  if (e.lineStart !== undefined) parts.push(e.lineEnd !== undefined && e.lineEnd !== e.lineStart ? `L${e.lineStart}-${e.lineEnd}` : `L${e.lineStart}`);
  if (e.symbol) parts.push(e.symbol);
  return parts.join(' ');
}

/**
 * 시스템 프롬프트에 붙일 RAG 블록. 근거가 없으면 빈 근거 안내만 넣는다.
 */
export function buildRagSystem(evidence: Evidence[], plan: QueryPlan): string {
  const lines: string[] = [t('rag.system.intro'), t('rag.system.untrusted')];
  if (plan.rewritten) lines.push(t('rag.system.query', { query: escapeText(plan.rewritten) }));
  if (evidence.length === 0) {
    lines.push(t('rag.system.empty'));
    return lines.join('\n');
  }

  lines.push('<documents>');
  for (const e of evidence) {
    const attrs = [
      `n="${e.n}"`,
      `kb="${escapeAttr(e.kbName)}"`,
      `title="${escapeAttr(e.title)}"`,
      `path="${escapeAttr(e.path)}"`,
    ];
    if (e.headingPath.length) attrs.push(`section="${escapeAttr(e.headingPath.join(' > '))}"`);
    const loc = locationOf(e);
    if (loc) attrs.push(`location="${escapeAttr(loc)}"`);
    if (e.method) attrs.push(`method="${e.method}"`);
    lines.push(`<doc ${attrs.join(' ')}>`);
    lines.push(escapeText(e.text));
    lines.push('</doc>');
  }
  lines.push('</documents>');
  return lines.join('\n');
}

/** 근거를 응답에 저장할 출처 목록 (미리보기는 280자 이하) */
export function toCitations(evidence: Evidence[]): Citation[] {
  return evidence.map((e) => {
    const flat = e.text.replace(/\s+/g, ' ').trim();
    const snippet = flat.length > SNIPPET_MAX_CHARS ? `${flat.slice(0, SNIPPET_MAX_CHARS - 1)}…` : flat;
    return {
      n: e.n,
      kbId: e.kbId,
      kbName: e.kbName,
      chunkId: e.chunkId,
      docId: e.docId,
      path: e.path,
      title: e.title,
      headingPath: e.headingPath,
      url: e.url,
      page: e.page,
      lineStart: e.lineStart,
      lineEnd: e.lineEnd,
      symbol: e.symbol,
      snippet,
      score: e.score,
      ...(e.method ? { method: e.method } : {}),
    };
  });
}
