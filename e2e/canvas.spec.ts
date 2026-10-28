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

  // 카드 위에 쓰기
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
