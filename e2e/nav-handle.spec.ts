import { expect, test } from '@playwright/test';

/** 모바일 세션 내비게이션 핸들: 끌어서 좌·우 가장자리에 붙이고, 숨기기/다시 보이기 (ADR-056) */
test('내비게이션 핸들: 가운데에 놓으면 가까운 쪽에 붙고, 숨기면 헤더 버튼으로 복원', async ({ page }, info) => {
  test.skip(info.project.name !== 'mobile', '핸들은 모바일 전용');
  await page.goto('/#scenario=home');
  const main = page.locator('[data-panel="main"]');
  const toolbar = main.getByRole('toolbar', { name: '질문 이동' });
  const handle = toolbar.locator('[data-nav-handle]');
  await expect(toolbar).toHaveAttribute('data-nav-dock', 'right');

  // 화면 가운데보다 약간 왼쪽, 위쪽에 놓는다 → 왼쪽 가장자리에 붙는다
  const box = (await handle.boundingBox())!;
  const vw = page.viewportSize()!.width;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(vw / 2 - 20, 200, { steps: 8 });
  await page.mouse.up();
  await expect(toolbar).toHaveAttribute('data-nav-dock', 'left');
  await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished)));
  await expect.poll(async () => (await toolbar.boundingBox())!.x).toBeLessThan(20);
  expect((await toolbar.boundingBox())!.y).toBeLessThan(300);
  await page.screenshot({ path: `test-results/nav-handle-left.png` });

  // 새로고침 후에도 위치 유지
  await page.reload();
  await expect(toolbar).toHaveAttribute('data-nav-dock', 'left');

  // 핸들을 누르면 숨기기 메뉴 → 숨기면 헤더의 내비게이션 버튼으로 복원
  await handle.click();
  await page.getByRole('menuitem', { name: '숨기기' }).click();
  await expect(toolbar).toHaveCount(0);
  const restore = main.getByRole('button', { name: '내비게이션 보이기' });
  await expect(restore).toBeVisible();
  await page.screenshot({ path: `test-results/nav-handle-hidden.png` });
  await restore.click();
  await expect(toolbar).toBeVisible();
  await expect(restore).toHaveCount(0);
});
