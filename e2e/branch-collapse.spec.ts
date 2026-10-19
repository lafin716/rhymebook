import { expect, test } from '@playwright/test';

/** 사이드바: 하위 세션 아래 하위 세션을 접고 펼친다. 접으면 개수 표시 */
test('사이드바 하위 세션 접기·펼치기', async ({ page }, info) => {
  await page.goto('/#scenario=home');
  if (info.project.name === 'mobile') await page.getByRole('button', { name: '세션 목록', exact: true }).click();
  const nav = page.getByRole('navigation', { name: '학습 세션' });
  const toggle = nav.getByRole('button', { name: '하위 세션 접기' });
  // 시드: Query, Key, Value → 내적 → 코사인 유사도 (토글 2개)
  await expect(toggle).toHaveCount(2);
  await expect(nav.getByText('코사인 유사도')).toBeVisible();

  await toggle.first().click();
  await expect(nav.getByText('내적')).toHaveCount(0);
  await expect(nav.getByText('코사인 유사도')).toHaveCount(0);
  await expect(nav.getByText('+1')).toBeVisible();
  await page.screenshot({ path: `test-results/branch-collapse-${info.project.name}.png` });

  await nav.getByRole('button', { name: '하위 세션 펼치기' }).click();
  await expect(nav.getByText('코사인 유사도')).toBeVisible();
});
