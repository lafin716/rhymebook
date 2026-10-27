import { expect, test } from '@playwright/test';

/** 사이드바 [+] → 세션: 빈 하위 세션을 바로 열고, 부모에 각주·내비게이션 각주 (ADR-054, ADR-075) */
test('하위 세션: 사이드바 + → 세션 → 부모 각주와 내비게이션 각주', async ({ page }, info) => {
  const mobile = info.project.name === 'mobile';
  await page.goto('/#scenario=home');
  if (mobile) await page.getByRole('button', { name: '세션 목록', exact: true }).click();
  const nav = page.getByRole('navigation', { name: '학습 세션' });
  // 첫 학습을 연 뒤 그 행의 + 로 하위 세션을 만든다
  const parentTitle = (await nav.locator('div.truncate').first().innerText()).trim();
  await nav.locator('div.truncate').first().click();
  if (mobile) await page.getByRole('button', { name: '세션 목록', exact: true }).click();
  await nav.getByRole('button', { name: '하위 항목 만들기' }).first().click({ force: true });
  // 질문 입력 팝업 없이 드롭다운에서 고른다
  const menu = page.getByRole('menu', { name: '하위 항목 만들기' });
  await expect(menu.getByRole('menuitem')).toHaveText([/빈 페이지/, /세션/]);
  await menu.getByRole('menuitem', { name: '세션' }).click();
  await expect(menu).toHaveCount(0);
  await expect(page.getByRole('dialog', { name: '하위 세션 만들기' })).toHaveCount(0);

  // 빈 하위 세션이 열린다
  await expect(page.locator('header').filter({ hasText: '새 학습' }).first()).toBeVisible();
  if (mobile) await page.getByRole('dialog', { name: '가지 시트' }).getByRole('button', { name: '시트 닫기' }).click();

  // 부모 세션(본문)에 각주가 생긴다
  const main = page.locator('[data-panel="main"]');
  await expect(main).toContainText(parentTitle);
  const notes = main.locator('[data-footnotes]');
  await expect(notes).toContainText('각주 1');
  await expect(notes).toContainText('새 학습');
  await expect(main.locator('[data-footnote-ref]')).toHaveCount(1);

  // 내비게이션 가지 패널 하단에 각주가 고정된다
  await main.getByRole('button', { name: /^이 페이지의 가지 \d+개$/ }).click();
  const pinned = page.locator('[data-nav-footnotes]');
  await expect(pinned).toContainText('[1]');
  await expect(pinned).toContainText('새 학습');
  await page.screenshot({ path: `test-results/subsession-nav-${info.project.name}.png` });
});

/** 앵커 없는 하위 세션: 부모 원문이 없어도 요약 버튼 줄을 접는다 (접으면 헤더 아이콘으로) */
test('빈 하위 세션: 요약 버튼 줄 접기·펼치기', async ({ page }, info) => {
  const mobile = info.project.name === 'mobile';
  await page.goto('/#scenario=home');
  if (mobile) await page.getByRole('button', { name: '세션 목록', exact: true }).click();
  const nav = page.getByRole('navigation', { name: '학습 세션' });
  await nav.locator('div.truncate').first().click();
  if (mobile) await page.getByRole('button', { name: '세션 목록', exact: true }).click();
  await nav.getByRole('button', { name: '하위 항목 만들기' }).first().click({ force: true });
  await page.getByRole('menu', { name: '하위 항목 만들기' }).getByRole('menuitem', { name: '세션' }).click();

  const header = page.locator('header').filter({ hasText: '새 학습' }).first();
  await expect(header.getByRole('button', { name: '부모에 요약 붙이기' })).toHaveText(/부모에 요약 붙이기/);
  await header.getByRole('button', { name: '요약 버튼 접기' }).click();
  // 줄은 사라지고 헤더 아이콘 버튼만 남는다
  await expect(header.getByRole('button', { name: '부모에 요약 붙이기' })).not.toHaveText(/부모에 요약 붙이기/);
  await page.screenshot({ path: `test-results/subsession-fold-${info.project.name}.png` });
  await header.getByRole('button', { name: '요약 버튼 펼치기' }).click();
  await expect(header.getByRole('button', { name: '부모에 요약 붙이기' })).toHaveText(/부모에 요약 붙이기/);
});

/** 사이드바 [+] → 빈 페이지: 하위 페이지가 열리고, 부모가 페이지면 본문에 링크가 붙는다 (ADR-075) */
test('하위 페이지: 사이드바 + → 빈 페이지 → 부모 페이지에 링크', async ({ page }, info) => {
  test.skip(info.project.name === 'mobile', '모바일은 사이드바가 서랍이라 데스크톱에서 검증');
  await page.goto('/#scenario=home');
  const nav = page.getByRole('navigation', { name: '학습 세션' });
  const main = page.locator('[data-panel="main"]');
  // 부모 페이지를 하나 만들고 본문을 쓴다
  await page.getByRole('button', { name: '새로 만들기' }).click();
  await main.getByRole('button', { name: '빈 페이지로 시작' }).click();
  await page.keyboard.type('부모 페이지 본문');
  await main.getByRole('button', { name: '완료' }).click();
  await expect(main).toContainText('부모 페이지 본문');

  await main.locator('[data-page-title]').click();
  const rename = main.getByRole('textbox').first();
  await rename.fill('부모 페이지');
  await rename.press('Enter');

  const row = nav.locator('[data-session-row]').filter({ hasText: '부모 페이지' }).first();
  await row.getByRole('button', { name: '하위 항목 만들기' }).click({ force: true });
  await page.getByRole('menu', { name: '하위 항목 만들기' }).getByRole('menuitem', { name: '빈 페이지' }).click();
  // 새 하위 페이지가 편집 상태로 열린다
  await expect(main.getByLabel('페이지 본문 (마크다운)')).toBeVisible();
  await expect(main.locator('[data-page-title]')).toHaveText(/새 페이지/);
  await expect(nav.getByText('새 페이지', { exact: true })).toBeVisible();

  // 부모 페이지 본문 끝에 링크가 붙는다
  await row.click();
  await expect(main.locator('a.page-link', { hasText: '새 페이지' })).toBeVisible();
  await expect(main).toContainText('부모 페이지 본문');
});
