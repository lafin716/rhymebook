import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.routeWebSocket('**/*', (socket) => socket.close());
  await page.addInitScript(() => {
    localStorage.setItem('branch.profile', 'local');
    localStorage.setItem('octobooks.locale', 'ko');
  });
});

/** 응답 생성 중이면 채팅바 위에 … 표시, 누르면 맨 아래로. 끝나면 사라진다 */
test('응답 중 … 표시 → 클릭하면 맨 아래로 → 완료 후 사라짐', async ({ page }, info) => {
  await page.goto('/?platform=desktop');
  await expect(page.locator('main')).toBeVisible();
  await page.evaluate(async () => {
    const path = performance.getEntriesByType('resource').map((e) => e.name).find((n) => new URL(n).pathname === '/src/app/store.ts')!;
    const { actions, registry } = await import(path);
    const w = window as unknown as { release?: () => void };
    actions().updateSettings({ setupDone: true, defaultProviderId: 'anthropic-api' });
    actions().newRootSession('responding');
    actions().renameSession('responding', '응답 표시');
    actions().setConnection('anthropic-api', { enabled: true, status: 'ready' });
    registry.register({
      id: 'anthropic-api', label: 'Responding test', available: async () => ({ status: 'ready' }),
      async *stream(req: { purpose?: string }) {
        if (req.purpose && req.purpose !== 'chat') { yield { type: 'done' }; return; }
        yield { type: 'delta', text: Array.from({ length: 80 }, (_, i) => `${i + 1}번째 문단입니다.`).join('\n\n') };
        await new Promise<void>((r) => (w.release = r));
        yield { type: 'delta', text: '\n\n마지막 문단.' };
        yield { type: 'done' };
      },
    });
    actions().sendMessage('responding', '길게 설명해줘');
  });

  const main = page.locator('[data-panel="main"]');
  const scroller = main.locator('[data-scroll]');
  const indicator = main.getByRole('button', { name: '응답 중… 클릭하면 맨 아래로' });
  await expect(main.getByText('80번째 문단입니다.')).toBeAttached();
  await expect(indicator).toBeVisible();

  // 위로 올렸다가 표시를 누르면 바닥으로
  await scroller.evaluate((el) => { el.scrollTop = 0; el.dispatchEvent(new Event('scroll')); });
  await indicator.click();
  await expect.poll(() => scroller.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight)).toBeLessThan(4);
  await page.screenshot({ path: `test-results/responding-indicator-${info.project.name}.png` });

  await page.evaluate(() => (window as unknown as { release: () => void }).release());
  await expect(main.getByText('마지막 문단.')).toBeVisible();
  await expect(indicator).toHaveCount(0);
});
