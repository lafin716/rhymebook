import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { t, type KnowledgeProgress } from '@branch/core';
import { createKnowledgeStore, gitCloneArgs, gitErrorLine } from '../src';

const roots: string[] = [];
async function tmp(prefix: string): Promise<string> {
  const d = await mkdtemp(path.join(os.tmpdir(), prefix));
  roots.push(d);
  return d;
}
afterAll(async () => {
  await Promise.all(roots.map((d) => rm(d, { recursive: true, force: true })));
});

/** 마지막 인자(클론 대상 폴더)에 파일을 만드는 셸 조각 */
const MAKE_DEST = 'for a; do dest="$a"; done; mkdir -p "$dest" && echo hi > "$dest/README.md"';

/** 가짜 git 스크립트를 만든다 (posix 셸) */
async function fakeGit(body: string): Promise<string> {
  const dir = await tmp('kb-fakegit-');
  const bin = path.join(dir, 'git');
  await writeFile(bin, `#!/bin/sh\n${body}\n`);
  await chmod(bin, 0o755);
  return bin;
}

async function setup(body: string, extra: { cloneIdleMs?: number; cloneTimeoutMs?: number } = {}) {
  const root = await tmp('kb-prog-');
  const store = createKnowledgeStore({ root, env: { PATH: process.env.PATH }, gitBin: await fakeGit(body), ...extra });
  const kbId = (await store.create('p')).id;
  return { store, kbId };
}

const posix = process.platform !== 'win32';

describe.runIf(posix)('knowledge store: 클론 진행·멈춤·취소', () => {
  it('진행 줄을 진행률로 알리고 끝나면 repos/에 넣는다', async () => {
    const { store, kbId } = await setup(
      `printf "Cloning into 'x'...\\n" >&2; printf "Receiving objects:  50%% (1/2)\\r" >&2; printf "Receiving objects: 100%% (2/2), done.\\n" >&2; ${MAKE_DEST}`,
    );
    const seen: KnowledgeProgress[] = [];
    const res = await store.cloneGit(kbId, 'octo/hello', { onProgress: (p) => seen.push(p) });
    expect(res.added).toEqual(['repos/hello']);
    const ratios = seen.filter((p) => p.phase === 'clone' && p.ratio !== undefined).map((p) => p.ratio);
    expect(ratios[0]).toBeCloseTo(0.425);
    expect(ratios.at(-1)).toBeCloseTo(0.85);
    expect(seen.at(-1)?.phase).toBe('save');
  });

  it('git이 끝났는데 손자 프로세스가 stderr를 붙잡아도 기다리지 않고 끝낸다', async () => {
    const { store, kbId } = await setup(`(sleep 20) & ${MAKE_DEST}; exit 0`);
    const start = Date.now();
    const res = await store.cloneGit(kbId, 'octo/hello');
    expect(res.added).toEqual(['repos/hello']);
    expect(Date.now() - start).toBeLessThan(5000);
  });

  it('출력 없이 멈추면 무응답 오류로 끝내고 임시 폴더를 남기지 않는다', async () => {
    const { store, kbId } = await setup('sleep 20', { cloneIdleMs: 300 });
    const start = Date.now();
    await expect(store.cloneGit(kbId, 'octo/hello')).rejects.toThrow(t('bridge.knowledge.cloneStalled'));
    expect(Date.now() - start).toBeLessThan(5000);
    expect(await store.tree(kbId)).toEqual([]);
  });

  it('전체 제한 시간을 넘기면 시간 초과로 끝낸다', async () => {
    const { store, kbId } = await setup('while true; do printf "Receiving objects:  10%% (1/9)\\r" >&2; sleep 0.05; done', {
      cloneTimeoutMs: 400,
    });
    await expect(store.cloneGit(kbId, 'octo/hello')).rejects.toThrow(t('bridge.knowledge.cloneTimeout'));
  });

  it('취소하면 프로세스를 끝내고 취소 문구로 reject한다', async () => {
    const { store, kbId } = await setup('while true; do printf "Receiving objects:  10%% (1/9)\\r" >&2; sleep 0.05; done');
    const ac = new AbortController();
    const p = store.cloneGit(kbId, 'octo/hello', { signal: ac.signal });
    setTimeout(() => ac.abort(), 200);
    await expect(p).rejects.toThrow(t('bridge.knowledge.cancelled'));
    expect(await store.tree(kbId)).toEqual([]);
  });

  it('실패하면 fatal 줄을 오류 문구에 담는다', async () => {
    const { store, kbId } = await setup(`printf "Cloning into 'x'...\\nfatal: unable to access 'https://github.com/octo/x.git/': Could not resolve host: github.com\\n" >&2; exit 128`);
    await expect(store.cloneGit(kbId, 'octo/x')).rejects.toThrow('Could not resolve host: github.com');
  });

  it('없는/비공개 저장소는 알아보기 쉬운 문구로 알린다', async () => {
    const { store, kbId } = await setup(`printf "Cloning into 'x'...\\nfatal: could not read Username for 'https://github.com': terminal prompts disabled\\n" >&2; exit 128`);
    await expect(store.cloneGit(kbId, 'octo/nope')).rejects.toThrow(t('bridge.knowledge.repoNotFound'));
    const second = await setup(`printf "fatal: repository 'https://github.com/octo/nope.git/' not found\\n" >&2; exit 128`);
    await expect(second.store.cloneGit(second.kbId, 'octo/nope')).rejects.toThrow(t('bridge.knowledge.repoNotFound'));
  });
});

describe('knowledge store: 복사 진행·취소', () => {
  it('addPaths는 파일마다 복사 진행을 알린다', async () => {
    const root = await tmp('kb-copy-');
    const src = await tmp('kb-src-');
    await mkdir(path.join(src, 'd'));
    await writeFile(path.join(src, 'd', 'a.txt'), 'aa');
    await writeFile(path.join(src, 'd', 'b.txt'), 'bbb');
    const store = createKnowledgeStore({ root, env: { PATH: process.env.PATH } });
    const kbId = (await store.create('c')).id;
    const seen: KnowledgeProgress[] = [];
    await store.addPaths(kbId, [path.join(src, 'd')], undefined, { onProgress: (p) => seen.push(p) });
    expect(seen.at(-1)).toEqual({ phase: 'copy', files: 2, bytes: 5 });
  });

  it('취소된 신호면 아무것도 넣지 않고 취소 문구로 reject한다', async () => {
    const root = await tmp('kb-copy-');
    const src = await tmp('kb-src-');
    await writeFile(path.join(src, 'a.txt'), 'aa');
    const store = createKnowledgeStore({ root, env: { PATH: process.env.PATH } });
    const kbId = (await store.create('c')).id;
    const ac = new AbortController();
    ac.abort();
    await expect(store.addPaths(kbId, [path.join(src, 'a.txt')], undefined, { signal: ac.signal })).rejects.toThrow(
      t('bridge.knowledge.cancelled'),
    );
    await expect(
      store.addFiles(kbId, [{ name: 'x.txt', data: new Uint8Array([1]) }], undefined, { signal: ac.signal }),
    ).rejects.toThrow(t('bridge.knowledge.cancelled'));
    expect(await store.tree(kbId)).toEqual([]);
    // 취소 뒤에도 다음 작업은 막히지 않는다
    expect((await store.addPaths(kbId, [path.join(src, 'a.txt')])).added).toEqual(['a.txt']);
  });
});

describe('knowledge store: git 인자·오류 줄', () => {
  it('진행 출력을 켜고 자격 증명 도우미를 끈다', () => {
    const args = gitCloneArgs('https://github.com/a/b.git', '/tmp/d');
    expect(args).toContain('--progress');
    expect(args).not.toContain('--quiet');
    expect(args).toContain('credential.helper=');
  });
  it('gitErrorLine은 fatal → error → 마지막 줄 → 종료 코드 순으로 고른다', () => {
    expect(gitErrorLine(["Cloning into 'x'...", 'warning: w', 'fatal: boom'], 128)).toBe('boom');
    expect(gitErrorLine(['error: bad', 'other'], 1)).toBe('bad');
    expect(gitErrorLine(["Cloning into 'x'...", 'something'], 1)).toBe('something');
    expect(gitErrorLine(["Cloning into 'x'..."], 1)).toBe('exit 1');
  });
});
