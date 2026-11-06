/**
 * RAG 검색 평가 리포트: 집계와 마크다운 렌더링 (순수 함수, rag.eval.ts에서 쓴다).
 */
import { mean, percentile } from '../../core/src/rag/metrics';

export interface QueryRecord {
  config: string;
  source: string;
  id: string;
  type: string;
  gold: string[];
  /** 상위 5개 근거 경로 (중복 제거 전) */
  top: string[];
  recall5?: number;
  recall10?: number;
  hit5?: number;
  rr?: number;
  ndcg10?: number;
  /** goldMarker가 있는 질의: 상위 5개 근거 중 정답 구간과 겹치는 것이 있는가 */
  span5?: boolean;
  /** 무결과 질의: 기본 minScore(0.15)·엄격 minScore(0.5)에서 근거가 남았는가 (오탐) */
  fp015?: boolean;
  fp050?: boolean;
  topScore?: number;
  /** 근거 집합 (LLM 전달분), 기본 설정 */
  ev?: EvidenceSample;
  latencyMs: number[];
  error?: string;
}

export interface EvidenceSample {
  count: number;
  chars: number;
  /** 정답 문서 중 근거에 들어간 비율 (정답 있는 질의) */
  recall?: number;
  /** 무결과 질의에서 근거가 남았나 (오탐) */
  fp?: boolean;
}

export interface EvidenceRow {
  /** 정답 있는 질의 수 */
  n: number;
  /** 무결과 질의 수 */
  nNoResult: number;
  recall: number;
  count: number;
  chars: number;
  fpRate: number;
}

export interface MetricRow {
  n: number;
  recall5: number;
  recall10: number;
  hit5: number;
  mrr: number;
  ndcg10: number;
  span5: number;
  spanN: number;
}

export interface IndexRow {
  config: string;
  source: string;
  provider: string;
  status: string;
  indexMs: number;
  docCount: number;
  chunkCount: number;
  indexBytes: number;
  sourceBytes: number;
  failedDocs: number;
  /** 정답 문서가 색인에 status ok로 들어간 비율 */
  goldIndexed: number;
  error?: string;
}

export interface SummaryRow {
  config: string;
  source: string;
  type: string;
  row: MetricRow;
}

export interface Report {
  label: string;
  generatedAt: string;
  node: string;
  gitHead: string | null;
  realRev: string;
  topK: number;
  reps: number;
  openai: boolean;
  configs: { id: string; label: string; skipped?: string }[];
  datasets: Record<string, { total: number; byType: Record<string, number> }>;
  corpus: Record<string, { files: number; bytes: number }>;
  index: IndexRow[];
  summary: SummaryRow[];
  latency: { config: string; source: string; p50: number; p95: number; samples: number }[];
  noResult: { config: string; source: string; n: number; fp015: number; fp050: number }[];
  evidence: { config: string; source: string; row: EvidenceRow }[];
  queries: QueryRecord[];
}

export function metricRow(records: QueryRecord[]): MetricRow {
  const rk = records.filter((r) => r.gold.length > 0);
  const spans = rk.filter((r) => r.span5 !== undefined);
  return {
    n: rk.length,
    recall5: mean(rk.map((r) => r.recall5 ?? 0)),
    recall10: mean(rk.map((r) => r.recall10 ?? 0)),
    hit5: mean(rk.map((r) => r.hit5 ?? 0)),
    mrr: mean(rk.map((r) => r.rr ?? 0)),
    ndcg10: mean(rk.map((r) => r.ndcg10 ?? 0)),
    span5: mean(spans.map((r) => (r.span5 ? 1 : 0))),
    spanN: spans.length,
  };
}

/** 설정 × 소스(synthetic·real·all) × 유형(all 포함) 집계 */
export function buildSummary(records: QueryRecord[], configIds: string[], sources: string[], types: string[]): SummaryRow[] {
  const out: SummaryRow[] = [];
  for (const config of configIds) {
    for (const source of [...sources, 'all']) {
      const inSource = records.filter((r) => r.config === config && (source === 'all' || r.source === source));
      for (const type of ['all', ...types]) {
        const rows = type === 'all' ? inSource : inSource.filter((r) => r.type === type);
        if (rows.length === 0) continue;
        out.push({ config, source, type, row: metricRow(rows) });
      }
    }
  }
  return out;
}

/** 근거 집합 지표 (LLM에 전달되는 근거) */
export function evidenceRow(records: QueryRecord[]): EvidenceRow {
  const withEv = records.filter((r) => r.ev !== undefined).map((r) => ({ r, s: r.ev! }));
  const rk = withEv.filter((x) => x.r.gold.length > 0);
  const nr = withEv.filter((x) => x.r.gold.length === 0);
  return {
    n: rk.length,
    nNoResult: nr.length,
    recall: mean(rk.map((x) => x.s.recall ?? 0)),
    count: mean(withEv.map((x) => x.s.count)),
    chars: mean(withEv.map((x) => x.s.chars)),
    fpRate: mean(nr.map((x) => (x.s.fp ? 1 : 0))),
  };
}

export function latencyOf(records: QueryRecord[], config: string, source: string): { p50: number; p95: number; samples: number } {
  const samples = records
    .filter((r) => r.config === config && (source === 'all' || r.source === source))
    .flatMap((r) => r.latencyMs);
  return { p50: percentile(samples, 50), p95: percentile(samples, 95), samples: samples.length };
}

function f(x: number, digits = 3): string {
  return Number.isNaN(x) ? '–' : x.toFixed(digits);
}

function pct(x: number): string {
  return Number.isNaN(x) ? '–' : `${(x * 100).toFixed(1)}%`;
}

export function renderMarkdown(rep: Report): string {
  const L: string[] = [];
  const configName = new Map(rep.configs.map((c) => [c.id, c.label]));
  L.push(`# RAG 검색 평가: ${rep.label}`);
  L.push('');
  L.push(`- 생성: ${rep.generatedAt} · Node ${rep.node} · HEAD ${rep.gitHead ?? '(알 수 없음)'}`);
  L.push(`- 실제 코퍼스 고정 리비전: ${rep.realRev} (git archive: docs, packages/core/src)`);
  L.push(`- 검색 설정: topK ${rep.topK}, minScore 0, maxContextChars 무제한 (순위 지표용). 근거 집합은 기본 설정(topK 6 · 9000자 · minScore 0.15)으로 잰다. 무결과 오탐(minScore 0.15 / 0.5)은 기본 설정 기준. 지연은 질의당 워밍업 1회 후 ${rep.reps}회 측정.`);
  L.push(`- OpenAI 설정 실행: ${rep.openai ? '예' : '아니오 (EVAL_OPENAI=1 과 OPENAI_API_KEY 필요)'}`);
  L.push('');
  L.push('## 데이터셋');
  L.push('');
  L.push('| 소스 | 질의 수 | 유형별 | 코퍼스 파일 수 | 코퍼스 바이트 |');
  L.push('|---|---|---|---|---|');
  for (const [src, d] of Object.entries(rep.datasets)) {
    const byType = Object.entries(d.byType).map(([t, n]) => `${t} ${n}`).join(', ');
    const c = rep.corpus[src];
    L.push(`| ${src} | ${d.total} | ${byType} | ${c?.files ?? '–'} | ${c?.bytes ?? '–'} |`);
  }
  L.push('');
  L.push('## 설정');
  L.push('');
  for (const c of rep.configs) L.push(`- \`${c.id}\`: ${c.label}${c.skipped ? ` — **건너뜀**: ${c.skipped}` : ''}`);
  L.push('');
  L.push('## 색인');
  L.push('');
  L.push('| 설정 | 소스 | 상태 | 색인 시간(ms) | 문서 | 청크 | 색인 바이트 | 원본 바이트 | 실패 문서 | 정답 문서 색인률 |');
  L.push('|---|---|---|---|---|---|---|---|---|---|');
  for (const r of rep.index) {
    L.push(`| ${r.config} | ${r.source} | ${r.status}${r.error ? ` (${r.error})` : ''} | ${f(r.indexMs, 0)} | ${r.docCount} | ${r.chunkCount} | ${r.indexBytes} | ${r.sourceBytes} | ${r.failedDocs} | ${pct(r.goldIndexed)} |`);
  }
  L.push('');
  L.push('## 검색 품질 (정답이 있는 질의, 소스별)');
  L.push('');
  L.push('| 설정 | 소스 | N | R@5 | R@10 | hit@5 | MRR | nDCG@10 | span@5 (N) |');
  L.push('|---|---|---|---|---|---|---|---|---|');
  for (const s of rep.summary.filter((x) => x.type === 'all')) {
    const m = s.row;
    L.push(`| ${s.config} | ${s.source} | ${m.n} | ${f(m.recall5)} | ${f(m.recall10)} | ${f(m.hit5)} | ${f(m.mrr)} | ${f(m.ndcg10)} | ${m.spanN ? `${f(m.span5)} (${m.spanN})` : '–'} |`);
  }
  L.push('');
  L.push('## 유형별 (소스 합산)');
  L.push('');
  L.push('| 설정 | 유형 | N | R@5 | R@10 | hit@5 | MRR | nDCG@10 |');
  L.push('|---|---|---|---|---|---|---|---|');
  for (const s of rep.summary.filter((x) => x.source === 'all' && x.type !== 'all')) {
    const m = s.row;
    L.push(`| ${s.config} | ${s.type} | ${m.n} | ${f(m.recall5)} | ${f(m.recall10)} | ${f(m.hit5)} | ${f(m.mrr)} | ${f(m.ndcg10)} |`);
  }
  L.push('');
  L.push('## 기준(local-hash) 대비 차이 (소스 합산)');
  L.push('');
  const base = rep.summary.find((x) => x.config === 'local-hash' && x.source === 'all' && x.type === 'all');
  if (base) {
    L.push('| 설정 | ΔR@10 | ΔMRR | ΔnDCG@10 |');
    L.push('|---|---|---|---|');
    for (const s of rep.summary.filter((x) => x.source === 'all' && x.type === 'all' && x.config !== 'local-hash')) {
      const d = (a: number, b: number) => (Number.isNaN(a) || Number.isNaN(b) ? '–' : `${a - b >= 0 ? '+' : ''}${(a - b).toFixed(3)}`);
      L.push(`| ${s.config} | ${d(s.row.recall10, base.row.recall10)} | ${d(s.row.mrr, base.row.mrr)} | ${d(s.row.ndcg10, base.row.ndcg10)} |`);
    }
    L.push('');
  }
  L.push('## 지연 시간 (ms, 질의 전체 측정)');
  L.push('');
  L.push('| 설정 | 소스 | P50 | P95 | 표본 |');
  L.push('|---|---|---|---|---|');
  for (const l of rep.latency) L.push(`| ${l.config} | ${l.source} | ${f(l.p50, 1)} | ${f(l.p95, 1)} | ${l.samples} |`);
  L.push('');
  L.push('## 근거 집합 (LLM에 전달되는 근거, 기본 설정 topK 6 · 9000자 · minScore 0.15)');
  L.push('');
  L.push('| 설정 | 소스 | 정답 문서 재현율 | 평균 근거 수 | 평균 근거 글자 수 | 무결과 오탐률 |');
  L.push('|---|---|---|---|---|---|');
  for (const e of rep.evidence) {
    L.push(`| ${configName.get(e.config) ?? e.config} | ${e.source} | ${pct(e.row.recall)} (정답 ${e.row.n}건) | ${f(e.row.count, 2)} | ${Math.round(e.row.chars)} | ${pct(e.row.fpRate)} (무결과 ${e.row.nNoResult}건) |`);
  }
  L.push('');
  L.push('## 무결과 질의 오탐 (정답 없음이어야 함)');
  L.push('');
  L.push('| 설정 | 소스 | N | 오탐 @0.15 | 오탐 @0.5 |');
  L.push('|---|---|---|---|---|');
  for (const n of rep.noResult) L.push(`| ${n.config} | ${n.source} | ${n.n} | ${n.fp015}/${n.n} | ${n.fp050}/${n.n} |`);
  L.push('');
  L.push('## 실패 질의 (상위 5개 안에 정답 없음)');
  L.push('');
  for (const c of rep.configs.filter((x) => !x.skipped)) {
    const miss = rep.queries.filter((q) => q.config === c.id && q.gold.length > 0 && q.hit5 === 0);
    const byType = new Map<string, number>();
    for (const q of miss) byType.set(q.type, (byType.get(q.type) ?? 0) + 1);
    const ids = miss.map((q) => `${q.source}/${q.id}`).join(', ');
    L.push(`- **${configName.get(c.id) ?? c.id}**: ${miss.length}건 (${[...byType].map(([t, n]) => `${t} ${n}`).join(', ') || '없음'})${ids ? ` — ${ids}` : ''}`);
  }
  L.push('');
  const errors = rep.queries.filter((q) => q.error);
  if (errors.length > 0) {
    L.push('## 검색 오류');
    L.push('');
    for (const q of errors.slice(0, 20)) L.push(`- ${q.config} ${q.source}/${q.id}: ${q.error}`);
    L.push('');
  }
  return L.join('\n');
}
