import { expect, test, type Locator, type Page } from '@playwright/test';

/**
 * 캔버스 (ADR-079): 새로 만들기 → 캔버스 → 펜으로 쓰기 → 페이지 내용 가져오기 → 그 위에 쓰기 → 실행 취소 → 새로고침 후 유지.
 */
const KEY = 'sk-ant-e2e-ok';
const LOCAL = '/?platform=desktop';
const MAIN = '[data-panel="main"]';

function collectErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
}

/** 마우스로 board 위 (fx, fy) 비율 위치에서 오른쪽 아래로 한 획 긋는다 */
async function stroke(page: Page, board: Locator, fx: number, fy: number) {
  const r = (await board.boundingBox())!;
  const x = r.x + r.width * fx;
  const y = r.y + r.height * fy;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 40, y + 10, { steps: 5 });
  await page.mouse.move(x + 80, y + 30, { steps: 5 });
  await page.mouse.up();
}

async function onboard(page: Page) {
  await page.goto(LOCAL);
  const onboarding = page.getByRole('dialog', { name: '시작하기' });
  await onboarding.getByRole('button', { name: /^API 키/ }).click();
  const input = page.getByLabel('Anthropic API 키');
  await input.fill(KEY);
  await input.press('Enter');
  await page.keyboard.press('Escape');
}

test('캔버스: 펜 필기 · 페이지 내용 가져오기 · 그 위에 쓰기 · 실행 취소 · 새로고침 후 유지', async ({ page }, info) => {
  const errors = collectErrors(page);
  const mobile = info.project.name === 'mobile';
  await onboard(page);
  const main = page.locator(MAIN);

  // 가져올 페이지를 먼저 만든다
  await page.getByRole('button', { name: '빈 페이지' }).click();
  await main.getByLabel('페이지 본문 (마크다운)').fill('# 어텐션 노트\n\n쿼리와 키를 비교한다.');
  await main.getByRole('button', { name: '완료' }).click();
  await expect(main.getByRole('heading', { name: '어텐션 노트' })).toBeVisible();

  // 새로 만들기 → 캔버스로 시작
  if (mobile) await page.getByRole('button', { name: '세션 목록', exact: true }).click();
  await page.getByRole('button', { name: '새로 만들기' }).click();
  await main.getByRole('button', { name: '캔버스로 시작' }).click();
  await expect(page.locator('[data-canvas]')).toBeVisible();
  await expect(main.getByLabel('메시지 입력')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '펜', exact: true })).toHaveAttribute('aria-pressed', 'true');

  const board = page.getByLabel('캔버스 그림판');
  const strokes = board.locator('svg path');
  await stroke(page, board, 0.6, 0.15);
  await expect(strokes).toHaveCount(1);

  // 페이지 내용을 글 카드로 가져오기
  await page.getByRole('button', { name: '가져오기' }).click();
  await page.locator('[data-canvas-import-source="page"]').click();
  const picker = page.getByRole('dialog', { name: '페이지 내용 가져오기' });
  await picker.locator('[data-canvas-import-picker] button').first().click();
  await expect(picker).toHaveCount(0);
  const card = board.locator('[data-canvas-item]');
  await expect(card).toHaveCount(1);
  await expect(card).toContainText('쿼리와 키를 비교한다');
  // 가져온 직후에는 선택 도구로 바뀌고 가져온 카드가 골라져 있다
  await expect(page.getByRole('button', { name: '선택/이동' })).toHaveAttribute('aria-pressed', 'true');
  await expect(card).toHaveAttribute('data-selected', 'true');

  // 펜을 고르면 카드 선택이 풀린다. 카드 위에 쓰기
  await page.getByRole('button', { name: '펜', exact: true }).click();
  await expect(card).not.toHaveAttribute('data-selected', 'true');
  const cr = (await card.boundingBox())!;
  const br = (await board.boundingBox())!;
  await stroke(page, board, (cr.x + cr.width * 0.2 - br.x) / br.width, (cr.y + cr.height * 0.5 - br.y) / br.height);
  await expect(strokes).toHaveCount(2);

  await page.getByRole('button', { name: '실행 취소' }).click();
  await expect(strokes).toHaveCount(1);
  await page.getByRole('button', { name: '다시 실행' }).click();
  await expect(strokes).toHaveCount(2);

  // 저장(0.5초 지연) 뒤 새로고침해도 남는다
  await page.waitForTimeout(1200);
  await page.reload();
  const after = page.getByLabel('캔버스 그림판');
  await expect(after.locator('svg path')).toHaveCount(2);
  await expect(after.locator('[data-canvas-item]')).toContainText('쿼리와 키를 비교한다');
  expect(errors).toEqual([]);
});

test('캔버스 설정: 가로형 쪽 나눔 · 새 쪽 · 옆으로/위아래로 밀어 쪽 넘기기 · 새로고침 후 유지', async ({ page }, info) => {
  const errors = collectErrors(page);
  const mobile = info.project.name === 'mobile';
  await onboard(page);
  const main = page.locator(MAIN);

  if (mobile) await page.getByRole('button', { name: '세션 목록', exact: true }).click();
  await page.getByRole('button', { name: '새로 만들기' }).click();
  await main.getByRole('button', { name: '캔버스로 시작' }).click();
  const board = page.getByLabel('캔버스 그림판');
  await expect(board).toBeVisible();
  await expect(board.locator('[data-canvas-page]')).toHaveCount(0);

  await page.getByRole('button', { name: '캔버스 설정' }).click();
  const settings = page.getByRole('dialog', { name: '캔버스 설정' });
  await expect(settings.getByRole('radio', { name: /자유/ })).toHaveAttribute('aria-checked', 'true');
  await settings.getByRole('radio', { name: /가로형 16:9/ }).click();
  await expect(settings).toHaveCount(0);

  const pages = board.locator('[data-canvas-page]');
  await expect(pages).toHaveCount(1);
  const pr = (await pages.first().boundingBox())!;
  expect(Math.abs(pr.width / pr.height - 16 / 9)).toBeLessThan(0.02);
  const nav = page.getByRole('navigation', { name: '쪽 넘김' });
  await expect(nav).toContainText('1 / 1');

  // 마지막 쪽에서 [새 쪽]
  await nav.getByRole('button', { name: '새 쪽' }).click();
  await expect(pages).toHaveCount(2);
  await expect(nav).toContainText('2 / 2');
  await nav.getByRole('button', { name: '이전 쪽' }).click();
  await expect(nav).toContainText('1 / 2');

  // 선택 도구로 빈 곳을 왼쪽으로 끌면 다음 쪽, 마지막 쪽에서 또 밀면 새 쪽
  await page.getByRole('button', { name: '선택/이동' }).click();
  const swipe = async () => {
    const r = (await board.boundingBox())!;
    const y = r.y + r.height * 0.5;
    await page.mouse.move(r.x + r.width * 0.8, y);
    await page.mouse.down();
    await page.mouse.move(r.x + r.width * 0.2, y, { steps: 8 });
    await page.mouse.up();
  };
  await swipe();
  await expect(nav).toContainText('2 / 2');
  await swipe();
  await expect(nav).toContainText('3 / 3');
  await expect(pages).toHaveCount(3);

  // 쪽 넘김 방향을 위아래로: 쪽이 아래로 이어지고, 위로 밀면 다음(새) 쪽, 아래로 밀면 이전 쪽
  await page.getByRole('button', { name: '캔버스 설정' }).click();
  await expect(settings.getByRole('radio', { name: /옆으로/ })).toHaveAttribute('aria-checked', 'true');
  await settings.getByRole('radio', { name: /위아래로/ }).click();
  await expect(settings.getByRole('radio', { name: /위아래로/ })).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('Escape');
  await expect(settings).toHaveCount(0);
  const b0 = (await pages.nth(0).boundingBox())!;
  const b1 = (await pages.nth(1).boundingBox())!;
  expect(Math.abs(b0.x - b1.x)).toBeLessThan(1);
  expect(b1.y).toBeGreaterThan(b0.y + b0.height);
  const swipeV = async (from: number, to: number) => {
    const r = (await board.boundingBox())!;
    const x = r.x + r.width * 0.5;
    await page.mouse.move(x, r.y + r.height * from);
    await page.mouse.down();
    await page.mouse.move(x, r.y + r.height * to, { steps: 8 });
    await page.mouse.up();
  };
  await swipeV(0.8, 0.2);
  await expect(nav).toContainText('4 / 4');
  await swipeV(0.2, 0.8);
  await expect(nav).toContainText('3 / 4');

  await page.waitForTimeout(1200);
  await page.reload();
  const after = page.getByLabel('캔버스 그림판');
  await expect(after.locator('[data-canvas-page]')).toHaveCount(4);
  await expect(page.getByRole('navigation', { name: '쪽 넘김' })).toContainText('1 / 4');
  await expect(page.getByRole('button', { name: '다음 쪽' }).locator('svg')).toHaveClass(/chevron-down/);
  expect(errors).toEqual([]);
});
