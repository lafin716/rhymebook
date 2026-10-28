import { expect, test, type Page } from '@playwright/test';

/**
 * 캔버스 발표 (ADR-089): 발표 버튼 → 화면 전체 발표 모드(도구 막대·포인터·펜·지우개·쪽 넘김)
 * → '발표 화면 열기'로 연 청중 창은 도구 막대 없이 같은 쪽·필기를 받는다 → Esc로 끝내면 청중 창도 끝남 안내.
 */
const MAIN = '[data-panel="main"]';

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

async function pagedCanvas(page: Page, mobile: boolean) {
  if (mobile) await page.getByRole('button', { name: '세션 목록', exact: true }).click();
  await page.getByRole('button', { name: '새로 만들기' }).click();
  await page.locator(MAIN).getByRole('button', { name: '캔버스로 시작' }).click();
  await page.getByRole('button', { name: '캔버스 설정' }).click();
  await page.getByRole('dialog', { name: '캔버스 설정' }).getByRole('radio', { name: /가로형 16:9/ }).click();
  const nav = page.getByRole('navigation', { name: '쪽 넘김' });
  await nav.getByRole('button', { name: '새 쪽' }).click();
  await expect(nav).toContainText('2 / 2');
  await nav.getByRole('button', { name: '이전 쪽' }).click();
  await expect(nav).toContainText('1 / 2');
}

test('발표 모드: 도구 막대 · 펜 임시 필기 · 지우개 · 쪽 넘김 · Esc로 끝내면 필기 사라짐', async ({ page }, info) => {
  const errors = collectErrors(page);
  await onboard(page);
  await pagedCanvas(page, info.project.name === 'mobile');
  const savedStrokes = await page.getByLabel('캔버스 그림판').locator('svg path').count();

  await page.getByRole('button', { name: '발표', exact: true }).click();
  const show = page.locator('[data-canvas-presentation]');
  await expect(show).toBeVisible();
  const tools = show.getByRole('toolbar', { name: '발표 도구' });
  await expect(tools).toBeVisible();
  await expect(tools.getByRole('button', { name: '레이저 포인터' })).toHaveAttribute('aria-pressed', 'true');
  await expect(tools.locator('[data-present-page]')).toHaveText('1 / 2');

  // 발표 화면이 앱 전체를 덮는다
  const box = (await show.boundingBox())!;
  const vp = page.viewportSize()!;
  expect(box.width).toBe(vp.width);
  expect(box.height).toBe(vp.height);

  // 포인터: 누르고 움직이는 동안 레이저 점이 보인다
  const board = show.getByLabel('캔버스 그림판');
  const r = (await board.boundingBox())!;
  await page.mouse.move(r.x + r.width / 2, r.y + r.height / 3);
  await page.mouse.down();
  await page.mouse.move(r.x + r.width / 2 + 20, r.y + r.height / 3 + 10, { steps: 3 });
  await expect(show.locator('[data-canvas-laser]')).toHaveCount(1);
  await page.mouse.up();

  // 펜: 획이 하나 늘고, 지우개로 지운다
  await tools.getByRole('button', { name: '펜', exact: true }).click();
  const paths = board.locator('svg path');
  const before = await paths.count();
  await page.mouse.move(r.x + r.width * 0.4, r.y + r.height * 0.4);
  await page.mouse.down();
  await page.mouse.move(r.x + r.width * 0.5, r.y + r.height * 0.45, { steps: 6 });
  await page.mouse.move(r.x + r.width * 0.6, r.y + r.height * 0.5, { steps: 6 });
  await page.mouse.up();
  await expect(paths).toHaveCount(before + 1);
  await tools.getByRole('button', { name: '지우개' }).click();
  await page.mouse.move(r.x + r.width * 0.5, r.y + r.height * 0.3);
  await page.mouse.down();
  await page.mouse.move(r.x + r.width * 0.5, r.y + r.height * 0.6, { steps: 12 });
  await page.mouse.up();
  await expect(paths).toHaveCount(before);

  // 쪽 넘김: 키보드와 버튼
  await page.keyboard.press('ArrowRight');
  await expect(tools.locator('[data-present-page]')).toHaveText('2 / 2');
  await tools.getByRole('button', { name: '이전 쪽' }).click();
  await expect(tools.locator('[data-present-page]')).toHaveText('1 / 2');

  // 다시 쓰고 Esc로 끝내면 발표 필기는 문서에 남지 않는다
  await tools.getByRole('button', { name: '펜', exact: true }).click();
  await page.mouse.move(r.x + r.width * 0.4, r.y + r.height * 0.4);
  await page.mouse.down();
  await page.mouse.move(r.x + r.width * 0.6, r.y + r.height * 0.5, { steps: 8 });
  await page.mouse.up();
  await page.keyboard.press('Escape');
  await expect(show).toHaveCount(0);
  await expect(page.getByLabel('캔버스 그림판').locator('svg path')).toHaveCount(savedStrokes);
  expect(errors).toEqual([]);
});

test('발표 화면(청중 창): 도구 막대 없이 같은 쪽·필기를 받고, 발표를 끝내면 끝남 안내', async ({ page, context }, info) => {
  test.skip(info.project.name === 'mobile', '청중 창은 데스크탑·웹 전용');
  const errors = collectErrors(page);
  await onboard(page);
  await pagedCanvas(page, false);
  await page.getByRole('button', { name: '발표', exact: true }).click();
  const show = page.locator('[data-canvas-presentation]');
  const tools = show.getByRole('toolbar', { name: '발표 도구' });

  const [audience] = await Promise.all([context.waitForEvent('page'), tools.getByRole('button', { name: '발표 화면 열기' }).click()]);
  const audienceErrors = collectErrors(audience);
  const stage = audience.locator('[data-present-audience]');
  await expect(stage).toBeVisible();
  const audienceBoard = stage.getByLabel('캔버스 그림판');
  await expect(audienceBoard).toBeVisible();
  await expect(audience.getByRole('toolbar')).toHaveCount(0);
  await expect(audienceBoard.locator('[data-canvas-page]')).toHaveCount(2);

  // 발표자가 쓴 획이 청중 창에도 나타난다
  const inkBefore = await audienceBoard.locator('svg path').count();
  await tools.getByRole('button', { name: '펜', exact: true }).click();
  const r = (await show.getByLabel('캔버스 그림판').boundingBox())!;
  await page.bringToFront();
  await page.mouse.move(r.x + r.width * 0.4, r.y + r.height * 0.4);
  await page.mouse.down();
  await page.mouse.move(r.x + r.width * 0.6, r.y + r.height * 0.5, { steps: 8 });
  await page.mouse.up();
  await expect(audienceBoard.locator('svg path')).toHaveCount(inkBefore + 1);

  // 쪽을 넘기면 청중 화면도 그 쪽에 맞춘다 (2쪽이 화면 가운데로)
  await tools.getByRole('button', { name: '다음 쪽' }).click();
  await expect(tools.locator('[data-present-page]')).toHaveText('2 / 2');
  await expect
    .poll(async () => {
      const second = (await audienceBoard.locator('[data-canvas-page]').nth(1).boundingBox())!;
      const vp = audience.viewportSize()!;
      return Math.abs(second.x + second.width / 2 - vp.width / 2) < 20;
    })
    .toBe(true);

  // 발표를 끝내면 청중 창은 끝남 안내
  await page.keyboard.press('Escape');
  await expect(show).toHaveCount(0);
  await expect(audience.getByText('발표가 끝났어요')).toBeVisible();
  expect(errors).toEqual([]);
  expect(audienceErrors).toEqual([]);
});
