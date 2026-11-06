/**
 * RAG 검색 품질·지연·색인 비용 평가 하네스.
 * 실행: pnpm --filter @branch/bridge eval:rag  (EVAL_LABEL=baseline 등으로 결과 파일 이름 지정)
 * 결과: <리포 루트>/docs/eval/<EVAL_LABEL>.json · .md
 *
 * - 합성 코퍼스(eval/corpus/synthetic)와 실제 코퍼스(git archive 2aec63d: docs, packages/core/src)를
 *   임시 디렉터리에 KB 형식(<root>/<kbId>/files, meta.json)으로 복사해 색인한다.
 * - 설정: local-hash(기본), fts-symbol(벡터 가중치 0), none(벡터 없음, 지원 시), openai(EVAL_OPENAI=1 + 키가 있을 때만).
 *   OpenAI는 문서 본문을 외부로 보내므로 명시적으로 켜야 한다. 키는 로그·결과 파일에 남기지 않는다.
 * - 공개 API만 쓴다. 지표 함수는 core/src/rag/metrics.ts를 상대 경로로 가져와 HEAD에서도 동작하게 한다.
 */
import { execFileSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'vitest';
import {
  buildRewriteContext,
  DEFAULT_RAG_SETTINGS,
  rewriteQuery,
  type KnowledgeIndexState,
  type Message,
  type QueryPlan,
  type RagSettings,
  type RetrievalResult,
  type Session,
} from '@branch/core';
import { createKnowledgeIndexer, type KnowledgeIndexer } from '../src';
import {
  hitAtK,
  ndcgAtK,
  recallAtK,
  reciprocalRank,
  spanOverlaps,
} from '../../core/src/rag/metrics';
import {
  buildSummary,
  evidenceRow,
  latencyOf,
  renderMarkdown,
  type EvidenceSample,
  type IndexRow,
  type QueryRecord,
  type Report,
} from './report';

// ── 경로·상수 ──────────────────────────────────────────

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BRIDGE_ROOT = path.resolve(HERE, '..');
const REPO_ROOT = path.resolve(BRIDGE_ROOT, '../..');
const SYNTHETIC_CORPUS = path.join(HERE, 'corpus', 'synthetic');
const DATASET_DIR = path.join(HERE, 'datasets');
const REAL_REV = '2aec63d';
const REAL_PATHS = ['docs', 'packages/core/src'];
const LABEL = (process.env.EVAL_LABEL ?? 'local').replace(/[^a-zA-Z0-9_-]/g, '') || 'local';
const OPENAI_ENABLED = process.env.EVAL_OPENAI === '1' && Boolean(process.env.OPENAI_API_KEY);
const RANK_TOP_K = 10;
const REPS = 3;
const TERMINAL = new Set(['ready', 'stale', 'empty', 'error']);
const INDEX_TIMEOUT_MS = 20 * 60 * 1000;
const SOURCES = ['synthetic', 'real'] as const;
type Source = (typeof SOURCES)[number];

// ── 데이터셋 ──────────────────────────────────────────

interface Item {
  id: string;
  type: string;
  source: Source;
  question: string;
  gold: string[];
  goldMarker?: string;
  context?: { turns: { role: 'user' | 'assistant'; content: string }[] };
}

async function loadDatasets(): Promise<Item[]> {
  const files = (await readdir(DATASET_DIR)).filter((f) => f.endsWith('.jsonl')).sort();
  const items: Item[] = [];
  for (const f of files) {
    const text = await readFile(path.join(DATASET_DIR, f), 'utf8');
    for (const line of text.split('\n')) {
      if (line.trim() === '') continue;
      items.push(JSON.parse(line) as Item);
    }
  }
  const ids = new Set<string>();
  for (const it of items) {
    const key = `${it.source}/${it.id}`;
    if (ids.has(key)) throw new Error(`데이터셋 id 중복: ${key}`);
    ids.add(key);
  }
  return items;
}

// ── 설정(검색 구성) ───────────────────────────────────

type IndexProvider = 'local-hash' | 'none' | 'openai';

interface ConfigDef {
  id: string;
  label: string;
  index: IndexProvider;
  settings: Partial<RagSettings>;
  skipped?: string;
}

const CONFIGS: ConfigDef[] = [
  { id: 'local-hash', label: 'local-hash 기본 설정 (키워드 + 해시 벡터 + 경량 리랭커)', index: 'local-hash', settings: {} },
  {
    id: 'fts-symbol',
    label: 'local-hash, 벡터 가중치 0 (키워드·심볼 중심 근사, HEAD에서는 벡터도 계산되므로 순수 FTS가 아님)',
    index: 'local-hash',
    settings: { vectorWeight: 0 },
  },
  { id: 'none', label: 'provider none (벡터 없음, ADR-121)', index: 'none', settings: {} },
];
if (!OPENAI_ENABLED) {
  CONFIGS.push({
    id: 'openai',
    label: 'OpenAI text-embedding-3-small',
    index: 'openai',
    settings: {},
    skipped: 'EVAL_OPENAI=1 과 OPENAI_API_KEY가 모두 필요 (문서가 OpenAI로 전송됨)',
  });
} else {
  CONFIGS.push({ id: 'openai', label: 'OpenAI text-embedding-3-small', index: 'openai', settings: {} });
}

function kbIdOf(index: IndexProvider, source: Source): string {
  const p = index.replace(/[^a-z0-9]/g, '');
  return `kb${p}${source === 'synthetic' ? 'syn' : 'real'}`;
}

// ── 파일·디렉터리 ─────────────────────────────────────

async function dirStats(dir: string): Promise<{ files: number; bytes: number }> {
  let files = 0;
  let bytes = 0;
  const walk = async (d: string): Promise<void> => {
    for (const e of await readdir(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) await walk(p);
      else if (e.isFile()) {
        files++;
        bytes += (await stat(p)).size;
      }
    }
  };
  await walk(dir);
  return { files, bytes };
}

async function prepareCorpora(work: string): Promise<Record<Source, string>> {
  const synthetic = path.join(work, 'corpus-synthetic');
  await cp(SYNTHETIC_CORPUS, synthetic, { recursive: true });
  const real = path.join(work, 'corpus-real');
  await mkdir(real, { recursive: true });
  const archive = execFileSync('git', ['-C', REPO_ROOT, 'archive', REAL_REV, ...REAL_PATHS], {
    maxBuffer: 1024 * 1024 * 512,
  });
  execFileSync('tar', ['-x', '-C', real], { input: archive });
  return { synthetic, real };
}

/** 정답 마커가 든 줄부터 다음 빈 줄 직전까지를 정답 구간으로 본다 */
function resolveSpan(text: string, marker: string): { startLine: number; endLine: number } {
  const lines = text.split('\n');
  const idx = lines.findIndex((l) => l.includes(marker));
  if (idx < 0) throw new Error(`goldMarker를 정답 파일에서 찾지 못함: ${marker}`);
  let end = idx;
  while (end + 1 < lines.length && (lines[end + 1] ?? '').trim() !== '') end++;
  return { startLine: idx + 1, endLine: end + 1 };
}

// ── 색인 ──────────────────────────────────────────────

function metaFor(index: IndexProvider, name: string): string {
  const now = Date.now();
  const embedding = index === 'openai' ? { provider: 'openai', model: 'text-embedding-3-small' } : { provider: index };
  return JSON.stringify({ name, createdAt: now, updatedAt: now, settings: { embedding } }, null, 2);
}

async function indexKb(
  ix: KnowledgeIndexer,
  kbId: string,
): Promise<{ state: KnowledgeIndexState; ms: number; error?: string }> {
  const t0 = performance.now();
  let resolveTerminal!: (s: KnowledgeIndexState) => void;
  const terminal = new Promise<KnowledgeIndexState>((res) => (resolveTerminal = res));
  const off = ix.onState((s) => {
    if (s.kbId === kbId && TERMINAL.has(s.status)) resolveTerminal(s);
  });
  try {
    await ix.enqueue(kbId, 'full');
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<'timeout'>((res) => (timer = setTimeout(() => res('timeout'), INDEX_TIMEOUT_MS)));
    const winner = await Promise.race([terminal, timeout]);
    if (timer) clearTimeout(timer);
    const ms = performance.now() - t0;
    if (winner === 'timeout') {
      const [partial] = await ix.states([kbId]);
      return { state: partial ?? emptyState(kbId), ms, error: 'timeout' };
    }
    const [full] = await ix.states([kbId]);
    return { state: full ?? winner, ms };
  } finally {
    off();
  }
}

function emptyState(kbId: string): KnowledgeIndexState {
  return { kbId, status: 'empty', docCount: 0, chunkCount: 0, indexBytes: 0, sourceBytes: 0, failedDocs: 0 } as KnowledgeIndexState;
}

// ── 질의 계획 ─────────────────────────────────────────

function planOf(item: Item): QueryPlan {
  const sessions: Record<string, Session> = {};
  const messages: Record<string, Message[]> = {};
  let sessionId = 'none';
  if (item.context) {
    sessions.root = { id: 'root', parentId: null, rootId: 'root', title: '' } as Session;
    sessions.cur = { id: 'cur', parentId: 'root', rootId: 'root', title: '' } as Session;
    sessionId = 'cur';
    messages.cur = item.context.turns.map(
      (t, i) => ({ id: `t${i}`, sessionId: 'cur', role: t.role, content: t.content, createdAt: i + 1 }) as Message,
    );
  }
  return rewriteQuery(buildRewriteContext(sessions, messages, sessionId, item.question, []));
}

// ── 메인 ──────────────────────────────────────────────

interface Run {
  report: Report;
  outDir: string;
}

async function runEval(): Promise<Run> {
  const started = Date.now();
  const items = await loadDatasets();
  const work = await mkdtemp(path.join(os.tmpdir(), 'ob-rag-eval-'));
  const log = (msg: string): void => {
    process.stdout.write(`[eval ${LABEL}] ${msg}\n`);
  };
  const ix = createKnowledgeIndexer({
    root: path.join(work, 'kb'),
    getOpenAIKey: () => (OPENAI_ENABLED ? process.env.OPENAI_API_KEY : undefined),
    retryDelayMs: 500,
    log: () => undefined,
  });
  try {
    const corpora = await prepareCorpora(work);
    const corpusStats: Record<string, { files: number; bytes: number }> = {};
    for (const s of SOURCES) corpusStats[s] = await dirStats(corpora[s]);

    // 1) 색인 구축 (provider × source). fts-symbol은 local-hash KB를 공유한다.
    const indexRows: IndexRow[] = [];
    const skipReason = new Map<string, string>(); // `${index}|${source}` → 이유
    const kbOf = new Map<string, string>(); // `${index}|${source}` → kbId
    const providers = [...new Set(CONFIGS.filter((c) => !c.skipped).map((c) => c.index))];
    for (const provider of providers) {
      for (const source of SOURCES) {
        const kbId = kbIdOf(provider, source);
        const kbDir = path.join(work, 'kb', kbId);
        await mkdir(path.join(kbDir, 'files'), { recursive: true });
        await cp(corpora[source], path.join(kbDir, 'files'), { recursive: true });
        await writeFile(path.join(kbDir, 'meta.json'), metaFor(provider, `eval ${provider} ${source}`));
        log(`색인 시작: ${kbId}`);
        const { state, ms, error } = await indexKb(ix, kbId);
        const key = `${provider}|${source}`;
        kbOf.set(key, kbId);
        const docs = state.status === 'error' || error ? [] : await ix.docs(kbId).catch(() => []);
        const okPaths = new Set(docs.filter((d) => d.status === 'ok').map((d) => d.path));
        const goldPaths = new Set(items.filter((i) => i.source === source).flatMap((i) => i.gold));
        const goldIndexed = goldPaths.size === 0 ? NaN : [...goldPaths].filter((p) => okPaths.has(p)).length / goldPaths.size;
        const actualModel = state.model?.provider;
        let reason: string | undefined;
        if (error || state.status === 'error') reason = `색인 실패(${state.error ?? error ?? 'error'})`;
        else if (state.status === 'empty' || state.chunkCount === 0) reason = '색인된 청크 없음';
        else if (provider === 'none' && actualModel !== 'none') {
          reason = `provider none 미지원 (색인 모델 ${actualModel ?? '알 수 없음'})`;
        }
        if (reason) skipReason.set(key, reason);
        indexRows.push({
          config: provider,
          source,
          provider,
          status: state.status,
          indexMs: ms,
          docCount: state.docCount,
          chunkCount: state.chunkCount,
          indexBytes: state.indexBytes,
          sourceBytes: state.sourceBytes,
          failedDocs: state.failedDocs ?? 0,
          goldIndexed,
          error: reason ?? state.error,
        });
        log(`색인 완료: ${kbId} ${state.status} ${Math.round(ms)}ms chunks=${state.chunkCount}${reason ? ` (건너뜀: ${reason})` : ''}`);
      }
    }

    // 2) 질의 실행
    const records: QueryRecord[] = [];
    const configSkip = new Map<string, string[]>();
    for (const cfg of CONFIGS) {
      if (cfg.skipped) continue;
      for (const source of SOURCES) {
        const key = `${cfg.index}|${source}`;
        const reason = skipReason.get(key);
        if (reason) {
          configSkip.set(cfg.id, [...(configSkip.get(cfg.id) ?? []), `${source}: ${reason}`]);
          continue;
        }
        const kbId = kbOf.get(key)!;
        for (const item of items.filter((i) => i.source === source)) {
          records.push(await evaluateItem(ix, cfg, kbId, item, corpora));
        }
        log(`질의 완료: ${cfg.id} ${source}`);
      }
    }

    const configs = CONFIGS.map((c) => {
      const skips = configSkip.get(c.id);
      const skipped = c.skipped ?? (skips ? skips.join('; ') : undefined);
      return { id: c.id, label: c.label, ...(skipped ? { skipped } : {}) };
    });
    const liveConfigs = configs.filter((c) => !c.skipped).map((c) => c.id);
    const types = [...new Set(items.map((i) => i.type))].sort();
    const datasets: Report['datasets'] = {};
    for (const s of SOURCES) {
      const mine = items.filter((i) => i.source === s);
      const byType: Record<string, number> = {};
      for (const i of mine) byType[i.type] = (byType[i.type] ?? 0) + 1;
      datasets[s] = { total: mine.length, byType };
    }
    const noResult: Report['noResult'] = [];
    for (const c of liveConfigs) {
      for (const s of SOURCES) {
        const rs = records.filter((r) => r.config === c && r.source === s && r.gold.length === 0);
        if (rs.length === 0) continue;
        noResult.push({
          config: c,
          source: s,
          n: rs.length,
          fp015: rs.filter((r) => r.fp015).length,
          fp050: rs.filter((r) => r.fp050).length,
        });
      }
    }
    const latency: Report['latency'] = [];
    for (const c of liveConfigs) {
      for (const s of [...SOURCES, 'all']) {
        latency.push({ config: c, source: s, ...latencyOf(records, c, s) });
      }
    }
    const evidence: Report['evidence'] = [];
    for (const c of liveConfigs) {
      for (const s of [...SOURCES, 'all']) {
        evidence.push({ config: c, source: s, row: evidenceRow(records.filter((r) => r.config === c && (s === 'all' || r.source === s))) });
      }
    }
    const gitHead = safeGit(['rev-parse', 'HEAD']);
    const report: Report = {
      label: LABEL,
      generatedAt: new Date().toISOString(),
      node: process.version,
      gitHead,
      realRev: REAL_REV,
      topK: RANK_TOP_K,
      reps: REPS,
      openai: OPENAI_ENABLED,
      configs,
      datasets,
      corpus: corpusStats,
      index: indexRows,
      summary: buildSummary(records, liveConfigs, [...SOURCES], types),
      latency,
      noResult,
      evidence,
      queries: records,
    };
    log(`완료: 질의 ${records.length}건, ${Math.round((Date.now() - started) / 1000)}초`);
    const outDir = path.join(REPO_ROOT, 'docs', 'eval');
    return { report, outDir };
  } finally {
    await ix.close();
    await rm(work, { recursive: true, force: true });
  }
}

async function evaluateItem(
  ix: KnowledgeIndexer,
  cfg: ConfigDef,
  kbId: string,
  item: Item,
  corpora: Record<Source, string>,
): Promise<QueryRecord> {
  const plan = planOf(item);
  const base: RagSettings = { ...DEFAULT_RAG_SETTINGS, ...cfg.settings, minScore: 0, topK: RANK_TOP_K, maxContextChars: 1_000_000 };
  const rec: QueryRecord = {
    config: cfg.id,
    source: item.source,
    id: item.id,
    type: item.type,
    gold: item.gold,
    top: [],
    latencyMs: [],
  };
  try {
    // 워밍업 1회 + 측정 REPS회 (지연은 검색 호출만 잰다)
    await ix.retrieve({ kbIds: [kbId], plan, settings: base });
    let result: RetrievalResult | undefined;
    for (let r = 0; r < REPS; r++) {
      const t0 = performance.now();
      result = await ix.retrieve({ kbIds: [kbId], plan, settings: base });
      rec.latencyMs.push(performance.now() - t0);
    }
    const ev = result?.evidence ?? [];
    const ranked = ev.map((e) => e.path);
    rec.top = ranked.slice(0, 5);
    rec.topScore = ev[0]?.score;
    if (item.gold.length > 0) {
      const rel = new Set(item.gold);
      rec.recall5 = recallAtK(rel, ranked, 5);
      rec.recall10 = recallAtK(rel, ranked, 10);
      rec.hit5 = hitAtK(rel, ranked, 5);
      rec.rr = reciprocalRank(rel, ranked);
      rec.ndcg10 = ndcgAtK(rel, ranked, 10);
      if (item.goldMarker) {
        const target = item.gold[0]!;
        const text = await readFile(path.join(corpora[item.source], target), 'utf8');
        const span = resolveSpan(text, item.goldMarker);
        rec.span5 = ev
          .slice(0, 5)
          .some((e) => e.path === target && spanOverlaps({ startLine: span.startLine, endLine: span.endLine }, { lineStart: e.lineStart, lineEnd: e.lineEnd }));
      }
    } else {
      // 무결과 질의: 기본 임계값과 엄격 임계값에서 근거가 남는지 본다 (오탐)
      const at015 = await ix.retrieve({ kbIds: [kbId], plan, settings: { ...DEFAULT_RAG_SETTINGS, ...cfg.settings, minScore: 0.15 } });
      const at050 = await ix.retrieve({ kbIds: [kbId], plan, settings: { ...DEFAULT_RAG_SETTINGS, ...cfg.settings, minScore: 0.5 } });
      rec.fp015 = at015.evidence.length > 0;
      rec.fp050 = at050.evidence.length > 0;
    }
    // 근거 집합 (LLM에 실제로 가는 것): 기본 설정(topK 6 · 글자 예산 9000 · minScore 0.15)
    rec.ev = await evidenceSample(ix, kbId, plan, { ...DEFAULT_RAG_SETTINGS, ...cfg.settings }, item.gold);
  } catch (err) {
    rec.error = err instanceof Error ? err.message : String(err);
  }
  return rec;
}

async function evidenceSample(ix: KnowledgeIndexer, kbId: string, plan: QueryPlan, settings: RagSettings, gold: string[]): Promise<EvidenceSample> {
  const res = await ix.retrieve({ kbIds: [kbId], plan, settings });
  const paths = res.evidence.map((e) => e.path);
  return {
    count: res.evidence.length,
    chars: res.evidence.reduce((n, e) => n + e.text.length, 0),
    recall: gold.length > 0 ? gold.filter((g) => paths.includes(g)).length / gold.length : undefined,
    fp: gold.length === 0 ? res.evidence.length > 0 : undefined,
  };
}

function safeGit(args: string[]): string | null {
  try {
    return execFileSync('git', ['-C', REPO_ROOT, ...args], { encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

describe('RAG 검색 평가', () => {
  it(
    `평가 실행 → docs/eval/${LABEL}.{json,md}`,
    async () => {
      const { report, outDir } = await runEval();
      await mkdir(outDir, { recursive: true });
      await writeFile(path.join(outDir, `${LABEL}.json`), JSON.stringify(report, null, 2) + '\n');
      await writeFile(path.join(outDir, `${LABEL}.md`), renderMarkdown(report) + '\n');
      process.stdout.write(`[eval ${LABEL}] 결과: ${path.join(outDir, `${LABEL}.md`)}\n`);
    },
    60 * 60 * 1000,
  );
});
