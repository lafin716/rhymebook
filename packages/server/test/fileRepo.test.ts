import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { emptyView, type StoredData } from '@branch/core';
import { createFileRepository } from '../src/fileRepo';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'rhymebook-repo-'));
});
afterEach(() => rm(dir, { recursive: true, force: true }));

const data = (n: number): StoredData => ({ sessions: [], messages: [], view: { ...emptyView(), splitSessionIds: [] }, settings: { n } as never });

describe('fileRepo', () => {
  it('파일이 없으면 null, 바뀜을 모아 한 번에 0600으로 원자적으로 쓴다', async () => {
    const file = path.join(dir, 'sub', 'data.json');
    const repo = createFileRepository(file, { intervalMs: 20 });
    expect(repo.load()).toBeNull();
    let n = 0;
    repo.attach(() => data(++n));
    repo.saveSession({} as never);
    repo.saveSettings({} as never);
    repo.saveView({} as never);
    await new Promise((r) => setTimeout(r, 60));
    expect(n).toBe(1);
    expect(repo.load()?.settings).toEqual({ n: 1 });
    expect((await stat(file)).mode & 0o777).toBe(0o600);
  });

  it('flush는 남은 바뀜을 바로 쓰고, 바뀜이 없으면 쓰지 않는다', async () => {
    const file = path.join(dir, 'data.json');
    const repo = createFileRepository(file, { intervalMs: 60_000 });
    let n = 0;
    repo.attach(() => data(++n));
    await repo.flush();
    expect(n).toBe(0);
    repo.saveMessage({} as never, 0);
    await repo.flush();
    expect(JSON.parse(await readFile(file, 'utf8')).settings).toEqual({ n: 1 });
  });

  it('깨진 파일은 덮어쓰지 않도록 load에서 실패한다', async () => {
    const file = path.join(dir, 'data.json');
    await writeFile(file, '{"sessions":1}');
    expect(() => createFileRepository(file).load()).toThrow(/형식/);
    await writeFile(file, '{oops');
    expect(() => createFileRepository(file).load()).toThrow();
  });
});
