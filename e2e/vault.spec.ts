import { expect, test } from '@playwright/test';

/** 보관함: 답변 보관 → 폴더 만들고 옮기기 → 페이지로 조각 엮기 → 지우기 (ADR-055) */
test('보관함: 답변 담기 · 폴더 트리 · 페이지 구성', async ({ page }, info) => {
  const mobile = info.project.name === 'mobile';
  await page.goto('/#scenario=home');
  if (mobile) await page.getByRole('button', { name: '세션 목록', exact: true }).click();
  const nav = page.getByRole('navigation', { name: '학습 세션' });
  await nav.locator('div.truncate').first().click();

  // 답변 아래 [보관]
  const main = page.locator('[data-panel="main"]');
  const save = main.locator('[data-vault-save]').first();
  await save.scrollIntoViewIfNeeded();
  await save.click({ force: true });
  await expect(page.getByText('보관함에 담았어요.')).toBeVisible();

  await page.getByRole('button', { name: '보관함', exact: true }).click();
  const vault = page.getByRole('dialog', { name: '보관함' });
  await expect(vault.locator('[data-vault-node][data-kind="item"]')).toHaveCount(1);
  const itemName = (await vault.locator('[data-vault-node][data-kind="item"]').innerText()).trim();

  // 맨 위에 새 페이지 → 조각과 글을 넣는다
  await vault.getByRole('button', { name: '새 페이지' }).click();
  const name = vault.locator('[data-vault-name]');
  await name.fill('복습 페이지');
  await name.press('Enter');
  const editor = vault.locator('[data-vault-page]');
  await editor.getByRole('button', { name: '조각 넣기' }).click();
  await vault.locator('[data-vault-picker]').getByRole('button', { name: itemName, exact: true }).click();
  await editor.getByRole('button', { name: '글 넣기' }).click();
  await editor.getByLabel('글').fill('## 오늘의 정리\n핵심만 다시 보기');
  await editor.getByLabel('글').blur();
  await expect(editor.locator('[data-vault-block]')).toHaveCount(2);
  // 글을 위로 올린다
  await editor.locator('[data-vault-block]').nth(1).getByRole('button', { name: '위로' }).click();
  await expect(editor.locator('[data-vault-block]').first().getByLabel('글')).toBeVisible();

  await editor.getByRole('button', { name: '보기' }).click();
  await expect(editor.getByRole('heading', { name: '오늘의 정리' })).toBeVisible();
  if (mobile) await vault.getByRole('button', { name: '보관함 목록으로' }).click();

  // 새 폴더 → 이름 바꾸기
  await vault.getByRole('button', { name: '새 폴더' }).click();
  await expect(name).toHaveValue('새 폴더');
  await name.fill('단어장');
  await name.press('Enter');
  if (mobile) await vault.getByRole('button', { name: '보관함 목록으로' }).click();
  await expect(vault.locator('[data-vault-node][data-kind="folder"]')).toContainText('단어장');

  // 조각을 폴더로 옮긴다
  await vault.locator('[data-vault-node][data-kind="item"]').getByRole('button', { name: itemName, exact: true }).click();
  await vault.getByLabel('옮길 폴더').selectOption({ label: '단어장' });
  if (mobile) await vault.getByRole('button', { name: '보관함 목록으로' }).click();
  await expect(vault.getByRole('treeitem', { name: /단어장/ }).getByRole('group')).toContainText(itemName);

  // 페이지 보기 화면
  await vault.locator('[data-vault-node][data-kind="page"]').getByRole('button').click();
  await page.screenshot({ path: `test-results/vault-page-${info.project.name}.png` });

  // 폴더를 지우면 안의 조각도 지워지고, 페이지는 '지워진 조각'으로 남는다
  if (mobile) await vault.getByRole('button', { name: '보관함 목록으로' }).click();
  await vault.locator('[data-vault-node][data-kind="folder"]').getByRole('button', { name: '단어장', exact: true }).click();
  await vault.getByRole('button', { name: '지우기' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: '지우기' }).click();
  await expect(vault.locator('[data-vault-node][data-kind="folder"]')).toHaveCount(0);
  await vault.locator('[data-vault-node][data-kind="page"]').getByRole('button').click();
  await expect(vault.locator('[data-vault-page]')).toContainText('지워진 조각이에요.');
  await page.screenshot({ path: `test-results/vault-tree-${info.project.name}.png` });
});
