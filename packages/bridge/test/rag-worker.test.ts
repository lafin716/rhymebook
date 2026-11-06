import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { MessageChannel } from 'node:worker_threads';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_RAG_SETTINGS, type KnowledgeIndexState, type QueryPlan, type RetrievalRequest } from '@branch/core';
import {
  runIndexerWorker,
  startIndexerWorker,
  type KnowledgeIndexer,
  type PortLike,
  type WorkerLike,
} from '../src';

const KB = 'kbworker00001';
const FIXTURES = path.resolve(__dirname, 'fixtures/rag');

let root: string;
const closers: Array<() => Promise<void>> = [];

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'rag-worker-'));
  await mkdir(path.join(root, KB, 'files'), { recursive: true });
  await writeFile(path.join(root, KB, 'meta.json'), JSON.stringify({ name: 'test', createdAt: 1, updatedAt: 1 }), 'utf8');
  await cp(path.join(FIXTURES, 'linux/processes.md'), path.join(root, KB, 'files', 'processes.md'));
});

afterEach(async () => {
  for (const c of closers.splice(0)) await c();
  await rm(root, { recursive: true, force: true });
});

/**
 * 워커 쪽 포트는 runIndexerWorker가 직접 쓰고, 메인 쪽 포트는 WorkerLike로 감싼다.
 * 실제 Worker 스레드 대신 MessageChannel로 같은 RPC 경계를 검증한다.
 */
function startWithChannel(): KnowledgeIndexer {
  const channel = new MessageChannel();
  const workerSide = channel.port1;
  const mainSide = channel.port2;
  runIndexerWorker(workerSide as unknown as PortLike, { root });
  const wrapped: WorkerLike = {
    postMessage: (v) => mainSide.postMessage(v),
    on: (ev, fn) => {
      if (ev === 'message') mainSide.on('message', (data: unknown) => fn(data));
      else mainSide.on(ev, fn as (...a: unknown[]) => void);
      return wrapped;
    },
    terminate: () => {
      mainSide.close();
      workerSide.close();
      return Promise.resolve(0);
    },
  };
  const ix = startIndexerWorker({
    workerPath: '/unused/worker.js',
    root,
    getOpenAIKey: () => undefined,
    spawnWorker: () => wrapped,
  });
  closers.push(() => ix.close());
  return ix;
}

function planFor(question: string): QueryPlan {
  const keywords = question.toLowerCase().split(/\s+/).filter(Boolean);
  return { original: question, rewritten: question, keywords, contextTerms: [], vectorText: question, keywordQuery: keywords, contextual: false };
}

describe('워커 RPC 경계 (MessageChannel)', () => {
  it('enqueue 후 상태 방송으로 색인 완료를 받고 검색한다', async () => {
    const ix = startWithChannel();
    const done = new Promise<KnowledgeIndexState>((resolve) => {
      const off = ix.onState((s) => {
        if (s.kbId === KB && s.status === 'ready') {
          off();
          resolve(s);
        }
      });
    });
    await ix.enqueue(KB);
    const state = await done;
    expect(state.docCount).toBe(1);

    const req: RetrievalRequest = { kbIds: [KB], plan: planFor('zombie wait'), settings: DEFAULT_RAG_SETTINGS };
    const res = await ix.retrieve(req);
    expect(JSON.stringify(res.evidence)).toContain('processes.md');
  });

  it('states와 docs를 RPC로 조회한다', async () => {
    const ix = startWithChannel();
    const states = await ix.states([KB]);
    expect(states).toHaveLength(1);
    expect(states[0]?.kbId).toBe(KB);
    expect(await ix.docs(KB)).toEqual([]);
  });

  it('워커 쪽 오류는 원래 이름과 메시지로 되돌아온다', async () => {
    const ix = startWithChannel();
    await expect(ix.enqueue('not-a-kb')).rejects.toThrow(/invalid kb id/);
  });

  it('close 후 호출은 거절된다', async () => {
    const ix = startWithChannel();
    await ix.close();
    await expect(ix.states([KB])).rejects.toThrow(/closed|unavailable/);
  });
});
