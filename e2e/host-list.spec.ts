import { expect, test } from '@playwright/test';

/**
 * 모바일 앱 원격 모드: 저장한 여러 PC를 메인 화면에서 골라 전환한다 (ADR-063).
 * Capacitor 대신 window.branchMobile을 주입한다. PC는 닿지 않는 주소라 연결은 실패(끊김)한다.
 */
const pc = (id: string, name: string, port: number) => ({
  url: `ws://127.0.0.1:${port}`,
  bridgeKey: `key-${id}`,
  bridgeId: id,
  bridgeName: name,
  deviceId: 'dev-1',
  deviceSecret: 'secret',
  pairedAt: 1,
  trust: 'qr',
});

test.beforeEach(async ({ page }) => {
  const a = pc('pc-a', '집 맥북', 9);
  const b = pc('pc-b', '회사 PC', 10);
  await page.addInitScript(
    ({ a, b }) => {
      // 목록 기능 전처럼 활성 페어링만 있고, 목록에는 다른 PC만 있다 → 둘 다 보여야 한다
      const store = new Map<string, string>([
        ['pairing:remote-bridge', JSON.stringify(a)],
        ['pairing:remote-hosts', JSON.stringify([b])],
      ]);
      (window as unknown as { __secrets: Map<string, string> }).__secrets = store;
      (window as unknown as { branchMobile: unknown }).branchMobile = {
        platform: 'ios',
        secrets: {
          persistent: true,
          get: async (k: string) => store.get(k) ?? null,
          set: async (k: string, v: string) => void store.set(k, v),
          delete: async (k: string) => void store.delete(k),
        },
        onPairLink: () => () => {},
      };
    },
    { a, b },
  );
});

test('메인 화면에 저장한 PC 목록이 보이고, 눌러서 다른 PC로 전환·지우기', async ({ page }) => {
  await page.goto('/');
  const list = page.getByTestId('host-list');
  await expect(list.getByRole('listitem')).toHaveCount(2);
  await expect(list.getByRole('listitem').nth(0)).toContainText('집 맥북');
  await expect(list.getByRole('listitem').nth(1)).toContainText('회사 PC');
  await expect(list.locator('li[data-active]')).toContainText('집 맥북');
  await expect(page.getByRole('heading', { name: '집 맥북와 연결이 끊겼어요' })).toBeVisible();

  // 다른 PC로 전환 → 활성 페어링이 바뀌고 그 PC에 연결을 시도한다
  await list.getByRole('button', { name: '회사 PC 연결' }).click();
  await expect(list.locator('li[data-active]')).toContainText('회사 PC');
  await expect(page.getByRole('heading', { name: /회사 PC/ })).toBeVisible();
  const active = await page.evaluate(() => JSON.parse((window as unknown as { __secrets: Map<string, string> }).__secrets.get('pairing:remote-bridge')!).bridgeId);
  expect(active).toBe('pc-b');

  // 지금 쓰지 않는 PC를 지운다
  await list.getByRole('button', { name: '집 맥북 목록에서 지우기' }).click();
  await page.getByRole('button', { name: '지우기', exact: true }).click();
  await expect(list.getByRole('listitem')).toHaveCount(1);

  // 마지막(지금) PC를 지우면 페어링 필요 화면으로 돌아간다
  await list.getByRole('button', { name: '회사 PC 목록에서 지우기' }).click();
  await page.getByRole('button', { name: '지우기', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'PC와 연결해 주세요' })).toBeVisible();
  await expect(page.getByTestId('host-list')).toHaveCount(0);
});

test('[PC 추가]는 메인 화면에서 페어링 폼을 연다', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('host-list').getByRole('button', { name: 'PC 추가' }).click();
  await expect(page.getByTestId('host-list').getByLabel('페어링 링크')).toBeVisible();
});
