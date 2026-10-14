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
