import { expect, test } from '@playwright/test';

/**
 * ADR-066~069: 질문 우클릭 → 별도 세션으로 분리 · 다른 세션으로 옮기기, 세션 재정리(하위 세션은 각주로),
 * 마인드맵 질문 목록, 스킬 관리의 기본 스킬 배지.
 */
const THIRD = '인코더랑 디코더에서 어텐션이 다르게 쓰여?';

test('질문 우클릭 → 별도 세션으로 분리 (같은 레벨, 각주 없음)', async ({ page }, info) => {
  await page.goto('/#scenario=home');
  const main = page.locator('[data-panel="main"]');
  const third = main.locator('[data-turn]').getByText(THIRD, { exact: true });
  await expect(third).toBeVisible();

  await third.click({ button: 'right' });
  await page.getByRole('menuitem', { name: '별도 세션으로 분리' }).click();

  await expect(page.getByText('별도 세션으로 분리했어요. 제목은 AI가 지어요.')).toBeVisible();
  await expect(third).toHaveCount(0);
  // 하위 분리와 달리 부모 본문에 각주 표식이 남지 않는다
  await expect(main.locator('[data-footnote-ref]')).toHaveCount(0);
  await page.screenshot({ path: `test-results/turn-split-out-${info.project.name}.png` });
});

test('질문 우클릭 → 다른 세션으로 옮기기', async ({ page }, info) => {
  await page.goto('/#scenario=home');
  const main = page.locator('[data-panel="main"]');
  const third = main.locator('[data-turn]').getByText(THIRD, { exact: true });
  await expect(third).toBeVisible();

  await third.click({ button: 'right' });
  await page.getByRole('menuitem', { name: '다른 세션으로 옮기기' }).click();
  const dialog = page.getByRole('dialog', { name: '질문 옮기기' });
  await expect(dialog.getByText(`“${THIRD}”`)).toBeVisible();
  // 현재 세션은 고를 수 없다
  await expect(dialog.getByRole('option', { name: /트랜스포머 어텐션.*현재 세션/ })).toBeDisabled();
  await dialog.getByLabel('세션 제목 검색').fill('역전파');
  await page.screenshot({ path: `test-results/turn-move-picker-${info.project.name}.png` });
  await dialog.getByRole('option', { name: '역전파 기초' }).click();

  await expect(dialog).toHaveCount(0);
  await expect(page.getByText('“역전파 기초” 세션 끝으로 옮겼어요.')).toBeVisible();
  await expect(third).toHaveCount(0);
});

test('세션 재정리: 하나의 질문·답변으로 바뀌고 하위 세션은 각주가 된다', async ({ page }, info) => {
  await page.goto('/#scenario=home');
  const main = page.locator('[data-panel="main"]');
  await expect(main.locator('[data-turn]').getByText(THIRD, { exact: true })).toBeVisible();
  expect(await main.locator('[data-turn]').count()).toBeGreaterThan(1);

  await main.getByRole('button', { name: '세션 재정리' }).click();
  const confirmDialog = page.getByRole('alertdialog');
  await expect(confirmDialog).toContainText('각주로 남아요');
  await confirmDialog.getByRole('button', { name: '재정리' }).click();

  await expect(main.locator('[data-turn]')).toHaveCount(1);
  await expect(main.locator('[data-turn]')).toContainText('트랜스포머의 어텐션을 처음부터 정리해 줘');
  await expect(main.getByText('데모 재정리 응답입니다.', { exact: false })).toBeVisible();
  await expect(main.locator('[data-footnotes]')).toContainText('Query, Key, Value');
  await page.screenshot({ path: `test-results/reorganize-${info.project.name}.png` });
});

test('마인드맵 ▾ → 질문 목록 → 질문 클릭 시 그 질문으로 이동', async ({ page }, info) => {
  await page.goto('/#scenario=mindmap');
  const node = page.locator('.react-flow__node').filter({ hasText: '트랜스포머 어텐션' }).first();
  await expect(node).toBeVisible();
  await node.getByRole('button', { name: '질문 목록 펼치기' }).click();
  const list = node.getByRole('list', { name: '트랜스포머 어텐션 질문 목록' });
  await expect(list).toBeVisible();
  await expect(list.getByRole('button', { name: /트랜스포머의 어텐션이 뭔지 설명해줘/ })).toBeVisible();
  await page.screenshot({ path: `test-results/mindmap-turns-${info.project.name}.png` });

  await list.getByRole('button', { name: new RegExp(THIRD.replace('?', '\\?')) }).click();
  const target = page.locator('[data-turn]:focus');
  await expect(target).toContainText(THIRD);
  await expect(target).toBeInViewport();
});

test('스킬 관리: 기본 스킬에 “기본 스킬” 배지', async ({ page }) => {
  await page.goto('/#scenario=home');
  const main = page.locator('[data-panel="main"]');
  await main.getByRole('button', { name: '첨부·스킬' }).click();
  await page.getByRole('menuitem', { name: '스킬 관리…' }).click();
  const skills = page.getByRole('dialog', { name: '스킬 관리' });
  await expect(skills.locator('[data-skill-row="reorganize"]')).toContainText('기본 스킬');
  await expect(skills.locator('[data-skill-row="curriculum"]')).toContainText('기본 스킬');
});
