import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { KbToolError } from '@branch/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { gitListArgs, gitListEnv } from '../src/codebase/listing';
import { CODEBASE_LIMITS, grep, readCodebaseRange, type CodebaseTarget } from '../src/codebase';
import { listDir, readText, resolveInside } from '../src/kbTools/files';
import { keywordSearch } from '../src/kbTools/search';
import { indexedSearch } from '../src/kbTools/indexSearch';

/** T7 리뷰 수정 검증: git 인자(f), 첫 줄 과대(h), 긴 줄 검사 상한(i), 링크·경계(j), 취소 신호(g) */
let root: string;
let outside: string;
let target: CodebaseTarget;

function write(p: string, body: string | Buffer): void {
  mkdirSync(path.dirname(p), { recursive: true });
  writeFileSync(p, body);
}

beforeAll(() => {
  root = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'cbguard-')));
  outside = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'cbguard-out-')));
  write(path.join(root, 'real', 'inner.txt'), 'inner text\n');
  write(path.join(root, 'big', 'huge.txt'), 'h'.repeat(CODEBASE_LIMITS.rangeMaxChars + 500) + '\n');
  write(path.join(root, 'wide', 'deep.txt'), 'x'.repeat(1500) + 'DEEPNEEDLE' + '\n');
  write(path.join(root, 'wide', 'near.txt'), 'z'.repeat(CODEBASE_LIMITS.userRegexLineMaxChars - 20) + 'NEARNEEDLE' + '\n');
  write(path.join(root, 'wide', 'far.txt'), 'y'.repeat(4500) + 'FARNEEDLE' + '\n');
  write(path.join(outside, 'secret.txt'), 'OUTSIDE\n');
  symlinkSync(outside, path.join(root, 'linkdir'));
  symlinkSync(path.join(root, 'real'), path.join(root, 'linkreal'));
  target = { kbId: 'kbguard01', kbName: '가드', root, excludes: [] };
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
});

describe('git 목록 인자 (f)', () => {
  it('ls-files 앞에 core.fsmonitor=false와 core.hooksPath=/dev/null을 고정한다', () => {
    const args = gitListArgs();
    const ls = args.indexOf('ls-files');
    expect(ls).toBeGreaterThan(0);
    const before = args.slice(0, ls);
    const i = before.indexOf('core.fsmonitor=false');
    expect(i).toBeGreaterThan(0);
    expect(before[i - 1]).toBe('-c');
    expect(before).toContain('core.hooksPath=/dev/null');
  });

  it('환경에 GIT_CONFIG_NOSYSTEM과 GIT_TERMINAL_PROMPT를 넣는다', () => {
    const env = gitListEnv();
    expect(env.GIT_CONFIG_NOSYSTEM).toBe('1');
    expect(env.GIT_TERMINAL_PROMPT).toBe('0');
  });
});

describe('첫 줄이 글자 한도를 넘을 때 (h)', () => {
  it('빈 내용이 아니라 첫 줄의 앞부분을 truncated로 돌려준다', async () => {
    const r = await readCodebaseRange(target, 'big/huge.txt');
    expect(r.content.length).toBe(CODEBASE_LIMITS.rangeMaxChars);
    expect(r.content).toBe('h'.repeat(CODEBASE_LIMITS.rangeMaxChars));
    expect(r.truncated).toBe(true);
    expect(r.startLine).toBe(1);
    expect(r.endLine).toBe(1);
  });
});

describe('검사 길이 상한 (i)', () => {
  it('리터럴 모드는 1000자 뒤의 일치도 찾는다 (4000자 이내)', async () => {
    const hits = await grep(target, 'DEEPNEEDLE');
    expect(hits.map((h) => h.path)).toContain('wide/deep.txt');
    const hit = hits.find((h) => h.path === 'wide/deep.txt')!;
    // 발췌는 300자로 자른다
    expect(hit.text.length).toBeLessThanOrEqual(300);
  });

  it('사용자 정규식은 줄 앞 300자만 검사한다 (역추적 최악 비용 상한, ADR-134)', async () => {
    const deep = await grep(target, 'DEEP\\w+', { regex: true });
    expect(deep.some((h) => h.path === 'wide/deep.txt')).toBe(false);
    const near = await grep(target, 'NEAR\\w+', { regex: true });
    expect(near.map((h) => h.path)).toContain('wide/near.txt');
  });

  it('상한(4000자)을 넘는 뒤쪽 일치는 검사하지 않는다', async () => {
    const hits = await grep(target, 'FARNEEDLE');
    expect(hits.some((h) => h.path === 'wide/far.txt')).toBe(false);
  });
});

describe('대상 경계 (j)', () => {
  it('심볼릭 링크 폴더 목록은 bad_path로 거부한다', async () => {
    await expect(listDir(root, 'linkdir', 0)).rejects.toMatchObject({ code: 'bad_path' });
    await expect(listDir(root, 'linkreal', 0)).rejects.toMatchObject({ code: 'bad_path' });
  });

  it('심볼릭 링크 폴더 아래 파일 읽기도 거부한다', async () => {
    await expect(readText(root, 'linkdir/secret.txt')).rejects.toMatchObject({ code: 'bad_path' });
    await expect(resolveInside(root, 'linkreal/inner.txt')).rejects.toMatchObject({ code: 'bad_path' });
  });

  it('형식이 틀린 경로(.., 절대 경로)는 bad_path', async () => {
    await expect(resolveInside(root, '../secret.txt')).rejects.toBeInstanceOf(KbToolError);
    await expect(resolveInside(root, '/etc/passwd')).rejects.toMatchObject({ code: 'bad_path' });
  });

  it('정상적인 중첩 폴더 목록과 파일 읽기는 허용한다', async () => {
    const dir = await listDir(root, 'real', 0);
    expect(dir.entries.map((e) => e.path)).toContain('real/inner.txt');
    const file = await readText(root, 'real/inner.txt');
    expect(file.lines).toEqual(['inner text']);
    const top = await listDir(root, '', 0);
    expect(top.entries.some((e) => e.name === 'real')).toBe(true);
  });
});

describe('취소 신호 (g)', () => {
  it('이미 취소된 신호로 키워드 검색을 시작하면 cancelled', async () => {
    const ac = new AbortController();
    ac.abort();
    const kbs = [{ kbId: 'kbguard01', kbName: '가드', filesRoot: root }];
    await expect(keywordSearch(kbs, 'inner', { limit: 5, signal: ac.signal })).rejects.toMatchObject({ code: 'cancelled' });
  });

  it('이미 취소된 신호로 색인 검색을 시작하면 cancelled', async () => {
    const ac = new AbortController();
    ac.abort();
    await expect(indexedSearch(root, ['kbguard01'], { query: 'inner', limit: 5, signal: ac.signal })).rejects.toMatchObject({
      code: 'cancelled',
    });
  });
});
