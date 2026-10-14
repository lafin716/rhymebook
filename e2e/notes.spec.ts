import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';

/** 이해 노트 (ADR-022): 시드 트리의 가지·요약을 모아 Markdown/Anki로 내보낸다 */
test('이해 노트: 가지 카드 목록 → Markdown·Anki 내보내기 → 카드로 세션 이동', async ({ page }) => {
  await page.goto('/#scenario=home');
  await page.getByRole('banner').getByRole('button', { name: '이해 노트' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('요약 2개');

  const [md] = await Promise.all([page.waitForEvent('download'), dialog.getByRole('button', { name: 'Markdown 저장' }).click()]);
  expect(md.suggestedFilename()).toMatch(/-이해노트-\d{4}-\d{2}-\d{2}\.md$/);
  const text = await readFile((await md.path())!, 'utf8');
  expect(text).toMatch(/^# .+\n\n> rhymebook 이해 노트 · /);
  expect(text).toContain('**이해한 내용** — ');
  await expect(dialog.getByRole('status')).toContainText('저장했어요');

  const [anki] = await Promise.all([page.waitForEvent('download'), dialog.getByRole('button', { name: 'Anki 카드' }).click()]);
  const tsv = await readFile((await anki.path())!, 'utf8');
  expect(tsv.split('\n').slice(0, 2)).toEqual(['#separator:tab', '#html:true']);
  expect(tsv.trimEnd().split('\n')).toHaveLength(6);

  // 첫 가지 카드를 누르면 그 세션이 열리고 모달이 닫힌다
  const first = dialog.getByRole('listitem').first().getByRole('button');
  const title = (await first.locator('span.truncate').innerText()).trim();
  await first.click();
  await expect(dialog).toBeHidden();
  await expect(page.locator('[data-panel="main"]')).toContainText(title);
});

/** 학습 꾸러미 (ADR-043): zip 내보내기 → 같은 zip 가져오기(모두 유지) → 책으로 만들기 */
test('이해 노트: 학습 내보내기·가져오기 → 책으로 만들기', async ({ page }, info) => {
  // 데스크톱(로컬 저장) 화면: 웹은 PC 미러라 PC 연결이 필요하다
  await page.goto('/?platform=desktop#scenario=home');
  await page.getByRole('banner').getByRole('button', { name: '이해 노트' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('button', { name: '책으로 만들기' })).toBeEnabled();
  await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished)));
  await page.screenshot({ path: `test-results/notes-study-${info.project.name}.png` });

  const [zip] = await Promise.all([page.waitForEvent('download'), dialog.getByRole('button', { name: '학습 내보내기' }).click()]);
  expect(zip.suggestedFilename()).toMatch(/-학습-\d{4}-\d{2}-\d{2}\.zip$/);
  await expect(dialog.getByRole('status')).toContainText('학습 꾸러미');

  await dialog.locator('input[type=file]').setInputFiles((await zip.path())!);
  await expect(dialog.getByRole('status')).toContainText(/가져왔어요 — 가지 추가 0 · 갱신 0 · 유지 \d+/);

  await dialog.getByRole('button', { name: '책으로 만들기' }).click();
  await expect(dialog).toBeHidden();
  const main = page.locator('[data-panel="main"]');
  await expect(main).toContainText('📖');
  await expect(main).toContainText('이 학습 기록을 책으로 만들어 줘.');
  await expect(main).toContainText('학습 원문.md');
});
