import { expect, test, type Page } from '@playwright/test';

/**
 * 캔버스 도구 막대 (ADR-088): 발표·전체 보기·가져오기 순서, 전체 보기에서 제목 숨김,
 * 팔레트 접기/펼치기·한 번에 보일 색 개수, 핸들로 동서남북 가장자리에 붙이기, 맞춤 상태에서 한 축만 밀기.
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

async function newCanvas(page: Page, mobile: boolean) {
  if (mobile) await page.getByRole('button', { name: '세션 목록', exact: true }).click();
  await page.getByRole('button', { name: '새로 만들기' }).click();
  await page.locator(MAIN).getByRole('button', { name: '캔버스로 시작' }).click();
  await expect(page.getByLabel('캔버스 그림판')).toBeVisible();
}

test('발표 · 전체 보기 · 가져오기 순서, 전체 보기에서 제목 숨김과 Esc로 끝내기', async ({ page }, info) => {
  const errors = collectErrors(page);
  await onboard(page);
  await newCanvas(page, info.project.name === 'mobile');
  const toolbar = page.getByRole('toolbar', { name: '캔버스 도구' });

  // 버튼 순서: 발표 → 전체 화면 → 가져오기
  const order = await toolbar.locator('[data-canvas-present], [data-panel-full], [data-canvas-import]').evaluateAll((els) =>
    els.map((e) => (e.hasAttribute('data-canvas-present') ? 'present' : e.hasAttribute('data-panel-full') ? 'full' : 'import')),
  );
  expect(order).toEqual(['present', 'full', 'import']);

  const header = page.locator(`${MAIN} header`).first();
  await expect(header).toBeVisible();
  await toolbar.getByRole('button', { name: '전체 화면', exact: true }).click();
  await expect(page.getByRole('button', { name: '마인드맵' })).toHaveCount(0);
  await expect(page.locator(`${MAIN} header`)).toHaveCount(0);
  await expect(page.getByLabel('캔버스 그림판')).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: '마인드맵' })).toBeVisible();
  await expect(toolbar.getByRole('button', { name: '전체 화면', exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test('팔레트 접기/펼치기 · 한 번에 보일 색 개수 · 넘친 색은 더 많은 색에서 · 새로고침 후 유지', async ({ page }, info) => {
  const errors = collectErrors(page);
  await onboard(page);
  await newCanvas(page, info.project.name === 'mobile');
  const colors = page.getByRole('group', { name: '색' });

  // 기본은 7색 모두 보이고 '더 많은 색'은 없다
  await expect(colors.locator('[data-canvas-ink]')).toHaveCount(7);
  await expect(colors.getByRole('button', { name: '더 많은 색' })).toHaveCount(0);

  // 접으면 색이 숨고 다시 펼치면 돌아온다
  await colors.getByRole('button', { name: '색 팔레트 접기' }).click();
  await expect(colors.locator('[data-canvas-ink]')).toHaveCount(0);
  await colors.getByRole('button', { name: '색 팔레트 펼치기' }).click();
  await expect(colors.locator('[data-canvas-ink]')).toHaveCount(7);

  // 설정에서 3개로 줄이면 나머지는 '더 많은 색'에
  await page.getByRole('button', { name: '캔버스 설정' }).click();
  const settings = page.getByRole('dialog', { name: '캔버스 설정' });
  await settings.getByLabel('팔레트 색 개수').fill('3');
  await expect(settings.locator('[data-palette-count]')).toHaveText('3 / 7');
  await page.keyboard.press('Escape');
  await expect(colors.locator('[data-canvas-ink]')).toHaveCount(3);
  await colors.getByRole('button', { name: '더 많은 색' }).click();
  const more = page.getByRole('dialog', { name: '더 많은 색' });
  await expect(more.locator('[data-canvas-ink]')).toHaveCount(4);

  // 넘친 색을 고르면 팔레트에 함께 보인다
  await more.getByRole('button', { name: '보라 색' }).click();
  await expect(colors.getByRole('button', { name: '보라 색' })).toHaveAttribute('aria-pressed', 'true');
  await expect(colors.locator('[data-canvas-ink]')).toHaveCount(4);

  // 접힘·개수는 새로고침 뒤에도 남는다
  await colors.getByRole('button', { name: '색 팔레트 접기' }).click();
  await page.reload();
  const colorsAfter = page.getByRole('group', { name: '색' });
  await expect(colorsAfter.getByRole('button', { name: '색 팔레트 펼치기' })).toBeVisible();
  await colorsAfter.getByRole('button', { name: '색 팔레트 펼치기' }).click();
  await expect(colorsAfter.locator('[data-canvas-ink]')).toHaveCount(3);
  expect(errors).toEqual([]);
});

test('핸들로 도구 막대를 끌면 가장 가까운 가장자리(동서남북)에 붙고 새로고침 후 유지', async ({ page }, info) => {
  const errors = collectErrors(page);
  await onboard(page);
  await newCanvas(page, info.project.name === 'mobile');
  const toolbar = page.locator('[data-canvas-toolbar]');
  const handle = page.getByRole('button', { name: '도구 막대 위치 변경' });
  await expect(toolbar).toHaveAttribute('data-dock', 'top');

  const panel = (await page.locator('[data-canvas]').boundingBox())!;
  const dragTo = async (x: number, y: number) => {
    const h = (await handle.boundingBox())!;
    await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
    await page.mouse.down();
    await page.mouse.move(x, y, { steps: 10 });
    await expect(page.locator('[data-canvas-dock-preview]')).toHaveCount(1);
    await page.mouse.up();
    await expect(page.locator('[data-canvas-dock-preview]')).toHaveCount(0);
  };
  const midX = panel.x + panel.width / 2;
  const midY = panel.y + panel.height / 2;

  await dragTo(panel.x + 5, midY);
  await expect(toolbar).toHaveAttribute('data-dock', 'left');
  const left = (await toolbar.boundingBox())!;
  expect(left.x - panel.x).toBeLessThan(2);
  expect(left.height).toBeGreaterThan(left.width);

  await dragTo(midX, panel.y + panel.height - 5);
  await expect(toolbar).toHaveAttribute('data-dock', 'bottom');
  const bottom = (await toolbar.boundingBox())!;
  expect(panel.y + panel.height - (bottom.y + bottom.height)).toBeLessThan(2);

  await dragTo(panel.x + panel.width - 5, midY);
  await expect(toolbar).toHaveAttribute('data-dock', 'right');
  const right = (await toolbar.boundingBox())!;
  expect(panel.x + panel.width - (right.x + right.width)).toBeLessThan(2);

  await page.reload();
  await expect(page.locator('[data-canvas-toolbar]')).toHaveAttribute('data-dock', 'right');
  await dragTo(midX, panel.y + 5);
  await expect(page.locator('[data-canvas-toolbar]')).toHaveAttribute('data-dock', 'top');
  expect(errors).toEqual([]);
});

test('가로형 쪽이 화면에 맞춰져 있으면 위아래로 밀어도 판이 움직이지 않는다', async ({ page }, info) => {
  const errors = collectErrors(page);
  await onboard(page);
  await newCanvas(page, info.project.name === 'mobile');
  await page.getByRole('button', { name: '캔버스 설정' }).click();
  await page.getByRole('dialog', { name: '캔버스 설정' }).getByRole('radio', { name: /가로형 16:9/ }).click();
  const board = page.getByLabel('캔버스 그림판');
  const sheet = board.locator('[data-canvas-page]').first();
  await expect(sheet).toBeVisible();
  if (await page.getByRole('dialog', { name: '캔버스 설정' }).isVisible()) await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: '캔버스 설정' })).toHaveCount(0);
  await page.getByRole('button', { name: '선택/이동' }).click();
  // 맞춤 애니메이션이 끝날 때까지 기다린다
  let last = -1;
  await expect
    .poll(async () => {
      const y = (await sheet.boundingBox())!.y;
      const still = Math.abs(y - last) < 0.5;
      last = y;
      return still;
    })
    .toBe(true);

  const before = (await sheet.boundingBox())!;
  const r = (await board.boundingBox())!;
  await page.mouse.move(r.x + r.width / 2, r.y + r.height * 0.3);
  await page.mouse.down();
  await page.mouse.move(r.x + r.width / 2 + 30, r.y + r.height * 0.8, { steps: 8 });
  // 손을 떼기 전(되돌림 애니메이션 전): 위아래는 그대로, 좌우만 따라 움직인다
  const during = (await sheet.boundingBox())!;
  expect(Math.abs(during.y - before.y)).toBeLessThan(2);
  expect(during.x - before.x).toBeGreaterThan(20);
  await page.mouse.up();
  await expect(page.getByRole('navigation', { name: '쪽 넘김' })).toContainText('1 / 1');
  expect(errors).toEqual([]);
});
