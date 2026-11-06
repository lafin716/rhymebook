import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createNoneEmbedder, type KnowledgeIndexState } from '@branch/core';
import { createKnowledgeIndexer, INDEX_FILE, KbToolService, type KbEntry, type KnowledgeIndexer } from '../src';

/** 검색 후 아무것도 쓰지 않았는지 확인하려고 색인 파일 상태를 잰다 */
const KB_INDEXED = 'kbidxaaaa001';
const KB_SCAN = 'kbscanbbbb002';
const KB_CORRUPT = 'kbbadccccc003';
const UNIQUE = 'zephyrquartz';
const TERMINAL = new Set(['ready', 'stale', 'empty', 'error']);

let root: string;
const indexers: KnowledgeIndexer[] = [];

function filesOf(kbId: string): string {
  return path.join(root, kbId, 'files');
}

async function writeKb(kbId: string, files: Record<string, string>): Promise<void> {
  for (const [rel, body] of Object.entries(files)) {
    const dest = path.join(filesOf(kbId), rel);
    await mkdir(path.dirname(dest), { recursive: true });
    await writeFile(dest, body, 'utf8');
  }
}

/** 색인을 만든다 (테스트 전용: 쓰기 가능 색인기 + 임베딩 없음 + 키 없음) */
async function buildIndex(kbId: string): Promise<KnowledgeIndexState> {
  const ix = createKnowledgeIndexer({
    root,
    getOpenAIKey: () => undefined,
    embedderFor: () => createNoneEmbedder(),
    retryDelayMs: 1,
  });
  indexers.push(ix);
  const state = await new Promise<KnowledgeIndexState>((resolve, reject) => {
    const off = ix.onState((s) => {
      if (s.kbId !== kbId || !TERMINAL.has(s.status)) return;
      off();
      resolve(s);
    });
    ix.enqueue(kbId).catch((e: unknown) => {
      off();
      reject(e);
    });
  });
  await ix.close();
  return state;
}

function serviceFor(kbIds: string[], withRoot: boolean): KbToolService {
  const kbs: KbEntry[] = kbIds.map((kbId) => ({ kbId, kbName: kbId, filesRoot: filesOf(kbId) }));
  return new KbToolService({ kbs, ...(withRoot ? { root } : {}), callTimeoutMs: 20_000 });
}

interface SearchOut {
  results: { kbId: string; path: string; snippet: string; heading?: string }[];
  skipped: { kbId: string; reason: string }[];
  folders: unknown[];
}

async function search(svc: KbToolService, args: Record<string, unknown>): Promise<SearchOut> {
  const r = await svc.call('searchKnowledge', args);
  expect(r.isError).toBe(false);
  return JSON.parse(r.text) as SearchOut;
}

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'kb-idx-tools-'));
});

afterEach(async () => {
  for (const ix of indexers.splice(0)) await ix.close().catch(() => undefined);
  await rm(root, { recursive: true, force: true });
});

describe('searchKnowledge 읽기 전용 색인 경로', () => {
  it('색인이 있는 KB는 FTS 검색 결과를 돌려주고, 검색은 색인 파일을 바꾸지 않는다', async () => {
    await writeKb(KB_INDEXED, {
      'notes/deploy.md': `# 배포\n\n${UNIQUE} 설정은 ci 파이프라인에서 읽는다.\n`,
      'notes/other.md': '# 기타\n\n관련 없는 내용입니다.\n',
    });
    const state = await buildIndex(KB_INDEXED);
    expect(state.status).toBe('ready');
    const indexFile = path.join(root, KB_INDEXED, INDEX_FILE);
    const before = await stat(indexFile);
    const beforeBytes = await readFile(indexFile);

    const svc = serviceFor([KB_INDEXED], true);
    const out = await search(svc, { query: UNIQUE });

    expect(out.results.map((r) => r.path)).toContain('notes/deploy.md');
    const hit = out.results.find((r) => r.path === 'notes/deploy.md');
    expect(hit?.snippet).toContain(UNIQUE);
    // 색인 경로만 제목(heading)을 붙인다. 스캔 결과에는 없다
    expect(hit?.heading).toBeTruthy();
    expect(out.skipped).toEqual([]);

    // 읽기 전용: 파일 내용과 수정 시각이 그대로다
    const after = await stat(indexFile);
    expect(after.mtimeMs).toBe(before.mtimeMs);
    expect(Buffer.compare(await readFile(indexFile), beforeBytes)).toBe(0);
  });

  it('색인 파일이 없으면 키워드 스캔으로 대신하고, 색인을 새로 만들지 않는다', async () => {
    await writeKb(KB_SCAN, { 'guide/setup.md': `# 설치\n\n${UNIQUE} 값을 먼저 확인하세요.\n` });
    const svc = serviceFor([KB_SCAN], true);

    const out = await search(svc, { query: UNIQUE });

    expect(out.results.map((r) => r.path)).toContain('guide/setup.md');
    await expect(stat(path.join(root, KB_SCAN, INDEX_FILE))).rejects.toThrow();
  });

  it('색인 파일이 손상되어 열 수 없으면(스키마 오류 포함) 스캔으로 내려간다', async () => {
    await writeKb(KB_CORRUPT, { 'docs/a.md': `# 문서\n\n${UNIQUE} 항목.\n` });
    await writeFile(path.join(root, KB_CORRUPT, INDEX_FILE), 'not a sqlite database at all');
    const svc = serviceFor([KB_CORRUPT], true);

    const out = await search(svc, { query: UNIQUE });

    expect(out.results.map((r) => r.path)).toContain('docs/a.md');
    expect(out.skipped).toEqual([]);
  });

  it('인덱싱된 KB와 색인 없는 KB를 함께 검색하면 둘 다 결과에 들어간다', async () => {
    await writeKb(KB_INDEXED, { 'a/one.md': `# 하나\n\n${UNIQUE} 첫 문서.\n` });
    await buildIndex(KB_INDEXED);
    await writeKb(KB_SCAN, { 'b/two.md': `# 둘\n\n${UNIQUE} 둘째 문서.\n` });
    const svc = serviceFor([KB_INDEXED, KB_SCAN], true);

    const out = await search(svc, { query: UNIQUE, limit: 10 });

    const kbs = new Set(out.results.map((r) => r.kbId));
    expect(kbs).toEqual(new Set([KB_INDEXED, KB_SCAN]));
  });

  it('root가 없으면 기존처럼 스캔만 한다', async () => {
    await writeKb(KB_INDEXED, { 'c/three.md': `# 셋\n\n${UNIQUE} 셋째.\n` });
    await buildIndex(KB_INDEXED);
    const svc = serviceFor([KB_INDEXED], false);

    const out = await search(svc, { query: UNIQUE });

    expect(out.results.map((r) => r.path)).toContain('c/three.md');
  });
});
