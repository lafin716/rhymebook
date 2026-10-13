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
  await expect(main.getByText('스킬 /vocab 적용.', { exact: false })).toBeVisible();
  expect(errors).toEqual([]);
});

test('AI가 부수 파일을 만들고, 고급 옵션의 전용 모델로 그 질문만 답한다 (IMP-12)', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const main = await start(page);

  await main.getByRole('button', { name: '첨부·스킬' }).click();
  await page.getByRole('menuitem', { name: 'AI로 스킬 만들기…' }).click();
  const skills = page.getByRole('dialog', { name: '스킬 관리' });
  const request = skills.getByLabel('AI에게 요청');
  await request.fill('채점 기준 참고 파일도 만들어 줘');
  await request.press('Enter');
  await expect(skills.locator('[data-skill-assist]').getByRole('status')).toContainText('새 스킬을 만들었어요.');
  const file = skills.locator('[data-skill-file="references/rubric.md"]');
  await expect(file).toBeVisible();
  await file.click();
  await expect(skills.getByLabel('references/rubric.md 내용')).toHaveValue(/# 채점 기준/);

  // 직접 파일 추가
  await skills.getByRole('button', { name: '새 파일' }).click();
  await skills.getByLabel('새 파일 경로').fill('scripts/demo.py');
  await skills.getByRole('button', { name: '추가', exact: true }).click();
  await skills.getByLabel('scripts/demo.py 내용').fill('print("hi")');

  // 고급 옵션: 이 스킬만 다른 모델
  const options = skills.locator('[data-skill-options]');
  await options.getByRole('button', { name: /고급 옵션/ }).click();
  await options.getByLabel('스킬 프로바이더').selectOption('anthropic-api');
  await options.getByLabel('스킬 모델').fill('claude-e2e-skill');
  await skills.getByRole('button', { name: '저장' }).click();
  await expect(skills.locator('[data-skill-row="vocab"]')).toBeVisible();

  // 다시 열어도 유지
  await skills.locator('[data-skill-row="vocab"]').click();
  await expect(skills.locator('[data-skill-file="scripts/demo.py"]')).toBeVisible();
  await expect(options).toContainText('claude-e2e-skill');
  await page.keyboard.press('Escape');

  await main.getByLabel('메시지 입력').fill('/vocab apple');
  await main.getByRole('button', { name: '보내기' }).click();
  await expect(main.getByText(/스킬 \/vocab 적용\. 스킬 파일 2개\. 모델 claude-e2e-skill\./)).toBeVisible();
  // 다음 일반 질문은 세션(연결 기본) 모델
  await main.getByLabel('메시지 입력').fill('그냥 질문');
  await main.getByRole('button', { name: '보내기' }).click();
  await expect(main.getByText('마지막 문장 [그냥 질문].')).toBeVisible();
  await expect(main.getByText(/모델 claude-e2e-skill/)).toHaveCount(1);
  expect(errors).toEqual([]);
});
