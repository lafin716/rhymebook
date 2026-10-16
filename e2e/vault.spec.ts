import { expect, test, type Locator, type Page } from '@playwright/test';

/** 마우스로 a를 눌러 b의 (fx, fy) 비율 위치까지 끌어 놓는다 */
async function dragTo(page: Page, a: Locator, b: Locator, fx = 0.5, fy = 0.5) {
  const ra = (await a.boundingBox())!;
  const rb = (await b.boundingBox())!;
  await page.mouse.move(ra.x + ra.width / 2, ra.y + ra.height / 2);
  await page.mouse.down();
  await page.mouse.move(ra.x + ra.width / 2 + 10, ra.y + ra.height / 2 + 10, { steps: 3 });
  await page.mouse.move(rb.x + rb.width * fx, rb.y + rb.height * fy, { steps: 8 });
  await page.mouse.up();
}

/** 보관함: 답변 담기 → 페이지(저장 버튼·끌어 나란히) → 폴더 이동(팝업·끌기) → 지우기 (ADR-055, ADR-058) */
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
  if (!mobile) {
    // 태블릿 이상: 화면 높이의 80% 창, [전체 화면으로 보기]
    const box = (await vault.boundingBox())!;
    expect(box.height).toBeGreaterThan(900 * 0.75);
    await vault.getByRole('button', { name: '전체 화면으로 보기' }).click();
    await expect.poll(async () => (await vault.boundingBox())!.height).toBe(900);
    await vault.getByRole('button', { name: '창으로 보기' }).click();
  }

  // 맨 위에 새 페이지 → 조각과 글을 넣고 [저장]
  await vault.getByRole('button', { name: '새 페이지' }).click();
  const name = vault.locator('[data-vault-name]');
  await name.fill('복습 페이지');
  await name.press('Enter');
  const editor = vault.locator('[data-vault-page]');
  await editor.getByRole('button', { name: '조각 넣기' }).click();
  await vault.locator('[data-vault-picker]').getByRole('button', { name: itemName, exact: true }).click();
  await editor.getByRole('button', { name: '글 넣기' }).click();
  await editor.getByLabel('글').fill('## 오늘의 정리\n핵심만 다시 보기');
  await expect(editor.locator('[data-vault-block]')).toHaveCount(2);
  // 글을 위로 올린다
  await editor.locator('[data-vault-block]').nth(1).getByRole('button', { name: '위로' }).click();
  await expect(editor.locator('[data-vault-block]').first().getByLabel('글')).toBeVisible();
  if (!mobile) {
    // 손잡이로 글을 조각 오른쪽 끝에 끌어 놓으면 한 줄에 나란히
    const blocks = editor.locator('[data-vault-block]');
    await dragTo(page, blocks.first().locator('[data-vault-handle]'), blocks.nth(1), 0.92, 0.5);
    await expect(editor.locator('[data-vault-row]')).toHaveCount(1);
    await expect(blocks.nth(1).getByLabel('글')).toBeVisible();
  }
  if (!mobile) {
    // 저장하지 않고 다른 항목으로 가려 하면 버릴지 묻는다
    await vault.locator('[data-vault-node][data-kind="item"]').getByRole('button', { name: itemName, exact: true }).click();
    const ask = page.getByRole('alertdialog');
    await expect(ask).toContainText('저장하지 않은 변경을 버릴까요?');
    await ask.getByRole('button', { name: '취소' }).click();
    await expect(editor.locator('[data-vault-block]')).toHaveCount(2);
  }
  await vault.getByRole('button', { name: '저장', exact: true }).click();
  await expect(page.getByText('저장했어요.')).toBeVisible();
  await expect(editor.getByRole('heading', { name: '오늘의 정리' })).toBeVisible();
  await expect(editor.locator('[data-vault-row]')).toHaveCount(mobile ? 2 : 1);
  await expect(vault.locator('[data-vault-title]')).toHaveText('복습 페이지');
  if (mobile) await vault.getByRole('button', { name: '보관함 목록으로' }).click();

  // 새 폴더 → 이름 바꾸기
  await vault.getByRole('button', { name: '새 폴더' }).click();
  await expect(name).toHaveValue('새 폴더');
  await name.fill('단어장');
  await name.press('Enter');
  await expect(vault.locator('[data-vault-title]')).toHaveText('단어장');
  if (mobile) await vault.getByRole('button', { name: '보관함 목록으로' }).click();
  await expect(vault.locator('[data-vault-node][data-kind="folder"]')).toContainText('단어장');

  // 조각을 [이동] 팝업으로 폴더에 옮긴다
  await vault.locator('[data-vault-node][data-kind="item"]').getByRole('button', { name: itemName, exact: true }).click();
  await vault.locator('[data-vault-toolbar]').getByRole('button', { name: '이동' }).click();
  await page.locator('[data-vault-folder-picker]').getByRole('button', { name: '단어장' }).click();
  await expect(page.getByText("'단어장' 폴더로 옮겼어요.")).toBeVisible();
  if (mobile) await vault.getByRole('button', { name: '보관함 목록으로' }).click();
  await expect(vault.getByRole('treeitem', { name: /단어장/ }).getByRole('group')).toContainText(itemName);

  if (!mobile) {
    // 트리에서 페이지를 끌어 폴더에 넣고, 빈 곳에 놓아 다시 맨 위로
    const pageRow = vault.locator('[data-vault-node][data-kind="page"]');
    await dragTo(page, pageRow, vault.locator('[data-vault-node][data-kind="folder"]'));
    await expect(vault.getByRole('treeitem', { name: /단어장/ }).getByRole('group')).toContainText('복습 페이지');
    await dragTo(page, pageRow, vault.locator('[data-vault-tree] [role="tree"]'), 0.5, 0.95);
    await expect(page.getByText('보관함 맨 위로 옮겼어요.')).toBeVisible();
    await expect(vault.getByRole('treeitem', { name: /단어장/ }).getByRole('group')).not.toContainText('복습 페이지');

    // 같은 폴더 안 순서 바꾸기: 폴더 줄 위쪽 가장자리로 끌면 선으로 자리를 보여 주고, 놓으면 그 앞으로 (ADR-059)
    const topRows = vault.locator('[role="tree"] > ul > li > [data-vault-node]');
    await expect(topRows.first()).toHaveAttribute('data-kind', 'folder');
    const from = (await pageRow.boundingBox())!;
    const to = (await vault.locator('[data-vault-node][data-kind="folder"]').boundingBox())!;
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(from.x + from.width / 2 + 10, from.y + from.height / 2 - 10, { steps: 3 });
    await page.mouse.move(to.x + to.width / 2, to.y + to.height * 0.1, { steps: 8 });
    await expect(vault.locator('[data-vault-drop-line="before"]')).toBeVisible();
    await page.screenshot({ path: `test-results/vault-reorder-${info.project.name}.png` });
    await page.mouse.up();
    await expect(vault.locator('[data-vault-drop-line]')).toHaveCount(0);
    await expect(topRows.first()).toHaveAttribute('data-kind', 'page');
    await expect(topRows.nth(1)).toHaveAttribute('data-kind', 'folder');
  }

  // 페이지 보기 화면
  await vault.locator('[data-vault-node][data-kind="page"]').getByRole('button').click();
  await page.screenshot({ path: `test-results/vault-page-${info.project.name}.png` });

  // 폴더를 지우면 안의 조각도 지워지고, 페이지는 '지워진 조각'으로 남는다
  if (mobile) await vault.getByRole('button', { name: '보관함 목록으로' }).click();
  await vault.locator('[data-vault-node][data-kind="folder"]').getByRole('button', { name: '단어장', exact: true }).click();
  await vault.locator('[data-vault-toolbar]').getByRole('button', { name: '지우기' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: '지우기' }).click();
  await expect(vault.locator('[data-vault-node][data-kind="folder"]')).toHaveCount(0);
  await vault.locator('[data-vault-node][data-kind="page"]').getByRole('button').click();
  await expect(vault.locator('[data-vault-page]')).toContainText('지워진 조각이에요.');
  await page.screenshot({ path: `test-results/vault-tree-${info.project.name}.png` });
});
