import { expect, test, type Page } from '@playwright/test';

/**
 * IMP-11: AI로 스킬 만들기·고치기. 입력창 + 메뉴 → 'AI로 스킬 만들기…' → 요청 → 편집 칸 채움 → 고치기 → 되돌리기 → 저장 → 사용.
 * 응답은 e2e/mock-anthropic.mjs: 새 스킬은 '요청: …', 고치기는 기존 지시 뒤에 '추가: …'를 붙인다.
 */
const KEY = 'sk-ant-e2e-ok';

async function start(page: Page) {
  await page.goto('/?platform=desktop');
  const onboarding = page.getByRole('dialog', { name: '시작하기' });
  await onboarding.getByRole('button', { name: /^API 키/ }).click();
  const input = page.getByLabel('Anthropic API 키');
  await input.fill(KEY);
  await input.press('Enter');
  await expect(page.getByRole('dialog')).toContainText('연결됨');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '새 학습 시작' }).click();
  return page.locator('[data-panel="main"]');
}

test('AI로 스킬을 만들고 고친 뒤 되돌리고 저장해 쓴다', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const main = await start(page);

  await main.getByRole('button', { name: '첨부·스킬' }).click();
  await page.getByRole('menuitem', { name: 'AI로 스킬 만들기…' }).click();
  const skills = page.getByRole('dialog', { name: '스킬 관리' });
  const assist = skills.locator('[data-skill-assist]');
  const request = assist.getByLabel('AI에게 요청');
  // 새 스킬 편집 화면이 열리고 AI 요청 칸에 바로 입력할 수 있다
  await expect(request).toBeFocused();
  await expect(assist.getByRole('button', { name: 'AI로 만들기' })).toBeDisabled();

  await request.fill('영단어 외우기');
  await request.press('Enter');
  await expect(assist.getByRole('status')).toContainText('새 스킬을 만들었어요.');
  await expect(skills.getByLabel('명령 이름')).toHaveValue('vocab');
  await expect(skills.getByLabel('제목', { exact: true })).toHaveValue('단어 암기');
  await expect(skills.getByRole('textbox', { name: /^지시/ })).toHaveValue('요청: 영단어 외우기');
  await expect(request).toHaveValue('');

  // 채운 뒤에는 고치기: 빠른 요청을 골라 보낸다
  await assist.getByRole('button', { name: '더 간결하게' }).click();
  await expect(request).toHaveValue(/간결하게/);
  await assist.getByRole('button', { name: 'AI로 고치기' }).click();
  await expect(assist.getByRole('status')).toContainText('요청을 지시에 더했어요.');
  await expect(skills.getByRole('textbox', { name: /^지시/ })).toHaveValue(/^요청: 영단어 외우기\n추가: 지시를 더 짧고/);
  await expect(skills.getByLabel('명령 이름')).toHaveValue('vocab');

  // AI 변경 취소 → 고치기 전으로
  await assist.getByRole('button', { name: 'AI 변경 취소' }).click();
  await expect(skills.getByRole('textbox', { name: /^지시/ })).toHaveValue('요청: 영단어 외우기');

  await skills.getByRole('button', { name: '저장' }).click();
  await expect(skills.locator('[data-skill-row="vocab"]')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(skills).toBeHidden();

  await main.getByLabel('메시지 입력').fill('/vocab apple');
  await main.getByRole('button', { name: '보내기' }).click();
  await expect(main.getByText('스킬 /vocab 적용.')).toBeVisible();
  expect(errors).toEqual([]);
});
