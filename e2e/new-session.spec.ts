import { expect, test, type Page } from '@playwright/test';

/**
 * 새로 만들기 (ADR-074): 메뉴 없이 빈 대화 화면이 열리고, 첫 메시지를 보내야 사이드바 목록에 나타난다.
 * 보내지 않고 남긴 빈 대화는 다음 새로 만들기에서 다시 쓴다.
 */
const KEY = 'sk-ant-e2e-ok';
const MAIN = '[data-panel="main"]';

async function onboard(page: Page) {
  await page.goto('/?platform=desktop');
  await page.getByRole('dialog', { name: '시작하기' }).getByRole('button', { name: /^API 키/ }).click();
  const input = page.getByLabel('Anthropic API 키');
  await input.fill(KEY);
  await input.press('Enter');
  await page.keyboard.press('Escape');
}

async function openNew(page: Page, mobile: boolean) {
  if (mobile) await page.getByRole('button', { name: '세션 목록', exact: true }).click();
  await page.getByRole('button', { name: '새로 만들기' }).click();
}

test('새로 만들기 → 빈 화면, 첫 메시지를 보내면 목록에 추가', async ({ page }, info) => {
  const mobile = info.project.name === 'mobile';
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await onboard(page);
  const main = page.locator(MAIN);
  const list = page.getByRole('navigation', { name: '학습 세션' });

  await openNew(page, mobile);
  await expect(main.getByRole('heading', { name: '어떤 호기심부터 펼쳐볼까요?' })).toBeVisible();
  await expect(main.getByRole('button', { name: '빈 페이지로 시작' })).toBeVisible();

  // 아직 목록에 없다. 다시 눌러도 빈 대화가 쌓이지 않는다
  if (mobile) await page.getByRole('button', { name: '세션 목록', exact: true }).click();
  await expect(list).toContainText('세션이 없어요');
  await page.getByRole('button', { name: '새로 만들기' }).click();
  if (mobile) await page.getByRole('button', { name: '세션 목록', exact: true }).click();
  await expect(list).toContainText('세션이 없어요');
  await expect(page.getByText('0개의 시작점')).toBeVisible();
  if (mobile) await page.getByRole('button', { name: '목록 닫기' }).click({ position: { x: 370, y: 400 } });

  await main.getByLabel('메시지 입력').fill('바다는 왜 파랄까');
  await main.getByRole('button', { name: '보내기' }).click();
  await expect(main.getByText('마지막 문장 [바다는 왜 파랄까].')).toBeVisible();

  if (mobile) await page.getByRole('button', { name: '세션 목록', exact: true }).click();
  await expect(list.getByRole('button')).not.toHaveCount(0);
  await expect(page.getByText('1개의 시작점')).toBeVisible();
  expect(errors).toEqual([]);
});
