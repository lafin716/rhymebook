import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi, type MockedFunction } from 'vitest';
import {
  createHashEmbedder,
  KnowledgePolicyError,
  type EmbeddingProvider,
  type KnowledgeIndexSettings,
} from '@branch/core';
import { createKnowledgeIndexer, createKnowledgeStore, type KnowledgeIndexer, type KnowledgeStore } from '../src';

/**
 * 코드베이스 정책 가드 (ADR-127·129): 어떤 경로로도 임베딩·색인·색인 파일 생성이 일어나지 않아야 한다.
 * 색인기와 저장소 두 층 모두에서 거부되는지 확인한다 (UI·IPC 검사를 우회해도 막히는지).
 */

let base: string;
let root: string;
let project: string;
let kbId: string;
let store: KnowledgeStore;
let indexer: KnowledgeIndexer | undefined;
let embedderCalls: number;
let embedderFor: MockedFunction<(kbId: string, settings: KnowledgeIndexSettings) => EmbeddingProvider>;

beforeEach(async () => {
  base = await mkdtemp(path.join(os.tmpdir(), 'kb-guard-'));
  root = path.join(base, 'knowledge');
  project = path.join(base, 'project');
  await mkdir(path.join(project, 'src'), { recursive: true });
  await writeFile(path.join(project, 'src', 'main.ts'), 'export const needleCodebase = 1;\n');
  await writeFile(path.join(project, 'package.json'), '{"name":"demo"}\n');
  store = createKnowledgeStore({ root });
  const kb = await store.create('데모 코드', { kind: 'codebase', linkedPath: project });
  kbId = kb.id;
  embedderCalls = 0;
  const base0 = createHashEmbedder();
  const spy: EmbeddingProvider = {
    info: base0.info,
    batchSize: base0.batchSize,
    async embed(texts, signal) {
      embedderCalls++;
      return base0.embed(texts, signal);
    },
  };
  embedderFor = vi.fn((_kbId: string, _settings: KnowledgeIndexSettings) => spy);
  indexer = createKnowledgeIndexer({ root, getOpenAIKey: () => 'sk-test-not-used', embedderFor, retryDelayMs: 1 });
});

afterEach(async () => {
  await indexer?.close();
  indexer = undefined;
  // store.create가 뒤에서 통계를 쓰므로(measureLater) 잠깐 기다리는 재시도를 허용한다
  await rm(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

async function indexFilesIn(dir: string): Promise<string[]> {
  return (await readdir(dir)).filter((n) => n.startsWith('index') && n.endsWith('.sqlite'));
}

function expectPolicy(p: Promise<unknown>, code: string): Promise<void> {
  return p.then(
    () => {
      throw new Error(`expected ${code}`);
    },
    (err: unknown) => {
      expect(err).toBeInstanceOf(KnowledgePolicyError);
      expect((err as KnowledgePolicyError).code).toBe(code);
    },
  );
}

describe('코드베이스 색인 거부 (색인기 층)', () => {
  it('enqueue는 codebase_index_forbidden으로 거부하고 임베딩을 부르지 않는다', async () => {
    await expectPolicy(indexer!.enqueue(kbId, 'incremental'), 'codebase_index_forbidden');
    await expectPolicy(indexer!.enqueue(kbId, 'full'), 'codebase_index_forbidden');
    expect(embedderFor).not.toHaveBeenCalled();
    expect(embedderCalls).toBe(0);
  });

  it('reindex(full · paths · retryFailed) 모두 거부한다', async () => {
    await expectPolicy(indexer!.reindex(kbId, { full: true }), 'codebase_index_forbidden');
    await expectPolicy(indexer!.reindex(kbId, { paths: ['src/main.ts'] }), 'codebase_index_forbidden');
    await expectPolicy(indexer!.reindex(kbId, { retryFailed: true }), 'codebase_index_forbidden');
    await expectPolicy(indexer!.reindex(kbId), 'codebase_index_forbidden');
    expect(embedderCalls).toBe(0);
  });

  it('verify는 거부한다 (색인이 없으므로 무결성 검사 대상이 아니다)', async () => {
    await expectPolicy(indexer!.verify(kbId), 'codebase_index_forbidden');
  });

  it('거부된 모든 호출 뒤에도 index*.sqlite가 만들어지지 않는다', async () => {
    await indexer!.enqueue(kbId).catch(() => undefined);
    await indexer!.reindex(kbId, { full: true }).catch(() => undefined);
    await indexer!.verify(kbId).catch(() => undefined);
    expect(await indexFilesIn(path.join(root, kbId))).toEqual([]);
    expect(embedderCalls).toBe(0);
  });
});

describe('코드베이스 설정 거부 (저장소 층)', () => {
  it('setSettings는 codebase_index_forbidden으로 거부한다', async () => {
    await expectPolicy(
      store.setSettings(kbId, { embedding: { provider: 'local-hash' } }),
      'codebase_index_forbidden',
    );
  });

  it('setExcludes는 코드베이스에서만 되고, 문서형에는 거부한다', async () => {
    const doc = await store.create('문서');
    await expect(store.setExcludes(doc.id, ['dist/'])).rejects.toThrow();
    const saved = await store.setExcludes(kbId, ['dist/', 'coverage/']);
    expect(saved.excludes).toEqual(['dist/', 'coverage/']);
  });

  it('연결 폴더 코드베이스는 문서형으로 바꿀 수 없다 (linked_kind_locked)', async () => {
    await expectPolicy(store.setKind(kbId, 'document'), 'linked_kind_locked');
    const meta = (await store.list()).find((k) => k.id === kbId);
    expect(meta?.kind).toBe('codebase');
    expect(meta?.linkedPath).toBe(await (await import('node:fs/promises')).realpath(project));
  });
});

describe('IPC 우회 불가 (두 층 모두)', () => {
  it('저장소 설정 → 색인기 enqueue 순서로 우회해도 색인 파일·임베딩이 생기지 않는다', async () => {
    await expect(store.setSettings(kbId, { embedding: { provider: 'local-hash' } })).rejects.toBeInstanceOf(KnowledgePolicyError);
    await expectPolicy(indexer!.enqueue(kbId), 'codebase_index_forbidden');
    expect(await indexFilesIn(path.join(root, kbId))).toEqual([]);
    expect(embedderCalls).toBe(0);
    expect(embedderFor).not.toHaveBeenCalled();
  });

  it('settingsChanged·markStale도 색인 파일을 만들지 않는다', async () => {
    await indexer!.settingsChanged(kbId).catch(() => undefined);
    await indexer!.markStale(kbId).catch(() => undefined);
    expect(await indexFilesIn(path.join(root, kbId))).toEqual([]);
    expect(embedderCalls).toBe(0);
  });
});
