import { expect, test, type Page } from '@playwright/test';

/**
 * ADR-107: 학습별 지식베이스. 웹 개발 서버에서는 데스크톱 bridge가 없으므로
 * addInitScript가 메모리 안의 가짜 지식베이스 API(window.__branchKnowledgeFake)를 넣는다.
 * 프로덕션 빌드는 이 훅을 읽지 않는다 (ui/src/knowledge/api.ts는 import.meta.env.DEV에서만 사용).
 */
const KEY = 'sk-ant-e2e-ok';

function installFakeKnowledge() {
  type Src = { id: string; type: 'files' | 'folder' | 'github' | 'web'; location: string; dest: string; addedAt: number; updatedAt: number };
  type Base = {
    id: string;
    name: string;
    files: Map<string, string>;
    description?: string;
    sources: Src[];
    settings: { embedding: { provider: 'local-hash' | 'openai'; model?: string }; autoIndex?: boolean };
  };
  const bases = new Map<string, Base>();
  let seq = 0;
  const info = (b: Base) => ({
    id: b.id,
    name: b.name,
    createdAt: 0,
    updatedAt: 0,
    fileCount: b.files.size,
    totalBytes: [...b.files.values()].reduce((a, c) => a + c.length, 0),
    description: b.description,
  });
  const get = (id: string) => {
    const b = bases.get(id);
    if (!b) throw new Error('no base');
    return b;
  };
  const put = (b: Base, paths: string[]) => {
    for (const p of paths) b.files.set(p, `본문: ${p}`);
    return { added: paths, skipped: 0 };
  };
  // 진행률·취소: 'slow/' 저장소는 진행률을 보낸 뒤 취소될 때까지 기다리고, 'broken/' 저장소는 실패한다
  const listeners = new Set<(p: unknown) => void>();
  const stateListeners = new Set<(s: unknown) => void>();
  const indexed = new Map<string, unknown>();
  const indexState = (kbId: string, status: string, progress?: unknown, chunkCount = 0) => ({
    kbId,
    status,
    docCount: chunkCount ? 2 : 0,
    chunkCount,
    indexBytes: 0,
    sourceBytes: 0,
    failedDocs: 0,
    progress,
  });
  let cancel: (() => void) | undefined;
  const emit = (p: unknown) => listeners.forEach((l) => l(p));
  const api = {
    onProgress: (l: (p: unknown) => void) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    cancel: async () => cancel?.(),
    list: async () => [...bases.values()].map(info),
    create: async (name: string) => {
      const id = `kbfake${String(++seq).padStart(4, '0')}`;
      const b: Base = { id, name, files: new Map(), sources: [], settings: { embedding: { provider: 'local-hash' } } };
      bases.set(id, b);
      return info(b);
    },
    rename: async (id: string, name: string) => {
      const b = get(id);
      b.name = name;
      return info(b);
    },
    remove: async (id: string) => {
      bases.delete(id);
    },
    tree: async (id: string) => {
      // 실제 브리지처럼 폴더 항목도 함께 돌려준다
      const files = [...get(id).files.keys()];
      const dirs = new Set(files.flatMap((f) => f.split('/').slice(0, -1).map((_, i, a) => a.slice(0, i + 1).join('/'))));
      return [...dirs].map((path) => ({ path, dir: true }))
        .concat(files.map((path) => ({ path, dir: false, size: 10 })))
        .sort((a, b) => a.path.localeCompare(b.path));
    },
    pathForFile: () => '',
    addPaths: async (id: string, paths: string[]) => put(get(id), paths.map((p) => p.split('/').pop() ?? p)),
    addFiles: async (id: string, files: { name: string }[]) => put(get(id), files.map((f) => f.name)),
    pickFiles: async (id: string) => put(get(id), ['notes/intro.md']),
    addLink: async (id: string, url: string) => put(get(id), [`links/${url.split('/').pop()}.md`]),
    cloneGit: async (id: string, url: string) => {
      if (url.includes('/broken/')) throw new Error("Error invoking remote method 'knowledge:clone-git': Error: 저장소를 받지 못했습니다 (Repository not found.)");
      if (url.includes('/slow/')) {
        emit({ phase: 'clone' });
        await new Promise((r) => setTimeout(r, 50));
        emit({ phase: 'clone', ratio: 0.45 });
        await new Promise<void>((_, reject) => {
          cancel = () => reject(new Error('가져오기를 취소했습니다'));
        });
      }
      const res = put(get(id), ['repos/repo/README.md']);
      get(id).sources.push({ id: `src${++seq}`, type: 'github', location: url, dest: 'repos/repo', addedAt: 0, updatedAt: 0 });
      return res;
    },
    removeEntry: async (id: string, path: string) => {
      get(id).files.delete(path);
    },
    preview: async (id: string, path: string) => {
      const text = get(id).files.get(path) ?? null;
      return { text, size: text?.length ?? 0, truncated: false };
    },
    open: async () => {},
    // 색인 상태: 새 지식베이스는 '아직 색인 전'이고, 다시 색인하면 진행을 거쳐 완료된다
    indexStates: async (ids?: string[]) =>
      [...bases.keys()].filter((id) => !ids || ids.includes(id)).map((id) => indexed.get(id) ?? indexState(id, 'empty')),
    onIndexState: (l: (s: unknown) => void) => {
      stateListeners.add(l);
      return () => stateListeners.delete(l);
    },
    reindex: async (id: string) => {
      indexed.set(id, indexState(id, 'indexing', { phase: 'embed', done: 1, total: 2 }));
      stateListeners.forEach((l) => l(indexed.get(id)));
      await new Promise((r) => setTimeout(r, 50));
      indexed.set(id, indexState(id, 'ready', undefined, 3));
      stateListeners.forEach((l) => l(indexed.get(id)));
    },
    setDescription: async (id: string, description: string) => {
      get(id).description = description;
      return info(get(id));
    },
    // 문서 목록: 경로·제목 부분 일치 검색
    docs: async (id: string, query?: string) => {
      const q = query?.toLowerCase();
      return [...get(id).files.keys()]
        .filter((p) => !q || p.toLowerCase().includes(q))
        .map((path, i) => ({ docId: `doc${i}`, path, title: path.split('/').pop() ?? path, kind: 'md', bytes: 10, chunkCount: 2, status: 'ok', indexedAt: 0 }));
    },
    sources: async (id: string) => get(id).sources,
    updateSource: async (id: string, sourceId: string) => {
      const src = get(id).sources.find((x) => x.id === sourceId);
      if (!src) throw new Error('no source');
      src.updatedAt = ++seq;
      return put(get(id), ['repos/repo/README.md']);
    },
    getIndexSettings: async (id: string) => get(id).settings,
    setIndexSettings: async (id: string, settings: Base['settings']) => {
      get(id).settings = settings;
      return indexState(id, 'stale');
    },
    cancelIndex: async () => {},
    // 검색: 연결된 첫 지식베이스에서 근거 한 건을 돌려준다 (답변 인용 번호 [1])
    retrieve: async (req: { kbIds: string[]; plan: unknown }) => {
      const kbId = req.kbIds.find((id) => bases.has(id));
      const evidence = kbId
        ? [{ n: 1, kbId, kbName: get(kbId).name, chunkId: 'chunk0', docId: 'doc0', path: 'notes/cell.md', title: '세포막', kind: 'md', headingPath: ['1장', '세포막'], text: '세포막은 인지질 이중층으로 이루어져 있다.', score: 0.9 }]
        : [];
      return { plan: req.plan, evidence, skipped: [], tookMs: 1 };
    },
    source: async (kbId: string) => ({
      kbId,
      path: 'notes/cell.md',
      title: '세포막',
      kind: 'md',
      headingPath: ['1장', '세포막'],
      chunkText: '세포막은 인지질 이중층으로 이루어져 있다.',
      sectionText: '1장 세포막 본문 전체',
    }),
  };
  (window as unknown as { __branchKnowledgeFake: unknown }).__branchKnowledgeFake = api;
}

async function start(page: Page) {
  await page.goto('/?platform=desktop');
  const onboarding = page.getByRole('dialog', { name: '시작하기' });
  await onboarding.getByRole('button', { name: /^API 키/ }).click();
  const input = page.getByLabel('Anthropic API 키');
  await input.fill(KEY);
  await input.press('Enter');
  await expect(page.getByRole('dialog')).toContainText('연결됨');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '새 학습 시작' }).click();
  return page.locator('[data-panel="main"]');
}

test('학습에 지식베이스를 만들어 연결하고 자료를 넣고 지운다', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(installFakeKnowledge);
  const main = await start(page);

  await main.locator('[data-knowledge-button]').click();
  const dialog = page.getByRole('dialog', { name: '지식베이스', exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('아직 지식베이스가 없어요.');

  // 빈 상태의 만들기 버튼으로 새 지식베이스
  await dialog.getByRole('button', { name: '새 지식베이스' }).first().click();
  await dialog.getByLabel('새 지식베이스').fill('세포생물학');
  await dialog.getByRole('button', { name: '만들기' }).click();
  await expect(dialog.getByRole('heading', { name: '세포생물학', level: 3 })).toBeVisible();

  // 색인 상태: 새 지식베이스는 색인 전이고, 다시 색인하면 완료 문구로 바뀐다
  await expect(dialog.locator('[data-index-status="empty"]')).toContainText('아직 색인 전');
  await dialog.getByRole('button', { name: '다시 색인' }).click();
  await expect(dialog.locator('[data-index-status="ready"]')).toContainText('색인 완료 · 청크 3개');

  // 이 학습에 연결하면 세션 버튼에 연결 표시가 붙는다
  await dialog.getByRole('button', { name: '이 학습에 연결', exact: true }).click();
  await expect(dialog.getByRole('button', { name: '연결 해제', exact: true })).toBeVisible();
  await expect(main.locator('[data-knowledge-button][data-linked]')).toHaveCount(1);

  // 웹 주소는 http(s)만 받는다
  const linkInput = dialog.getByLabel('웹 페이지 주소');
  await linkInput.fill('ftp://example.com/cell');
  await dialog.getByRole('button', { name: '가져오기' }).click();
  await expect(dialog.getByRole('alert')).toContainText('http(s) 주소만');
  await linkInput.fill('https://example.com/cell');
  await dialog.getByRole('button', { name: '가져오기' }).click();
  await expect(dialog.locator('[data-entry="links/cell.md"]')).toBeVisible();

  // 폴더는 접고 펼 수 있다 (새로 넣은 자료의 폴더는 펼쳐져 있다)
  const linksDir = dialog.locator('[data-entry="links"]').locator('button[aria-expanded]');
  await expect(linksDir).toHaveAttribute('aria-expanded', 'true');
  await linksDir.click();
  await expect(dialog.locator('[data-entry="links/cell.md"]')).toHaveCount(0);
  await dialog.getByRole('button', { name: '모두 펼치기' }).click();
  await expect(dialog.locator('[data-entry="links/cell.md"]')).toBeVisible();
  await dialog.getByRole('button', { name: '모두 접기' }).click();
  await expect(dialog.locator('[data-entry="links/cell.md"]')).toHaveCount(0);
  await linksDir.click();
  await expect(dialog.locator('[data-entry="links/cell.md"]')).toBeVisible();

  // 전체 화면 토글 (모바일은 이미 화면을 다 쓰므로 버튼이 없다)
  const fullBtn = dialog.getByRole('button', { name: '전체 화면' });
  if (page.viewportSize()!.width < 768) {
    await expect(fullBtn).toBeHidden();
  } else {
    await fullBtn.click();
    await expect(dialog.getByRole('button', { name: '전체 화면 끝내기' })).toHaveAttribute('aria-pressed', 'true');
    const vw = page.viewportSize()!.width;
    expect((await dialog.boundingBox())!.width).toBeGreaterThan(vw * 0.9);
    await dialog.getByRole('button', { name: '전체 화면 끝내기' }).click();
    await expect(fullBtn).toHaveAttribute('aria-pressed', 'false');
  }

  // 파일 선택과 끌어다 놓기 (경로가 없는 파일은 내용으로 들어간다)
  await dialog.getByRole('button', { name: '파일 선택' }).click();
  await expect(dialog.locator('[data-entry="notes/intro.md"]')).toBeVisible();
  const dt = await page.evaluateHandle(() => {
    const d = new DataTransfer();
    d.items.add(new File(['drop'], 'drop.txt', { type: 'text/plain' }));
    return d;
  });
  await dialog.locator('[data-knowledge-drop]').dispatchEvent('drop', { dataTransfer: dt });
  await expect(dialog.locator('[data-entry="drop.txt"]')).toBeVisible();

  // GitHub: 받는 동안 진행 막대와 취소 버튼이 보이고, 취소하면 안내가 뜬다
  const gitInput = dialog.getByLabel('GitHub 저장소');
  await gitInput.fill('slow/repo');
  await dialog.getByRole('button', { name: '클론' }).click();
  const bar = dialog.getByRole('progressbar', { name: '가져오기 진행률' });
  await expect(bar).toBeVisible();
  await expect(bar).toHaveAttribute('aria-valuenow', '45');
  await expect(dialog).toContainText('GitHub에서 받는 중… 45%');
  // 받는 중에 놓은 파일은 넣지 않고 알린다
  const dt2 = await page.evaluateHandle(() => {
    const d = new DataTransfer();
    d.items.add(new File(['x'], 'late.txt', { type: 'text/plain' }));
    return d;
  });
  await dialog.locator('[data-knowledge-drop]').dispatchEvent('drop', { dataTransfer: dt2 });
  await expect(dialog.getByRole('alert')).toContainText('아직 가져오는 중');
  await dialog.getByRole('button', { name: '취소', exact: true }).click();
  await expect(bar).toBeHidden();
  await expect(dialog.getByRole('status')).toContainText('가져오기를 취소했어요.');
  await expect(dialog.locator('[data-entry="late.txt"]')).toHaveCount(0);

  // 실패하면 원인이 붉은 경고로 보인다
  await gitInput.fill('broken/repo');
  await dialog.getByRole('button', { name: '클론' }).click();
  await expect(dialog.getByRole('alert')).toContainText('추가하지 못했어요. 다시 시도해 주세요. (저장소를 받지 못했습니다 (Repository not found.))');
  await expect(bar).toBeHidden();

  // 기본 브랜치(main·master)만 받는다는 안내
  await expect(dialog.locator('[data-git-hint]')).toContainText('기본 브랜치');

  // 미리보기
  await dialog.locator('[data-entry="links/cell.md"]').getByRole('button', { name: 'cell.md', exact: true }).click();
  await expect(dialog.getByText('본문: links/cell.md')).toBeVisible();

  // 항목 삭제 (확인 창)
  await dialog.getByRole('button', { name: '지우기: drop.txt' }).click();
  await page.getByRole('button', { name: '지우기', exact: true }).click();
  await expect(dialog.locator('[data-entry="drop.txt"]')).toHaveCount(0);

  // 연결 해제 후 지식베이스 지우기
  await dialog.getByRole('button', { name: '연결 해제', exact: true }).click();
  await expect(main.locator('[data-knowledge-button][data-linked]')).toHaveCount(0);
  await dialog.getByRole('button', { name: '지식베이스 지우기' }).click();
  await page.getByRole('button', { name: '지우기', exact: true }).click();
  await expect(dialog).toContainText('아직 지식베이스가 없어요.');

  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  expect(errors).toEqual([]);
});

test('API가 없는 웹에서는 지식베이스 버튼이 보이지 않는다', async ({ page }) => {
  const main = await start(page);
  await expect(main).toBeVisible();
  await expect(main.locator('[data-knowledge-button]')).toHaveCount(0);
});

test('설명·문서 검색·출처 갱신·임베딩 설정', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(installFakeKnowledge);
  const main = await start(page);

  await main.locator('[data-knowledge-button]').click();
  const dialog = page.getByRole('dialog', { name: '지식베이스', exact: true });
  await dialog.getByRole('button', { name: '새 지식베이스' }).first().click();
  await dialog.getByLabel('새 지식베이스').fill('논문');
  await dialog.getByRole('button', { name: '만들기' }).click();
  await expect(dialog.getByRole('heading', { name: '논문', level: 3 })).toBeVisible();

  // 자료: 파일 하나와 GitHub 저장소 하나 (저장소는 출처로 남는다)
  await dialog.getByRole('button', { name: '파일 선택' }).click();
  await expect(dialog.locator('[data-entry="notes/intro.md"]')).toBeVisible();
  await dialog.getByLabel('GitHub 저장소').fill('acme/notes');
  await dialog.getByRole('button', { name: '클론' }).click();
  await expect(dialog.locator('[data-entry="repos/repo/README.md"]')).toBeVisible();

  // 문서 목록: 두 문서가 보이고, 검색어로 걸러진다
  const docs = dialog.locator('[data-doc]');
  await expect(docs).toHaveCount(2);
  const search = dialog.getByRole('searchbox', { name: '경로나 제목으로 검색' });
  await search.fill('readme');
  await expect(docs).toHaveCount(1);
  await expect(docs.first()).toContainText('README.md');
  await search.fill('없는문서');
  await expect(dialog).toContainText('검색 결과가 없어요.');
  await search.fill('');
  await expect(docs).toHaveCount(2);

  // 출처: GitHub 출처만 갱신 버튼이 있고, 누르면 완료 문구가 뜬다
  const sources = dialog.locator('[data-source]');
  await expect(sources).toHaveCount(1);
  await expect(sources.first()).toContainText('GitHub');
  await sources.first().getByRole('button', { name: '갱신', exact: true }).click();
  await expect(dialog.getByText('출처를 갱신했어요.')).toBeVisible();

  // 설명·저장 용량·임베딩은 지식베이스 설정 팝업에 있다
  await dialog.getByRole('button', { name: '지식베이스 설정', exact: true }).click();
  const kbSettings = page.getByRole('dialog', { name: '지식베이스 설정', exact: true });
  await expect(kbSettings).toBeVisible();
  await expect(kbSettings).toContainText('논문 설정');

  // 설명: 비어 있으면 안내가 보이고, 저장하면 바뀐다
  await expect(kbSettings.locator('[data-knowledge-description]')).toContainText('설명이 없어요');
  await kbSettings.getByRole('button', { name: '수정', exact: true }).click();
  const descInput = kbSettings.getByPlaceholder('예: 우리 팀 배포 절차 문서 모음');
  await descInput.fill('세포 신호전달 논문 모음');
  await descInput.locator('xpath=ancestor::form[1]').getByRole('button', { name: '저장', exact: true }).click();
  await expect(kbSettings.locator('[data-knowledge-description]')).toContainText('세포 신호전달 논문 모음');

  // 저장 용량
  await expect(kbSettings.locator('[data-storage-usage]')).toContainText('색인');

  // 임베딩: OpenAI를 고르면 외부 전송 안내가 뜨고, 저장하면 다시 색인을 권한다
  const provider = kbSettings.locator('label', { hasText: '방식' }).locator('select');
  await expect(provider).toHaveValue('local-hash');
  await expect(kbSettings.locator('[data-external-notice]')).toHaveCount(0);
  await provider.selectOption('openai');
  await expect(kbSettings.locator('[data-external-notice]')).toContainText('OpenAI 서버로 전송');
  await provider.locator('xpath=ancestor::form[1]').getByRole('button', { name: '저장', exact: true }).click();
  await expect(kbSettings).toContainText('모델이 바뀌었어요');

  await kbSettings.getByRole('button', { name: '닫기', exact: true }).click();
  await expect(kbSettings).toBeHidden();
  await expect(dialog).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  expect(errors).toEqual([]);
});

test('여러 지식베이스를 세션마다 고르고, 가지는 상속하며 덮어쓰고 되돌린다', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(installFakeKnowledge);
  const main = await start(page);

  await main.locator('[data-knowledge-button]').click();
  const dialog = page.getByRole('dialog', { name: '지식베이스', exact: true });
  // 모바일은 자료를 고르면 목록이 가려지므로 목록으로 돌아간다
  const backToList = async () => {
    const back = dialog.getByRole('button', { name: '목록으로' });
    if (await back.isVisible()) await back.click();
  };
  // 두 지식베이스를 만들고 각각 이 학습에 연결한다
  for (const name of ['세포생물학', '유전학']) {
    await backToList();
    await dialog.getByRole('button', { name: '새 지식베이스' }).first().click();
    await dialog.getByLabel('새 지식베이스').fill(name);
    await dialog.getByRole('button', { name: '만들기' }).click();
    await expect(dialog.getByRole('heading', { name, level: 3 })).toBeVisible();
    await dialog.getByRole('button', { name: '이 학습에 연결', exact: true }).click();
    await expect(dialog.getByRole('button', { name: '연결 해제', exact: true })).toBeVisible();
  }
  await expect(dialog.getByText('이 학습에 연결됨', { exact: true })).toHaveCount(2);
  await expect(main.locator('[data-knowledge-button][data-linked]')).toHaveCount(1);
  await expect(main.locator('[data-knowledge-button][data-inherited]')).toHaveCount(0);

  const rootId = await page.evaluate(async () => {
    const path = performance.getEntriesByType('resource').map((entry) => entry.name).find((name) => new URL(name).pathname === '/src/app/store.ts')!;
    const { appStore } = await import(/* @vite-ignore */ path);
    return appStore.getState().view.activeSessionId as string;
  });
  const rootKbs = await page.evaluate(async (root) => {
    const path = performance.getEntriesByType('resource').map((entry) => entry.name).find((name) => new URL(name).pathname === '/src/app/store.ts')!;
    const { appStore } = await import(/* @vite-ignore */ path);
    return appStore.getState().sessions[root].knowledgeIds as string[];
  }, rootId);
  expect(rootKbs).toHaveLength(2);
  const [cellId, geneId] = rootKbs;

  // 가지를 만들면 부모의 두 지식베이스를 물려받는다
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  const branchId = await page.evaluate(async (root) => {
    const path = performance.getEntriesByType('resource').map((entry) => entry.name).find((name) => new URL(name).pathname === '/src/app/store.ts')!;
    const { actions } = await import(/* @vite-ignore */ path);
    const id = actions().createSubSession(root, '분기 질문') as string;
    actions().openSession(id);
    return id;
  }, rootId);
  await expect(main.locator('[data-knowledge-button][data-inherited]')).toHaveCount(1);
  await main.locator('[data-knowledge-button]').click();
  await backToList();
  await dialog.getByRole('button', { name: /^세포생물학/ }).click();
  await expect(dialog.locator('[data-link-scope="inherited"]')).toContainText('부모 가지의 지식베이스를 따르고 있어요.');
  await expect(dialog.getByText('이 학습에 연결됨', { exact: true })).toHaveCount(2);
  await expect(dialog.getByRole('button', { name: '부모 따르기' })).toHaveCount(0);

  // 가지에서 유전학을 끊으면 이 가지만 덮어쓴 목록이 된다 (부모는 그대로)
  await backToList();
  await dialog.getByRole('button', { name: /^유전학/ }).click();
  await dialog.getByRole('button', { name: '연결 해제', exact: true }).click();
  await expect(dialog.locator('[data-link-scope="overridden"]')).toContainText('이 가지만 다른 지식베이스를 쓰고 있어요.');
  await expect(dialog.getByText('이 학습에 연결됨', { exact: true })).toHaveCount(1);
  const kbsOf = (id: string) => page.evaluate(async (sid) => {
    const path = performance.getEntriesByType('resource').map((entry) => entry.name).find((name) => new URL(name).pathname === '/src/app/store.ts')!;
    const { appStore } = await import(/* @vite-ignore */ path);
    return appStore.getState().sessions[sid].knowledgeIds as string[] | undefined;
  }, id);
  expect(await kbsOf(branchId)).toEqual([cellId]);
  expect(await kbsOf(rootId)).toEqual([cellId, geneId]);

  // 부모 따르기로 되돌리면 다시 상속한다
  await dialog.getByRole('button', { name: '부모 따르기' }).click();
  await expect(dialog.locator('[data-link-scope="overridden"]')).toHaveCount(0);
  await expect(dialog.locator('[data-link-scope="inherited"]')).toContainText('부모 가지의 지식베이스를 따르고 있어요.');
  await expect(dialog.getByText('이 학습에 연결됨', { exact: true })).toHaveCount(2);
  expect(await kbsOf(branchId)).toBeUndefined();

  await page.keyboard.press('Escape');
  expect(errors).toEqual([]);
});

test('연결된 지식베이스의 근거가 답변 출처 칩으로 붙고, 누르면 원문이 열린다', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(installFakeKnowledge);
  const main = await start(page);

  await main.locator('[data-knowledge-button]').click();
  const dialog = page.getByRole('dialog', { name: '지식베이스', exact: true });
  await dialog.getByRole('button', { name: '새 지식베이스' }).first().click();
  await dialog.getByLabel('새 지식베이스').fill('생명과학');
  await dialog.getByRole('button', { name: '만들기' }).click();
  await expect(dialog.getByRole('heading', { name: '생명과학', level: 3 })).toBeVisible();
  await dialog.getByRole('button', { name: '이 학습에 연결', exact: true }).click();
  await expect(dialog.getByRole('button', { name: '연결 해제', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();

  // 질문을 보내면 검색 근거가 답변의 출처 칩으로 붙는다
  await main.getByLabel('메시지 입력').fill('세포막은 무엇인가요');
  await main.getByRole('button', { name: '보내기' }).click();
  await expect(main.getByText('마지막 문장 [세포막은 무엇인가요].')).toBeVisible();
  const chip = main.locator('[data-citation="1"]');
  await expect(chip).toBeVisible();
  await expect(chip).toContainText('세포막');

  // 칩을 누르면 찾은 부분과 원문 문맥이 열린다
  await chip.click();
  const viewer = page.getByRole('dialog', { name: '출처 보기' });
  await expect(viewer).toContainText('세포막은 인지질 이중층으로 이루어져 있다.');
  await viewer.getByRole('button', { name: '닫기' }).first().click();
  await expect(viewer).toBeHidden();

  expect(errors).toEqual([]);
});

test('검색 설정의 근거 개수를 저장하면 전역 설정에 남는다', async ({ page }) => {
  await page.addInitScript(installFakeKnowledge);
  const main = await start(page);

  await main.locator('[data-knowledge-button]').click();
  const dialog = page.getByRole('dialog', { name: '지식베이스', exact: true });
  await dialog.getByRole('button', { name: '검색 설정', exact: true }).click();
  const rag = page.getByRole('dialog', { name: '검색 설정', exact: true });
  const topK = rag.getByLabel('근거 개수');
  await topK.fill('4');
  await rag.getByRole('button', { name: '저장', exact: true }).click();
  await expect(rag).toBeHidden();

  const stored = await page.evaluate(async () => {
    const path = performance.getEntriesByType('resource').map((entry) => entry.name).find((name) => new URL(name).pathname === '/src/app/store.ts')!;
    const { appStore } = await import(/* @vite-ignore */ path);
    return appStore.getState().settings.rag?.topK;
  });
  expect(stored).toBe(4);
});

test('자동 색인 스위치를 끄면 지식베이스 설정에 autoIndex false가 저장된다', async ({ page }) => {
  await page.addInitScript(installFakeKnowledge);
  const main = await start(page);

  await main.locator('[data-knowledge-button]').click();
  const dialog = page.getByRole('dialog', { name: '지식베이스', exact: true });
  await dialog.getByRole('button', { name: '새 지식베이스' }).first().click();
  await dialog.getByLabel('새 지식베이스').fill('자동');
  await dialog.getByRole('button', { name: '만들기' }).click();
  await expect(dialog.getByRole('heading', { name: '자동', level: 3 })).toBeVisible();

  const sw = dialog.getByRole('switch', { name: '자동 색인' });
  await expect(sw).toBeChecked();
  await sw.click();
  await expect(sw).not.toBeChecked();
  const saved = await page.evaluate(async () => {
    const api = (window as unknown as { __branchKnowledgeFake: { list: () => Promise<{ id: string }[]>; getIndexSettings: (id: string) => Promise<{ autoIndex?: boolean }> } }).__branchKnowledgeFake;
    const [kb] = await api.list();
    return (await api.getIndexSettings(kb!.id)).autoIndex;
  });
  expect(saved).toBe(false);
  await sw.click();
  await expect(sw).toBeChecked();
});
