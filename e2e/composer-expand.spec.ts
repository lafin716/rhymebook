import { expect, test, type Page } from '@playwright/test';

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,OPTIONS' };

async function setup(page: Page, asked: string[]) {
  await page.route('**/v1/models**', (route) => route.fulfill({ contentType: 'application/json', body: '{"data":[]}', headers: CORS }));
  await page.route('**/v1/messages', async (route) => {
    const body = route.request().postDataJSON() as { system?: string; messages: { role: string; content: unknown }[] };
    const isTitle = (body.system ?? '').startsWith('다음 대화의 주제');
    if (!isTitle) asked.push(JSON.stringify(body.messages.at(-1)?.content));
    const text = isTitle ? '자세히 입력' : '받았어요.';
    const events = [
      { type: 'message_start', message: {} },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } },
      { type: 'message_delta', delta: { stop_reason: 'end_turn' } },
      { type: 'message_stop' },
    ];
    await route.fulfill({ contentType: 'text/event-stream', headers: CORS, body: events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join('') });
  });
  await page.goto('/?platform=desktop');
  await page.getByRole('dialog', { name: '시작하기' }).getByRole('button', { name: /^API 키/ }).click();
  await page.getByLabel('Anthropic API 키').fill('sk-ant-e2e-ok');
  await page.getByLabel('Anthropic API 키').press('Enter');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '새 학습 시작' }).click();
  return page.locator('[data-panel="main"]');
}

test('자세히 입력하기: 전체 화면에서 Enter는 줄바꿈, Ctrl+Enter로 보내고 접힌다', async ({ page }) => {
  const asked: string[] = [];
  const main = await setup(page, asked);
  await main.getByLabel('메시지 입력').fill('첫 줄');
  await main.getByRole('button', { name: '자세히 입력하기' }).click();

  const full = page.getByRole('dialog', { name: '자세히 입력하기' });
  await expect(full).toBeVisible();
  const input = full.getByLabel('메시지 입력');
  await expect(input).toBeFocused();
  await expect(input).toHaveValue('첫 줄');

  // Enter는 보내지 않고 줄을 바꾼다
  await input.press('Enter');
  await input.pressSequentially('둘째 줄');
  await expect(input).toHaveValue('첫 줄\n둘째 줄');
  expect(asked).toHaveLength(0);

  // Esc로 접어도 글은 그대로, 다시 펼쳐 Ctrl+Enter로 보낸다
  await input.press('Escape');
  await expect(full).toBeHidden();
  await expect(main.getByLabel('메시지 입력')).toHaveValue('첫 줄\n둘째 줄');
  await main.getByRole('button', { name: '자세히 입력하기' }).click();
  await full.getByLabel('메시지 입력').press('Control+Enter');

  await expect(full).toBeHidden();
  await expect(main.getByText('받았어요.')).toBeVisible();
  expect(asked[0]).toContain('첫 줄\\n둘째 줄');
  await expect(main.getByLabel('메시지 입력')).toHaveValue('');
});

test('자세히 입력하기: 보내기 버튼으로도 보낸다', async ({ page }) => {
  const asked: string[] = [];
  const main = await setup(page, asked);
  await main.getByRole('button', { name: '자세히 입력하기' }).click();
  const full = page.getByRole('dialog', { name: '자세히 입력하기' });
  await full.getByLabel('메시지 입력').fill('버튼으로 보내기');
  await full.getByRole('button', { name: '보내기' }).click();
  await expect(full).toBeHidden();
  await expect(main.getByText('받았어요.')).toBeVisible();
  expect(asked[0]).toContain('버튼으로 보내기');
});
