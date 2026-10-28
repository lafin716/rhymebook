import { expect, test, type Page } from '@playwright/test';

/** 캔버스·페이지 전체 화면: 헤더 우측 버튼으로 상단 바(마인드맵 행)·사이드바를 숨기고 되돌린다 */
const MAIN = '[data-panel="main"]';

async function onboard(page: Page) {
  await page.goto('/?platform=desktop');
  const onboarding = page.getByRole('dialog', { name: '시작하기' });
  await onboarding.getByRole('button', { name: /^API 키/ }).click();
  const input = page.getByLabel('Anthropic API 키');
  await input.fill('sk-ant-e2e-ok');
  await input.press('Enter');
  await page.keyboard.press('Escape');
}

test('캔버스·페이지 전체 화면 켜고 끄기', async ({ page }, info) => {
  const mobile = info.project.name === 'mobile';
  await onboard(page);
  const main = page.locator(MAIN);
  const mindmap = page.getByRole('button', { name: '마인드맵' });

  await page.getByRole('button', { name: '빈 페이지' }).click();
  await expect(mindmap).toBeVisible();
  await main.getByRole('button', { name: '전체 화면', exact: true }).click();
  await expect(mindmap).toHaveCount(0);
  await expect(main.getByLabel('페이지 본문 (마크다운)')).toBeVisible();
  await main.getByRole('button', { name: '전체 화면 끝내기' }).click();
  await expect(mindmap).toBeVisible();

  if (mobile) await page.getByRole('button', { name: '세션 목록', exact: true }).click();
  await page.getByRole('button', { name: '새로 만들기' }).click();
  await main.getByRole('button', { name: '캔버스로 시작' }).click();
  await expect(page.locator('[data-canvas]')).toBeVisible();
  await main.getByRole('button', { name: '전체 화면', exact: true }).click();
  await expect(mindmap).toHaveCount(0);
  await expect(page.getByLabel('캔버스 그림판')).toBeVisible();
  await main.getByRole('button', { name: '전체 화면 끝내기' }).click();
  await expect(mindmap).toBeVisible();
});
