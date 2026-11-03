import { expect, test, type Page } from '@playwright/test';

// Keep the fixture stable while independent work updates source files.
test.beforeEach(async ({ page }) => { await page.routeWebSocket('**/*', (socket) => socket.close()); await page.addInitScript(() => localStorage.setItem('octobooks.locale', 'ko')); });

async function openSchedules(page: Page, mobile: boolean) {
  if (mobile) await page.getByRole('button', { name: '세션 목록', exact: true }).click();
  await page.getByRole('button', { name: '예약 관리', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '예약', exact: true })).toBeVisible();
}

async function createConversation(page: Page) {
  await page.addInitScript(() => localStorage.setItem('branch.profile', 'local'));
  await page.goto('/?platform=desktop');
  // Seed a real persisted local profile through app actions. This isolates schedules
  // from the unrelated in-progress onboarding locale migration and external APIs.
  await expect(page.locator('main')).toBeVisible();
  await page.evaluate(async () => {
    const path = performance.getEntriesByType('resource').map((entry) => entry.name).find((name) => new URL(name).pathname === '/src/app/store.ts')!;
    const { actions, persistence } = await import(path);
    actions().updateSettings({ setupDone: true });
    actions().newRootSession('schedule-chat');
    actions().renameSession('schedule-chat', '예약 테스트 대화');
    actions().newPage('schedule-page', { focus: false });
    actions().renameSession('schedule-page', '선택하면 안 되는 페이지');
    actions().newPage('schedule-canvas', { focus: false, kind: 'canvas' });
    actions().renameSession('schedule-canvas', '선택하면 안 되는 캔버스');
    actions().setOverlay('none');
    await persistence.flush();
  });
}

test('예약: 만들기 · 수정 · 일시정지 · 유지 · 재개 · 삭제', async ({ page }, info) => {
  const mobile = info.project.name === 'mobile';
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await createConversation(page);
  await openSchedules(page, mobile);
  const dialog = page.getByRole('dialog', { name: '예약', exact: true });
  await expect(dialog.getByText('아직 예약이 없습니다')).toBeVisible();
  await expect(dialog.getByRole('note')).toContainText('앱이 실행 중일 때만');
  await dialog.getByRole('button', { name: '새 예약', exact: true }).click();
  await dialog.getByLabel('이름', { exact: true }).fill('매일 학습 복습');
  await dialog.getByLabel('실행할 질문', { exact: true }).fill('오늘 학습할 내용을 세 가지로 정리해 줘.');
  await dialog.getByLabel('반복', { exact: true }).selectOption('daily');
  await expect(dialog.getByLabel('대화', { exact: true })).not.toHaveValue('');
  await expect(dialog.getByLabel('대화', { exact: true }).locator('option')).toHaveCount(2);
  await page.screenshot({ animations: 'disabled', path: info.outputPath(`schedules-editor-${info.project.name}.png`) });
  await dialog.getByRole('button', { name: '저장', exact: true }).click();
  const row = dialog.locator('[data-schedule-id]').first();
  await expect(row).toContainText('매일 학습 복습');
  await expect(row).toContainText('예약됨');
  await row.getByRole('button', { name: '수정', exact: true }).click();
  await dialog.getByLabel('이름', { exact: true }).fill('평일 학습 복습');
  await dialog.getByLabel('반복', { exact: true }).selectOption('weekdays');
  // A failed save remains in the editor and exposes the actual error.
  await dialog.getByLabel('다음 실행 시간', { exact: true }).fill('2020-01-01T09:00');
  await dialog.getByRole('button', { name: '저장', exact: true }).click();
  await expect(dialog.getByRole('alert')).toBeVisible();
  await expect(dialog.getByLabel('이름', { exact: true })).toHaveValue('평일 학습 복습');
  await dialog.getByLabel('다음 실행 시간', { exact: true }).fill('2099-01-05T09:00');
  await dialog.getByRole('button', { name: '저장', exact: true }).click();
  await expect(row).toContainText('평일 학습 복습');
  await row.getByRole('button', { name: '일시정지', exact: true }).click();
  await expect(row).toContainText('일시정지');
  await page.screenshot({ animations: 'disabled', path: info.outputPath(`schedules-list-${info.project.name}.png`) });
  await page.reload();
  // Overlay selection is persisted along with the other application settings.
  await expect(dialog).toBeVisible();
  await expect(row).toContainText('평일 학습 복습');
  await expect(row).toContainText('일시정지');
  await row.getByRole('button', { name: '다시 시작', exact: true }).click();
  await expect(row).toContainText('예약됨');
  await row.getByRole('button', { name: '수정', exact: true }).click();
  await dialog.getByLabel('이름', { exact: true }).fill('저장하지 않을 변경');
  await dialog.getByRole('button', { name: '취소', exact: true }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: '버리기', exact: true }).click();
  await expect(row).toContainText('평일 학습 복습');
  await row.getByRole('button', { name: '대화 열기', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('[data-panel="main"]').getByText('예약 테스트 대화').first()).toBeVisible();
  await openSchedules(page, mobile);
  await row.getByRole('button', { name: '예약 삭제', exact: true }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: '삭제', exact: true }).click();
  await expect(dialog.getByText('아직 예약이 없습니다')).toBeVisible();
  await page.reload();
  await expect(dialog.getByText('아직 예약이 없습니다')).toBeVisible();
  expect(errors).toEqual([]);
});

test('예약: 원격 창은 PC 관리 안내만 표시', async ({ page }, info) => {
  await page.goto('/#scenario=home');
  await openSchedules(page, info.project.name === 'mobile');
  const dialog = page.getByRole('dialog', { name: '예약', exact: true });
  await expect(dialog).toContainText('PC의 메인 창에서 예약을 관리하세요');
  await expect(dialog.getByRole('button', { name: '새 예약', exact: true })).toHaveCount(0);
  await expect(dialog.locator('input, textarea, select')).toHaveCount(0);
  await page.screenshot({ animations: 'disabled', path: info.outputPath(`schedules-remote-${info.project.name}.png`) });
});
