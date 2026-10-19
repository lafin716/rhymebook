import { expect, test } from '@playwright/test';

/** 질문 우클릭 → 하위 세션으로 분리: 그 질문과 답변이 각주 하위 세션으로 옮겨진다. 첫 질문은 분리 불가 (ADR-065) */
test('질문 우클릭 → 하위 세션으로 분리', async ({ page }, info) => {
  await page.goto('/#scenario=home');
  const main = page.locator('[data-panel="main"]');
  const first = main.locator('[data-turn]').getByText('트랜스포머의 어텐션이 뭔지 설명해줘', { exact: true });
  const third = main.locator('[data-turn]').getByText('인코더랑 디코더에서 어텐션이 다르게 쓰여?', { exact: true });
  await expect(third).toBeVisible();

  // 첫 질문은 분리·삭제할 수 없다
  await first.click({ button: 'right' });
  await expect(page.getByRole('menuitem', { name: '하위 세션으로 분리' })).toBeDisabled();
  await expect(page.getByText('첫 질문은 분리·삭제할 수 없어요.')).toBeVisible();
  await page.keyboard.press('Escape');

  await third.click({ button: 'right' });
  await page.getByRole('menuitem', { name: '하위 세션으로 분리' }).click();

  // 부모 본문에서 빠지고, 그 자리에 각주가 생긴다
  await expect(third).toHaveCount(0);
  await expect(main.getByText('그럼 멀티헤드 어텐션은 뭐가 달라?', { exact: true })).toBeVisible();
  await expect(main.getByText('어텐션 계산량은 얼마나 돼? 긴 문장에서도 괜찮아?', { exact: true })).toBeVisible();
  const notes = main.locator('[data-footnotes]');
  await expect(notes).toContainText('인코더랑 디코더에서 어텐션이 다르게 쓰여?');
  await expect(main.locator('[data-footnote-ref]')).toHaveCount(1);
  await page.screenshot({ path: `test-results/turn-split-${info.project.name}.png` });
});
