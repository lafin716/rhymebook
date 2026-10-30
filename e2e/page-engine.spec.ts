import { expect, test, type Page } from '@playwright/test';

/**
 * 페이지 편집 엔진 (ADR-087): 콜론 이모지 미리보기, 번호 목록 당겨 매기기, 이미지 선택·통째 지우기,
 * 블록 핸들로 옮기기·좌우 나란히 배치, 핸들 메뉴.
 * 칸 묶음 표시 줄은 글자로 보이지 않기 (ADR-091). 모바일은 탭으로 행 고르기 → 핸들·행 시트, 다시 탭하면 편집 (ADR-095).
 */
const MAIN = '[data-panel="main"]';
const CONTENT = `${MAIN} [data-page-editor] .cm-content >> nth=0`;
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

test('블록 핸들: 끌어서 위아래로 옮기고, 옆 가장자리에 놓으면 좌우로 나란히 배치·메뉴로 풀기', async ({ page }, info) => {
  test.skip(info.project.name === 'mobile', '모바일은 행을 골라야 핸들이 뜬다 — 아래 모바일 전용 테스트');
  const errors = collectErrors(page);
  await blankPage(page);
  await setDoc(page, '# 제목\n\n첫째 문단\n\n둘째 문단', 0);
  const handles = page.locator(`${MAIN} [data-page-handle]`);
  await expect(handles).toHaveCount(3);

  // 핸들은 줄 상자가 아니라 글자의 세로 가운데에 온다 (제목처럼 위 여백이 큰 줄도)
  const textMid = (text: string) =>
    page.locator(CONTENT).evaluate((el, t) => {
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const i = n.textContent!.indexOf(t);
        if (i < 0) continue;
        const r = document.createRange();
        r.setStart(n, i);
        r.setEnd(n, i + t.length);
        const b = r.getBoundingClientRect();
        return b.top + b.height / 2;
      }
      return NaN;
    }, text);
  for (const [i, text] of [
    [0, '제목'],
    [1, '첫째 문단'],
  ] as const) {
    const h = (await handles.nth(i).boundingBox())!;
    expect(Math.abs(h.y + h.height / 2 - (await textMid(text)))).toBeLessThan(3);
  }

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
  // 칸은 전체 너비를 반반 나눈다 (좁은 화면도 위아래로 쌓지 않는다)
  const [c1, c2] = await columns.locator('[data-page-column]').evaluateAll((els) => els.map((e) => e.getBoundingClientRect()));
  const whole = (await columns.boundingBox())!;
  expect(Math.abs(c1!.width - c2!.width)).toBeLessThan(2);
  expect(Math.abs(c1!.top - c2!.top)).toBeLessThan(2);
  expect(c2!.right - c1!.left).toBeGreaterThan(whole.width - 2);
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

test('칸 하나는 상자 하나 — 칸 안 편집은 그 칸에서만, 표·코드도 칸 안에서 그려진다 (ADR-096)', async ({ page }) => {
  const errors = collectErrors(page);
  await blankPage(page);
  const doc =
    '<!-- columns -->\n왼쪽\n\n| 가 | 나 |\n| --- | --- |\n| 1 | 2 |\n<!-- column -->\n오른쪽\n\n```js\nconst a = 1;\n```\n<!-- /columns -->\n\n아래';
  await setDoc(page, doc, doc.length);
  const columns = page.locator(`${MAIN} [data-page-columns]`);
  const cols = columns.locator('[data-page-column]');
  await expect(cols).toHaveCount(2);
  // 표시 줄·표/코드 기호가 글자로 보이지 않는다
  await expect(columns).not.toContainText('<!--');
  await expect(columns).not.toContainText('| ---');
  await expect(cols.nth(0).locator('table')).toHaveCount(1);
  // 코드 블록은 본문과 같은 코드 상자로 (울타리는 흐리게)
  await expect(cols.nth(1).locator('.cm-line.cm-lp-code')).toHaveCount(3);
  await expect(cols.nth(1)).toContainText('const a = 1;');
  // 칸마다 + · 핸들
  await expect(columns.locator('[data-column-add]')).toHaveCount(2);
  await expect(columns.locator('[data-column-handle]')).toHaveCount(2);

  // 왼쪽 칸을 눌러 고치면 그 칸에만 들어간다
  await cols.nth(0).getByText('왼쪽', { exact: true }).click();
  await page.keyboard.press('End');
  await page.keyboard.type('!');
  await expect.poll(() => source(page)).toBe(doc.replace('왼쪽', '왼쪽!'));
  // 칸 맨 앞 Backspace·Delete 연타로 칸 나눔이 깨지지 않는다
  await page.keyboard.press('Home');
  for (let i = 0; i < 3; i++) await page.keyboard.press('Backspace');
  await expect.poll(() => source(page)).toBe(doc.replace('왼쪽', '왼쪽!'));

  // 오른쪽 칸 + → 그 칸 끝에 새 줄 (칸 버튼은 칸을 고른 뒤에 보인다, ADR-098)
  await cols.nth(1).getByText('오른쪽', { exact: true }).click();
  await columns.locator('[data-column-add]').nth(1).click();
  await page.keyboard.type('추가');
  await expect.poll(() => source(page)).toContain('```\n추가\n<!-- /columns -->');
  // 되돌리기는 본문 기록을 따른다
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(() => source(page)).not.toContain('추가');

  // 칸 핸들 메뉴 → 왼쪽으로 옮기기
  await cols.nth(1).getByText('오른쪽', { exact: true }).click();
  await columns.locator('[data-column-handle]').nth(1).click();
  const menu = page.getByRole('menu', { name: '블록·AI 메뉴' });
  await menu.getByRole('menuitem', { name: '왼쪽으로 옮기기' }).click();
  await expect.poll(() => source(page)).toMatch(/^<!-- columns -->\n오른쪽/);
  expect(errors).toEqual([]);
});

test('Tab: 글에서는 공백, 목록에서는 들여쓰기 · Shift+Tab은 내어쓰기', async ({ page }) => {
  const errors = collectErrors(page);
  await blankPage(page);
  await setDoc(page, '글');
  await page.keyboard.press('Tab');
  await expect.poll(() => source(page)).toMatch(/^글 +$/);
  await setDoc(page, '- 하나\n- 둘');
  await page.keyboard.press('Tab');
  await expect.poll(() => source(page)).toBe('- 하나\n  - 둘');
  await page.keyboard.press('Shift+Tab');
  await expect.poll(() => source(page)).toBe('- 하나\n- 둘');
  // 포커스는 편집기에 남는다
  await expect(page.locator(CONTENT)).toBeFocused();
  expect(errors).toEqual([]);
});

test('모바일: 한 번 탭하면 행을 고르고(핸들·시트), 핸들로 옮기고, 한 번 더 탭하면 편집 (ADR-095)', async ({ page }, info) => {
  test.skip(info.project.name !== 'mobile', '모바일 전용');
  const errors = collectErrors(page);
  await blankPage(page);
  await setDoc(page, '첫째 문단\n\n둘째 문단\n\n셋째 문단', 0);
  await page.locator(CONTENT).evaluate((el) => (el as HTMLElement).blur());
  await expect(page.locator(`${MAIN} [data-page-handle][data-active]`)).toHaveCount(0);

  // 첫 탭: 행을 고른다 — 키보드(포커스) 없이 표시·핸들·행 시트
  await page.locator(CONTENT).getByText('셋째 문단', { exact: true }).tap();
  await expect(page.locator(`${MAIN} [data-page-row-selected]`)).toHaveText('셋째 문단');
  await expect(page.locator(CONTENT)).not.toBeFocused();
  const sheet = page.locator('[data-page-sheet]');
  await expect(sheet).toBeVisible();
  const handle = page.locator(`${MAIN} [data-page-handle][data-active]`);
  await expect(handle).toHaveCount(1);
  await expect(page.locator(`${MAIN} [data-page-row-add][data-active]`)).toHaveCount(1);

  // 핸들을 끌어 첫째 문단 윗부분으로
  const cdp = await page.context().newCDPSession(page);
  const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', x: number, y: number) =>
    cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
  const h = (await handle.boundingBox())!;
  const top = (await page.locator(CONTENT).getByText('첫째 문단', { exact: true }).boundingBox())!;
  const from = { x: h.x + h.width / 2, y: h.y + h.height / 2 };
  await touch('touchStart', from.x, from.y);
  // 가로는 본문 가운데로 (가장자리에 놓으면 나란히 배치)
  const mid = (await page.locator(CONTENT).boundingBox())!;
  const to = { x: mid.x + mid.width / 2, y: top.y + 2 };
  for (let i = 1; i <= 8; i++) await touch('touchMove', from.x + ((to.x - from.x) * i) / 8, from.y + ((to.y - from.y) * i) / 8);
  await expect(page.locator('[data-page-drop]')).toHaveCount(1);
  await touch('touchEnd', 0, 0);
  await expect.poll(() => source(page)).toBe('셋째 문단\n\n첫째 문단\n\n둘째 문단');
  // 옮긴 행이 계속 골라져 있다
  await expect(page.locator(`${MAIN} [data-page-row-selected]`)).toHaveText('셋째 문단');

  // 시트: 블록 바꾸기 칩 · 아래로
  await sheet.locator('[data-row-kind="h2"]').click();
  await expect.poll(() => source(page)).toBe('## 셋째 문단\n\n첫째 문단\n\n둘째 문단');
  await expect(sheet.locator('[data-row-kind="h2"]')).toHaveAttribute('aria-pressed', 'true');
  await sheet.locator('[data-row-action="down"]').click();
  await expect.poll(() => source(page)).toBe('첫째 문단\n\n## 셋째 문단\n\n둘째 문단');
  await expect(page.locator(CONTENT)).not.toBeFocused();

  // 같은 행을 한 번 더 탭하면 편집 — 시트가 닫히고 커서가 들어간다
  await page.locator(`${MAIN} [data-page-row-selected]`).tap();
  await expect(sheet).toHaveCount(0);
  await expect(page.locator(CONTENT)).toBeFocused();
  await page.keyboard.type('!');
  await expect.poll(() => source(page)).toMatch(/## 셋째[^\n]*!/);

  // 바깥(다른 행)을 고르면 그 행으로 옮겨 간다 — 다른 행 첫 탭은 편집 중이 아니면 고르기
  await page.locator(CONTENT).evaluate((el) => (el as HTMLElement).blur());
  await page.locator(CONTENT).getByText('첫째 문단', { exact: true }).tap();
  await expect(page.locator(`${MAIN} [data-page-row-selected]`)).toHaveText('첫째 문단');
  await sheet.locator('[data-row-action="delete"]').click();
  await expect.poll(() => source(page)).not.toContain('첫째 문단');
  await expect(sheet).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('칸 +·핸들은 칸 왼쪽 띠에, 마우스를 올리거나 칸을 고를 때만 보이고 동작한다 (ADR-098)', async ({ page }, info) => {
  const errors = collectErrors(page);
  await blankPage(page);
  const doc = '첫 줄\n\n<!-- columns -->\n왼쪽 하나\n\n왼쪽 둘\n<!-- column -->\n오른쪽 하나\n\n- 목록\n<!-- /columns -->\n\n아래';
  await setDoc(page, doc, doc.length);
  const columns = page.locator(`${MAIN} [data-page-columns]`);
  const cols = columns.locator('[data-page-column]');
  const mobile = info.project.name === 'mobile';
  await page.mouse.move(0, 0);
  const vis = (i: number) => columns.locator('[data-column-add]').nth(i).evaluate((b) => { const s = getComputedStyle(b); return s.display !== 'none' && Number(s.opacity) > 0.5; });
  expect(await vis(0)).toBe(false);
  expect(await vis(1)).toBe(false);
  if (!mobile) {
    await cols.nth(1).hover();
    await expect.poll(() => vis(1)).toBe(true);
    expect(await vis(0)).toBe(false);
  }
  const text = cols.nth(1).getByText('오른쪽 하나');
  if (mobile) await text.tap(); else await text.click();
  if (mobile && !(await vis(1))) { await text.tap(); }
  await page.mouse.move(0, 0);
  await expect.poll(() => vis(1)).toBe(true);
  // 버튼은 칸 상자 안 왼쪽, 첫 줄 높이
  const btn = (await columns.locator('[data-column-add]').nth(1).boundingBox())!;
  const box = (await cols.nth(1).boundingBox())!;
  const line = (await text.boundingBox())!;
  expect(btn.x).toBeGreaterThanOrEqual(box.x);
  expect(btn.x + btn.width).toBeLessThanOrEqual(line.x);
  expect(Math.abs(btn.y + btn.height / 2 - (line.y + line.height / 2))).toBeLessThan(8);
  // + 는 그 칸 끝에 새 줄
  const add = columns.locator('[data-column-add]').nth(1);
  if (mobile) await add.tap(); else await add.click();
  await page.keyboard.type('추가');
  await expect.poll(() => source(page)).toContain('- 목록\n추가\n<!-- /columns -->');
  // 핸들은 칸 메뉴
  const grip = columns.locator('[data-column-handle]').nth(1);
  if (mobile) await grip.tap(); else await grip.click();
  await expect(page.getByRole('menu', { name: '블록·AI 메뉴' })).toBeVisible();
  expect(errors).toEqual([]);
});
