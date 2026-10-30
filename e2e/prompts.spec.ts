import { expect, test } from '@playwright/test';

/** 사이드바 툴바 '모두 접기' — 최상위 세션 트리를 모두 접는다 (ADR-098) */
test('사이드바 모두 접기', async ({ page }, info) => {
  await page.goto('/#scenario=home');
  if (info.project.name === 'mobile') await page.getByRole('button', { name: '세션 목록', exact: true }).click();
  const nav = page.getByRole('navigation', { name: '학습 세션' });
  const toolbar = page.getByRole('toolbar', { name: '세션 목록 도구' });
  if ((await nav.getByText('코사인 유사도').count()) === 0) await nav.getByRole('button', { name: '가지 펼치기' }).first().click();
  await expect(nav.getByText('코사인 유사도')).toBeVisible();

  await toolbar.getByRole('button', { name: '모두 접기' }).click();
  await expect(nav.getByText('코사인 유사도')).toHaveCount(0);
  await expect(nav.getByRole('button', { name: '가지 접기' })).toHaveCount(0);
  await page.screenshot({ path: `test-results/sidebar-collapse-all-${info.project.name}.png` });
});

/** 프롬프트 관리: 기본 시스템 프롬프트를 고쳐 저장하면 유지되고, 기본값으로 되돌릴 수 있다 (ADR-098) */
test('프롬프트 관리: 고치기 · 유지 · 기본값으로 되돌리기', async ({ page }, info) => {
  const mobile = info.project.name === 'mobile';
  await page.goto('/?platform=desktop');
  const onboarding = page.getByRole('dialog', { name: '시작하기' });
  await onboarding.getByRole('button', { name: /^API 키/ }).click();
  const key = page.getByLabel('Anthropic API 키');
  await key.fill('sk-ant-e2e-ok');
  await key.press('Enter');
  await expect(page.getByRole('dialog')).toContainText('연결됨');
  await page.keyboard.press('Escape');
  if (mobile) await page.getByRole('button', { name: '세션 목록', exact: true }).click();
  await page.getByRole('button', { name: '프롬프트 관리' }).click();
  const dlg = page.getByRole('dialog', { name: '프롬프트 관리' });
  await expect(dlg).toBeVisible();
  for (const key of ['base', 'branchSuggest', 'branch', 'subsession', 'summary', 'title', 'pageOrganize', 'pageFill', 'skillAssist']) {
    await expect(dlg.locator(`[data-prompt-row="${key}"]`)).toBeVisible();
  }
  if (mobile) await dlg.locator('[data-prompt-row="base"]').click();
  const box = dlg.getByLabel('기본 시스템 프롬프트 프롬프트');
  await expect(box).toHaveValue(/학습을 돕는 튜터/);
  await box.fill('너는 소크라테스식 질문으로 가르치는 튜터다.');
  await dlg.getByRole('button', { name: '저장' }).click();
  if (mobile) await expect(dlg.locator('[data-prompt-row="base"]')).toContainText('수정됨');
  else await expect(dlg.getByRole('button', { name: '저장' })).toBeDisabled();
  await page.screenshot({ path: `test-results/prompts-${info.project.name}.png` });

  // 새로고침해도 유지
  await page.reload();
  await expect(dlg).toBeVisible();
  await expect(dlg.locator('[data-prompt-row="base"]')).toContainText('수정됨');
  if (mobile) await dlg.locator('[data-prompt-row="base"]').click();
  await expect(box).toHaveValue('너는 소크라테스식 질문으로 가르치는 튜터다.');

  await dlg.getByRole('button', { name: '기본값으로 되돌리기' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: '되돌리기' }).click();
  await expect(box).toHaveValue(/학습을 돕는 튜터/);
  if (mobile) await dlg.getByRole('button', { name: '프롬프트 목록' }).click();
  await expect(dlg.locator('[data-prompt-row="base"]')).not.toContainText('수정됨');
});

/** 원격(웹·모바일)은 대화가 PC에서 돌아 프롬프트를 보기만 한다 */
test('프롬프트 관리: 원격에서는 읽기 전용', async ({ page }, info) => {
  await page.goto('/#scenario=home');
  if (info.project.name === 'mobile') await page.getByRole('button', { name: '세션 목록', exact: true }).click();
  await page.getByRole('button', { name: '프롬프트 관리' }).click();
  const dlg = page.getByRole('dialog', { name: '프롬프트 관리' });
  await expect(dlg.getByRole('note')).toContainText('PC 앱에서 바꿀 수 있어요');
  await dlg.locator('[data-prompt-row="title"]').click();
  await expect(dlg.getByLabel('세션 제목 프롬프트')).not.toBeEditable();
  await expect(dlg.getByRole('button', { name: '저장' })).toHaveCount(0);
});
