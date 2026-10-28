import { expect, test, type Page } from '@playwright/test';

/**
 * 페이지 UI 묶음 (ADR-087): 상단 도구 줄(Undo/Redo), 설정 창, 키보드 바, 선택 메뉴 'AI로 채우기'.
 * - P1: AI 정리 후 되돌리기 버튼이 없고, 편집기 실행 취소로 정리를 되돌린다
 * - P2: 상단 Undo/Redo 버튼 (기록 없으면 비활성)
 * - P5: 설정 창 토글 저장 (localStorage 기기별)
 * - P10: SelectionMenu 'AI로 채우기' (canFillPage일 때)
 */

const KEY = 'sk-ant-e2e-ok';
const LOCAL = '/?platform=desktop';
const MAIN = '[data-panel="main"]';
const DOC = '# 테스트\n\n- 첫 번째\n- 두 번째';

async function onboard(page: Page) {
  await page.goto(LOCAL);
  const onboarding = page.getByRole('dialog', { name: '시작하기' });
  await onboarding.getByRole('button', { name: /^API 키/ }).click();
  const input = page.getByLabel('Anthropic API 키');
  await input.fill(KEY);
  await input.press('Enter');
  await page.keyboard.press('Escape');
}

/** 페이지 본문 CodeMirror 원문 읽기 */
async function source(page: Page) {
  return page
    .locator(`${MAIN} [data-page-editor] .cm-content`)
    .evaluate((el) => (el as unknown as { cmTile: { root: { view: { state: { doc: { toString(): string } } } } } }).cmTile.root.view.state.doc.toString());
}

/** 편집기에 포커스 맞추고 텍스트 선택 */
async function selectInEditor(page: Page, text: string) {
  await page.locator(`${MAIN} [data-page-editor] .cm-content`).evaluate((el, t) => {
    const v = (el as unknown as { cmTile: { root: { view: { state: { doc: { toString(): string } }; dispatch(s: unknown): void; focus(): void } } } }).cmTile.root.view;
    const i = v.state.doc.toString().indexOf(t);
    if (i < 0) throw new Error(`선택할 텍스트 없음: ${t}`);
    v.focus();
    v.dispatch({ selection: { anchor: i, head: i + t.length } });
  }, text);
}

function collectErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
}

test('P2: Undo/Redo 버튼 활성/비활성 전환', async ({ page }) => {
  const errors = collectErrors(page);
  await onboard(page);
  await page.getByRole('button', { name: '빈 페이지' }).click();

  const main = page.locator(MAIN);
  const undoBtn = main.locator('[data-page-undo]');
  const redoBtn = main.locator('[data-page-redo]');

  // 초기: 기록이 없으므로 둘 다 비활성
  await expect(undoBtn).toBeDisabled();
  await expect(redoBtn).toBeDisabled();

  // 편집기에 입력
  const body = main.getByLabel('페이지 본문 (마크다운)');
  await body.fill('# 제목\n\n본문');
  await page.keyboard.press('Escape');

  // 입력 후 undo 기록이 있으므로 undo 활성화
  await expect(undoBtn).toBeEnabled();
  await expect(redoBtn).toBeDisabled();

  // undo 클릭
  await undoBtn.click();
  await page.waitForTimeout(100);

  // undo 후 redo 활성화
  await expect(redoBtn).toBeEnabled();

  // redo 클릭
  await redoBtn.click();
  await page.waitForTimeout(100);

  // redo 후 undo 다시 활성
  await expect(undoBtn).toBeEnabled();

  expect(errors).toEqual([]);
});

test('P1: AI 정리 후 되돌리기 버튼이 없고, Undo로 정리를 되돌린다', async ({ page }) => {
  const errors = collectErrors(page);
  await onboard(page);
  await page.getByRole('button', { name: '빈 페이지' }).click();

  const main = page.locator(MAIN);
  const body = main.getByLabel('페이지 본문 (마크다운)');

  // 문서 작성
  await body.fill(DOC);
  await page.keyboard.press('Escape');
  const originalSource = await source(page);

  // AI 정리 버튼 클릭
  const organizeBtn = main.getByRole('button', { name: /AI.*정리/ });
  await organizeBtn.click();

  // 정리 진행 중
  await expect(main.getByRole('button', { name: /정리 중/ })).toBeVisible({ timeout: 2000 });

  // 정리 완료 대기
  await expect(main.getByRole('button', { name: /AI.*정리/ })).toBeVisible({ timeout: 5000 });

  // 정리 후: 되돌리기 버튼이 없어야 함 (data-page-ai-undo 없음)
  await expect(main.locator('[data-page-ai-undo]')).toHaveCount(0);

  // 정리된 본문
  const organizedSource = await source(page);
  expect(organizedSource).not.toBe(originalSource);
  expect(organizedSource).toBeTruthy();

  // Undo 버튼으로 정리 전 상태로 되돌린다
  const undoBtn = main.locator('[data-page-undo]');
  await expect(undoBtn).toBeEnabled();
  await undoBtn.click();
  await page.waitForTimeout(100);

  // 원래 내용으로 돌아옴
  const afterUndoSource = await source(page);
  expect(afterUndoSource).toBe(originalSource);

  expect(errors).toEqual([]);
});

test('P5: 설정 창에서 이모지 미리보기 토글 저장 (localStorage)', async ({ page }) => {
  const errors = collectErrors(page);
  await onboard(page);
  await page.getByRole('button', { name: '빈 페이지' }).click();

  const main = page.locator(MAIN);
  const settingsBtn = main.locator('[data-page-settings-open]');
  await expect(settingsBtn).toBeVisible();

  // 설정 열기
  await settingsBtn.click();
  const dialog = page.getByRole('dialog', { name: '페이지 설정' });
  await expect(dialog).toBeVisible();

  // 이모지 미리보기 체크박스 (기본값: on)
  const emojiCheckbox = dialog.getByRole('checkbox', { name: /이모지/ });

  // 현재 값 확인 (기본 true)
  let isChecked = await emojiCheckbox.isChecked();
  expect(isChecked).toBe(true);

  // 토글 끄기
  await emojiCheckbox.click();
  isChecked = await emojiCheckbox.isChecked();
  expect(isChecked).toBe(false);

  // localStorage 확인
  const savedValue = await page.evaluate(() => localStorage.getItem('octobooks.page.emoji'));
  expect(savedValue).toBe('false');

  // 다시 켜기
  await emojiCheckbox.click();
  isChecked = await emojiCheckbox.isChecked();
  expect(isChecked).toBe(true);

  const savedValueOn = await page.evaluate(() => localStorage.getItem('octobooks.page.emoji'));
  expect(savedValueOn).toBe('true');

  // 설정 닫기
  await dialog.getByRole('button', { name: '닫기' }).last().click();
  await expect(dialog).not.toBeVisible();

  expect(errors).toEqual([]);
});

test('P10: SelectionMenu에서 "AI로 채우기" 버튼 (canFillPage일 때)', async ({ page }) => {
  const errors = collectErrors(page);
  await onboard(page);
  await page.getByRole('button', { name: '빈 페이지' }).click();

  const main = page.locator(MAIN);
  const body = main.getByLabel('페이지 본문 (마크다운)');
  await body.fill(DOC);
  await page.keyboard.press('Escape');

  // 페이지 글 선택 (SelectionMenu 포함 AI 채우기 버튼이 나타나야 함)
  await expect(async () => {
    await selectInEditor(page, '테스트');
    // 모바일에서는 하단 바, 데스크톱에서는 플로팅 메뉴 (portaled to document.body)
    await expect(page.getByRole('button', { name: 'AI로 채우기' })).toBeVisible({ timeout: 500 });
  }).toPass();

  // AI로 채우기 버튼 클릭
  const fillBtn = page.getByRole('button', { name: 'AI로 채우기' });
  await fillBtn.click();

  // AI 채우기 입력창이 열려야 함
  await expect(main.getByLabel(/무엇을 채울까요/)).toBeVisible();

  expect(errors).toEqual([]);
});

test('P10: SelectionMenu 복사·잘라내기 버튼 (페이지 편집기에서)', async ({ page }) => {
  const errors = collectErrors(page);
  await onboard(page);
  await page.getByRole('button', { name: '빈 페이지' }).click();

  const main = page.locator(MAIN);
  const body = main.getByLabel('페이지 본문 (마크다운)');
  await body.fill(DOC);
  await page.keyboard.press('Escape');

  // 페이지 글 선택
  await expect(async () => {
    await selectInEditor(page, '첫 번째');
    await expect(page.getByRole('button', { name: '복사' })).toBeVisible({ timeout: 500 });
  }).toPass();

  // 복사 버튼 확인 (SelectionMenu 페이지 모드에는 복사·잘라내기가 있어야 함, portaled to document.body)
  await expect(page.getByRole('button', { name: '복사' })).toBeVisible();

  // 모바일에서는 추가로 잘라내기 버튼도 있음 (선택 메뉴 페이지 모드)
  // 데스크톱에서는 복사만 확인 가능 (서식 버튼들이 다름)

  expect(errors).toEqual([]);
});
