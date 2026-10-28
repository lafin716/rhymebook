import { expect, test, type Page } from '@playwright/test';

/**
 * 페이지 편집 엔진 (ADR-087): 콜론 이모지 미리보기, 번호 목록 당겨 매기기, 이미지 선택·통째 지우기,
 * 블록 핸들로 옮기기·좌우 나란히 배치, 핸들 메뉴.
 */
const MAIN = '[data-panel="main"]';
const CONTENT = `${MAIN} [data-page-editor] .cm-content`;
const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAGklEQVR42mNk+M9Qz0AEYBxVSF+FAP8EBQEAOjsKX6kNqGQAAAAASUVORK5CYII=';

type View = {
  state: { doc: { toString(): string; length: number } };
  dispatch(s: unknown): void;
  focus(): void;
};

function collectErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
}

async function onboard(page: Page) {
  await page.goto('/?platform=desktop');
  const onboarding = page.getByRole('dialog', { name: '시작하기' });
  await onboarding.getByRole('button', { name: /^API 키/ }).click();
  const input = page.getByLabel('Anthropic API 키');
  await input.fill('sk-ant-e2e-ok');
  await input.press('Enter');
  await page.keyboard.press('Escape');
}

async function blankPage(page: Page) {
  await onboard(page);
  await page.getByRole('button', { name: '빈 페이지' }).click();
  await expect(page.locator(CONTENT)).toBeVisible();
}

async function source(page: Page) {
  return page.locator(CONTENT).evaluate((el) => (el as unknown as { cmTile: { root: { view: View } } }).cmTile.root.view.state.doc.toString());
}

/** 본문을 통째로 바꾸고(입력 아님) 커서를 문서 끝 또는 지정 위치에 둔다 */
async function setDoc(page: Page, text: string, caret?: number) {
  await page.locator(CONTENT).evaluate(
    (el, [t, c]) => {
      const v = (el as unknown as { cmTile: { root: { view: View } } }).cmTile.root.view;
      v.focus();
      v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: t }, selection: { anchor: c ?? (t as string).length } });
    },
    [text, caret ?? null] as const,
  );
}

async function select(page: Page, from: number, to: number) {
  await page.locator(CONTENT).evaluate(
    (el, [a, b]) => {
      const v = (el as unknown as { cmTile: { root: { view: View } } }).cmTile.root.view;
      v.focus();
      v.dispatch({ selection: { anchor: a, head: b } });
    },
    [from, to] as const,
  );
}

const undoKey = process.platform === 'darwin' ? 'Meta+z' : 'Control+z';

test('콜론 이모지 미리보기: :smi 입력하면 후보가 뜨고 Enter로 넣는다', async ({ page }) => {
  const errors = collectErrors(page);
  await blankPage(page);
  await setDoc(page, '안녕 ');
  await page.keyboard.type(':smi');
  const popup = page.locator('[data-page-emoji]');
  await expect(popup).toBeVisible();
  const first = popup.getByRole('option').first();
  await expect(first).toHaveAttribute('aria-selected', 'true');
  const emoji = await first.getAttribute('data-emoji');
  await page.keyboard.press('Enter');
  await expect(popup).toHaveCount(0);
  expect(await source(page)).toBe(`안녕 ${emoji}`);

  // Esc로 닫으면 글자 그대로
  await page.keyboard.type(' :hea');
  await expect(popup).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(popup).toHaveCount(0);
  expect(await source(page)).toBe(`안녕 ${emoji} :hea`);
  expect(errors).toEqual([]);
});

test('번호 목록 가운데 항목을 지우면 아래 번호가 당겨지고, 되돌리기 한 번에 함께 돌아온다', async ({ page }) => {
  const errors = collectErrors(page);
  await blankPage(page);
  const doc = '1. 사과\n2. 배\n3. 감\n4. 귤';
  await setDoc(page, doc);
  const start = doc.indexOf('2. 배');
  await select(page, start, start + '2. 배\n'.length);
  await page.keyboard.press('Backspace');
  await expect.poll(() => source(page)).toBe('1. 사과\n2. 감\n3. 귤');

  await page.keyboard.press(undoKey);
  await expect.poll(() => source(page)).toBe(doc);
  expect(errors).toEqual([]);
});

test('이미지: 누르면 선택 표시, 지우기 버튼·Backspace로 통째로 한 번에 지운다', async ({ page }) => {
  const errors = collectErrors(page);
  await blankPage(page);
  const doc = `위 문단\n\n![그림](${PNG})\n\n아래 문단`;
  await setDoc(page, doc, 0);
  const image = page.locator(`${MAIN} [data-page-image]`);
  await expect(image).toBeVisible();

  await image.locator('img').click();
  await expect(image).toHaveAttribute('data-selected', '');
  // 이미지가 선택된 동안 선택 메뉴는 뜨지 않는다
  await expect(page.locator('[data-selection-menu]')).toHaveCount(0);
  await image.getByRole('button', { name: '이미지 지우기' }).click();
  await expect.poll(() => source(page)).toBe('위 문단\n\n\n아래 문단');
  await expect(page.locator(`${MAIN} [data-page-image]`)).toHaveCount(0);

  // 되돌리기 한 번에 이미지가 통째로 돌아온다
  await page.keyboard.press(undoKey);
  await expect.poll(() => source(page)).toBe(doc);

  // 키보드 Backspace도 통째로
  await page.locator(`${MAIN} [data-page-image] img`).click();
  await expect(page.locator(`${MAIN} [data-page-image]`)).toHaveAttribute('data-selected', '');
  await page.keyboard.press('Backspace');
  await expect.poll(() => source(page)).toBe('위 문단\n\n\n아래 문단');
  expect(errors).toEqual([]);
});

test('블록 핸들: 끌어서 위아래로 옮기고, 옆 가장자리에 놓으면 좌우로 나란히 배치·메뉴로 풀기', async ({ page }) => {
  const errors = collectErrors(page);
  await blankPage(page);
  await setDoc(page, '# 제목\n\n첫째 문단\n\n둘째 문단', 0);
  const handles = page.locator(`${MAIN} [data-page-handle]`);
  await expect(handles).toHaveCount(3);

  const drag = async (index: number, x: number, y: number) => {
    const h = (await handles.nth(index).boundingBox())!;
    await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
    await page.mouse.down();
    await page.mouse.move(x, y, { steps: 10 });
    await expect(page.locator('[data-page-drop]')).toHaveCount(1);
    await page.mouse.up();
    await expect(page.locator('[data-page-drop]')).toHaveCount(0);
  };

  // 셋째 블록을 맨 위(제목 윗부분)로
  const content = (await page.locator(CONTENT).boundingBox())!;
  const h0 = (await handles.nth(0).boundingBox())!;
  await drag(2, content.x + content.width / 2, h0.y + 2);
  await expect.poll(() => source(page)).toBe('둘째 문단\n\n# 제목\n\n첫째 문단');

  // 셋째 블록(첫째 문단)을 첫 블록(둘째 문단)의 오른쪽 가장자리에 놓으면 나란히
  const h0b = (await handles.nth(0).boundingBox())!;
  await drag(2, content.x + content.width - 6, h0b.y + h0b.height / 2);
  await expect
    .poll(() => source(page))
    .toBe('<!-- columns -->\n둘째 문단\n<!-- column -->\n첫째 문단\n<!-- /columns -->\n\n# 제목');
  const columns = page.locator(`${MAIN} [data-page-columns]`);
  await expect(columns).toBeVisible();
  await expect(columns.locator('[data-page-column]')).toHaveCount(2);
  await expect(handles.first()).toHaveAttribute('data-block-kind', 'columns');

  // 핸들을 누르기만 하면 블록 메뉴 → 나란히 배치 풀기
  await handles.first().click();
  const menu = page.getByRole('menu', { name: '블록·AI 메뉴' });
  await expect(menu).toBeVisible();
  await menu.getByRole('menuitem', { name: '나란히 배치 풀기' }).click();
  await expect.poll(() => source(page)).toBe('둘째 문단\n\n첫째 문단\n\n# 제목');

  // 메뉴로 아래로 옮기기 · 지우기
  await handles.first().click();
  await menu.getByRole('menuitem', { name: '아래로 옮기기' }).click();
  await expect.poll(() => source(page)).toBe('첫째 문단\n\n둘째 문단\n\n# 제목');
  await handles.nth(2).click();
  await menu.getByRole('menuitem', { name: '블록 지우기' }).click();
  await expect.poll(() => source(page)).toBe('첫째 문단\n\n둘째 문단\n\n');
  expect(errors).toEqual([]);
});
