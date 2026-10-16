import { expect, test } from '@playwright/test';

/** 직접 입력한 질문으로 하위 세션 만들기 → 부모에 각주·내비게이션 각주 (ADR-054) */
test('하위 세션: 사이드바 + → 질문 입력 → 부모 각주와 내비게이션 각주', async ({ page }, info) => {
  const mobile = info.project.name === 'mobile';
  await page.goto('/#scenario=home');
  if (mobile) await page.getByRole('button', { name: '세션 목록', exact: true }).click();
  const nav = page.getByRole('navigation', { name: '학습 세션' });
  // 첫 학습을 연 뒤 그 행의 + 로 하위 세션을 만든다
  const parentTitle = (await nav.locator('div.truncate').first().innerText()).trim();
  await nav.locator('div.truncate').first().click();
  if (mobile) await page.getByRole('button', { name: '세션 목록', exact: true }).click();
  await nav.getByRole('button', { name: '하위 세션 만들기' }).first().click({ force: true });

  const dialog = page.getByRole('dialog', { name: '하위 세션 만들기' });
  await expect(dialog).toContainText(parentTitle);
  await expect(dialog.getByRole('button', { name: '만들기' })).toBeDisabled();
  await dialog.getByRole('textbox').fill('이 내용을 실생활 예시로 다시 설명해줘');
  await dialog.getByRole('button', { name: '만들기' }).click();
  await expect(dialog).toBeHidden();

  // 새 하위 세션이 열리고 질문이 첫 메시지로 들어간다
  await expect(page.getByText('이 내용을 실생활 예시로 다시 설명해줘').first()).toBeVisible();
  if (mobile) await page.getByRole('dialog', { name: '가지 시트' }).getByRole('button', { name: '시트 닫기' }).click();

  // 부모 세션(본문)에 각주가 생긴다
  const main = page.locator('[data-panel="main"]');
  await expect(main).toContainText(parentTitle);
  const notes = main.locator('[data-footnotes]');
  await expect(notes).toContainText('각주 1');
  await expect(notes).toContainText('이 내용을 실생활 예시로 다시 설명해줘');
  await expect(main.locator('[data-footnote-ref]')).toHaveCount(1);

  // 내비게이션 가지 패널 하단에 각주가 고정된다
  await main.getByRole('button', { name: /^이 페이지의 가지 \d+개$/ }).click();
  const pinned = page.locator('[data-nav-footnotes]');
  await expect(pinned).toContainText('[1]');
  await expect(pinned).toContainText('이 내용을 실생활 예시로 다시 설명해줘');
  await page.screenshot({ path: `test-results/subsession-nav-${info.project.name}.png` });
});
