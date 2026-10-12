import { expect, test } from '@playwright/test';

/** 학습 삭제는 기본 confirm 대신 공통 확인 창을 띄운다 */
test('학습 삭제: 확인 창에서 취소하면 남고, 삭제하면 사라진다', async ({ page }, info) => {
  test.skip(info.project.name === 'mobile', '삭제 버튼은 데스크톱 사이드바 hover로 노출');
  await page.goto('/#scenario=home');
  const nav = page.getByRole('navigation', { name: '학습 세션' });
  const count = await nav.getByRole('button', { name: '세션 삭제' }).count();
  expect(count).toBeGreaterThan(0);

  const confirm = page.getByRole('alertdialog', { name: '학습을 삭제할까요?' });
  await nav.getByRole('button', { name: '세션 삭제' }).first().click({ force: true });
  await expect(confirm).toBeVisible();
  await expect(confirm.getByRole('button', { name: '취소' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(confirm).toBeHidden();
  await expect(nav.getByRole('button', { name: '세션 삭제' })).toHaveCount(count);

  await nav.getByRole('button', { name: '세션 삭제' }).first().click({ force: true });
  await confirm.getByRole('button', { name: '삭제' }).click();
  await expect(confirm).toBeHidden();
  await expect(nav.getByRole('button', { name: '세션 삭제' })).toHaveCount(count - 1);
});
