import { expect, test } from '@playwright/test';

/** 웹 검색 (ADR-070): 검색 질문이면 답변 위에 검색 내역·출처가 보이고, 칩으로 끄면 검색하지 않는다 */
test('웹 검색 칩과 도구 사용 내역', async ({ page }, info) => {
  await page.goto('/#scenario=home');
  const main = page.locator('[data-panel="main"]');
  const chip = main.getByRole('button', { name: '웹 검색', exact: true });
  await expect(chip).toHaveAttribute('aria-pressed', 'true');

  await main.getByLabel('메시지 입력').fill('어텐션 최신 연구 검색해줘');
  await main.getByRole('button', { name: '보내기' }).click();
  const tool = main.locator('[data-tool="web_search"]').last();
  await expect(tool).toHaveAttribute('data-tool-status', 'done');
  await expect(tool).toContainText('웹 검색');
  await expect(tool).toContainText('출처 2');
  await tool.getByRole('button').click();
  const link = tool.getByRole('link').first();
  await expect(link).toHaveAttribute('target', '_blank');
  await expect(link).toHaveAttribute('href', /^https:\/\//);
  await page.screenshot({ path: `test-results/web-search-${info.project.name}.png` });

  // 끄면 같은 질문에도 검색하지 않는다
  await chip.click();
  await expect(main.getByRole('button', { name: '웹 검색 끔' })).toHaveAttribute('aria-pressed', 'false');
  const before = await main.locator('[data-tools]').count();
  await main.getByLabel('메시지 입력').fill('어텐션 최신 뉴스 검색해줘');
  await main.getByRole('button', { name: '보내기' }).click();
  await expect(main.getByText('어텐션 최신 뉴스 검색해줘').first()).toBeVisible();
  await expect(main.getByRole('button', { name: '보내기' })).toBeVisible({ timeout: 15_000 });
  await expect(main.locator('[data-tools]')).toHaveCount(before);
});
