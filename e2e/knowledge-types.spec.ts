import { expect, test, type Page } from '@playwright/test';

/**
 * 지식베이스 유형 (코드베이스 직접 탐색 / 문서 하이브리드 검색).
 * 웹 개발 서버에는 데스크톱 bridge가 없으므로 addInitScript가 가짜 API(window.__branchKnowledgeFake)를 넣는다.
 * 선택적 메서드(retrieve, cancelRetrieve, reindex, setExcludes, setKind …)도 채워서 UI 흐름을 본다.
 */
const KEY = 'sk-ant-e2e-ok';

function installKbTypesFake() {
  type Kind = 'codebase' | 'document';
  type Base = {
    id: string;
    name: string;
    description?: string;
    kind?: Kind;
    linkedPath?: string;
    excludes?: string[];
    fileCount: number;
    totalBytes: number;
    createdAt: number;
    updatedAt: number;
    failedDocs: number;
  };
  const bases = new Map<string, Base>();
  let seq = 0;
  const retrieveCancelled = new Set<string>();
  const pending = new Map<string, (v: unknown) => void>();
  const info = (b: Base) => ({
    id: b.id,
    name: b.name,
    description: b.description,
    createdAt: b.createdAt,
    updatedAt: b.updatedAt,
    fileCount: b.fileCount,
    totalBytes: b.totalBytes,
    kind: b.kind,
    linkedPath: b.linkedPath,
    excludes: b.excludes,
  });
  const state = (b: Base) => ({
    kbId: b.id,
    status: b.failedDocs > 0 ? 'partial' : b.kind === 'codebase' ? 'empty' : 'ready',
    kind: b.kind,
    docCount: b.kind === 'document' ? b.fileCount : 0,
    chunkCount: b.kind === 'document' ? b.fileCount * 3 : 0,
    indexBytes: 0,
    sourceBytes: b.totalBytes,
    failedDocs: b.failedDocs,
    lastJob: undefined,
  });
  const get = (id: string) => {
    const b = bases.get(id);
    if (!b) throw new Error('no base');
    return b;
  };
  const seed = (over: Partial<Base> & { id: string; name: string }) => {
    bases.set(over.id, { fileCount: 0, totalBytes: 0, createdAt: 0, updatedAt: Date.now(), failedDocs: 0, ...over });
  };
  seed({ id: 'kbcode', name: 'Kubernetes 소스', kind: 'codebase', linkedPath: '/src/k8s', excludes: ['.git/', 'vendor/'], fileCount: 4200, totalBytes: 9000000, updatedAt: Date.now() - 3 * 3_600_000 });
  seed({ id: 'kbdoc', name: '운영 가이드', kind: 'document', description: '팀 배포 절차', fileCount: 2, totalBytes: 2048, updatedAt: Date.now() - 2 * 86_400_000, failedDocs: 1 });
  seed({ id: 'kbnone', name: '미정 자료', fileCount: 1, totalBytes: 100, updatedAt: Date.now() - 9 * 86_400_000 });

  const hit = (kbId: string, kbName: string, n: number, codebase: boolean) => ({
    n,
    kbId,
    kbName,
    chunkId: `c${n}`,
    docId: `d${n}`,
    path: codebase ? 'pkg/sched/queue.go' : '운영 가이드.pdf',
    title: codebase ? 'queue.go' : '운영 가이드',
    kind: codebase ? 'code' : 'pdf',
    headingPath: [],
    page: codebase ? undefined : 4,
    lineStart: codebase ? 120 : undefined,
    lineEnd: codebase ? 148 : undefined,
    text: 'Pod 스케줄링은 큐에서 우선순위가 높은 Pod부터 노드 필터와 점수로 고른다.',
    score: codebase ? 0.91 : 0.64,
    method: codebase ? 'agentic' : 'hybrid',
  });

  const api = {
    onProgress: () => () => undefined,
    cancel: async () => undefined,
    list: async () => [...bases.values()].map(info),
    create: async (name: string, opts?: { kind?: Kind; linkedPath?: string }) => {
      const id = `kbnew${String(++seq).padStart(4, '0')}`;
      const b: Base = { id, name, kind: opts?.kind, linkedPath: opts?.linkedPath, fileCount: 0, totalBytes: 0, createdAt: 0, updatedAt: Date.now(), failedDocs: 0 };
      bases.set(id, b);
      return info(b);
    },
    rename: async (id: string, name: string) => {
      get(id).name = name;
      return info(get(id));
    },
    remove: async (id: string) => {
      bases.delete(id);
    },
    tree: async (id: string) => {
      const b = get(id);
      if (b.kind === 'codebase') return [{ path: 'pkg', dir: true }];
      return [
        { path: '운영 가이드.pdf', dir: false, size: 1024 },
        { path: '배포.md', dir: false, size: 1024 },
      ];
    },
    preview: async () => ({ kind: 'text', text: 'package sched', truncated: false }),
    pathForFile: () => '',
    addPaths: async () => ({ added: [], skipped: 0 }),
    addFiles: async () => ({ added: [], skipped: 0 }),
    pickFiles: async () => [],
    addLink: async () => ({ added: [], skipped: 0 }),
    cloneGit: async () => undefined,
    removeEntry: async () => undefined,
    open: async () => undefined,
    pickFolder: async () => null,
    inspectFolder: async () => ({ path: '/src/k8s', fileCount: 4200, totalBytes: 9000000, isGit: true, truncated: false }),
    indexStates: async (ids?: string[]) => [...bases.values()].filter((b) => !ids || ids.includes(b.id)).map(state),
    reindex: async (id: string) => {
      get(id).failedDocs = 0;
    },
    setKind: async (id: string, kind: Kind) => {
      get(id).kind = kind;
    },
    setExcludes: async (id: string, excludes: string[]) => {
      get(id).excludes = excludes;
    },
    verifyIndex: async () => ({ ok: true }),
    restoreIndexBackup: async () => false,
    setDescription: async () => undefined,
    getIndexSettings: async () => ({ embedding: { provider: 'local-hash' }, autoIndex: true }),
    setIndexSettings: async () => undefined,
    sources: async () => [],
    docs: async () => [],
    retrieve: async (req: { kbIds: string[]; plan: { original: string } }, requestId?: string) => {
      const kb = get(req.kbIds[0]!);
      const codebase = kb.kind === 'codebase';
      // '느린 질문'은 취소될 때까지 응답하지 않는다 (취소 흐름 검증용)
      if (req.plan.original === '느린 질문') {
        return new Promise((resolve, reject) => {
          if (requestId) pending.set(requestId, (v) => (retrieveCancelled.has(requestId) ? reject(new Error('cancelled')) : resolve(v)));
        });
      }
      return {
        plan: {},
        evidence: [hit(kb.id, kb.name, 1, codebase)],
        skipped: [],
        tookMs: 42,
        notices: [],
      };
    },
    cancelRetrieve: async (requestId: string) => {
      retrieveCancelled.add(requestId);
      pending.get(requestId)?.(undefined);
      pending.delete(requestId);
    },
    source: async (kbId: string) => ({
      kbId,
      path: 'pkg/sched/queue.go',
      title: 'queue.go',
      kind: 'code',
      headingPath: [],
      chunkText: 'func (q *Queue) Pop() {}',
      sectionText: 'func (q *Queue) Pop() {}',
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

async function openDialog(page: Page) {
  const main = await start(page);
  await main.locator('[data-knowledge-button]').click();
  const dialog = page.getByRole('dialog', { name: '지식베이스', exact: true });
  await expect(dialog).toBeVisible();
  return dialog;
}

test('목록: 유형 배지·준비 상태가 보이고 유형 필터와 검색으로 좁힌다', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(installKbTypesFake);
  const dialog = await openDialog(page);

  await expect(dialog.locator('[data-kind="codebase"]').first()).toBeVisible();
  await expect(dialog.locator('[data-kind="document"]').first()).toBeVisible();
  await expect(dialog.locator('[data-readiness="partial"]')).toBeVisible();

  await dialog.getByRole('button', { name: '코드베이스', exact: true }).click();
  await expect(dialog.getByRole('button', { name: '코드베이스', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(dialog.getByRole('button', { name: /Kubernetes 소스/ })).toBeVisible();
  await expect(dialog.getByRole('button', { name: /운영 가이드/ })).toHaveCount(0);

  await dialog.getByRole('button', { name: '전체', exact: true }).click();
  await dialog.getByLabel('지식베이스 검색').fill('배포 절차');
  await expect(dialog.getByRole('button', { name: /운영 가이드/ })).toBeVisible();
  await expect(dialog.getByRole('button', { name: /Kubernetes 소스/ })).toHaveCount(0);
  await dialog.getByLabel('지식베이스 검색').fill('없는말');
  await expect(dialog).toContainText('조건에 맞는 지식베이스가 없어요.');

  expect(errors).toEqual([]);
});

test('목록 항목: 설명 한 줄, 코드베이스 경로(전체 경로는 title), 마지막 변경 시각이 보인다', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(installKbTypesFake);
  const dialog = await openDialog(page);

  const docRow = dialog.getByRole('button', { name: /운영 가이드/ });
  await expect(docRow).toContainText('팀 배포 절차');
  await expect(docRow.locator('time')).toHaveText(/.+/);

  const codeRow = dialog.getByRole('button', { name: /Kubernetes 소스/ });
  const pathLine = codeRow.locator('[title="/src/k8s"]');
  await expect(pathLine).toBeVisible();
  await expect(codeRow.locator('time')).toHaveText(/.+/);

  expect(errors).toEqual([]);
});

test('만들기: 첫 단계 두 유형 카드, 코드베이스는 색인 옵션 없이 안내 문구를 보여 준다', async ({ page }) => {
  await page.addInitScript(installKbTypesFake);
  const dialog = await openDialog(page);

  await dialog.getByRole('button', { name: '새 지식베이스' }).first().click();
  const codebaseCard = dialog.locator('[data-kind-card="codebase"]');
  const documentCard = dialog.locator('[data-kind-card="document"]');
  await expect(codebaseCard).toBeVisible();
  await expect(documentCard).toBeVisible();

  await codebaseCard.click();
  await expect(dialog).toContainText('코드베이스는 색인하지 않고 질문할 때마다 실제 파일을 직접 탐색해요.');
  await expect(dialog.getByRole('radio')).toHaveCount(0);
  await dialog.getByRole('button', { name: '뒤로', exact: true }).click();

  await documentCard.click();
  await expect(dialog.getByRole('radio', { name: '로컬 의미 검색 (기본)' })).toBeChecked();
});

test('문서 상세: 실패 문서 재시도와 검색 테스트가 근거 카드를 보여 준다', async ({ page }) => {
  await page.addInitScript(installKbTypesFake);
  const dialog = await openDialog(page);

  await dialog.getByRole('button', { name: /운영 가이드/ }).click();
  await expect(dialog.locator('[data-doc-maint]')).toBeVisible();
  await expect(dialog.getByRole('button', { name: '실패한 문서 1개 다시 시도' })).toBeVisible();

  const search = dialog.locator('[data-search-test]');
  await search.getByLabel('검색 질문').fill('Pod Scheduling은 어떻게 동작하나요?');
  await search.getByRole('button', { name: '검색', exact: true }).click();
  const hit = search.locator('[data-search-hit="1"]');
  await expect(hit).toContainText('운영 가이드 p.4');
  await expect(hit).toContainText('하이브리드 검색 (벡터 + 키워드)');
  await expect(hit.getByRole('meter')).toHaveAttribute('aria-valuenow', '64');
  await hit.getByRole('button', { name: '원문 보기' }).click();
  await expect(page.getByText('func (q *Queue) Pop() {}')).toBeVisible();
});

test('코드베이스 상세: 제외 목록을 고치고 검색 결과는 path:줄로 보인다. 색인 관리 버튼은 없다', async ({ page }) => {
  await page.addInitScript(installKbTypesFake);
  const dialog = await openDialog(page);

  await dialog.getByRole('button', { name: /Kubernetes 소스/ }).click();
  await expect(dialog.locator('[data-doc-maint]')).toHaveCount(0);
  const excludes = dialog.locator('[data-excludes-editor] textarea');
  await expect(excludes).toHaveValue('.git/\nvendor/');
  await excludes.fill('.git/\nvendor/\ndist/');
  await dialog.getByRole('button', { name: '저장', exact: true }).click();
  await expect(dialog.getByRole('button', { name: '저장', exact: true })).toBeDisabled();

  const search = dialog.locator('[data-search-test]');
  await search.getByLabel('검색 질문').fill('Pod Scheduling은 어떻게 동작하나요?');
  await search.getByRole('button', { name: '검색', exact: true }).click();
  await expect(search.locator('[data-search-hit="1"]')).toContainText('pkg/sched/queue.go:120-148');
  await expect(search.locator('[data-search-hit="1"]')).toContainText('직접 탐색');
});

test('검색 테스트는 취소할 수 있고 취소 뒤에는 결과 없이 취소 안내가 보인다', async ({ page }) => {
  await page.addInitScript(installKbTypesFake);
  const dialog = await openDialog(page);

  await dialog.getByRole('button', { name: /운영 가이드/ }).click();
  const search = dialog.locator('[data-search-test]');
  await search.getByLabel('검색 질문').fill('느린 질문');
  await search.getByRole('button', { name: '검색', exact: true }).click();
  await expect(search.locator('[data-search-state="running"]')).toBeVisible();
  await search.locator('[data-search-cancel]').click();
  await expect(search.locator('[data-search-state="cancelled"]')).toBeVisible();
  await expect(search.locator('[data-search-results]')).toHaveCount(0);
});

// 수동 캡처: KB_SHOTS=/절대/경로 pnpm exec playwright test e2e/knowledge-types.spec.ts --project=desktop -g 스크린샷
const SHOT_DIR = process.env.KB_SHOTS;
const SHOT_CONFIGS = [
  { name: 'm390-light', width: 390, height: 844, scheme: 'light' as const },
  { name: 'd900x600-light', width: 900, height: 600, scheme: 'light' as const },
  { name: 'm390-dark', width: 390, height: 844, scheme: 'dark' as const },
];
for (const cfg of SHOT_CONFIGS) {
  test(`스크린샷 ${cfg.name}`, async ({ page }) => {
    test.skip(!SHOT_DIR, 'KB_SHOTS 환경 변수가 있을 때만 실행');
    await page.setViewportSize({ width: cfg.width, height: cfg.height });
    await page.emulateMedia({ colorScheme: cfg.scheme });
    await page.addInitScript(installKbTypesFake);
    const dialog = await openDialog(page);
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${SHOT_DIR}/${cfg.name}-01-list.png` });

    await dialog.getByRole('button', { name: '새 지식베이스' }).first().click();
    await expect(dialog.locator('[data-kind-card="codebase"]')).toBeVisible();
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${SHOT_DIR}/${cfg.name}-02-create-kind.png` });
    await dialog.locator('[data-kind-card="codebase"]').click();
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${SHOT_DIR}/${cfg.name}-03-create-codebase.png` });
    await dialog.getByRole('button', { name: '뒤로', exact: true }).click();
    await dialog.getByRole('button', { name: '취소', exact: true }).click();

    await dialog.getByRole('button', { name: /Kubernetes 소스/ }).click();
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${SHOT_DIR}/${cfg.name}-04-codebase-detail.png` });

    await dialog.getByRole('button', { name: '목록으로', exact: true }).click({ timeout: 2000 }).catch(() => undefined);
    await dialog.getByRole('button', { name: /운영 가이드/ }).click();
    const search = dialog.locator('[data-search-test]');
    await search.getByLabel('검색 질문').fill('Pod Scheduling은 어떻게 동작하나요?');
    await search.getByRole('button', { name: '검색', exact: true }).click();
    await expect(search.locator('[data-search-hit="1"]')).toBeVisible();
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${SHOT_DIR}/${cfg.name}-05-document-search.png` });
  });
}
