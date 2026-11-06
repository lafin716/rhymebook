/**
 * 지식베이스 유형 개편 평가 (ADR-127~132, T6).
 * 실행: pnpm --filter @branch/bridge exec vitest run --config vitest.eval.config.ts eval/kbTypes.eval.ts
 * 결과: <리포 루트>/docs/eval/kb-types-2026-11-06.json · .md
 *
 * - 데이터셋: eval/datasets/real.jsonl (43질의, git grep으로 정답 검증, 고정 리비전 2aec63d).
 * - KB 구성 (실제 채팅 경로 `indexer.retrieve` 그대로):
 *   · kbcodebase: packages/core/src → kind 'codebase' (Agentic 실시간 탐색, 색인 없음)
 *   · kbdocument: docs → kind 'document', local-hash (Vector + BM25 하이브리드)
 *   · kbdocnone : docs → kind 'document', provider none (벡터 꺼짐 → 키워드만)
 * - 시나리오: mixed(두 KB 함께 연결 — 기본), codebase-only, document-only, document-keyword-only.
 * - 정책 지표: 코드베이스 KB 임베딩 호출 수·색인 파일 수·벡터 레코드 수·색인 큐 등록 거부.
 * - 토큰: 근거 본문 문자 수 기반 추정(한글 1.5자/토큰, 그 외 4자/토큰). LLM 호출은 하지 않는다.
 */
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  buildRewriteContext,
  createHashEmbedder,
  createNoneEmbedder,
  DEFAULT_RAG_SETTINGS,
  rewriteQuery,
  type EmbeddingProvider,
  type Evidence,
  type KnowledgeIndexSettings,
  type KnowledgeIndexState,
  type RetrievalResult,
} from '@branch/core';
import { createKnowledgeIndexer, type KnowledgeIndexer } from '../src';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '../../..');
const REAL_REV = '2aec63d';
const OUT_NAME = 'kb-types-2026-11-06';
const REPS = 3;
const TOP_K = 5;

interface Item {
  id: string;
  type: string;
  question: string;
  gold: string[];
}

const KB = { code: 'kbcodebase', doc: 'kbdocument', docNone: 'kbdocnone' } as const;

type Scenario = 'mixed' | 'codebase-only' | 'document-only' | 'document-keyword-only';

interface Rec {
  scenario: Scenario;
  id: string;
  type: string;
  gold: string[];
  goldKind: 'code' | 'doc' | 'both' | 'none';
  hit5: boolean;
  recall5: number;
  rank: number | null;
  sourced: number;
  evidence: number;
  tokens: number;
  msMedian: number;
  msP95: number;
  methods: string[];
  routedIntent?: string;
  top: string[];
}

function goldKindOf(gold: string[]): Rec['goldKind'] {
  if (gold.length === 0) return 'none';
  const code = gold.some((g) => g.startsWith('packages/'));
  const doc = gold.some((g) => g.startsWith('docs/'));
  return code && doc ? 'both' : code ? 'code' : 'doc';
}

function estTokens(text: string): number {
  let ko = 0;
  for (const ch of text) if (/[ㄱ-힝]/.test(ch)) ko++;
  return Math.ceil(ko / 1.5 + (text.length - ko) / 4);
}

/** 출처 연결 가능: 경로가 있고, 코드면 줄 범위, PDF면 페이지 */
function sourced(e: Evidence): boolean {
  if (!e.path) return false;
  if (e.method === 'agentic') return typeof e.lineStart === 'number' && typeof e.lineEnd === 'number';
  if (e.kind === 'pdf') return typeof e.page === 'number';
  return true;
}

function quantile(xs: number[], q: number): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * (s.length - 1) + 0.5))] ?? 0;
}

async function walk(dir: string, out: string[] = []): Promise<string[]> {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) await walk(p, out);
    else out.push(p);
  }
  return out;
}

async function waitTerminal(ix: KnowledgeIndexer, kbId: string): Promise<KnowledgeIndexState> {
  const done = new Set(['ready', 'stale', 'empty', 'error']);
  return new Promise((resolve) => {
    const off = ix.onState((s) => {
      if (s.kbId === kbId && done.has(s.status)) {
        off();
        void ix.states([kbId]).then(([st]) => resolve(st ?? s));
      }
    });
  });
}

describe('kb-types eval', () => {
  it('runs', async () => {
    const items: Item[] = (await readFile(path.join(HERE, 'datasets', 'real.jsonl'), 'utf8'))
      .split('\n')
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l) as Item);
    const work = await mkdtemp(path.join(os.tmpdir(), 'ob-kbtypes-eval-'));
    const root = path.join(work, 'kb');
    const embedCalls: Record<string, number> = {};
    // 실제 providerFor와 같게: provider none이면 임베딩하지 않는다. 호출 수만 센다.
    const embedderFor = (kbId: string, st: KnowledgeIndexSettings): EmbeddingProvider => {
      const base = st.embedding.provider === 'none' ? createNoneEmbedder() : createHashEmbedder();
      return {
        ...base,
        embed: async (texts: string[], signal?: AbortSignal) => {
          embedCalls[kbId] = (embedCalls[kbId] ?? 0) + texts.length;
          return base.embed(texts, signal);
        },
      } as EmbeddingProvider;
    };
    const ix = createKnowledgeIndexer({ root, embedderFor, retryDelayMs: 200, log: () => undefined });
    const log = (m: string) => process.stdout.write(`[kb-types] ${m}\n`);
    try {
      // 코퍼스
      const archive = execFileSync('git', ['-C', REPO_ROOT, 'archive', REAL_REV, 'docs', 'packages/core/src'], {
        maxBuffer: 512 * 1024 * 1024,
      });
      const now = Date.now();
      const mk = async (id: string, sub: string, meta: Record<string, unknown>) => {
        const files = path.join(root, id, 'files');
        await mkdir(files, { recursive: true });
        execFileSync('tar', ['-x', '-C', files, sub], { input: archive });
        await writeFile(
          path.join(root, id, 'meta.json'),
          JSON.stringify({ createdAt: now, updatedAt: now, ...meta }, null, 2),
        );
      };
      await mk(KB.code, 'packages/core/src', { name: 'octobooks core', kind: 'codebase' });
      await mk(KB.doc, 'docs', { name: 'octobooks docs', kind: 'document', settings: { embedding: { provider: 'local-hash' } } });
      await mk(KB.docNone, 'docs', { name: 'octobooks docs (no vector)', kind: 'document', settings: { embedding: { provider: 'none' } } });

      // 색인: 문서 KB만. 코드베이스 enqueue는 정책상 거부·무시되어야 한다.
      const index: Record<string, { status: string; ms: number; chunks: number; docs: number }> = {};
      for (const id of [KB.doc, KB.docNone]) {
        const t0 = performance.now();
        const wait = waitTerminal(ix, id);
        await ix.enqueue(id, 'full');
        const st = await wait;
        index[id] = { status: st.status, ms: Math.round(performance.now() - t0), chunks: st.chunkCount, docs: st.docCount };
        log(`색인 ${id}: ${st.status} ${index[id]!.ms}ms chunks=${st.chunkCount}`);
      }
      let codebaseEnqueue = 'accepted';
      try {
        await ix.enqueue(KB.code, 'full');
        const [st] = await ix.states([KB.code]);
        codebaseEnqueue = st && st.status !== 'empty' && st.chunkCount > 0 ? `accepted(${st.status})` : 'ignored';
      } catch (e) {
        codebaseEnqueue = `rejected(${(e as Error).name})`;
      }

      const scenarios: { s: Scenario; kbIds: string[]; filter: (it: Item) => boolean }[] = [
        { s: 'mixed', kbIds: [KB.code, KB.doc], filter: () => true },
        { s: 'codebase-only', kbIds: [KB.code], filter: (it) => goldKindOf(it.gold) === 'code' },
        { s: 'document-only', kbIds: [KB.doc], filter: (it) => goldKindOf(it.gold) === 'doc' },
        { s: 'document-keyword-only', kbIds: [KB.docNone], filter: (it) => goldKindOf(it.gold) === 'doc' },
      ];
      const settings = { ...DEFAULT_RAG_SETTINGS };
      const recs: Rec[] = [];
      for (const sc of scenarios) {
        for (const it of items.filter(sc.filter)) {
          const plan = rewriteQuery(buildRewriteContext({}, {}, 'none', it.question, []));
          let res: RetrievalResult = await ix.retrieve({ kbIds: sc.kbIds, plan, settings }); // 워밍업
          const ms: number[] = [];
          for (let r = 0; r < REPS; r++) {
            const t0 = performance.now();
            res = await ix.retrieve({ kbIds: sc.kbIds, plan, settings });
            ms.push(performance.now() - t0);
          }
          const paths: string[] = [];
          for (const e of res.evidence) if (!paths.includes(e.path)) paths.push(e.path);
          const top = paths.slice(0, TOP_K);
          const found = it.gold.filter((g) => top.includes(g)).length;
          const rankIdx = paths.findIndex((p) => it.gold.includes(p));
          const gk = goldKindOf(it.gold);
          const hit5 = gk === 'none' ? res.assessment?.sufficient === false || res.evidence.length === 0 : found > 0;
          recs.push({
            scenario: sc.s,
            id: it.id,
            type: it.type,
            gold: it.gold,
            goldKind: gk,
            hit5,
            recall5: it.gold.length ? found / it.gold.length : NaN,
            rank: rankIdx >= 0 ? rankIdx + 1 : null,
            sourced: res.evidence.filter(sourced).length,
            evidence: res.evidence.length,
            tokens: res.evidence.reduce((n, e) => n + estTokens(e.text), 0),
            msMedian: quantile(ms, 0.5),
            msP95: quantile(ms, 0.95),
            methods: [...new Set(res.evidence.map((e) => e.method ?? '?'))],
            ...(res.routed ? { routedIntent: res.routed.intent } : {}),
            top,
          });
        }
        log(`질의 완료: ${sc.s}`);
      }

      // 정책 지표 (코드베이스 KB)
      const codeFiles = await walk(path.join(root, KB.code));
      const indexFiles = codeFiles.filter((f) => /index[^/]*\.sqlite/.test(path.basename(f)));
      const codeVectorEvidence = recs.filter((r) => r.scenario !== 'document-only' && r.scenario !== 'document-keyword-only');
      const policy = {
        codebaseEmbedCalls: embedCalls[KB.code] ?? 0,
        codebaseIndexFiles: indexFiles.length,
        codebaseEnqueue,
        documentEmbedCalls: embedCalls[KB.doc] ?? 0,
        documentNoneEmbedCalls: embedCalls[KB.docNone] ?? 0,
        sourcedRatio:
          recs.reduce((n, r) => n + r.sourced, 0) / Math.max(1, recs.reduce((n, r) => n + r.evidence, 0)),
        codebaseScenarioQueries: codeVectorEvidence.length,
      };

      const summary = scenarios.map((sc) => {
        const rs = recs.filter((r) => r.scenario === sc.s);
        const withGold = rs.filter((r) => r.goldKind !== 'none');
        const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
        return {
          scenario: sc.s,
          n: rs.length,
          nGold: withGold.length,
          success: rs.filter((r) => r.hit5).length / Math.max(1, rs.length),
          recall5: avg(withGold.map((r) => r.recall5)),
          mrr: avg(withGold.map((r) => (r.rank ? 1 / r.rank : 0))),
          msMedian: quantile(rs.map((r) => r.msMedian), 0.5),
          msP95: quantile(rs.map((r) => r.msP95), 0.95),
          tokensAvg: avg(rs.map((r) => r.tokens)),
        };
      });
      const byKind = (['code', 'doc', 'both', 'none'] as const).map((k) => {
        const rs = recs.filter((r) => r.scenario === 'mixed' && r.goldKind === k);
        return {
          goldKind: k,
          n: rs.length,
          success: rs.filter((r) => r.hit5).length / Math.max(1, rs.length),
          recall5: k === 'none' ? NaN : rs.reduce((a, r) => a + r.recall5, 0) / Math.max(1, rs.length),
        };
      });

      const head = execFileSync('git', ['-C', REPO_ROOT, 'rev-parse', '--short', 'HEAD']).toString().trim();
      const report = { generatedAt: new Date().toISOString(), node: process.version, head, rev: REAL_REV, index, policy, summary, byKind, recs };
      const outDir = path.join(REPO_ROOT, 'docs', 'eval');
      await writeFile(path.join(outDir, `${OUT_NAME}.json`), JSON.stringify(report, null, 2));
      await writeFile(path.join(outDir, `${OUT_NAME}.md`), renderMd(report));
      log(JSON.stringify({ policy, summary }, null, 1));

      expect(policy.codebaseEmbedCalls).toBe(0);
      expect(policy.codebaseIndexFiles).toBe(0);
      expect(policy.documentNoneEmbedCalls).toBe(0);
    } finally {
      await ix.close?.();
      await rm(work, { recursive: true, force: true });
    }
  });
});

const pct = (x: number) => (Number.isNaN(x) ? '—' : `${(x * 100).toFixed(1)}%`);
const f3 = (x: number) => (Number.isNaN(x) ? '—' : x.toFixed(3));

function renderMd(r: {
  generatedAt: string;
  node: string;
  head: string;
  rev: string;
  index: Record<string, { status: string; ms: number; chunks: number; docs: number }>;
  policy: Record<string, number | string>;
  summary: { scenario: string; n: number; nGold: number; success: number; recall5: number; mrr: number; msMedian: number; msP95: number; tokensAvg: number }[];
  byKind: { goldKind: string; n: number; success: number; recall5: number }[];
  recs: Rec[];
}): string {
  const L: string[] = [];
  L.push(`# 지식베이스 유형 개편 평가 — ${OUT_NAME}`, '');
  L.push(`- 생성 ${r.generatedAt} · Node ${r.node} · 작업 트리 HEAD ${r.head}(+미커밋 변경) · 코퍼스 고정 리비전 ${r.rev}`);
  L.push('- 데이터셋: `packages/bridge/eval/datasets/real.jsonl` 43질의 (git grep으로 정답 검증). 성공 = 상위 5개 출처 안에 정답 파일(무결과 질의는 근거 부족 판정).');
  L.push('- 지연: 질의당 워밍업 1회 후 3회의 중앙값/95분위. 토큰: 근거 본문 추정치(한글 1.5자·기타 4자당 1토큰). LLM 호출 없음.');
  L.push('- 실행: `pnpm --filter @branch/bridge exec vitest run --config vitest.eval.config.ts eval/kbTypes.eval.ts`', '');
  L.push('## 정책 지표', '', '| 항목 | 값 | 목표 |', '|---|---|---|');
  L.push(`| 코드베이스 KB 임베딩 호출(텍스트 수) | ${r.policy.codebaseEmbedCalls} | 0 |`);
  L.push(`| 코드베이스 KB 색인 파일(index*.sqlite) | ${r.policy.codebaseIndexFiles} | 0 |`);
  L.push(`| 코드베이스 KB 색인 큐 등록 | ${r.policy.codebaseEnqueue} | 거부/무시 |`);
  L.push(`| 문서 KB(벡터 꺼짐) 임베딩 호출 | ${r.policy.documentNoneEmbedCalls} | 0 |`);
  L.push(`| 근거 출처 연결 가능 비율 | ${pct(Number(r.policy.sourcedRatio))} | 100% |`, '');
  L.push('## 색인 (문서 KB만)', '', '| KB | 상태 | 시간(ms) | 문서 | 청크 |', '|---|---|---|---|---|');
  for (const [id, v] of Object.entries(r.index)) L.push(`| ${id} | ${v.status} | ${v.ms} | ${v.docs} | ${v.chunks} |`);
  L.push('', '## 시나리오별', '', '| 시나리오 | 질의 | 정답 있음 | 성공률 | Recall@5 | MRR | 지연 p50(ms) | 지연 p95(ms) | 근거 토큰 평균 |', '|---|---|---|---|---|---|---|---|---|');
  for (const s of r.summary)
    L.push(`| ${s.scenario} | ${s.n} | ${s.nGold} | ${pct(s.success)} | ${f3(s.recall5)} | ${f3(s.mrr)} | ${s.msMedian.toFixed(1)} | ${s.msP95.toFixed(1)} | ${Math.round(s.tokensAvg)} |`);
  L.push('', '## mixed 시나리오 — 정답 위치별', '', '| 정답 위치 | 질의 | 성공률 | Recall@5 |', '|---|---|---|---|');
  for (const k of r.byKind) L.push(`| ${k.goldKind} | ${k.n} | ${pct(k.success)} | ${f3(k.recall5)} |`);
  L.push('', '## 해석', '');
  L.push('- 비교 기준(같은 43질의·같은 코퍼스, 이전 구조 = 코드+문서를 한 문서형 KB로 벡터 색인, local-hash): Recall@5 0.595 · hit@5 0.622 · MRR 0.396 (`docs/eval/final-2026-11-06.md`).');
  L.push('- 무결과 질의(n-*)의 성공은 검색 단계에서 근거 부족을 판정했는지로 셌다. 현재 검색 단계는 거부 판정을 하지 않고(근거를 돌려주고 답변 모델이 "자료에 없음"을 판단), 그래서 0%다 — 후속 과제.');
  L.push('- 한국어 의미 질문(s-*)은 같은 한국어 문장을 담은 i18n 로캘 JSON이 코드보다 앞서는 경우가 많다. 경로 기반 감점 없이 둔 것은 의도된 선택(로캘 문자열도 유효한 근거)이며 후속 튜닝 대상이다.');
  L.push('', '## 실패 질의 (mixed)', '');
  for (const x of r.recs.filter((q) => q.scenario === 'mixed' && !q.hit5))
    L.push(`- ${x.id} (${x.type}) 정답 ${x.gold.join(', ') || '없음'} → 상위: ${x.top.join(', ') || '없음'}`);
  L.push('');
  return L.join('\n');
}
