import { mkdirSync, mkdtempSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type FolderDocInput } from '@branch/core';
import { KbToolService, type KbEntry } from '../src';
import { readFolderMeta, refreshFolderMeta } from '../src/rag/folderMeta';
import { keywordSearch } from '../src/kbTools/search';

/**
 * 폴더 메타(meta/folders.json)를 도구 결과에 싣는 동작을 검증한다.
 * 메타는 <kbDir>/meta/ 에 있고, 도구는 <kbDir>/files/ 만 본다. 메타가 없거나 깨지면 기존 동작 그대로여야 한다.
 */
let root: string;
let outside: string;

const DESC = '설치 절차와 환경 변수를 모아 둔 가이드 폴더다.';
const INFO_DOC: FolderDocInput = { path: 'docs/guide/INFO.md', title: 'INFO', hash: 'hi', headings: [], text: DESC };
const INSTALL_DOC: FolderDocInput = {
  path: 'docs/guide/install.md',
  title: '설치',
  hash: 'h1',
  headings: ['설치'],
  text: 'quickstart 설치 방법을 설명한다.',
};
const API_DOC: FolderDocInput = { path: 'docs/guide/api.md', title: 'API', hash: 'h2', headings: ['API'], text: 'endpoint 목록' };

function write(p: string, body: string): void {
  mkdirSync(path.dirname(p), { recursive: true });
  writeFileSync(p, body);
}

/** files/ 본문을 쓰고 메타를 만든다. docs는 실제 파일 경로와 같아야 한다 */
function makeKb(kbId: string, docs: FolderDocInput[], withMeta: boolean): KbEntry {
  const kbDir = path.join(root, kbId);
  const filesRoot = path.join(kbDir, 'files');
  write(path.join(kbDir, 'meta.json'), JSON.stringify({ name: kbId }));
  for (const d of docs) write(path.join(filesRoot, d.path), d.text + '\n');
  if (withMeta) refreshFolderMeta(kbDir, docs, 1_000);
  return { kbId, kbName: kbId, filesRoot };
}

beforeAll(() => {
  root = mkdtempSync(path.join(os.tmpdir(), 'kbmeta-test-'));
  outside = mkdtempSync(path.join(os.tmpdir(), 'kbmeta-outside-'));
  write(path.join(outside, 'x.md'), 'OUTSIDE\n');
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
});

const parsed = (text: string) => JSON.parse(text) as Record<string, unknown>;

describe('폴더 메타 연계 (meta가 있는 KB)', () => {
  let kb: KbEntry;
  beforeAll(() => {
    kb = makeKb('kbmetaaa', [INFO_DOC, INSTALL_DOC, API_DOC], true);
  });
  const svc = () => new KbToolService({ kbs: [kb] });

  it('메타 파일이 실제로 만들어졌다 (전제 확인)', () => {
    const f = readFolderMeta(path.dirname(kb.filesRoot));
    expect(f?.folders.find((x) => x.path === 'docs/guide')?.description).toBe(DESC);
  });

  it('listKnowledgeDirectory는 폴더 설명을 summary로 돌려준다', async () => {
    const r = await svc().call('listKnowledgeDirectory', { kbId: 'kbmetaaa', path: 'docs/guide' });
    expect(r.isError).toBe(false);
    expect(parsed(r.text).summary).toBe(DESC);
  });

  it('getKnowledgeOutline은 폴더 설명을 description으로, 주요 문서를 항목으로 돌려준다', async () => {
    const r = await svc().call('getKnowledgeOutline', { kbId: 'kbmetaaa', path: 'docs/guide' });
    expect(r.isError).toBe(false);
    const out = parsed(r.text) as { description?: string; items: { kind: string; path?: string }[] };
    expect(out.description).toBe(DESC);
    const paths = out.items.map((i) => i.path);
    expect(paths).toContain('docs/guide/install.md');
    expect(paths).toContain('docs/guide/api.md');
    // 주요 문서는 파일 항목으로 나오고, 같은 파일이 두 번 나오지 않는다
    expect(out.items.find((i) => i.path === 'docs/guide/install.md')?.kind).toBe('file');
    expect(paths.filter((p) => p === 'docs/guide/install.md')).toHaveLength(1);
  });

  it('getKnowledgeOutline 목록의 파일은 file, 폴더는 directory로 표시한다', async () => {
    const r = await svc().call('getKnowledgeOutline', { kbId: 'kbmetaaa', path: 'docs' });
    const items = (parsed(r.text) as { items: { kind: string; name: string }[] }).items;
    expect(items.find((i) => i.name === 'guide')?.kind).toBe('directory');
  });

  it('searchKnowledge는 질의에 맞는 폴더를 folders로 돌려준다 (색인이 없으면 메타로 맞춘다)', async () => {
    const r = await svc().call('searchKnowledge', { query: 'guide', kbIds: ['kbmetaaa'] });
    expect(r.isError).toBe(false);
    const folders = (parsed(r.text) as { folders: { kbId: string; path: string }[] }).folders;
    expect(folders.some((f) => f.kbId === 'kbmetaaa' && f.path === 'docs/guide')).toBe(true);
  });

  it('searchKnowledge의 pathPrefix는 폴더 후보에도 적용된다', async () => {
    const other = await svc().call('searchKnowledge', { query: 'guide', kbIds: ['kbmetaaa'], pathPrefix: 'other' });
    expect((parsed(other.text) as { folders: unknown[] }).folders).toEqual([]);
    const same = await svc().call('searchKnowledge', { query: 'guide', kbIds: ['kbmetaaa'], pathPrefix: 'docs/guide' });
    expect((parsed(same.text) as { folders: { path: string }[] }).folders.map((f) => f.path)).toContain('docs/guide');
  });

  it('메타가 낡아 가리키는 주요 문서가 없어지면 목록에서 뺀다', async () => {
    const gone = path.join(kb.filesRoot, 'docs', 'guide', 'api.md');
    unlinkSync(gone);
    const r = await svc().call('getKnowledgeOutline', { kbId: 'kbmetaaa', path: 'docs/guide' });
    const paths = (parsed(r.text) as { items: { path?: string }[] }).items.map((i) => i.path);
    expect(paths).not.toContain('docs/guide/api.md');
    expect(paths).toContain('docs/guide/install.md');
    write(gone, 'endpoint 목록\n');
  });
});

describe('폴더 메타 연계 (meta가 없거나 깨진 KB는 기존 동작)', () => {
  let none: KbEntry;
  let corrupt: KbEntry;
  beforeAll(() => {
    none = makeKb('kbnometa', [INSTALL_DOC], false);
    corrupt = makeKb('kbcorrupt', [INSTALL_DOC], false);
    write(path.join(root, 'kbcorrupt', 'meta', 'folders.json'), '{"version":1,"folders":[{broken');
  });

  it('메타가 없으면 summary·description·folders가 없고 오류도 없다', async () => {
    const s = new KbToolService({ kbs: [none] });
    const list = await s.call('listKnowledgeDirectory', { kbId: 'kbnometa', path: 'docs' });
    expect(list.isError).toBe(false);
    expect(parsed(list.text)).not.toHaveProperty('summary');
    const outline = await s.call('getKnowledgeOutline', { kbId: 'kbnometa', path: 'docs' });
    expect(outline.isError).toBe(false);
    expect(parsed(outline.text)).not.toHaveProperty('description');
    const search = await s.call('searchKnowledge', { query: 'guide', kbIds: ['kbnometa'] });
    expect((parsed(search.text) as { folders: unknown[] }).folders).toEqual([]);
  });

  it('메타 파일이 깨졌으면 메타 없이 동작한다', async () => {
    const s = new KbToolService({ kbs: [corrupt] });
    const list = await s.call('listKnowledgeDirectory', { kbId: 'kbcorrupt', path: 'docs' });
    expect(list.isError).toBe(false);
    expect(parsed(list.text)).not.toHaveProperty('summary');
    const outline = await s.call('getKnowledgeOutline', { kbId: 'kbcorrupt', path: 'docs' });
    expect(outline.isError).toBe(false);
    expect(parsed(outline.text)).not.toHaveProperty('description');
    const search = await s.call('searchKnowledge', { query: 'guide', kbIds: ['kbcorrupt'] });
    expect(search.isError).toBe(false);
    expect((parsed(search.text) as { folders: unknown[] }).folders).toEqual([]);
  });
});

describe('meta/ 디렉터리는 도구로 닿지 않는다', () => {
  let kb: KbEntry;
  beforeAll(() => {
    kb = makeKb('kbsealed', [INFO_DOC, INSTALL_DOC], true);
    // files/ 안에서 meta/로 가는 심볼릭 링크와, 밖(outside)을 가리키는 링크
    symlinkSync(path.join(root, 'kbsealed', 'meta'), path.join(kb.filesRoot, 'metalink'));
    symlinkSync(outside, path.join(kb.filesRoot, 'outlink'));
  });
  const s = () => new KbToolService({ kbs: [kb] });

  it('files/ 밖 경로(..)로는 meta를 읽을 수 없다', async () => {
    const r = await s().call('readKnowledgeFile', { kbId: 'kbsealed', path: '../meta/folders.json', startLine: 1, endLine: 5 });
    expect(r.isError).toBe(true);
    expect(parsed(r.text).error).toBe('bad_path');
  });

  it('files/ 안에 meta 폴더가 없으므로 이름으로 나열·읽기·개요 모두 not_found', async () => {
    const list = await s().call('listKnowledgeDirectory', { kbId: 'kbsealed', path: 'meta' });
    expect(parsed(list.text).error).toBe('not_found');
    const read = await s().call('readKnowledgeFile', { kbId: 'kbsealed', path: 'meta/folders.json', startLine: 1, endLine: 5 });
    expect(parsed(read.text).error).toBe('not_found');
    const outline = await s().call('getKnowledgeOutline', { kbId: 'kbsealed', path: 'meta' });
    expect(parsed(outline.text).error).toBe('not_found');
  });

  it('심볼릭 링크로 meta/에 들어가려 하면 bad_path', async () => {
    const list = await s().call('listKnowledgeDirectory', { kbId: 'kbsealed', path: 'metalink' });
    expect(parsed(list.text).error).toBe('bad_path');
    const read = await s().call('readKnowledgeFile', { kbId: 'kbsealed', path: 'metalink/folders.json', startLine: 1, endLine: 5 });
    expect(parsed(read.text).error).toBe('bad_path');
  });

  it('키워드 검색의 pathPrefix가 심볼릭 링크로 밖을 가리키면 그 KB는 건너뛴다', async () => {
    const r = await keywordSearch([{ kbId: 'kbsealed', kbName: 'sealed', filesRoot: kb.filesRoot }], 'OUTSIDE', { limit: 10, pathPrefix: 'outlink' });
    expect(r.results).toEqual([]);
    expect(r.skipped.map((x) => x.kbId)).toEqual(['kbsealed']);
  });

  it('심볼릭 링크로 밖을 가리키면 bad_path (메타 값이 밖을 가리켜도 읽지 않는다)', async () => {
    const r = await s().call('readKnowledgeFile', { kbId: 'kbsealed', path: 'outlink/x.md', startLine: 1, endLine: 5 });
    expect(parsed(r.text).error).toBe('bad_path');
  });
});
