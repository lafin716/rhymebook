import { expect, test } from '@playwright/test';

/** 마지막으로 열어 둔 페이지(보관함)를 다시 켰을 때 되살리고, 닫으면 잊는다 */
test('마지막 페이지 기억', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '나중에 하기' }).click();
  await page.getByRole('banner').getByRole('button', { name: '보관함', exact: true }).click();
  const vault = page.getByRole('dialog', { name: '보관함' });
  await expect(vault).toBeVisible();

  await page.reload();
  await expect(vault).toBeVisible();
  // 웹은 페어링을 탭 메모리에만 두므로 새로고침하면 연결 안내가 다시 뜬다
  await page.getByRole('button', { name: '나중에 하기' }).click();

  await vault.getByRole('button', { name: '보관함 닫기' }).click();
  await expect(vault).toBeHidden();
  await page.reload();
  await expect(page.getByRole('banner')).toBeVisible();
  await expect(vault).toBeHidden();
});
