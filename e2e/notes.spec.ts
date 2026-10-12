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
