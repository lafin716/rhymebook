import { expect, test, type Page } from '@playwright/test';

function collectErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
}

test('분할 패널의 자리 이동 메뉴 → 다른 창 닫기: 그 세션만 남는다', async ({ page }, info) => {
  test.skip(info.project.name.includes('mobile'), '모바일은 분할이 탭이라 패널 메뉴가 없다');
  const errors = collectErrors(page);
  await page.goto('/#scenario=split');
  const panes = page.locator('[data-split-pane]');
  await expect(panes.nth(1)).toBeVisible();
  expect(await panes.count()).toBeGreaterThan(1);
  const keep = await panes.nth(1).getAttribute('data-split-pane');

  await panes.nth(1).getByRole('button', { name: '자리 이동' }).click();
  await page.getByRole('menuitem', { name: '다른 창 닫기' }).click();

  await expect(page.locator('[data-split-root]')).toHaveCount(0);
  await expect(panes).toHaveCount(1);
  await expect(panes.first()).toHaveAttribute('data-split-pane', keep!);
  expect(errors).toEqual([]);
});

test('분할 패널의 이동 버튼을 끌어 다른 패널 가운데에 놓으면 자리를 바꾼다', async ({ page }, info) => {
  test.skip(info.project.name.includes('mobile'), '모바일은 분할이 탭이라 패널 메뉴가 없다');
  const errors = collectErrors(page);
  await page.goto('/#scenario=split');
  const panes = page.locator('[data-split-pane]');
  await expect(panes.nth(1)).toBeVisible();
  const before = await panes.evaluateAll((els) => els.map((e) => e.getAttribute('data-split-pane')));

  await panes.nth(0).getByRole('button', { name: '자리 이동' }).dragTo(panes.nth(1), { targetPosition: { x: 200, y: 300 } });

  await expect.poll(() => panes.evaluateAll((els) => els.map((e) => e.getAttribute('data-split-pane')))).toEqual([before[1], before[0], ...before.slice(2)]);
  await expect(page.locator('[data-drop-zone]')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('사이드바 경계선을 끌어 너비를 바꾸고, 새로고침 뒤에도 유지 · 두 번 누르면 기본 너비', async ({ page }, info) => {
  test.skip(info.project.name.includes('mobile'), '모바일은 사이드바가 드로어다');
  const errors = collectErrors(page);
  await page.goto('/#scenario=split');
  const handle = page.getByRole('separator', { name: '사이드바 너비 조절' });
  const aside = page.locator('aside').filter({ has: handle });
  await expect(aside).toHaveJSProperty('offsetWidth', 272);

  const b = (await handle.boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + 200);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2 + 60, b.y + 200, { steps: 5 });
  await page.mouse.up();
  await expect(aside).toHaveJSProperty('offsetWidth', 332);

  await page.reload();
  await expect(aside).toHaveJSProperty('offsetWidth', 332);
  await handle.dblclick();
  await expect(aside).toHaveJSProperty('offsetWidth', 272);
  expect(errors).toEqual([]);
});

test('웹(원격): 스킬 관리에 PC 스킬 동기화 버튼이 있고, PC와 연결 전에는 비활성 · 폴더 열기는 없다', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/');
  await page.getByRole('dialog', { name: 'PC와 연결하기' }).getByRole('button', { name: '나중에 하기' }).click();
  const menu = page.getByRole('button', { name: '세션 목록', exact: true });
  if (await menu.isVisible()) await menu.click();
  await page.getByRole('button', { name: '스킬 관리' }).click();
  const skills = page.getByRole('dialog', { name: '스킬 관리' });
  await expect(skills.getByRole('button', { name: '동기화' })).toBeDisabled();
  await expect(skills.getByRole('button', { name: '스킬 폴더 열기' })).toHaveCount(0);
  await skills.locator('[data-skill-row="curriculum"]').click();
  await expect(skills.getByRole('button', { name: '폴더 열기' })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('데스크톱(로컬): 스킬 관리에 PC 동기화 버튼이 없다', async ({ page }) => {
  await page.goto('/?platform=desktop');
  await page.getByRole('dialog', { name: '시작하기' }).press('Escape');
  const menu = page.getByRole('button', { name: '세션 목록', exact: true });
  if (await menu.isVisible()) await menu.click();
  await page.getByRole('button', { name: '스킬 관리' }).click();
  const skills = page.getByRole('dialog', { name: '스킬 관리' });
  await expect(skills.getByRole('button', { name: '새 스킬' })).toBeVisible();
  await expect(skills.getByRole('button', { name: '동기화' })).toHaveCount(0);
});

test('웹(원격): 설정에 음성 입력은 PC 설정을 따른다고 보이고, PC와 연결 전에는 마이크 버튼이 없다', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/');
  await page.getByRole('dialog', { name: 'PC와 연결하기' }).getByRole('button', { name: '나중에 하기' }).click();
  await expect(page.getByRole('button', { name: '음성으로 입력' })).toHaveCount(0);
  await page.getByRole('button', { name: '설정', exact: true }).first().click();
  const dialog = page.getByRole('dialog', { name: '설정' });
  await expect(dialog.getByText('PC 설정을 따릅니다', { exact: false })).toBeVisible();
  await expect(dialog.getByRole('tab', { name: '음성' })).toHaveCount(0);
  expect(errors).toEqual([]);
});
