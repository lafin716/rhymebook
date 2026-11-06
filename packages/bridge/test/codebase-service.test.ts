import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { KB_TOOL_NAMES } from '@branch/core';
import { KbToolService, loadKbEntries, kbToolsNote, type KbEntry } from '../src';
import { mergeFairly } from '../src/kbTools/merge';

/** 코드베이스 KB 라우팅: 색인 없이 실제 파일을 읽고, 문서형 KB와 섞이지 않는지 확인한다 */
let root: string;
let codeFiles: string;
let docFiles: string;
let linked: string;
let code: KbEntry;
let doc: KbEntry;

function write(p: string, body: string): void {
  mkdirSync(path.dirname(p), { recursive: true });
  writeFileSync(p, body);
}

const parsed = (text: string) => JSON.parse(text) as Record<string, unknown>;

beforeAll(() => {
  root = mkdtempSync(path.join(os.tmpdir(), 'cbsvc-'));
  codeFiles = path.join(root, 'kbcode001', 'files');
  docFiles = path.join(root, 'kbdoc0001', 'files');
  linked = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'cblinked-')));
  write(path.join(codeFiles, 'src', 'app.ts'), 'export function startServer() {\n  return 1;\n}\n');
  write(path.join(codeFiles, 'src', 'more.ts'), 'return 2;\n');
  write(path.join(codeFiles, 'node_modules', 'x', 'i.js'), 'function startServer() {}\n');
  write(path.join(docFiles, 'note.md'), '# 노트\n서버 설정 메모\n');
  write(path.join(linked, 'lib', 'util.py'), 'def startServer():\n    pass\n');
  code = { kbId: 'kbcode001', kbName: '코드 KB', filesRoot: codeFiles, kind: 'codebase', excludes: [] };
  doc = { kbId: 'kbdoc0001', kbName: '문서 KB', filesRoot: docFiles };
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(linked, { recursive: true, force: true });
});

describe('KbToolService 코드베이스 라우팅', () => {
  it('searchKnowledge는 코드베이스 KB를 실제 파일에서 찾고 색인 건너뜀 표시가 없다', async () => {
    const svc = new KbToolService({ kbs: [code, doc] });
    const r = await svc.call('searchKnowledge', { query: 'startServer', kbIds: ['kbcode001'] });
    expect(r.isError).toBe(false);
    const out = parsed(r.text) as { results: { kbId: string; path: string; startLine?: number }[]; skipped: unknown[] };
    expect(out.results.some((x) => x.kbId === 'kbcode001' && x.path === 'src/app.ts')).toBe(true);
    expect(out.results.some((x) => x.path.startsWith('node_modules/'))).toBe(false);
    expect(out.skipped).toEqual([]);
  });

  it('listKnowledgeDirectory는 코드베이스 제외 규칙을 적용하고 폴더 메타를 붙이지 않는다', async () => {
    const svc = new KbToolService({ kbs: [code] });
    const r = await svc.call('listKnowledgeDirectory', { kbId: 'kbcode001' });
    const names = (parsed(r.text).entries as { name: string }[]).map((e) => e.name);
    expect(names).toContain('src');
    expect(names).not.toContain('node_modules');
    expect(parsed(r.text).summary).toBeUndefined();
  });

  it('readKnowledgeFile은 코드베이스 파일 줄 범위를 읽는다', async () => {
    const svc = new KbToolService({ kbs: [code] });
    const r = await svc.call('readKnowledgeFile', { kbId: 'kbcode001', path: 'src/app.ts', startLine: 1, endLine: 2 });
    expect(r.isError).toBe(false);
    expect(parsed(r.text)).toMatchObject({ startLine: 1, totalLines: 3, truncated: true });
    const mid = await svc.call('readKnowledgeFile', { kbId: 'kbcode001', path: 'src/app.ts', startLine: 2 });
    expect(parsed(mid.text)).toMatchObject({ path: 'src/app.ts', startLine: 2, endLine: 3, truncated: false });
  });

  it('getKnowledgeOutline은 코드베이스 파일에서 선언을 낸다', async () => {
    const svc = new KbToolService({ kbs: [code] });
    const r = await svc.call('getKnowledgeOutline', { kbId: 'kbcode001', path: 'src/app.ts' });
    expect(r.isError).toBe(false);
    expect(JSON.stringify(parsed(r.text).items)).toContain('startServer');
  });

  it('findFiles·grepKnowledge·findDefinitions는 결과와 잘림 표시를 돌려준다', async () => {
    const svc = new KbToolService({ kbs: [code] });
    const f = parsed((await svc.call('findFiles', { kbId: 'kbcode001', pattern: '*.ts', limit: 5 })).text);
    expect(f.paths).toEqual(['src/app.ts', 'src/more.ts']);
    expect(f.truncated).toBe(false);

    const g = parsed((await svc.call('grepKnowledge', { kbId: 'kbcode001', pattern: 'startserver' })).text);
    expect((g.hits as { path: string }[]).map((h) => h.path)).toEqual(['src/app.ts']);
    expect(g.scannedFiles).toBeGreaterThan(0);
    expect(g.notes).toEqual([]);

    const d = parsed((await svc.call('findDefinitions', { kbId: 'kbcode001', symbol: 'startServer' })).text);
    expect(d.hits).toEqual([expect.objectContaining({ path: 'src/app.ts', line: 1, kind: 'function' })]);
  });

  it('limit을 넘는 결과는 truncated=true로 표시한다', async () => {
    const svc = new KbToolService({ kbs: [code] });
    const r = parsed((await svc.call('findFiles', { kbId: 'kbcode001', pattern: '*.ts', limit: 1 })).text);
    expect(r.paths).toHaveLength(1);
    expect(r.truncated).toBe(true);
    const g = parsed((await svc.call('grepKnowledge', { kbId: 'kbcode001', pattern: 'return', limit: 1 })).text);
    expect((g.hits as unknown[]).length).toBe(1);
    expect(g.truncated).toBe(true);
  });

  it('잘못된 정규식은 bad_input으로 거부한다', async () => {
    const svc = new KbToolService({ kbs: [code] });
    const r = await svc.call('grepKnowledge', { kbId: 'kbcode001', pattern: '(a+)+$', regex: true });
    if (r.isError) expect(parsed(r.text).error).toBe('bad_input');
  });

  it('연결 폴더가 사라진 코드베이스는 not_found로 알리고, 검색은 건너뛴다', async () => {
    const gone: KbEntry = { ...code, kbId: 'kbgone001', kbName: '사라짐', missing: true };
    const svc = new KbToolService({ kbs: [gone, doc] });
    const r = await svc.call('findFiles', { kbId: 'kbgone001', pattern: '*' });
    expect(r.isError).toBe(true);
    expect(parsed(r.text).error).toBe('not_found');
    const s = parsed((await svc.call('searchKnowledge', { query: 'startServer', kbIds: ['kbgone001'] })).text);
    expect(s.skipped).toEqual([{ kbId: 'kbgone001', reason: 'linked folder is missing' }]);
  });

  it('도구 이름 목록은 일곱 개이며 새 도구가 포함된다', () => {
    expect(KB_TOOL_NAMES).toEqual(expect.arrayContaining(['findFiles', 'grepKnowledge', 'findDefinitions']));
    expect(KB_TOOL_NAMES).toHaveLength(7);
  });
});

describe('loadKbEntries (메타 기반)', () => {
  it('연결 폴더 코드베이스는 원본 폴더를 루트로 쓰고, 유형과 제외 규칙을 싣는다', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'cbload-'));
    try {
      write(path.join(dir, 'kblinked1', 'meta.json'), JSON.stringify({ name: '연결', kind: 'codebase', linkedPath: linked, excludes: ['*.log'] }));
      const { entries, problems } = await loadKbEntries(dir, ['kblinked1']);
      expect(problems).toEqual([]);
      expect(entries[0]).toMatchObject({ kbId: 'kblinked1', kbName: '연결', kind: 'codebase', excludes: ['*.log'], filesRoot: linked });
      expect(entries[0]?.missing).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('연결 폴더가 없으면 항목은 남기고 missing으로 표시하며 문제로 알린다', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'cbload-'));
    try {
      write(path.join(dir, 'kbgone002', 'meta.json'), JSON.stringify({ name: '없음', kind: 'codebase', linkedPath: path.join(dir, 'nope') }));
      const { entries, problems } = await loadKbEntries(dir, ['kbgone002']);
      expect(entries[0]?.missing).toBe(true);
      expect(problems).toEqual(['linked folder missing: kbgone002']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('kbToolsNote 코드베이스 안내', () => {
  it('코드베이스 KB가 있으면 색인 없음 안내를 붙이고, 문서형만 있으면 붙이지 않는다', () => {
    const withCode = kbToolsNote([{ kbId: 'kbcode001', kbName: '코드', kind: 'codebase' }], 'codex-cli');
    expect(withCode).toContain('no index');
    expect(withCode).toContain('[codebase: live exploration, no index]');
    const docOnly = kbToolsNote([{ kbId: 'kbdoc0001', kbName: '문서' }], 'codex-cli');
    expect(docOnly).not.toContain('no index');
  });
});

describe('혼합 검색 공정 병합', () => {
  let mixRoot: string;
  let mixDocs: string;
  let mixCode: string;
  beforeAll(() => {
    mixRoot = mkdtempSync(path.join(os.tmpdir(), 'cbmix-'));
    mixDocs = path.join(mixRoot, 'kbmixdoc1', 'files');
    mixCode = path.join(mixRoot, 'kbmixcod1', 'files');
    for (let i = 0; i < 30; i++) write(path.join(mixDocs, `doc${String(i).padStart(2, '0')}.md`), `zebraterm 문서 ${i}\n`);
    write(path.join(mixCode, 'src', 'zebra.ts'), 'export const zebraterm = 1;\n');
  });
  afterAll(() => {
    rmSync(mixRoot, { recursive: true, force: true });
  });

  it('문서 결과가 많아도 코드베이스 결과가 limit 안에 남는다', async () => {
    const docKb: KbEntry = { kbId: 'kbmixdoc1', kbName: '문서 다수', filesRoot: mixDocs };
    const codeKb: KbEntry = { kbId: 'kbmixcod1', kbName: '코드', filesRoot: mixCode, kind: 'codebase', excludes: [] };
    const svc = new KbToolService({ kbs: [docKb, codeKb] });
    const r = parsed((await svc.call('searchKnowledge', { query: 'zebraterm', kbIds: ['kbmixdoc1', 'kbmixcod1'], limit: 6 })).text) as {
      results: { kbId: string; path: string }[];
    };
    expect(r.results).toHaveLength(6);
    expect(r.results.some((x) => x.kbId === 'kbmixcod1')).toBe(true);
    expect(r.results.some((x) => x.kbId === 'kbmixdoc1')).toBe(true);
  });
});

describe('mergeFairly', () => {
  const item = (kbId: string, n: number) => ({ kbId, kbName: kbId, path: `${kbId}/${n}`, title: 't', score: 1, snippet: '' });
  it('양쪽 모두 있으면 코드베이스에 ceil(limit/2)를 보장한다', () => {
    const docs = Array.from({ length: 20 }, (_, i) => item('d', i));
    const live = Array.from({ length: 20 }, (_, i) => item('c', i));
    const out = mergeFairly(docs, live, 7);
    expect(out).toHaveLength(7);
    expect(out.filter((x) => x.kbId === 'c')).toHaveLength(4);
  });
  it('한쪽이 비면 남는 칸은 다른 쪽이 쓴다', () => {
    const docs = Array.from({ length: 20 }, (_, i) => item('d', i));
    expect(mergeFairly(docs, [], 5)).toHaveLength(5);
    expect(mergeFairly([], [item('c', 0)], 5)).toHaveLength(1);
    const few = mergeFairly([item('d', 0)], Array.from({ length: 20 }, (_, i) => item('c', i)), 6);
    expect(few).toHaveLength(6);
    expect(few.filter((x) => x.kbId === 'd')).toHaveLength(1);
  });
  it('limit이 0 이하면 빈 목록이다', () => {
    expect(mergeFairly([item('d', 0)], [item('c', 0)], 0)).toEqual([]);
  });
});
