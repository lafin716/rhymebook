import { expect, test } from '@playwright/test';

// 설치 후 첫 실행 (ADR-105): 저장소가 비어 있으면 언어부터 고른다
test.use({ storageState: { cookies: [], origins: [] } });

test('first run asks for a language, English switches the UI, settings switches back', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/?platform=desktop');

  const prompt = page.getByRole('dialog', { name: '언어 선택' });
  await expect(prompt).toBeVisible();
  await expect(prompt.getByRole('radio', { name: '한국어' })).toHaveAttribute('aria-checked', 'true');
  await prompt.getByRole('radio', { name: 'English' }).click();
  await prompt.getByRole('button', { name: '시작하기' }).click();

  // 다시 불러온 뒤 영어 화면, 언어 창은 다시 뜨지 않는다
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.getByRole('dialog', { name: 'Choose a language' })).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('octobooks.locale'))).toBe('en');

  // 시작 안내가 떠 있으면 닫는다
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const settings = page.getByRole('dialog', { name: 'Settings', exact: true });
  await settings.getByRole('tab', { name: 'General', exact: true }).click();
  await settings.getByRole('combobox', { name: 'Language' }).selectOption('ko');

  await expect(page.locator('html')).toHaveAttribute('lang', 'ko');
  await expect(page.getByRole('button', { name: '설정', exact: true })).toBeVisible();
  await expect(page.getByRole('dialog', { name: '언어 선택' })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('existing users are not asked', async ({ page }) => {
  await page.addInitScript(() => {
    if (!localStorage.getItem('branch.profile')) localStorage.setItem('branch.profile', 'local');
  });
  await page.goto('/?platform=desktop');
  await expect(page.getByRole('button', { name: '설정', exact: true })).toBeVisible();
  await expect(page.getByRole('dialog', { name: '언어 선택' })).toHaveCount(0);
  await expect(page.locator('html')).toHaveAttribute('lang', 'ko');
});
