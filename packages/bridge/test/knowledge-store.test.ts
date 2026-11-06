import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { KNOWLEDGE_LIMITS, t } from '@branch/core';
import {
  createKnowledgeStore,
  OUTLINE_DEPTH,
  extractTitle,
  gitCloneArgs,
  htmlToMarkdown,
  isPrivateHost,
  isSafeSegment,
  slugify,
  type KnowledgeStore,
} from '../src';

const roots: string[] = [];

async function tmp(prefix: string): Promise<string> {
  const d = await mkdtemp(path.join(os.tmpdir(), prefix));
  roots.push(d);
  return d;
}

afterAll(async () => {
  await Promise.all(roots.map((d) => rm(d, { recursive: true, force: true })));
});

/** 실제 fetch 대신 쓰는 가짜 응답 */
function fakeResponse(body: string, init: { status?: number; type?: string; url?: string; length?: number } = {}): Response {
  const headers = new Headers({ 'content-type': init.type ?? 'text/html; charset=utf-8' });
  if (init.length !== undefined) headers.set('content-length', String(init.length));
  const res = new Response(body, { status: init.status ?? 200, headers });
  Object.defineProperty(res, 'url', { value: init.url ?? '' });
  return res;
}

describe('knowledge store: 지식베이스 기본', () => {
  let root: string;
  let store: KnowledgeStore;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    root = await tmp('kb-root-');
    fetchMock = vi.fn(async () => fakeResponse('<html><title>T</title><body>hi</body></html>'));
    store = createKnowledgeStore({ root, fetch: fetchMock as unknown as typeof fetch, env: { PATH: process.env.PATH } });
  });

  it('create는 kb id·이름·빈 파일 폴더를 만들고 list에 보인다', async () => {
    const kb = await store.create('  생물  1장\n ');
    expect(kb.id).toMatch(/^kb[a-z0-9]{6,40}$/);
    expect(kb.name).toBe('생물 1장');
    expect(kb.fileCount).toBe(0);
    expect((await store.list()).map((k) => k.id)).toEqual([kb.id]);
  });

  it('빈 이름은 거절한다', async () => {
    await expect(store.create('   ')).rejects.toThrow(t('bridge.knowledge.badName'));
  });

  it('rename은 이름만 바꾸고 updatedAt을 갱신한다', async () => {
    const kb = await store.create('a');
    const next = await store.rename(kb.id, 'b');
    expect(next.name).toBe('b');
    expect(next.createdAt).toBe(kb.createdAt);
    expect(next.updatedAt).toBeGreaterThanOrEqual(kb.updatedAt);
  });

  it('remove는 폴더째 지운다', async () => {
    const kb = await store.create('x');
    await store.remove(kb.id);
    expect(await store.list()).toEqual([]);
  });

  it('잘못된 id는 거절한다 (경로 조작 포함)', async () => {
    for (const bad of ['../etc', 'kb', 'KBabcdef', 'kb../../x', '', 'kbabc/def']) {
      await expect(store.tree(bad)).rejects.toThrow(t('bridge.knowledge.badId'));
    }
    await expect(store.rename('kb-nope', 'x')).rejects.toThrow(t('bridge.knowledge.badId'));
  });

  it('없는 지식베이스는 notFound로 답한다', async () => {
    await expect(store.tree('kbzzzzzzzz')).rejects.toThrow(t('bridge.knowledge.notFound'));
  });

  it('dirFor는 <root>/<id>/files 경로를 준다', async () => {
    const kb = await store.create('x');
    expect(store.dirFor(kb.id)).toBe(path.join(root, kb.id, 'files'));
  });
});

describe('knowledge store: 파일 넣기·목록·미리보기', () => {
  let root: string;
  let store: KnowledgeStore;
  let kbId: string;
  let filesOf: (rel: string) => string;

  beforeEach(async () => {
    root = await tmp('kb-files-');
    store = createKnowledgeStore({ root, env: { PATH: process.env.PATH } });
    kbId = (await store.create('kb')).id;
    filesOf = (rel: string) => path.join(root, kbId, 'files', rel);
  });

  it('addPaths는 파일과 폴더를 복사하고 숨김·링크·상대 경로는 건너뛴다', async () => {
    const src = await tmp('kb-src-');
    await writeFile(path.join(src, 'a.txt'), 'hello');
    await mkdir(path.join(src, 'dir', 'inner'), { recursive: true });
    await writeFile(path.join(src, 'dir', 'inner', 'b.md'), '# b');
    await writeFile(path.join(src, 'dir', '.secret'), 'nope');
    await writeFile(path.join(src, 'real.txt'), 'real');
    await symlink(path.join(src, 'real.txt'), path.join(src, 'dir', 'link.txt'));

    const res = await store.addPaths(kbId, [path.join(src, 'a.txt'), path.join(src, 'dir'), 'relative/x.txt']);
    expect(res.added.sort()).toEqual(['a.txt', 'dir']);
    // 상대 경로 1 + dir 안의 숨김 파일 1 + 심볼릭 링크 1
    expect(res.skipped).toBe(3);
    expect(await readFile(filesOf('dir/inner/b.md'), 'utf8')).toBe('# b');
    await expect(readFile(filesOf('dir/.secret'), 'utf8')).rejects.toThrow();
    await expect(readFile(filesOf('dir/link.txt'), 'utf8')).rejects.toThrow();
  });

  it('지식베이스 폴더를 품거나 그 안에 있는 경로는 건너뛴다 (자기 복사 방지)', async () => {
    await writeFile(filesOf('in.txt'), 'x');
    const res = await store.addPaths(kbId, [root, path.dirname(root), filesOf('in.txt'), path.join(root, kbId)]);
    expect(res.added).toEqual([]);
    expect(res.skipped).toBe(4);
  });

  it('같은 이름이 있으면 (2)를 붙여 충돌을 피한다', async () => {
    const src = await tmp('kb-src-');
    await writeFile(path.join(src, 'note.md'), 'one');
    await store.addPaths(kbId, [path.join(src, 'note.md')]);
    const res = await store.addPaths(kbId, [path.join(src, 'note.md')]);
    expect(res.added).toEqual(['note (2).md']);
    expect(await readFile(filesOf('note.md'), 'utf8')).toBe('one');
  });

  it('dest는 files/ 안의 폴더로만 가고, 탈출 경로와 링크 폴더는 거절한다', async () => {
    const src = await tmp('kb-src-');
    await writeFile(path.join(src, 'a.txt'), 'x');
    const ok = await store.addPaths(kbId, [path.join(src, 'a.txt')], 'sub/deeper');
    expect(ok.added).toEqual(['sub/deeper/a.txt']);
    await expect(store.addPaths(kbId, [path.join(src, 'a.txt')], '../outside')).rejects.toThrow(t('bridge.knowledge.badPath'));
    await expect(store.addPaths(kbId, [path.join(src, 'a.txt')], '.git')).rejects.toThrow(t('bridge.knowledge.badPath'));

    const outside = await tmp('kb-outside-');
    await symlink(outside, filesOf('linked'));
    await expect(store.addPaths(kbId, [path.join(src, 'a.txt')], 'linked')).rejects.toThrow(t('bridge.knowledge.badPath'));
  });

  it('addFiles는 이름을 검증하고 안전한 것만 넣는다', async () => {
    const res = await store.addFiles(kbId, [
      { name: 'ok.txt', data: new TextEncoder().encode('ok') },
      { name: '../evil.txt', data: new Uint8Array([1]) },
      { name: '.hidden', data: new Uint8Array([1]) },
      { name: 'CON', data: new Uint8Array([1]) },
      { name: 'a/b.txt', data: new Uint8Array([1]) },
    ]);
    expect(res.added).toEqual(['ok.txt']);
    expect(res.skipped).toBe(4);
    expect(await readFile(filesOf('ok.txt'), 'utf8')).toBe('ok');
  });

  it('tree와 index는 숨김 항목을 빼고 경로순으로 준다', async () => {
    await store.addFiles(kbId, [
      { name: 'b.txt', data: new Uint8Array([1]) },
      { name: 'a.txt', data: new Uint8Array([2, 3]) },
    ]);
    await mkdir(filesOf('.git'));
    await writeFile(filesOf('.git/config'), 'x');
    const tree = await store.tree(kbId);
    expect(tree.map((e) => e.path)).toEqual(['a.txt', 'b.txt']);
    expect(tree[0]).toMatchObject({ dir: false, size: 2 });
    const idx = await store.index(kbId);
    expect(idx).toEqual({ paths: ['a.txt', 'b.txt'], truncated: false });
    const kb = (await store.list()).find((k) => k.id === kbId)!;
    expect(kb.fileCount).toBe(2);
    expect(kb.totalBytes).toBe(3);
  });

  it('index는 indexPaths 개수까지만 경로를 주고 잘렸음을 알린다', async () => {
    const n = KNOWLEDGE_LIMITS.indexPaths + 3;
    const files = Array.from({ length: n }, (_, i) => ({ name: `f${String(i).padStart(4, '0')}.txt`, data: new Uint8Array([1]) }));
    await store.addFiles(kbId, files);
    const idx = await store.index(kbId);
    expect(idx.truncated).toBe(true);
    expect(idx.paths).toHaveLength(KNOWLEDGE_LIMITS.indexPaths);
  });

  it('index는 얕은 층부터 너비 우선으로, 폴더는 /를 붙이고 깊이 OUTLINE_DEPTH까지 준다', async () => {
    await mkdir(filesOf('repo/pkg/kubelet/deep'), { recursive: true });
    await writeFile(filesOf('repo/pkg/kubelet/deep/x.go'), 'x');
    await writeFile(filesOf('repo/pkg/a.go'), 'a');
    await writeFile(filesOf('z.md'), 'z');
    const idx = await store.index(kbId);
    // 깊이 1: repo/, z.md → 깊이 2: repo/pkg/ → 깊이 3: repo/pkg/a.go, repo/pkg/kubelet/
    expect(idx.paths).toEqual(['repo/', 'z.md', 'repo/pkg/', 'repo/pkg/a.go', 'repo/pkg/kubelet/']);
    expect(idx.truncated).toBe(true);
    expect(OUTLINE_DEPTH).toBe(3);
  });

  it('preview는 텍스트를 자르고, 바이너리는 text null로 준다', async () => {
    await store.addFiles(kbId, [
      { name: 'long.txt', data: new TextEncoder().encode('가'.repeat(KNOWLEDGE_LIMITS.previewChars + 10)) },
      { name: 'bin.dat', data: new Uint8Array([0x89, 0, 0x50]) },
    ]);
    const long = await store.preview(kbId, 'long.txt');
    expect(long.text?.length).toBe(KNOWLEDGE_LIMITS.previewChars);
    expect(long.truncated).toBe(true);
    const bin = await store.preview(kbId, 'bin.dat');
    expect(bin).toEqual({ text: null, size: 3, truncated: false });
    await expect(store.preview(kbId, 'nope.txt')).rejects.toThrow(t('bridge.knowledge.entryNotFound'));
  });

  it('removeEntry는 파일과 폴더를 지우고 루트는 지우지 못한다', async () => {
    await store.addFiles(kbId, [{ name: 'a.txt', data: new Uint8Array([1]) }], 'd');
    await store.removeEntry(kbId, 'd');
    expect((await store.tree(kbId)).length).toBe(0);
    await expect(store.removeEntry(kbId, '')).rejects.toThrow(t('bridge.knowledge.badPath'));
  });

  it('resolvePath는 중간이나 끝이 링크면 거절한다', async () => {
    const outside = await tmp('kb-outside-');
    await writeFile(path.join(outside, 'secret.txt'), 's');
    await symlink(outside, filesOf('out'));
    await expect(store.resolvePath(kbId, 'out/secret.txt')).rejects.toThrow(t('bridge.knowledge.badPath'));
    await symlink(path.join(outside, 'secret.txt'), filesOf('leaf.txt'));
    await expect(store.resolvePath(kbId, 'leaf.txt')).rejects.toThrow(t('bridge.knowledge.badPath'));
  });

  it('경로 조각 검증: 빈 조각, 점, 숨김, 역슬래시, Windows 예약 이름을 막는다', async () => {
    for (const bad of ['a//b', './a', 'a/../b', '.hidden', 'a\\b', 'CON.txt', 'x.']) {
      await expect(store.tree(kbId).then(() => store.preview(kbId, bad))).rejects.toThrow();
    }
    expect(isSafeSegment('정상 파일.md')).toBe(true);
    expect(isSafeSegment('lpt1.txt')).toBe(false);
  });
});

describe('knowledge store: 한도', () => {
  it('파일 한 개가 한도를 넘으면 건너뛰고 skipped로 센다', async () => {
    const root = await tmp('kb-limit-');
    const store = createKnowledgeStore({ root, env: { PATH: process.env.PATH } });
    const kbId = (await store.create('k')).id;
    const big = { name: 'big.bin', data: new Uint8Array(KNOWLEDGE_LIMITS.fileBytes + 1) };
    const res = await store.addFiles(kbId, [big]);
    expect(res).toEqual({ added: [], skipped: 1 });
  }, 20_000);
});

describe('knowledge store: 링크 가져오기', () => {
  let root: string;
  let kbId: string;

  beforeEach(async () => {
    root = await tmp('kb-link-');
  });

  async function setup(fetchImpl: (url: string) => Promise<Response>) {
    const fetchMock = vi.fn(fetchImpl);
    const store = createKnowledgeStore({ root, fetch: fetchMock as unknown as typeof fetch, env: { PATH: process.env.PATH } });
    kbId = (await store.create('link')).id;
    return { store, fetchMock };
  }

  it('웹 페이지를 마크다운으로 links/ 아래에 저장한다', async () => {
    const { store } = await setup(async () =>
      fakeResponse('<html><head><title>광합성 - 위키</title><style>p{}</style></head><body><h1>광합성</h1><p>빛 에너지를 쓴다.</p></body></html>', {
        url: 'https://example.com/photo',
      }),
    );
    const res = await store.addLink(kbId, 'https://example.com/photo');
    expect(res.added).toEqual(['links/광합성 - 위키.md']);
    const body = await readFile(path.join(root, kbId, 'files', 'links', '광합성 - 위키.md'), 'utf8');
    expect(body).toContain('# 광합성 - 위키');
    expect(body).toContain('https://example.com/photo');
    expect(body).toContain('# 광합성');
    expect(body).toContain('빛 에너지를 쓴다.');
    expect(body).not.toContain('p{}');
  });

  it('사설·내부 주소는 요청 전에 거절한다', async () => {
    const { store, fetchMock } = await setup(async () => fakeResponse('x'));
    for (const url of ['http://localhost:8080/', 'http://127.0.0.1/', 'http://192.168.0.5/a', 'http://[::1]/']) {
      await expect(store.addLink(kbId, url)).rejects.toThrow(t('bridge.knowledge.privateHost'));
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('최종 리다이렉트 주소가 내부면 거절한다', async () => {
    const { store } = await setup(async () => fakeResponse('<p>x</p>', { url: 'http://10.0.0.1/admin' }));
    await expect(store.addLink(kbId, 'https://example.com/go')).rejects.toThrow(t('bridge.knowledge.privateHost'));
  });

  it('리디렉션은 따라가기 전에 매 단계 주소를 확인한다', async () => {
    const { store, fetchMock } = await setup(async (url) =>
      url.startsWith('https://example.com/')
        ? new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/latest' } })
        : fakeResponse('<p>secret</p>'),
    );
    await expect(store.addLink(kbId, 'https://example.com/go')).rejects.toThrow(t('bridge.knowledge.privateHost'));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('공개 주소로의 리디렉션은 따라간다', async () => {
    const { store } = await setup(async (url) =>
      url === 'https://example.com/old'
        ? new Response(null, { status: 301, headers: { location: '/new' } })
        : fakeResponse('<title>New</title><p>ok</p>', { url }),
    );
    expect((await store.addLink(kbId, 'https://example.com/old')).added).toEqual(['links/New.md']);
  });

  it('호스트 이름이 사설 주소로 풀리면 요청 전에 거절한다', async () => {
    const fetchMock = vi.fn(async () => fakeResponse('x'));
    const store = createKnowledgeStore({
      root,
      fetch: fetchMock as unknown as typeof fetch,
      lookup: async (h) => (h === 'evil.example' ? ['93.184.216.34', '127.0.0.1'] : ['93.184.216.34']),
      env: { PATH: process.env.PATH },
    });
    const id = (await store.create('dns')).id;
    await expect(store.addLink(id, 'https://evil.example/')).rejects.toThrow(t('bridge.knowledge.privateHost'));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('http(s)가 아니거나 자격 증명이 있는 주소는 거절한다', async () => {
    const { store, fetchMock } = await setup(async () => fakeResponse('x'));
    await expect(store.addLink(kbId, 'file:///etc/passwd')).rejects.toThrow(t('bridge.knowledge.badUrl'));
    await expect(store.addLink(kbId, 'https://user:pw@example.com/')).rejects.toThrow(t('bridge.knowledge.badUrl'));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('HTML이 아닌 응답, 실패 응답, 너무 큰 응답은 거절한다', async () => {
    const { store: s1 } = await setup(async () => fakeResponse('{}', { type: 'application/octet-stream' }));
    await expect(s1.addLink(kbId, 'https://example.com/a.bin')).rejects.toThrow(t('bridge.knowledge.notHtml'));
    const { store: s2 } = await setup(async () => fakeResponse('no', { status: 404 }));
    await expect(s2.addLink(kbId, 'https://example.com/404')).rejects.toThrow(t('bridge.knowledge.fetchFailed'));
    const { store: s3 } = await setup(async () => fakeResponse('x', { length: 6 * 1024 * 1024 }));
    await expect(s3.addLink(kbId, 'https://example.com/huge')).rejects.toThrow(t('bridge.knowledge.htmlTooLarge'));
    const { store: s4 } = await setup(async () => {
      throw new Error('network down');
    });
    await expect(s4.addLink(kbId, 'https://example.com/down')).rejects.toThrow(t('bridge.knowledge.fetchFailed'));
  });
});

describe('knowledge store: GitHub 클론 입력', () => {
  it('GitHub 주소가 아니면 거절한다 (네트워크 호출 없음)', async () => {
    const root = await tmp('kb-git-');
    const store = createKnowledgeStore({ root, env: { PATH: process.env.PATH } });
    const kbId = (await store.create('g')).id;
    await expect(store.cloneGit(kbId, 'https://gitlab.com/a/b')).rejects.toThrow(t('bridge.knowledge.badRepo'));
    await expect(store.cloneGit(kbId, 'https://user:pw@github.com/a/b')).rejects.toThrow(t('bridge.knowledge.badRepo'));
  });

  it('git을 찾지 못하면 안내 문구를 준다', async () => {
    const root = await tmp('kb-git-');
    const store = createKnowledgeStore({ root, env: { PATH: '/nonexistent-dir-for-test' } });
    const kbId = (await store.create('g')).id;
    await expect(store.cloneGit(kbId, 'owner/repo')).rejects.toThrow(t('bridge.knowledge.gitMissing'));
    expect(await store.tree(kbId)).toEqual([]);
  });

  it('gitCloneArgs는 셸 없이 쓸 인자로, 얕은 클론·심볼릭 링크 비활성·옵션 끝 구분자를 갖춘다', () => {
    const args = gitCloneArgs('https://github.com/a/b.git', '/tmp/dest');
    expect(args).toContain('core.symlinks=false');
    expect(args).toEqual(expect.arrayContaining(['clone', '--depth', '1']));
    const sep = args.indexOf('--');
    expect(sep).toBeGreaterThan(-1);
    expect(args.slice(sep + 1)).toEqual(['https://github.com/a/b.git', '/tmp/dest']);
  });

  it('gitCloneArgs는 브랜치를 지정하지 않고 기본 브랜치(main이든 master든) 하나만 받는다', () => {
    const args = gitCloneArgs('https://github.com/a/b.git', '/tmp/dest');
    expect(args).toContain('--single-branch');
    expect(args).not.toContain('--branch');
    expect(args).not.toContain('--no-single-branch');
  });
});

describe('knowledge store: 순수 도우미', () => {
  it('htmlToMarkdown은 script·style을 버리고 제목·목록·링크·엔티티를 살린다', () => {
    const md = htmlToMarkdown(
      '<!doctype html><html><head><script>alert(1)</script><style>.a{}</style></head><body>' +
        '<h2>제목 &amp; 부제</h2><ul><li>하나</li><li>둘 &lt;b&gt;</li></ul>' +
        '<p>보기 <a href="https://a.test/x">링크</a> &#65;&#x42;</p><!-- 주석 --></body></html>',
    );
    expect(md).not.toContain('alert');
    expect(md).not.toContain('.a{}');
    expect(md).not.toContain('주석');
    expect(md).toContain('## 제목 & 부제');
    expect(md).toContain('- 하나');
    expect(md).toContain('- 둘 <b>');
    expect(md).toContain('[링크](https://a.test/x)');
    expect(md).toContain('AB');
  });

  it('extractTitle은 제목을 정리해 준다', () => {
    expect(extractTitle('<title> A &amp;\n B </title>')).toBe('A & B');
    expect(extractTitle('<p>none</p>')).toBe('');
  });

  it('isPrivateHost는 내부 주소를 잡고 공인 주소는 통과시킨다', () => {
    for (const h of ['localhost', 'a.localhost', '10.1.2.3', '172.16.0.1', '172.31.255.1', '192.168.1.1', '169.254.1.1', '127.0.0.1', '0.0.0.0', '[::1]', 'fd00::1', 'fe80::1', '::ffff:10.0.0.1', new URL('http://[::ffff:127.0.0.1]/').hostname, new URL('http://[::ffff:169.254.169.254]/').hostname, '[::7f00:1]', '64:ff9b::a00:1']) {
      expect(isPrivateHost(h), h).toBe(true);
    }
    for (const h of ['example.com', '8.8.8.8', '172.32.0.1', 'fcc.com', '1.1.1.1']) {
      expect(isPrivateHost(h), h).toBe(false);
    }
  });

  it('slugify는 금지 문자를 지우고 빈 값은 page로 한다', () => {
    expect(slugify('a/b:c?d')).toBe('a b c d');
    expect(slugify('...')).toBe('page');
    expect(slugify('x'.repeat(100)).length).toBe(60);
  });
});
