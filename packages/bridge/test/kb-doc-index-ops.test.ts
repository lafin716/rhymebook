import { existsSync } from 'node:fs';
import { mkdtemp, rm, unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_RAG_SETTINGS,
  INDEX_FORMAT_VERSION,
  type KnowledgeIndexState,
  type QueryPlan,
  type RetrievalRequest,
} from '@branch/core';
import {
  createKnowledgeIndexer,
  createKnowledgeStore,
  INDEX_FILE,
  NEXT_INDEX_FILE,
  PREV_INDEX_FILE,
  type KnowledgeIndexer,
  type KnowledgeStore,
} from '../src';

/**
 * 문서형 색인 운영 (ADR-130): 키워드 전용 검색, 실패 재시도, 부분 재색인, 무결성 점검, 전체 재생성.
 * 원본 files/는 색인 작업으로 바뀌거나 지워지지 않아야 한다.
 */

const TERMINAL = new Set(['ready', 'stale', 'empty', 'error']);

let base: string;
let root: string;
let store: KnowledgeStore;
let indexer: KnowledgeIndexer;
let kbId: string;
let kbDir: string;
let filesDir: string;
/** 외부 임베딩 키를 요청한 횟수 (none·local-hash 문서 KB에서는 0이어야 한다) */
let keyAsked: number;

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

function search(question: string): RetrievalRequest {
  return { kbIds: [kbId], plan: planFor(question), settings: DEFAULT_RAG_SETTINGS };
}

function runJob(): Promise<KnowledgeIndexState> {
  return new Promise((resolve, reject) => {
    const off = indexer.onState((s) => {
      if (s.kbId !== kbId || !TERMINAL.has(s.status)) return;
      off();
      resolve(s);
    });
    // 구독을 먼저 걸고 예약한다. 터미널 상태(ready 등)는 작업이 완전히 끝난 뒤에만 나온다
    indexer.enqueue(kbId).catch((e: unknown) => {
      off();
      reject(e);
    });
  });
}

async function fullJob(opts: Parameters<KnowledgeIndexer['reindex']>[1]): Promise<KnowledgeIndexState> {
  return new Promise((resolve, reject) => {
    const off = indexer.onState((s) => {
      if (s.kbId !== kbId || !TERMINAL.has(s.status)) return;
      off();
      resolve(s);
    });
    indexer.reindex(kbId, opts).catch((e: unknown) => {
      off();
      reject(e);
    });
  });
}

beforeEach(async () => {
  base = await mkdtemp(path.join(os.tmpdir(), 'kb-ops-'));
  root = path.join(base, 'knowledge');
  store = createKnowledgeStore({ root });
  const kb = await store.create('운영 문서');
  kbId = kb.id;
  kbDir = path.join(root, kbId);
  filesDir = path.join(kbDir, 'files');
  await store.setSettings(kbId, { embedding: { provider: 'none' } });
  await store.addFiles(kbId, [
    { name: 'alpha.md', data: new TextEncoder().encode('# 알파\n\nquartzRefund 절차는 영업일 3일이다.\n') },
    { name: 'beta.md', data: new TextEncoder().encode('# 베타\n\n사과 바나나 포도 목록이다.\n') },
    { name: 'gamma.md', data: new TextEncoder().encode('# 감마\n\nzebraArchive 보관 정책.\n') },
    { name: 'broken.pdf', data: new TextEncoder().encode('이것은 PDF가 아니다') },
  ]);
  keyAsked = 0;
  // 임베딩 공급자 주입 없이 실제 경로(provider 'none')를 탄다
  indexer = createKnowledgeIndexer({
    root,
    getOpenAIKey: () => {
      keyAsked++;
      return undefined;
    },
    retryDelayMs: 1,
  });
});

afterEach(async () => {
  await indexer.close();
  await rm(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

describe('키워드 전용 검색 (임베딩 none)', () => {
  it('임베딩 없이도 키워드 검색이 되고, 공급자를 부르지 않는다', async () => {
    const state = await runJob();
    expect(['ready', 'error']).toContain(state.status);
    const res = await indexer.retrieve(search('quartzRefund'));
    expect(res.evidence.some((e) => e.path === 'alpha.md')).toBe(true);
    expect(keyAsked).toBe(0);
  });

  it('PDF 파싱에 실패한 문서는 오류 문서로 남고 나머지는 색인된다', async () => {
    await runJob();
    const docs = await indexer.docs(kbId);
    expect(docs.find((d) => d.path === 'broken.pdf')?.status).toBe('error');
    expect(docs.find((d) => d.path === 'alpha.md')?.status).toBe('ok');
  });
});

describe('실패 재시도', () => {
  it('retryFailed 재색인은 실패한 문서를 다시 시도한다', async () => {
    await runJob();
    const before = (await indexer.docs(kbId)).find((d) => d.path === 'broken.pdf');
    expect(before?.status).toBe('error');
    await new Promise((r) => setTimeout(r, 5));

    const state = await fullJob({ retryFailed: true });
    expect(TERMINAL.has(state.status)).toBe(true);

    const after = (await indexer.docs(kbId)).find((d) => d.path === 'broken.pdf');
    // 다시 시도했으므로 색인 시각이 갱신된다 (내용은 여전히 PDF가 아니라서 오류 상태 유지)
    expect(after?.indexedAt ?? 0).toBeGreaterThan(before?.indexedAt ?? 0);
    expect(after?.status).toBe('error');
  });
});

describe('부분 재색인', () => {
  it('paths로 지정한 파일만 다시 색인하고 나머지는 그대로 둔다', async () => {
    await runJob();
    await writeFile(path.join(filesDir, 'alpha.md'), '# 알파\n\nquartzRefund 개정: 영업일 5일.\n');
    await writeFile(path.join(filesDir, 'beta.md'), '# 베타\n\nmangoRevised 목록.\n');

    await fullJob({ paths: ['alpha.md'] });

    expect((await indexer.retrieve(search('개정'))).evidence.some((e) => e.path === 'alpha.md')).toBe(true);
    // beta는 paths 밖이라 새 내용이 색인되지 않는다
    expect((await indexer.retrieve(search('mangoRevised'))).evidence.some((e) => e.path === 'beta.md')).toBe(false);
  });

  it('paths에 files/ 밖 경로가 있으면 거부한다', async () => {
    await expect(indexer.reindex(kbId, { paths: ['../secret.md'] })).rejects.toThrow();
  });
});

describe('무결성 점검과 전체 재생성', () => {
  it('변경·삭제·추가 뒤 verify가 각각을 집계하고, 전체 재생성 뒤 ok가 된다', async () => {
    // 깨진 PDF가 있으면 failedDocs > 0 이라 ok가 아니다 — 이 시나리오는 PDF를 빼고 시작한다
    await unlink(path.join(filesDir, 'broken.pdf'));
    await runJob();
    expect((await indexer.verify(kbId)).ok).toBe(true);

    // 원본을 바꾸고(changed), 지우고(orphaned), 새로 넣는다(missing) — 재색인 없이
    await writeFile(path.join(filesDir, 'beta.md'), '# 베타\n\n바뀐 내용.\n');
    await unlink(path.join(filesDir, 'gamma.md'));
    await writeFile(path.join(filesDir, 'delta.md'), '# 델타\n\n새 문서.\n');

    const dirty = await indexer.verify(kbId);
    expect(dirty.ok).toBe(false);
    expect(dirty.changed).toBeGreaterThanOrEqual(1);
    expect(dirty.orphaned).toBe(1);
    expect(dirty.missing).toBe(1);
    expect(dirty.storageOk).toBe(true);
    expect(dirty.formatVersion).toBe(INDEX_FORMAT_VERSION);
    expect(dirty.expectedFormatVersion).toBe(INDEX_FORMAT_VERSION);
    expect(dirty.samples.length).toBeGreaterThan(0);

    await fullJob({ full: true });

    const clean = await indexer.verify(kbId);
    expect(clean.failedDocs).toBe(0);
    expect(clean.ok).toBe(true);
    expect(clean.changed + clean.orphaned + clean.missing).toBe(0);
    expect(clean.storageOk).toBe(true);
    // 교체가 성공하면 이전 색인(prev)과 새 색인 임시본(next)은 남지 않는다
    expect(existsSync(path.join(kbDir, INDEX_FILE))).toBe(true);
    expect(existsSync(path.join(kbDir, PREV_INDEX_FILE))).toBe(false);
    expect(existsSync(path.join(kbDir, NEXT_INDEX_FILE))).toBe(false);
  });

  it('원본 files/는 색인 작업으로 바뀌거나 지워지지 않는다', async () => {
    await runJob();
    await fullJob({ full: true });
    expect(existsSync(path.join(filesDir, 'alpha.md'))).toBe(true);
    expect(existsSync(path.join(filesDir, 'broken.pdf'))).toBe(true);
  });

  it('release 뒤 색인 파일을 지우고 다시 만들 수 있다', async () => {
    await unlink(path.join(filesDir, 'broken.pdf'));
    await runJob();
    await indexer.release(kbId);
    await rm(path.join(kbDir, INDEX_FILE), { force: true });
    await rm(path.join(kbDir, PREV_INDEX_FILE), { force: true });
    expect(existsSync(path.join(kbDir, INDEX_FILE))).toBe(false);

    const state = await runJob();
    expect(['ready', 'error']).toContain(state.status);
    expect(existsSync(path.join(kbDir, INDEX_FILE))).toBe(true);
    expect((await indexer.retrieve(search('quartzRefund'))).evidence.some((e) => e.path === 'alpha.md')).toBe(true);
    expect((await indexer.verify(kbId)).ok).toBe(true);
  });
});
