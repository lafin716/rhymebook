import { expect, test, type Page } from '@playwright/test';

/**
 * ADR-107: 학습별 지식베이스. 웹 개발 서버에서는 데스크톱 bridge가 없으므로
 * addInitScript가 메모리 안의 가짜 지식베이스 API(window.__branchKnowledgeFake)를 넣는다.
 * 프로덕션 빌드는 이 훅을 읽지 않는다 (ui/src/knowledge/api.ts는 import.meta.env.DEV에서만 사용).
 */
const KEY = 'sk-ant-e2e-ok';

function installFakeKnowledge() {
  type Base = { id: string; name: string; files: Map<string, string> };
  const bases = new Map<string, Base>();
  let seq = 0;
  const info = (b: Base) => ({
    id: b.id,
    name: b.name,
    createdAt: 0,
    updatedAt: 0,
    fileCount: b.files.size,
    totalBytes: [...b.files.values()].reduce((a, c) => a + c.length, 0),
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
      const b: Base = { id, name, files: new Map() };
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
      return put(get(id), ['repos/repo/README.md']);
    },
    removeEntry: async (id: string, path: string) => {
      get(id).files.delete(path);
    },
    preview: async (id: string, path: string) => {
      const text = get(id).files.get(path) ?? null;
      return { text, size: text?.length ?? 0, truncated: false };
    },
    open: async () => {},
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
  const dialog = page.getByRole('dialog', { name: '지식베이스' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('아직 지식베이스가 없어요.');

  // 빈 상태의 만들기 버튼으로 새 지식베이스
  await dialog.getByRole('button', { name: '새 지식베이스' }).first().click();
  await dialog.getByLabel('새 지식베이스').fill('세포생물학');
  await dialog.getByRole('button', { name: '만들기' }).click();
  await expect(dialog.getByRole('heading', { name: '세포생물학', level: 3 })).toBeVisible();

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
