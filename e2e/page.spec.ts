import { expect, test, type Page } from '@playwright/test';

/**
 * 마크다운 페이지 세션 (ADR-072): 새로 만들기 → 빈 페이지 → 마크다운 작성 → 렌더 → 글을 골라 가지 → 새로고침 후 유지.
 * 가지 응답은 e2e/mock-anthropic.mjs가 "마지막 문장 [대상]."으로 돌려준다.
 */
const KEY = 'sk-ant-e2e-ok';
const LOCAL = '/?platform=desktop';
const MAIN = '[data-panel="main"]';
const DOC = '# 어텐션 노트\n\n- 쿼리와 키를 비교한다\n- **가중합**으로 값을 섞는다\n\n소프트맥스로 정규화한다.';

/** CodeMirror 편집기의 마크다운 원문 (실시간 렌더라 화면 글자와 다르다, ADR-075) */
async function source(page: Page) {
  return page
    .locator(`${MAIN} [data-page-editor] .cm-content`)
    .evaluate((el) => (el as unknown as { cmTile: { root: { view: { state: { doc: { toString(): string } } } } } }).cmTile.root.view.state.doc.toString());
}

function collectErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
}

async function onboard(page: Page) {
  await page.goto(LOCAL);
  const onboarding = page.getByRole('dialog', { name: '시작하기' });
  await onboarding.getByRole('button', { name: /^API 키/ }).click();
  const input = page.getByLabel('Anthropic API 키');
  await input.fill(KEY);
  await input.press('Enter');
  await page.keyboard.press('Escape');
}

async function writePage(page: Page) {
  const main = page.locator(MAIN);
  const body = main.getByLabel('페이지 본문 (마크다운)');
  await expect(body).toBeVisible();
  // 대화 입력창은 없다
  await expect(main.getByLabel('메시지 입력')).toHaveCount(0);
  await body.fill(DOC);
  await main.getByRole('button', { name: '완료' }).click();
  await expect(main.getByRole('heading', { name: '어텐션 노트' })).toBeVisible();
  await expect(main.locator('li').filter({ hasText: '쿼리와 키를 비교한다' })).toBeVisible();
  await expect(main.locator('strong', { hasText: '가중합' })).toBeVisible();
}

test('빈 페이지 작성 → 글을 골라 가지 → 새로고침 후 본문·앵커 유지', async ({ page }) => {
  const errors = collectErrors(page);
  await onboard(page);
  await page.getByRole('button', { name: '빈 페이지' }).click();
  await writePage(page);

  // 페이지 글을 골라 묻기
  const ask = page.getByRole('button', { name: '이게 뭐야?' });
  await expect(async () => {
    await page.evaluate((sel) => {
      const root = document.querySelector(`${sel} [data-anchorable]`)!;
      const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let n = w.nextNode(); n; n = w.nextNode()) {
        const t = n as Text;
        const i = t.data.indexOf('소프트맥스');
        if (i < 0) continue;
        const r = document.createRange();
        r.setStart(t, i);
        r.setEnd(t, i + '소프트맥스'.length);
        const s = getSelection()!;
        s.removeAllRanges();
        s.addRange(r);
        document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
        return;
      }
      throw new Error('선택할 텍스트 없음');
    }, MAIN);
    await expect(ask).toBeVisible({ timeout: 500 });
  }).toPass();
  await ask.click();
  await expect(page.getByText('마지막 문장 [소프트맥스].').last()).toBeVisible();

  await page.reload();
  const main = page.locator(MAIN);
  await expect(main.getByRole('heading', { name: '어텐션 노트' })).toBeVisible();
  await expect(main.locator('mark.anchor').first()).toBeAttached();
  expect(errors).toEqual([]);
});

test('사이드바 새로 만들기 → 빈 화면에서 빈 페이지로 시작, 문서 아이콘과 제목 바꾸기', async ({ page }, info) => {
  test.skip(info.project.name === 'mobile', '모바일은 사이드바가 서랍이라 데스크톱에서 검증');
  const errors = collectErrors(page);
  await onboard(page);

  // 작은 메뉴 없이 바로 빈 대화 화면이 열린다 (ADR-074)
  await page.getByRole('button', { name: '새로 만들기' }).click();
  await expect(page.getByRole('menu')).toHaveCount(0);
  await page.locator(MAIN).getByRole('button', { name: '빈 페이지로 시작' }).click();
  await writePage(page);
  await expect(page.locator('svg[aria-label="페이지"]').first()).toBeVisible();

  // 헤더 제목을 눌러 이름 바꾸기
  const main = page.locator(MAIN);
  await main.locator('[data-page-title]').click();
  const rename = main.getByRole('textbox').first();
  await rename.fill('어텐션 정리');
  await rename.press('Enter');
  await expect(main.locator('[data-page-title]')).toHaveText(/어텐션 정리/);

  // 편집으로 돌아가면 원문이 그대로다
  await main.getByRole('button', { name: '편집' }).click();
  await expect(main.getByLabel('페이지 본문 (마크다운)')).toBeVisible();
  expect(await source(page)).toBe(DOC);
  expect(errors).toEqual([]);
});

test('/ 블록 넣기 — 검색·키보드로 고르고 Esc는 메뉴만 닫는다 (ADR-073)', async ({ page }) => {
  const errors = collectErrors(page);
  await onboard(page);
  await page.getByRole('button', { name: '빈 페이지' }).click();
  const main = page.locator(MAIN);
  const body = main.getByLabel('페이지 본문 (마크다운)');
  const menu = main.getByRole('listbox', { name: '블록 넣기' });
  await expect(body).toBeFocused();

  // /제목 → 제목 1·2·3, ↓로 제목 2 → Enter
  await page.keyboard.type('/제목');
  await expect(menu.getByRole('option')).toHaveCount(3);
  await expect(menu.getByRole('option', { selected: true })).toContainText('제목 1');
  await page.keyboard.press('ArrowDown');
  await expect(menu.getByRole('option', { selected: true })).toContainText('제목 2');
  await page.keyboard.press('Enter');
  await expect(menu).toHaveCount(0);
  await page.keyboard.type('어텐션 노트');
  await expect.poll(() => source(page)).toBe('## 어텐션 노트');

  // 문단 뒤 /hr → 구분선은 빈 줄로 띄운다, 영문 검색어
  await page.keyboard.press('Enter');
  await page.keyboard.type('본문 문장');
  await page.keyboard.press('Enter');
  await page.keyboard.type('/hr');
  await expect(menu.getByRole('option')).toHaveCount(1);
  await page.keyboard.press('Enter');
  // 할 일 목록은 클릭으로
  await page.keyboard.type('/할');
  await menu.getByRole('option', { name: /할 일 목록/ }).click();
  await page.keyboard.type('복습하기');
  await expect.poll(() => source(page)).toBe('## 어텐션 노트\n본문 문장\n\n---\n- [ ] 복습하기');

  // Esc는 메뉴만 닫고 편집을 이어간다. 같은 / 자리에선 다시 열리지 않는다
  // (Enter는 목록을 이어 가고, 빈 항목에서 한 번 더 누르면 목록을 끝낸다)
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await page.keyboard.type('/제');
  await expect(menu).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(body).toBeVisible();
  await page.keyboard.type('목'); // 여전히 맞는 검색어여도 닫힌 채다
  await expect(menu).toHaveCount(0);
  await expect.poll(() => source(page)).toMatch(/\/제목$/);
  // 맞는 블록이 없으면 메뉴가 없고, 경로 같은 a/b에서는 열리지 않는다
  await page.keyboard.type(' /없는블록 a/b');
  await expect(menu).toHaveCount(0);

  await main.getByRole('button', { name: '완료' }).click();
  await expect(main.getByRole('heading', { level: 2, name: '어텐션 노트' })).toBeVisible();
  await expect(main.locator('hr')).toHaveCount(1);
  await expect(main.locator('input[type="checkbox"]')).toHaveCount(1);
  expect(errors).toEqual([]);
});

test('실시간 렌더 — 커서가 없는 줄은 마크다운 기호를 숨기고 서식으로 보인다 (ADR-075)', async ({ page }) => {
  const errors = collectErrors(page);
  await onboard(page);
  await page.getByRole('button', { name: '빈 페이지' }).click();
  const main = page.locator(MAIN);
  const editor = main.locator('[data-page-editor]');
  await page.keyboard.type('## 제목 줄');
  await page.keyboard.press('Enter');
  await page.keyboard.type('**굵게** 그리고 `코드`');
  await page.keyboard.press('Enter');
  await page.keyboard.type('- [ ] 할 일');
  // 목록은 Enter로 이어지고, 빈 항목에서 Enter를 한 번 더 누르면 끝난다
  await page.keyboard.press('Enter');
  await expect.poll(() => source(page)).toMatch(/- \[ \] 할 일\n- \[ \] $/);
  await page.keyboard.press('Enter');
  await page.keyboard.type('마지막 줄');

  // 제목 줄: 줄 서식이 붙고 # 기호는 숨긴다
  const heading = editor.locator('.cm-line.cm-lp-h2');
  await expect(heading).toHaveText('제목 줄');
  await expect(editor.locator('.cm-lp-strong')).toHaveText('굵게');
  await expect(editor.locator('.cm-lp-inline-code')).toHaveText('코드');
  await expect(editor.locator('.cm-line', { hasText: '굵게' })).not.toContainText('**');
  // 할 일 체크박스는 눌러서 원문을 바꾼다
  await editor.locator('.cm-lp-check').click();
  await expect.poll(() => source(page)).toContain('- [x] 할 일');

  // 커서를 제목 줄로 옮기면 그 줄만 원문(## )이 드러난다
  await heading.click();
  await expect(editor.locator('.cm-line.cm-lp-h2')).toContainText('## ');
  expect(await source(page)).toBe('## 제목 줄\n**굵게** 그리고 `코드`\n- [x] 할 일\n마지막 줄');
  await page.screenshot({ path: `test-results/page-live-${test.info().project.name}.png` });
  expect(errors).toEqual([]);
});

test('/하위 페이지 → 링크로 열고, 이름을 바꾸면 부모 링크도 바뀐다 (ADR-075)', async ({ page }, info) => {
  test.skip(info.project.name === 'mobile', '모바일은 사이드바가 서랍이라 데스크톱에서 검증');
  const errors = collectErrors(page);
  await onboard(page);
  await page.getByRole('button', { name: '빈 페이지' }).click();
  const main = page.locator(MAIN);
  const title = main.locator('[data-page-title]');
  await page.keyboard.type('부모 본문');
  await page.keyboard.press('Enter');
  await page.keyboard.type('/하위');
  await main.getByRole('listbox', { name: '블록 넣기' }).getByRole('option', { name: /하위 페이지/ }).click();
  await expect.poll(() => source(page)).toMatch(/^부모 본문\n\[새 페이지\]\(#page:[^)]+\)$/);
  await main.getByRole('button', { name: '완료' }).click();
  await title.click();
  await main.getByRole('textbox').first().fill('부모 노트');
  await page.keyboard.press('Enter');
  await expect(title).toHaveText(/부모 노트/);

  // 읽기 화면의 링크를 누르면 하위 페이지가 열린다
  const link = main.locator('a.page-link', { hasText: '새 페이지' });
  await expect(link).toBeVisible();
  await link.click();
  await expect(title).toHaveText(/새 페이지/);
  await title.click();
  await main.getByRole('textbox').first().fill('하위 노트');
  await page.keyboard.press('Enter');
  await expect(title).toHaveText(/하위 노트/);

  // 부모로 돌아가면 링크 제목도 바뀌어 있다
  await page.getByRole('navigation', { name: '학습 세션' }).getByText('부모 노트').first().click();
  await expect(main.locator('a.page-link', { hasText: '하위 노트' })).toBeVisible();
  await page.screenshot({ path: `test-results/page-sublink-${info.project.name}.png` });
  expect(errors).toEqual([]);
});
