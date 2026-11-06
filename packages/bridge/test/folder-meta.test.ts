import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_RAG_SETTINGS,
  FOLDER_META_VERSION,
  tokenize,
  type FolderDocInput,
  type KnowledgeIndexState,
  type QueryPlan,
  type RetrievalRequest,
} from '@branch/core';
import { createKnowledgeIndexer, INDEX_FILE, type KnowledgeIndexer } from '../src';
import { FOLDERS_FILE, metaDirOf, readFolderMeta, refreshFolderMeta } from '../src/rag/folderMeta';
import { IndexRepository } from '../src/rag/sqliteRepository';
import { retrieveFrom, type KbSearchTarget } from '../src/rag/searchEngine';

const KB = 'kbfolders00001';
const TERMINAL = new Set(['ready', 'stale', 'empty', 'error']);

const FILES: Record<string, string> = {
  'README.md': '# 프로젝트 개요\n\n전체 안내입니다.',
  'auth/login.md': '# 로그인 흐름\n\nJWT 토큰 검증 로직과 세션 쿠키를 설명합니다.',
  'auth/INFO.md': '# 인증 모듈\n\n로그인과 토큰을 다루는 폴더입니다.',
  'infra/deploy.md': '# 배포 절차\n\n도커 이미지를 빌드하고 쿠버네티스에 배포합니다.',
  'infra/k8s/ingress.md': '# Ingress 설정\n\n쿠버네티스 Ingress 라우팅 설정입니다.',
};

function docsFrom(files: Record<string, string>): FolderDocInput[] {
  return Object.entries(files).map(([p, body]) => ({
    path: p,
    title: p.split('/').pop() ?? p,
    hash: `h:${body}`,
    headings: (body.match(/^#+\s+.+$/gm) ?? []).map((h) => h.replace(/^#+\s+/, '').trim()),
    text: body,
  }));
}

let root: string;
let kbDir: string;
const indexers: KnowledgeIndexer[] = [];

function make(): KnowledgeIndexer {
  const ix = createKnowledgeIndexer({ root, getOpenAIKey: () => undefined, retryDelayMs: 1 });
  indexers.push(ix);
  return ix;
}

function runJob(ix: KnowledgeIndexer, kbId: string): Promise<KnowledgeIndexState> {
  return new Promise((resolve, reject) => {
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
}

async function seedFiles(files: Record<string, string>): Promise<void> {
  for (const [rel, body] of Object.entries(files)) {
    const file = path.join(kbDir, 'files', rel);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, body);
  }
}

function planKo(question: string): QueryPlan {
  const keywords = [...new Set(tokenize(question))];
  return { original: question, rewritten: question, keywords, contextTerms: [], vectorText: question, keywordQuery: keywords, contextual: false } as unknown as QueryPlan;
}

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'folder-meta-'));
  kbDir = path.join(root, KB);
});

afterEach(async () => {
  for (const ix of indexers.splice(0)) await ix.close();
  await rm(root, { recursive: true, force: true });
});

describe('폴더 메타데이터 저장 (직접 호출)', () => {
  it('처음 만들면 folders.json·INDEX.md·폴더별 INFO.md를 쓴다', async () => {
    await mkdir(kbDir, { recursive: true });
    const r = refreshFolderMeta(kbDir, docsFrom(FILES), 1700000000000);
    expect(r.folders).toBe(4);
    expect(r.reused).toBe(0);
    const meta = readFolderMeta(kbDir);
    expect(meta?.version).toBe(FOLDER_META_VERSION);
    expect(meta?.folders.map((f) => f.path)).toEqual(['', 'auth', 'infra', 'infra/k8s']);
    expect(await readFile(path.join(metaDirOf(kbDir), 'INDEX.md'), 'utf8')).toContain('# 폴더 색인');
    expect(await readFile(path.join(metaDirOf(kbDir), 'tree', 'auth', 'INFO.md'), 'utf8')).toContain('# 인증 모듈');
  });

  it('증분: 한 문서만 바뀌면 나머지 폴더는 재사용하고 INFO.md도 바뀐 폴더 것만 다시 쓴다', async () => {
    await mkdir(kbDir, { recursive: true });
    refreshFolderMeta(kbDir, docsFrom(FILES), 1);
    const authInfo = path.join(metaDirOf(kbDir), 'tree', 'auth', 'INFO.md');
    const before = await readFile(authInfo, 'utf8');

    const changed = { ...FILES, 'infra/deploy.md': '# 배포 절차\n\n새 내용입니다.' };
    const r = refreshFolderMeta(kbDir, docsFrom(changed), 2);
    expect(r.reused).toBe(2); // auth, infra/k8s (루트·infra는 하위 해시가 바뀜)
    expect(r.written).toBeLessThan(r.folders);
    expect(await readFile(authInfo, 'utf8')).toBe(before);
    expect(readFolderMeta(kbDir)?.generatedAt).toBe(2);
  });

  it('사라진 폴더의 INFO.md는 지운다', async () => {
    await mkdir(kbDir, { recursive: true });
    refreshFolderMeta(kbDir, docsFrom(FILES), 1);
    const without = { ...FILES };
    delete without['infra/k8s/ingress.md'];
    refreshFolderMeta(kbDir, docsFrom(without), 2);
    await expect(stat(path.join(metaDirOf(kbDir), 'tree', 'infra', 'k8s', 'INFO.md'))).rejects.toThrow();
    expect(readFolderMeta(kbDir)?.folders.map((f) => f.path)).toEqual(['', 'auth', 'infra']);
  });

  it('안전하지 않은 폴더 경로(..)는 거부한다 (호출자가 폴백)', async () => {
    await mkdir(kbDir, { recursive: true });
    expect(() => refreshFolderMeta(kbDir, docsFrom({ '../escape/x.md': '# x\n\nbody' }), 1)).toThrow();
  });
});

describe('폴백: 메타데이터 없음·깨짐', () => {
  it('파일이 없으면 null', async () => {
    await mkdir(kbDir, { recursive: true });
    expect(readFolderMeta(kbDir)).toBeNull();
  });

  it('JSON이 깨졌거나 버전이 다르면 null, 다음 갱신은 전부 다시 만든다', async () => {
    await mkdir(kbDir, { recursive: true });
    refreshFolderMeta(kbDir, docsFrom(FILES), 1);
    await writeFile(path.join(metaDirOf(kbDir), FOLDERS_FILE), '{ 깨진 json');
    expect(readFolderMeta(kbDir)).toBeNull();
    const r = refreshFolderMeta(kbDir, docsFrom(FILES), 2);
    expect(r.reused).toBe(0);
    expect(readFolderMeta(kbDir)?.folders.length).toBe(4);
  });

  it('메타데이터가 없어도 원문 검색은 근거를 낸다 (폴더 후보만 빈 목록)', async () => {
    await seedFiles(FILES);
    const ix = make();
    const state = await runJob(ix, KB);
    expect(state.status).toBe('ready');
    await ix.close();
    indexers.splice(indexers.indexOf(ix), 1);

    await rm(path.join(metaDirOf(kbDir), FOLDERS_FILE), { force: true });
    const repo = IndexRepository.openReadOnly(path.join(kbDir, INDEX_FILE));
    try {
      const target: KbSearchTarget = { kbId: KB, kbName: KB, repo, folders: readFolderMeta(kbDir)?.folders };
      const req: RetrievalRequest = { kbIds: [KB], plan: planKo('JWT 토큰 검증 로직'), settings: DEFAULT_RAG_SETTINGS };
      const result = await retrieveFrom([target], req);
      expect(result.evidence.length).toBeGreaterThan(0);
      expect(result.folders).toBeUndefined();
    } finally {
      repo.close();
    }
  });
});

describe('색인 연동', () => {
  it('색인이 끝나면 폴더 메타데이터를 만들고 상태에 folderCount를 담는다', async () => {
    await seedFiles(FILES);
    const ix = make();
    const state = await runJob(ix, KB);
    expect(state.status).toBe('ready');
    expect(state.folderCount).toBe(4);
    expect(readFolderMeta(kbDir)?.folders.length).toBe(4);
  });

  it('검색 결과에 질의와 맞는 폴더 후보를 붙인다', async () => {
    await seedFiles(FILES);
    const ix = make();
    await runJob(ix, KB);
    await ix.close();
    indexers.splice(indexers.indexOf(ix), 1);

    const repo = IndexRepository.openReadOnly(path.join(kbDir, INDEX_FILE));
    try {
      const target: KbSearchTarget = { kbId: KB, kbName: KB, repo, folders: readFolderMeta(kbDir)?.folders };
      const req: RetrievalRequest = { kbIds: [KB], plan: planKo('인증 토큰은 어떻게 검증해?'), settings: DEFAULT_RAG_SETTINGS };
      const result = await retrieveFrom([target], req);
      expect(result.folders?.[0]?.path).toBe('auth');
      expect(result.folders?.[0]?.kbId).toBe(KB);
    } finally {
      repo.close();
    }
  });
});
