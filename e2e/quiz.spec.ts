import { expect, test, type Page } from '@playwright/test';

const QUIZ = {
  title: '어텐션 확인 퀴즈',
  questions: [
    { type: 'ox', question: '셀프 어텐션은 **같은 문장** 안의 토큰끼리 관계를 본다.', answer: true, explanation: 'Q·K·V가 모두 같은 시퀀스에서 나와요.' },
    { type: 'choice', question: '점수를 $\\sqrt{d_k}$로 나누는 이유는?', choices: ['속도', '소프트맥스 포화 방지', '메모리 절약', '정규화 제거'], answer: 2, explanation: '내적이 커지면 기울기가 사라져요.' },
    { type: 'short', question: '가중합되는 벡터의 이름은?', answer: 'Value', accept: ['V', '값'], explanation: '가중치는 Value에 곱해져요.' },
  ],
};
const ANSWER = ['배운 내용을 확인해 봐요.', '', '```quiz', JSON.stringify(QUIZ, null, 2), '```', '', '퀴즈 뒤 선택 문장.'].join('\n');
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,OPTIONS' };

async function mock(page: Page) {
  await page.route('**/v1/models**', (route) => route.fulfill({ contentType: 'application/json', body: '{"data":[]}', headers: CORS }));
  await page.route('**/v1/messages', async (route) => {
    const body = route.request().postDataJSON() as { system?: string };
    const text = body.system?.startsWith('다음 대화의 주제') ? '어텐션 퀴즈' : ANSWER;
    const events = [
      { type: 'message_start', message: {} },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } },
      { type: 'message_delta', delta: { stop_reason: 'end_turn' } },
      { type: 'message_stop' },
    ];
    await route.fulfill({ contentType: 'text/event-stream', headers: CORS, body: events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join('') });
  });
}

test('퀴즈 카드: OX·객관식·주관식을 차례로 풀고 점수·새로고침 유지·퀴즈 뒤 가지 선택', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await mock(page);
  await page.goto('/?platform=desktop');
  await page.getByRole('dialog', { name: '시작하기' }).getByRole('button', { name: /^API 키/ }).click();
  await page.getByLabel('Anthropic API 키').fill('sk-ant-e2e-ok');
  await page.getByLabel('Anthropic API 키').press('Enter');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '새 학습 시작' }).click();
  const main = page.locator('[data-panel="main"]');
  await main.getByLabel('메시지 입력').fill('/quiz 어텐션');
  await main.getByRole('button', { name: '보내기' }).click();

  const card = main.locator('[data-quiz]');
  await expect(card).toBeVisible();
  await expect(card).toContainText('어텐션 확인 퀴즈');
  await expect(card).toContainText('1 / 3');
  // 원본 JSON 코드는 보이지 않는다
  await expect(main.locator('pre').filter({ hasText: '"questions"' })).toBeHidden();
  await page.screenshot({ path: testInfo.outputPath('quiz-1.png') });

  // 1) OX 정답
  await card.getByRole('button', { name: 'O (맞다)' }).click();
  await expect(card.getByRole('status')).toContainText('정답이에요!');
  await expect(card).toContainText('Q·K·V가 모두 같은 시퀀스에서 나와요.');
  await card.getByRole('button', { name: '다음 문제' }).click();

  // 2) 객관식 오답 → 정답·해설 표시
  await expect(card).toContainText('2 / 3');
  await expect(card.locator('.katex')).toHaveCount(1);
  await card.getByRole('button', { name: /속도/ }).click();
  await expect(card.getByRole('status')).toContainText('틀렸어요');
  await expect(card.getByRole('status')).toContainText('2번 소프트맥스 포화 방지');
  await page.screenshot({ path: testInfo.outputPath('quiz-2-wrong.png') });
  await card.getByRole('button', { name: '다음 문제' }).click();

  // 3) 주관식: 인정 답(대소문자 무시)
  await card.getByLabel('주관식 답').fill('v');
  await card.getByLabel('주관식 답').press('Enter');
  await expect(card.getByRole('status')).toContainText('정답이에요!');
  await card.getByRole('button', { name: '결과 보기' }).click();
  await expect(card).toContainText('2 / 3 정답');
  await page.screenshot({ path: testInfo.outputPath('quiz-3-score.png') });

  // 새로고침해도 풀이 결과가 남는다
  await page.reload();
  await expect(main.locator('[data-quiz]')).toContainText('2 / 3 정답');

  // 카드 뒤 문장으로 가지를 만들면 앵커가 정확히 그 문장에 붙는다
  await expect(async () => {
    await page.evaluate(() => {
      const root = document.querySelector('[data-panel="main"] [data-anchorable]')!;
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const at = node.textContent?.indexOf('퀴즈 뒤 선택 문장') ?? -1;
        if (at < 0) continue;
        const range = document.createRange();
        range.setStart(node, at);
        range.setEnd(node, at + '퀴즈 뒤 선택 문장'.length);
        getSelection()!.removeAllRanges();
        getSelection()!.addRange(range);
        document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
        break;
      }
    });
    await expect(page.getByRole('button', { name: '이게 뭐야?' })).toBeVisible({ timeout: 500 });
  }).toPass();
  await page.getByRole('button', { name: '이게 뭐야?' }).click();
  await expect(page.locator('[data-panel="main"] mark.anchor')).toHaveText('퀴즈 뒤 선택 문장');

  // 다시 풀기 (가지 팝업은 닫고)
  await page.getByRole('dialog', { name: /가지 (팝업|시트)/ }).getByRole('button', { name: '닫기' }).click();
  await main.locator('[data-quiz]').getByRole('button', { name: '다시 풀기' }).click();
  await expect(main.locator('[data-quiz]')).toContainText('1 / 3');
  expect(errors).toEqual([]);
});
