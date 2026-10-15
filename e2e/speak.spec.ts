import { expect, test, type Page } from '@playwright/test';

const SCRIPT = {
  title: '베트남어 인사',
  items: [
    { text: 'Xin chào', lang: 'vi', note: '안녕하세요' },
    { text: 'Cảm ơn bạn', lang: 'vi', note: '고마워요' },
    { text: 'Nice to meet you.', lang: 'en' },
  ],
};
const SPEAK_ANSWER = ['버튼을 눌러 들어 보세요.', '', '```speak', JSON.stringify(SCRIPT, null, 2), '```'].join('\n');
const PLAIN_ANSWER = '스킬 없이 답했어요.';
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,OPTIONS' };

type Spoken = { text: string; lang: string }[];

async function setup(page: Page) {
  // 기기 음성은 가짜로 바꿔 무엇을 어떤 언어로 읽었는지 기록한다
  await page.addInitScript(() => {
    const w = window as unknown as { __spoken: Spoken };
    w.__spoken = [];
    const fake = {
      speak(u: SpeechSynthesisUtterance) {
        if (u.text) w.__spoken.push({ text: u.text, lang: u.lang });
        setTimeout(() => (u.onend as (() => void) | null)?.(), 20);
      },
      cancel() {},
      getVoices: () => [],
      addEventListener() {},
    };
    Object.defineProperty(window, 'speechSynthesis', { value: fake, configurable: true });
  });
  await page.route('**/v1/models**', (route) => route.fulfill({ contentType: 'application/json', body: '{"data":[]}', headers: CORS }));
  await page.route('**/v1/messages', async (route) => {
    const body = route.request().postDataJSON() as { system?: string };
    const system = body.system ?? '';
    const text = system.startsWith('다음 대화의 주제') ? '베트남어 인사' : /^## 스킬: .+ \(\/speak\)$/m.test(system) ? SPEAK_ANSWER : PLAIN_ANSWER;
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

const spoken = (page: Page) => page.evaluate(() => (window as unknown as { __spoken: Spoken }).__spoken);

test('요청에 맞는 /speak 스킬을 자동으로 쓰고, 읽기 카드에서 한 줄씩·모두 듣는다 (ADR-052)', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const main = await setup(page);
  const input = main.getByLabel('메시지 입력');

  // 의도가 맞으면 입력 중에 자동 스킬 칩이 뜬다
  await input.fill('베트남어 인사 발음 들려줘');
  const chip = main.locator('[data-auto-skill="speak"]');
  await expect(chip).toBeVisible();
  await expect(chip).toContainText('음성으로 읽기');
  await page.screenshot({ path: testInfo.outputPath('speak-1-auto-chip.png') });
  await main.getByRole('button', { name: '보내기' }).click();

  await expect(main.locator('[data-skill-badge="speak"]')).toBeVisible();
  const card = main.locator('[data-speak]');
  await expect(card).toBeVisible();
  await expect(card).toContainText('베트남어 인사');
  await expect(card.locator('[data-speak-item]')).toHaveCount(3);
  await expect(card).toContainText('안녕하세요');
  // 원본 JSON은 숨겨진다
  await expect(main.locator('pre').filter({ hasText: '"items"' })).toBeHidden();
  await page.screenshot({ path: testInfo.outputPath('speak-2-card.png') });

  // 한 줄 듣기: 그 줄의 언어로 읽는다
  await card.getByRole('button', { name: '듣기: Xin chào' }).click();
  await expect.poll(() => spoken(page)).toEqual([{ text: 'Xin chào', lang: 'vi-VN' }]);

  // 모두 듣기: 차례로 이어 읽는다
  await expect(card.getByRole('button', { name: '모두 듣기' })).toBeVisible();
  await card.getByRole('button', { name: '모두 듣기' }).click();
  await expect
    .poll(async () => (await spoken(page)).slice(1))
    .toEqual([
      { text: 'Xin chào', lang: 'vi-VN' },
      { text: 'Cảm ơn bạn', lang: 'vi-VN' },
      { text: 'Nice to meet you.', lang: 'en-US' },
    ]);
  await expect(card.getByRole('button', { name: '모두 듣기' })).toBeVisible();

  // 칩을 빼면 스킬 없이 보낸다
  await input.fill('이 문장 발음 들려줘');
  await expect(chip).toBeVisible();
  await main.getByRole('button', { name: '자동 스킬 빼기' }).click();
  await expect(chip).toBeHidden();
  await main.getByRole('button', { name: '보내기' }).click();
  await expect(main.getByText(PLAIN_ANSWER)).toBeVisible();
  await expect(main.locator('[data-skill-badge="speak"]')).toHaveCount(1);

  // 맞는 스킬이 없는 질문엔 칩이 없다
  await input.fill('어텐션이 뭐야?');
  await expect(chip).toBeHidden();
  expect(errors).toEqual([]);
});

test('설정에서 자동 스킬을 끄면 칩이 뜨지 않는다', async ({ page }) => {
  const main = await setup(page);
  await main.getByLabel('메시지 입력').fill('퀴즈 내줘');
  await expect(main.locator('[data-auto-skill="quiz"]')).toBeVisible();
  await page.evaluate(() => localStorage.setItem('branch.autoSkill', '0'));
  await page.reload();
  const input = page.locator('[data-panel="main"]').getByLabel('메시지 입력');
  await input.fill('퀴즈 내줘');
  await expect(input).toHaveValue('퀴즈 내줘');
  await expect(page.locator('[data-auto-skill]')).toHaveCount(0);
});
