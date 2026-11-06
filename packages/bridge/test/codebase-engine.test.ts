import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { identifierTerms, splitTerms, stemKo } from '../src/codebase/terms';
import { findDefinitions, findFiles, grep, listCodebaseFiles, readCodebaseRange, searchCodebase, type CodebaseTarget } from '../src/codebase';

/** 코드베이스 엔진 테스트: 임시 폴더에 실제 파일을 만들고 색인 없이 훑는지 확인한다 */
let root: string;
let outside: string;
let target: CodebaseTarget;

function write(p: string, body: string | Buffer): void {
  mkdirSync(path.dirname(p), { recursive: true });
  writeFileSync(p, body);
}

beforeAll(() => {
  root = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'cbengine-')));
  outside = mkdtempSync(path.join(os.tmpdir(), 'cboutside-'));
  write(path.join(root, 'src', 'a.ts'), 'export function parseConfig(x: string) {\n  return x.trim();\n}\n// config loader\n');
  write(path.join(root, 'src', 'b.py'), 'def parse_config(y):\n    return y\n');
  write(path.join(root, 'src', 'c.ts'), 'const limit = 3;\nexport class Parser {}\n');
  write(path.join(root, 'docs', 'guide.md'), '# 설정 가이드\n설정 파일을 읽는 방법\n');
  write(path.join(root, 'node_modules', 'pkg', 'index.js'), 'function parseConfig() {}\n');
  write(path.join(root, 'bin.dat'), Buffer.from([0x50, 0x00, 0x51, 0x0a]));
  write(path.join(outside, 'secret.txt'), 'OUTSIDE SECRET\n');
  symlinkSync(path.join(outside, 'secret.txt'), path.join(root, 'src', 'link.txt'));
  target = { kbId: 'kbcode001', kbName: '코드', root, excludes: [] };
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
});

describe('listing', () => {
  it('node_modules 같은 기본 제외 폴더는 목록에서 빼고, 실제 소스는 넣는다', async () => {
    const files = await listCodebaseFiles(target);
    expect(files).toContain('src/a.ts');
    expect(files).toContain('docs/guide.md');
    expect(files.some((f) => f.startsWith('node_modules/'))).toBe(false);
  });

  it('사용자 제외 패턴을 적용한다', async () => {
    const t = { ...target, excludes: ['*.md'] };
    const hits = await findFiles(t, '*.md');
    expect(hits).toEqual([]);
  });

  it('glob 패턴과 부분 문자열 패턴으로 파일을 찾는다', async () => {
    expect(await findFiles(target, '*.ts')).toEqual(expect.arrayContaining(['src/a.ts', 'src/c.ts']));
    expect(await findFiles(target, 'GUIDE')).toEqual(['docs/guide.md']);
  });
});

describe('grep', () => {
  it('리터럴 검색은 대소문자를 무시하고 파일·줄 번호를 돌려준다', async () => {
    const hits = await grep(target, 'CONFIG');
    const paths = hits.map((h) => h.path);
    expect(paths).toContain('src/a.ts');
    expect(paths).toContain('src/b.py');
    expect(hits.find((h) => h.path === 'src/b.py')?.line).toBe(1);
    expect(paths.some((p) => p.startsWith('node_modules/'))).toBe(false);
  });

  it('regex=true면 제한된 정규식으로 검색한다', async () => {
    const hits = await grep(target, 'parse\\w+', { regex: true });
    expect(hits.length).toBeGreaterThan(0);
  });

  it('바이너리 파일과 심볼릭 링크 대상은 결과에 없다', async () => {
    const hits = await grep(target, 'SECRET');
    expect(hits).toEqual([]);
    const bin = await grep(target, 'P');
    expect(bin.some((h) => h.path === 'bin.dat')).toBe(false);
  });
});

describe('findDefinitions', () => {
  it('함수 선언을 찾고 종류를 붙인다 (언어 무관 패턴)', async () => {
    const ts = await findDefinitions(target, 'parseConfig');
    expect(ts.find((h) => h.path === 'src/a.ts')).toMatchObject({ line: 1, kind: 'function' });
    const py = await findDefinitions(target, 'parse_config');
    expect(py.find((h) => h.path === 'src/b.py')).toMatchObject({ line: 1, kind: 'function' });
  });

  it('클래스 선언과 node_modules 안의 선언은 찾지 않는다', async () => {
    const cls = await findDefinitions(target, 'Parser');
    expect(cls).toEqual([expect.objectContaining({ path: 'src/c.ts', kind: 'class' })]);
    const nm = await findDefinitions(target, 'parseConfig');
    expect(nm.some((h) => h.path.startsWith('node_modules/'))).toBe(false);
  });
});

describe('searchCodebase', () => {
  it('질의 용어가 든 발췌를 점수순으로 돌려준다 (Korean 어미 제거 포함)', async () => {
    const hits = await searchCodebase(target, '설정을 읽는', { limit: 5 });
    expect(hits[0]?.path).toBe('docs/guide.md');
    expect(hits[0]?.lineStart).toBeGreaterThanOrEqual(1);
  });

  it('정의 줄에 걸리면 symbol을 붙인다', async () => {
    const hits = await searchCodebase(target, 'parseConfig', { limit: 5 });
    expect(hits.some((h) => h.symbol === 'parseConfig')).toBe(true);
  });
});

describe('readCodebaseRange', () => {
  it('줄 범위를 읽고, 파일 끝을 넘지 않으며, 남은 줄이 있으면 truncated다', async () => {
    const r = await readCodebaseRange(target, 'src/a.ts', { startLine: 1, endLine: 2 });
    expect(r.totalLines).toBe(4);
    expect(r.content.split('\n')).toHaveLength(2);
    expect(r.truncated).toBe(true);
    const all = await readCodebaseRange(target, 'src/a.ts', { startLine: 1, endLine: 100 });
    expect(all.truncated).toBe(false);
    expect(all.endLine).toBe(4);
  });

  it('심볼릭 링크와 루트 밖 경로는 거부한다', async () => {
    await expect(readCodebaseRange(target, 'src/link.txt')).rejects.toBeDefined();
    await expect(readCodebaseRange(target, '../outside/secret.txt')).rejects.toBeDefined();
  });

  it('빈 경로는 파일이 아니므로 거부한다', async () => {
    await expect(readCodebaseRange(target, '')).rejects.toMatchObject({ code: 'not_a_file' });
  });
});

describe('terms', () => {
  it('식별자를 낙타·스네이크 표기로 쪼개고 한국어 어미를 뗀다', () => {
    expect(identifierTerms('parseConfigFile').length).toBeGreaterThan(0);
    expect(splitTerms('parse_config').map((t) => t.toLowerCase())).toEqual(expect.arrayContaining(['parse', 'config']));
    expect(stemKo('설정을')).toBe('설정');
  });
});
