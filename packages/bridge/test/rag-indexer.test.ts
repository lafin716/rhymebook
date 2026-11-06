import { cp, mkdir, mkdtemp, readFile, rename, rm, stat, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHashEmbedder, EmbeddingError, DEFAULT_RAG_SETTINGS, type EmbeddingProvider, type KnowledgeIndexState, type QueryPlan, type RetrievalRequest } from '@branch/core';
import {
  createKnowledgeIndexer,
  INDEX_FILE,
  NEXT_INDEX_FILE,
  PREV_INDEX_FILE,
  type KnowledgeIndexer,
} from '../src';

const FIXTURES = path.resolve(__dirname, 'fixtures/rag');
const KB_A = 'kbalpha000001';
const KB_B = 'kbbravo000002';
const TERMINAL = new Set(['ready', 'stale', 'empty', 'error']);

function planFor(question: string): QueryPlan {
  const keywords = question.toLowerCase().split(/\s+/).filter(Boolean);
  return {
    original: question,
    rewritten: question,
    keywords,
    contextTerms: [],
    vectorText: question,
    keywordQuery: keywords,
    contextual: false,
  };
}

function requestFor(kbIds: string[], question: string): RetrievalRequest {
  return { kbIds, plan: planFor(question), settings: DEFAULT_RAG_SETTINGS };
}

let root: string;
const indexers: KnowledgeIndexer[] = [];

/** 테스트용 meta.json (kind 없음 = 미분류 문서형 동작). 깨진·없는 meta는 색인 경로가 거부하므로 항상 쓴다 */
async function seedMeta(kbDir: string): Promise<void> {
  await writeFile(path.join(kbDir, 'meta.json'), JSON.stringify({ name: 'test', createdAt: 1, updatedAt: 1 }), 'utf8');
}

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'rag-idx-'));
  await mkdir(filesOf(KB_A), { recursive: true });
  await mkdir(filesOf(KB_B), { recursive: true });
  await seedMeta(path.join(root, KB_A));
  await seedMeta(path.join(root, KB_B));
});

afterEach(async () => {
  for (const ix of indexers.splice(0)) await ix.close();
  await rm(root, { recursive: true, force: true });
});

function filesOf(kbId: string): string {
  return path.join(root, kbId, 'files');
}

async function seed(kbId: string, names: string[] = ['k8s/pods.md', 'k8s/services.md']): Promise<void> {
  for (const n of names) {
    const dest = path.join(filesOf(kbId), path.basename(n));
    await mkdir(path.dirname(dest), { recursive: true });
    await cp(path.join(FIXTURES, n), dest);
  }
}

function make(opts: Partial<Parameters<typeof createKnowledgeIndexer>[0]> = {}): KnowledgeIndexer {
  const ix = createKnowledgeIndexer({
    root,
    getOpenAIKey: () => undefined,
    retryDelayMs: 1,
    ...opts,
  });
  indexers.push(ix);
  return ix;
}

/** enqueue 후 작업이 끝날 때(queued·indexing이 아닌 상태)까지 기다린다 */
function runJob(ix: KnowledgeIndexer, kbId: string, mode?: 'incremental' | 'full'): Promise<KnowledgeIndexState> {
  return new Promise((resolve, reject) => {
    const off = ix.onState((s) => {
      if (s.kbId !== kbId || !TERMINAL.has(s.status)) return;
      off();
      resolve(s);
    });
    ix.enqueue(kbId, mode).catch((e: unknown) => {
      off();
      reject(e);
    });
  });
}

describe('색인 기본과 검색', () => {
  it('파일을 색인하고 하이브리드 검색으로 근거를 찾는다', async () => {
    await seed(KB_A);
    const ix = make();
    const state = await runJob(ix, KB_A);
    expect(state.status).toBe('ready');
    expect(state.docCount).toBe(2);
    expect(state.chunkCount).toBeGreaterThan(0);

    const res = await ix.retrieve(requestFor([KB_A], 'restartPolicy 기본값'));
    expect(res.evidence.length).toBeGreaterThan(0);
    expect(JSON.stringify(res.evidence)).toContain('pods.md');
  });

  it('변경 없이 다시 실행해도 문서 수는 그대로다 (증분)', async () => {
    await seed(KB_A);
    const ix = make();
    await runJob(ix, KB_A);
    const before = await ix.docs(KB_A);
    const again = await runJob(ix, KB_A);
    expect(again.status).toBe('ready');
    expect(await ix.docs(KB_A)).toEqual(before);
  });

  it('파일 내용이 바뀌면 증분 색인에 반영된다', async () => {
    await seed(KB_A);
    const ix = make();
    await runJob(ix, KB_A);
    await writeFile(path.join(filesOf(KB_A), 'pods.md'), '# 새 문서\n\n고유어 zebrafishmarker 가 여기에 있다.\n');
    const state = await runJob(ix, KB_A);
    expect(state.status).toBe('ready');
    const res = await ix.retrieve(requestFor([KB_A], 'zebrafishmarker'));
    expect(JSON.stringify(res.evidence)).toContain('pods.md');
  });

  it('같은 내용의 파일을 추가해도 문서는 각자 색인되고 오류 없이 끝난다', async () => {
    await seed(KB_A, ['k8s/pods.md']);
    const ix = make();
    await runJob(ix, KB_A);
    await cp(path.join(FIXTURES, 'k8s/pods.md'), path.join(filesOf(KB_A), 'copy-of-pods.md'));
    const state = await runJob(ix, KB_A);
    expect(state.status).toBe('ready');
    expect(state.docCount).toBe(2);
  });
});

describe('임베딩 실패와 재시도', () => {
  it('재시도 가능한 오류는 다시 시도해 성공한다', async () => {
    await seed(KB_A, ['k8s/pods.md']);
    let failures = 2;
    const base = createHashEmbedder();
    const flaky: EmbeddingProvider = {
      info: base.info,
      batchSize: base.batchSize,
      async embed(texts, signal) {
        if (failures > 0) {
          failures--;
          throw new EmbeddingError('rate limited', true);
        }
        return base.embed(texts, signal);
      },
    };
    const ix = make({ embedderFor: () => flaky });
    const state = await runJob(ix, KB_A);
    expect(state.status).toBe('ready');
    expect(failures).toBe(0);
  });

  it('재시도 불가능한 임베딩 오류는 error 상태로 끝난다', async () => {
    await seed(KB_A, ['k8s/pods.md']);
    const base = createHashEmbedder();
    const broken: EmbeddingProvider = {
      info: base.info,
      batchSize: base.batchSize,
      async embed() {
        throw new EmbeddingError('invalid key', false);
      },
    };
    const ix = make({ embedderFor: () => broken });
    const state = await runJob(ix, KB_A);
    expect(state.status).toBe('error');
    expect(state.error).toBeTruthy();
  });
});

describe('취소·이어하기·전체 재색인', () => {
  it('진행 중 취소하면 색인이 중단되고 다시 실행하면 완료된다', async () => {
    await seed(KB_A);
    const base = createHashEmbedder();
    const slow: EmbeddingProvider = {
      info: base.info,
      batchSize: base.batchSize,
      async embed(texts, signal) {
        await new Promise((r) => setTimeout(r, 30));
        if (signal?.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
        return base.embed(texts, signal);
      },
    };
    const ix = make({ embedderFor: () => slow });
    let cancelRequested = false;
    const cancelled = new Promise<KnowledgeIndexState>((resolve) => {
      const off = ix.onState((s) => {
        if (s.kbId !== KB_A) return;
        if (s.status === 'indexing' && !cancelRequested) {
          cancelRequested = true;
          void ix.cancel(KB_A);
        }
        if (TERMINAL.has(s.status)) {
          off();
          resolve(s);
        }
      });
    });
    await ix.enqueue(KB_A);
    const state = await cancelled;
    expect(['empty', 'stale']).toContain(state.status);

    const done = await runJob(make({ embedderFor: () => base }), KB_A);
    expect(done.status).toBe('ready');
    expect(done.docCount).toBe(2);
  });

  it('full 재색인은 index.next.sqlite를 남기지 않고 본 색인을 교체한다', async () => {
    await seed(KB_A);
    const ix = make();
    await runJob(ix, KB_A);
    const state = await runJob(ix, KB_A, 'full');
    expect(state.status).toBe('ready');
    expect(state.docCount).toBe(2);
    await expect(stat(path.join(root, KB_A, NEXT_INDEX_FILE))).rejects.toThrow();
    await expect(stat(path.join(root, KB_A, INDEX_FILE))).resolves.toBeTruthy();
  });
});

describe('KB 격리와 삭제', () => {
  it('검색 대상 KB 밖의 문서는 결과에 섞이지 않는다', async () => {
    await seed(KB_A, ['k8s/pods.md']);
    await seed(KB_B, ['linux/processes.md']);
    const ix = make();
    await runJob(ix, KB_A);
    await runJob(ix, KB_B);

    const res = await ix.retrieve(requestFor([KB_A], 'zombie process wait'));
    const kbs = new Set(res.evidence.map((e) => e.kbId));
    expect(kbs.has(KB_B)).toBe(false);
  });

  it('markStale은 색인하지 않고 stale로 표시하며, 다시 색인하면 ready가 된다', async () => {
    await seed(KB_A, ['k8s/pods.md']);
    const ix = make();
    await runJob(ix, KB_A);
    await seed(KB_A, ['k8s/services.md']);
    await ix.markStale(KB_A);
    const [st] = await ix.states([KB_A]);
    expect(st?.status).toBe('stale');
    expect(st?.docCount).toBe(1);
    const again = await runJob(ix, KB_A);
    expect(again.status).toBe('ready');
    expect(again.docCount).toBe(2);
  });

  it('drop은 색인 파일만 지우고 원본 files는 남긴다', async () => {
    await seed(KB_A, ['k8s/pods.md']);
    const ix = make();
    await runJob(ix, KB_A);
    await ix.drop(KB_A);
    await expect(stat(path.join(root, KB_A, INDEX_FILE))).rejects.toThrow();
    await expect(readFile(path.join(filesOf(KB_A), 'pods.md'), 'utf8')).resolves.toContain('파드');
  });
});

describe('출처 보기', () => {
  it('검색 결과의 chunkId로 원문과 부모 섹션을 돌려준다', async () => {
    await seed(KB_A, ['linux/filesystems.md']);
    const ix = make();
    await runJob(ix, KB_A);
    const res = await ix.retrieve(requestFor([KB_A], 'inode metadata'));
    const first = res.evidence[0];
    expect(first).toBeDefined();
    const src = await ix.source(first!.kbId, first!.chunkId);
    expect(src?.path).toContain('filesystems.md');
    expect(src?.chunkText.length).toBeGreaterThan(0);
    expect(src?.sectionText.length).toBeGreaterThan(0);
  });
});

describe('PDF 추출', () => {
  it('pdf-lib로 만든 텍스트 PDF를 색인하고 검색한다', async () => {
    const { PDFDocument, StandardFonts } = await import('pdf-lib');
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const page = doc.addPage([400, 200]);
    page.drawText('Quorum replication keeps the cluster consistent.', { x: 20, y: 120, size: 12, font });
    const bytes = await doc.save();
    await writeFile(path.join(filesOf(KB_A), 'quorum.pdf'), bytes);

    const ix = make();
    const state = await runJob(ix, KB_A);
    expect(state.status).toBe('ready');
    const res = await ix.retrieve(requestFor([KB_A], 'quorum replication'));
    expect(JSON.stringify(res.evidence)).toContain('quorum.pdf');
  });
});

describe('색인 교체 잔여물과 복구', () => {
  it('전체 재색인 뒤에는 index.prev.sqlite도 남지 않는다', async () => {
    await seed(KB_A);
    const ix = make();
    await runJob(ix, KB_A);
    await runJob(ix, KB_A, 'full');
    await expect(stat(path.join(root, KB_A, PREV_INDEX_FILE))).rejects.toThrow();
    await expect(stat(path.join(root, KB_A, NEXT_INDEX_FILE))).rejects.toThrow();
  });

  it('교체 도중 본 색인만 prev로 밀려 있으면 다시 열 때 복구한다', async () => {
    await seed(KB_A);
    const first = make();
    await runJob(first, KB_A);
    await first.close();
    indexers.splice(indexers.indexOf(first), 1);

    const dir = path.join(root, KB_A);
    await rename(path.join(dir, INDEX_FILE), path.join(dir, PREV_INDEX_FILE));
    await expect(stat(path.join(dir, INDEX_FILE))).rejects.toThrow();

    const second = make();
    const docs = await second.docs(KB_A);
    expect(docs.length).toBeGreaterThan(0);
    await expect(stat(path.join(dir, INDEX_FILE))).resolves.toBeTruthy();
    await expect(stat(path.join(dir, PREV_INDEX_FILE))).rejects.toThrow();
  });
});

describe('KB 삭제 경합', () => {
  it('작업 도중 drop하면 색인 파일 3종이 모두 남지 않고 이후 enqueue는 거부된다', async () => {
    await seed(KB_A);
    const ix = make();
    const running = new Promise<void>((resolve) => {
      const off = ix.onState((s) => {
        if (s.kbId !== KB_A || s.status !== 'indexing') return;
        off();
        resolve();
      });
    });
    await ix.enqueue(KB_A);
    await running;
    await ix.drop(KB_A);

    const dir = path.join(root, KB_A);
    await expect(stat(path.join(dir, INDEX_FILE))).rejects.toThrow();
    await expect(stat(path.join(dir, NEXT_INDEX_FILE))).rejects.toThrow();
    await expect(stat(path.join(dir, PREV_INDEX_FILE))).rejects.toThrow();
    await expect(ix.enqueue(KB_A)).rejects.toThrow();
    await expect(readFile(path.join(filesOf(KB_A), 'pods.md'), 'utf8')).resolves.toBeTruthy();
  });
});

describe('증분 색인: 변경 감지', () => {
  it('mtime과 크기를 되돌려도 내용이 바뀌면 다시 색인한다', async () => {
    const note = path.join(filesOf(KB_A), 'note.md');
    await writeFile(note, '# 메모\n\nalpha bravo charlie\n');
    const ix = make();
    await runJob(ix, KB_A);

    const before = await stat(note);
    await writeFile(note, '# 메모\n\nalpha delta charlie\n');
    await utimes(note, before.atime, before.mtime);
    expect((await stat(note)).size).toBe(before.size);

    const state = await runJob(ix, KB_A);
    expect(state.status).toBe('ready');
    const res = await ix.retrieve(requestFor([KB_A], 'delta'));
    expect(JSON.stringify(res.evidence)).toContain('note.md');
  });
});

describe('코드 AST 색인과 심볼 신호 (ADR-115)', () => {
  const tsDir = path.dirname(require.resolve('@vscode/tree-sitter-wasm'));
  const SRC = [
    '// 사용자 저장소',
    'export class UserRepository {',
    '  /** id로 사용자 한 명을 찾는다 */',
    '  findUserById(id: string) {',
    '    return this.rows.get(id);',
    '  }',
    '}',
    '',
    'export function normalizeEmail(raw: string): string {',
    '  return raw.trim().toLowerCase();',
    '}',
    '',
  ].join('\n');

  async function symbolCount(kbId: string): Promise<number> {
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(path.join(root, kbId, INDEX_FILE), { readOnly: true });
    try {
      return Number((db.prepare('SELECT COUNT(*) AS n FROM symbols').get() as { n: number }).n);
    } finally {
      db.close();
    }
  }

  it('코드 파일을 함수·클래스 단위로 색인하고 심볼 이름으로 찾는다', async () => {
    await writeFile(path.join(filesOf(KB_A), 'users.ts'), SRC);
    const ix = make({ treeSitterDir: tsDir });
    expect((await runJob(ix, KB_A)).status).toBe('ready');
    expect(await symbolCount(KB_A)).toBeGreaterThanOrEqual(3);

    const res = await ix.retrieve(requestFor([KB_A], 'findUserById'));
    // 작은 클래스는 한 청크로 두고, 멤버 이름은 심볼 표로만 그 청크를 가리킨다
    expect(res.evidence[0]?.symbol).toBe('UserRepository');
    expect(res.evidence[0]?.text).toContain('findUserById');
    const res2 = await ix.retrieve(requestFor([KB_A], 'normalize email'));
    expect(res2.evidence.some((e) => e.symbol === 'normalizeEmail')).toBe(true);
  });

  it('청커가 바뀌면 변경 없는 코드 문서도 다시 청킹한다', async () => {
    await writeFile(path.join(filesOf(KB_A), 'users.ts'), SRC);
    const regexIx = make();
    expect((await runJob(regexIx, KB_A)).status).toBe('ready');
    expect(await symbolCount(KB_A)).toBe(0);
    await regexIx.close();
    indexers.splice(indexers.indexOf(regexIx), 1);

    const astIx = make({ treeSitterDir: tsDir });
    expect((await runJob(astIx, KB_A)).status).toBe('ready');
    expect(await symbolCount(KB_A)).toBeGreaterThanOrEqual(3);
  });
});
