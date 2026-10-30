import { expect, test, type Page } from '@playwright/test';

/**
 * 페이지 편집기 행 단위 개편 (ADR-095):
 * 줄 머리 기호는 스페이스를 쳐야 블록이 되고 이후엔 숨는다 · Backspace로 되돌리기 ·
 * 행 앞 + 버튼으로 아래에 새 행 · 되돌리기/설정은 제목 바에.
 */
const MAIN = '[data-panel="main"]';
const CONTENT = `${MAIN} [data-page-editor] .cm-content >> nth=0`;

type View = { state: { doc: { toString(): string; length: number } }; dispatch(s: unknown): void; focus(): void };

function collectErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
}

async function blankPage(page: Page) {
  await page.goto('/?platform=desktop');
  const onboarding = page.getByRole('dialog', { name: '시작하기' });
  await onboarding.getByRole('button', { name: /^API 키/ }).click();
  const input = page.getByLabel('Anthropic API 키');
  await input.fill('sk-ant-e2e-ok');
  await input.press('Enter');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '빈 페이지' }).click();
  await expect(page.locator(CONTENT)).toBeVisible();
}

const source = (page: Page) =>
  page.locator(CONTENT).evaluate((el) => (el as unknown as { cmTile: { root: { view: View } } }).cmTile.root.view.state.doc.toString());

async function setDoc(page: Page, text: string, caret: number) {
  await page.locator(CONTENT).evaluate(
    (el, [t, c]) => {
      const v = (el as unknown as { cmTile: { root: { view: View } } }).cmTile.root.view;
      v.focus();
      v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: t }, selection: { anchor: c } });
    },
    [text, caret] as const,
  );
}

test('# 는 스페이스를 쳐야 제목이 되고, 바뀐 뒤엔 기호가 숨으며 Backspace로 되돌린다', async ({ page }) => {
  const errors = collectErrors(page);
  await blankPage(page);
  const editor = page.locator(`${MAIN} [data-page-editor]`);
  await page.locator(CONTENT).click();

  await page.keyboard.type('#');
  await expect.poll(() => source(page)).toBe('#');
  await expect(editor.locator('.cm-line.cm-lp-h1')).toHaveCount(0);
  await expect(editor.locator('.cm-line').first()).toHaveText('#');

  await page.keyboard.press('Space');
  await expect(editor.locator('.cm-line.cm-lp-h1')).toHaveCount(1);
  await expect(editor.locator('.cm-line.cm-lp-h1')).toHaveText('');
  await page.keyboard.type('큰 제목');
  await expect(editor.locator('.cm-line.cm-lp-h1')).toHaveText('큰 제목');
  expect(await source(page)).toBe('# 큰 제목');

  // 내용 시작에서 Backspace → 기호를 지워 평범한 줄로
  for (let i = 0; i < '큰 제목'.length; i++) await page.keyboard.press('Backspace');
  await expect.poll(() => source(page)).toBe('# ');
  await page.keyboard.press('Backspace');
  await expect.poll(() => source(page)).toBe('');
  await expect(editor.locator('.cm-line.cm-lp-h1')).toHaveCount(0);

  // 목록·할 일도 같은 규칙: `[] ` → 할 일
  await page.keyboard.type('[] 숙제');
  await expect.poll(() => source(page)).toBe('- [ ] 숙제');
  await expect(editor.locator('.cm-lp-check')).toHaveCount(1);
  expect(errors).toEqual([]);
});

test('행 앞 + 버튼은 그 행 아래에 새 행을 넣고 커서를 옮긴다 · 핸들과 함께 뜬다', async ({ page }, info) => {
  test.skip(info.project.name === 'mobile', '모바일은 행을 고른 뒤 — page-engine 모바일 테스트');
  const errors = collectErrors(page);
  await blankPage(page);
  await setDoc(page, '- 사과\n- 배\n\n끝 문단', 0);
  const add = page.locator(`${MAIN} [data-page-row-add]`);
  const handles = page.locator(`${MAIN} [data-page-handle]`);
  // 목록은 항목마다 한 행
  await expect(handles).toHaveCount(3);
  await expect(add).toHaveCount(3);
  // + 는 핸들 왼쪽, 같은 높이
  const a = (await add.first().boundingBox())!;
  const h = (await handles.first().boundingBox())!;
  expect(a.x + a.width).toBeLessThanOrEqual(h.x + 1);
  expect(Math.abs(a.y + a.height / 2 - (h.y + h.height / 2))).toBeLessThan(2);

  // 목록 아래 + → 같은 기호로 새 항목, 커서는 그 자리
  await add.nth(1).click();
  await expect.poll(() => source(page)).toBe('- 사과\n- 배\n- \n\n끝 문단');
  await expect(page.locator(CONTENT)).toBeFocused();
  await page.keyboard.type('감');
  await expect.poll(() => source(page)).toBe('- 사과\n- 배\n- 감\n\n끝 문단');

  // 문단 아래 +
  await add.nth(3).click();
  await page.keyboard.type('새 행');
  await expect.poll(() => source(page)).toBe('- 사과\n- 배\n- 감\n\n끝 문단\n새 행');
  expect(errors).toEqual([]);
});

test('되돌리기·다시 하기·설정 버튼은 제목 바에 있고 본문 위 도구 줄은 없다', async ({ page }) => {
  const errors = collectErrors(page);
  await blankPage(page);
  const header = page.locator(`${MAIN} header`).first();
  await expect(header.locator('[data-page-undo]')).toBeVisible();
  await expect(header.locator('[data-page-redo]')).toBeVisible();
  await expect(header.locator('[data-page-settings-open]')).toBeVisible();
  // 제목 바와 같은 줄에 있다
  const hb = (await header.boundingBox())!;
  const ub = (await header.locator('[data-page-undo]').boundingBox())!;
  expect(ub.y).toBeGreaterThanOrEqual(hb.y);
  expect(ub.y + ub.height).toBeLessThanOrEqual(hb.y + hb.height + 1);

  await page.locator(CONTENT).click();
  await page.keyboard.type('글');
  await expect.poll(() => source(page)).toBe('글');
  await header.locator('[data-page-undo]').click();
  await expect.poll(() => source(page)).toBe('');
  await header.locator('[data-page-redo]').click();
  await expect.poll(() => source(page)).toBe('글');
  await page.screenshot({ path: `test-results/page-rows-${test.info().project.name}.png` });
  expect(errors).toEqual([]);
});
