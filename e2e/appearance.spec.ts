import { expect, test } from '@playwright/test';

test('octobooks: five palettes persist independently of appearance and learning data', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/?platform=desktop#scenario=home');
  await expect(page).toHaveTitle(/octobooks/);
  await page.getByRole('button', { name: '설정', exact: true }).click();
  const settings = page.getByRole('dialog', { name: '설정', exact: true });
  await settings.getByRole('tab', { name: '테마', exact: true }).click();
  const initialSessionCount = await page.locator('[data-session-row]').count();
  const backgrounds = new Set<string>();
  for (const [id, name] of [['ocean', '오션'], ['lagoon', '라군'], ['coral', '코랄'], ['abyss', '어비스'], ['pearl', '펄']]) {
    const option = settings.getByRole('button', { name: `${name} 테마`, exact: true });
    await option.click();
    await expect(option).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('html')).toHaveAttribute('data-palette', id!);
    const lightBackground = await page.locator('body').evaluate((el) => getComputedStyle(el).backgroundColor);
    backgrounds.add(lightBackground);
    await settings.getByRole('button', { name: '다크', exact: true }).click();
    await expect(page.locator('html')).toHaveClass(/dark/);
    expect(await page.locator('body').evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe(lightBackground);
    await expect(page.locator('html')).toHaveAttribute('data-palette', id!);
    await settings.getByRole('button', { name: '라이트', exact: true }).click();
  }
  expect(backgrounds.size).toBe(5);
  await settings.getByRole('button', { name: '다크', exact: true }).click();
  await expect(page.locator('html')).toHaveClass(/dark/);
  await expect(page.locator('html')).toHaveAttribute('data-palette', 'pearl');
  await settings.getByRole('button', { name: '설정 닫기' }).click();
  expect(await page.locator('[data-session-row]').count()).toBe(initialSessionCount);
  // No scenario reload here: verify the real persisted presentation after a clean navigation.
  await page.goto('/?platform=desktop');
  await expect(page.locator('html')).toHaveClass(/dark/);
  await expect(page.locator('html')).toHaveAttribute('data-palette', 'pearl');
  expect(await page.evaluate(() => localStorage.getItem('octobooks.palette'))).toBe('pearl');
  const color = await page.locator('html').evaluate((el) => getComputedStyle(el).getPropertyValue('--bg').trim());
  await expect(page.locator('meta[name="theme-color"]').first()).toHaveAttribute('content', color);
  expect(errors).toEqual([]);
});

test('remote: color selection is available without pairing, survives reload, and syncs between windows', async ({ page, context }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '나중에 하기' }).click();
  await page.getByRole('button', { name: '설정', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '설정', exact: true });
  await dialog.getByRole('button', { name: '코랄 테마' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-palette', 'coral');
  const other = await context.newPage();
  await other.goto('/');
  await expect(other.locator('html')).toHaveAttribute('data-palette', 'coral');
  await dialog.getByRole('button', { name: '라군 테마' }).click();
  await expect(other.locator('html')).toHaveAttribute('data-palette', 'lagoon');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-palette', 'lagoon');
  await other.close();
});

test('invalid stored palette falls back safely and system mode follows OS changes', async ({ page }) => {
  await page.addInitScript(() => { localStorage.setItem('octobooks.palette', 'unknown'); localStorage.setItem('branch.theme', 'system'); });
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-palette', 'ocean');
  await expect(page.locator('html')).not.toHaveClass(/dark/);
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveClass(/dark/);
});

test('blocked storage still boots in system dark mode and keeps a live palette choice', async ({ page }) => {
  await page.addInitScript(() => { Object.defineProperty(window, 'localStorage', { get() { throw new Error('Storage blocked'); } }); });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/');
  await page.getByRole('button', { name: '나중에 하기' }).click();
  await expect(page.locator('html')).toHaveClass(/dark/);
  await page.getByRole('button', { name: '설정', exact: true }).click();
  await page.getByRole('dialog', { name: '설정', exact: true }).getByRole('button', { name: '어비스 테마' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-palette', 'abyss');
});
