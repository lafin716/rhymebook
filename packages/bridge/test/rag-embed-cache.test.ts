import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHashEmbedder, type EmbeddingProvider, type KnowledgeIndexState } from '@branch/core';
import { createKnowledgeIndexer, type KnowledgeIndexer } from '../src';

const FIXTURES = path.resolve(__dirname, 'fixtures/rag');
const KB = 'kbcache000001';
const TERMINAL = new Set(['ready', 'stale', 'empty', 'error']);

let root: string;
const indexers: KnowledgeIndexer[] = [];

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'rag-cache-'));
  const files = path.join(root, KB, 'files');
  await mkdir(files, { recursive: true });
  await writeFile(path.join(root, KB, 'meta.json'), JSON.stringify({ name: 'test', createdAt: 1, updatedAt: 1 }), 'utf8');
  await cp(path.join(FIXTURES, 'k8s/pods.md'), path.join(files, 'pods.md'));
  await cp(path.join(FIXTURES, 'k8s/services.md'), path.join(files, 'services.md'));
});

afterEach(async () => {
  for (const ix of indexers.splice(0)) await ix.close();
  await rm(root, { recursive: true, force: true });
});

/** 임베딩한 텍스트 개수를 세는 제공자 */
function counting(base: EmbeddingProvider): { provider: EmbeddingProvider; texts: () => number } {
  let n = 0;
  return {
    provider: {
      info: base.info,
      batchSize: base.batchSize,
      async embed(texts, signal) {
        n += texts.length;
        return base.embed(texts, signal);
      },
    },
    texts: () => n,
  };
}

function runJob(ix: KnowledgeIndexer, mode: 'incremental' | 'full'): Promise<KnowledgeIndexState> {
  return new Promise((resolve, reject) => {
    const off = ix.onState((s) => {
      if (s.kbId !== KB || !TERMINAL.has(s.status)) return;
      off();
      resolve(s);
    });
    ix.enqueue(KB, mode).catch((e: unknown) => {
      off();
      reject(e);
    });
  });
}

function make(embedder: EmbeddingProvider): KnowledgeIndexer {
  const ix = createKnowledgeIndexer({ root, getOpenAIKey: () => undefined, retryDelayMs: 1, embedderFor: () => embedder });
  indexers.push(ix);
  return ix;
}

describe('임베딩 캐시 재사용', () => {
  it('전체 재색인은 같은 모델의 캐시를 쓰고 임베딩 호출을 하지 않는다', async () => {
    const first = counting(createHashEmbedder());
    const ix1 = make(first.provider);
    expect((await runJob(ix1, 'incremental')).status).toBe('ready');
    expect(first.texts()).toBeGreaterThan(0);
    await ix1.close();
    indexers.splice(indexers.indexOf(ix1), 1);

    const second = counting(createHashEmbedder());
    const state = await runJob(make(second.provider), 'full');
    expect(state.status).toBe('ready');
    expect(second.texts()).toBe(0);
  });

  it('모델 키(차원)가 다르면 캐시를 쓰지 않고 다시 임베딩한다', async () => {
    const first = counting(createHashEmbedder());
    const ix1 = make(first.provider);
    await runJob(ix1, 'incremental');
    await ix1.close();
    indexers.splice(indexers.indexOf(ix1), 1);

    const other = counting(createHashEmbedder(128));
    const state = await runJob(make(other.provider), 'full');
    expect(state.status).toBe('ready');
    expect(other.texts()).toBeGreaterThan(0);
  });

  it('캐시 재사용은 같은 내용의 파일이 바뀌지 않은 부분에 대해서만 일어난다', async () => {
    const first = counting(createHashEmbedder());
    await runJob(make(first.provider), 'incremental');
    await writeFile(path.join(root, KB, 'files', 'pods.md'), '# 새 문서\n\n완전히 다른 내용의 문단입니다.\n');
    const second = counting(createHashEmbedder());
    const state = await runJob(make(second.provider), 'incremental');
    expect(state.status).toBe('ready');
    expect(second.texts()).toBeGreaterThan(0);
    expect(second.texts()).toBeLessThan(first.texts());
  });
});
