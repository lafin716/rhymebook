import { expect, test, type Page } from '@playwright/test';

/** 추천 가지 (ADR-094): 커리큘럼 챕터 옆 "가지" 버튼과 답변 아래 "추천 가지" 칩이 하위 세션을 만들어 연다 */
const BLOCK = {
  chapters: [
    { title: '1주차: 벡터와 내적', question: '벡터와 내적을 예시로 설명해줘' },
    { title: '2주차: 소프트맥스', question: '소프트맥스를 예시로 설명해줘' },
    { title: '3주차: 어텐션', question: '어텐션을 예시로 설명해줘' },
  ],
  next: [{ title: '하루 공부 순서', question: '하루 공부 순서를 짜줘' }],
};
const CURRICULUM = [
  '트랜스포머 3주 로드맵이에요.',
  '',
  '## 1주차: 벡터와 내적',
  '- 벡터 덧셈과 길이',
  '',
  '## 2주차: 소프트맥스',
  '- 점수를 확률로',
  '',
  '## 3주차: 어텐션',
  '- Q·K·V',
  '',
  '```branches',
  JSON.stringify(BLOCK),
  '```',
].join('\n');
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,OPTIONS' };

async function mock(page: Page) {
  await page.route('**/v1/models**', (route) => route.fulfill({ contentType: 'application/json', body: '{"data":[]}', headers: CORS }));
  await page.route('**/v1/messages', async (route) => {
    const body = route.request().postDataJSON() as { system?: string; messages?: { content: unknown }[] };
    const last = JSON.stringify(body.messages?.at(-1)?.content ?? '');
    const text = body.system?.startsWith('다음 대화의 주제')
      ? '트랜스포머 로드맵'
      : last.includes('커리큘럼')
        ? CURRICULUM
        : '하위 세션 답변입니다.';
    const events = [
      { type: 'message_start', message: {} },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } },
      { type: 'message_delta', delta: { stop_reason: 'end_turn' } },
      { type: 'message_stop' },
    ];
    await route.fulfill({ contentType: 'text/event-stream', headers: CORS, body: events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join('') });
  });
}

test('추천 가지: 챕터 가지 버튼 → 앵커 가지, 추천 칩 → 하위 세션, 다시 누르면 같은 세션', async ({ page }, info) => {
  const mobile = info.project.name === 'mobile';
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await mock(page);
  await page.goto('/?platform=desktop');
  await page.getByRole('dialog', { name: '시작하기' }).getByRole('button', { name: /^API 키/ }).click();
  await page.getByLabel('Anthropic API 키').fill('sk-ant-e2e-ok');
  await page.getByLabel('Anthropic API 키').press('Enter');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '새 학습 시작' }).click();
  const main = page.locator('[data-panel="main"]');
  await main.getByLabel('메시지 입력').fill('트랜스포머 커리큘럼 짜줘');
  await main.getByRole('button', { name: '보내기' }).click();

  // 블록은 숨고, 챕터마다 가지 버튼, 아래에 추천 칩
  await expect(main.getByRole('heading', { name: /3주차: 어텐션/ })).toBeVisible();
  await expect(main.getByText('"chapters"')).toBeHidden();
  const chapterButtons = main.locator('[data-chapter-branch]');
  await expect(chapterButtons).toHaveCount(3);
  const chips = main.locator('[data-suggest-branch]');
  await expect(chips).toHaveText(['하루 공부 순서']);
  if (mobile) expect((await chapterButtons.first().boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await page.screenshot({ path: `test-results/branch-suggest-${info.project.name}.png` });

  // 챕터 가지: 앵커 가지가 열리고 챕터 질문이 보내진다
  await main.getByRole('heading', { name: /2주차: 소프트맥스/ }).locator('[data-chapter-branch]').click();
  await expect(page.getByText('소프트맥스를 예시로 설명해줘').last()).toBeVisible();
  await expect(page.getByText('하위 세션 답변입니다.').last()).toBeVisible();
  await page.screenshot({ path: `test-results/branch-suggest-chapter-${info.project.name}.png` });
  if (mobile) await page.getByRole('dialog', { name: '가지 시트' }).getByRole('button', { name: '시트 닫기' }).click();
  else await page.keyboard.press('Escape');

  // 버튼은 "열기"로 바뀌고 챕터 제목이 앵커로 표시된다
  const opened = main.getByRole('heading', { name: /2주차: 소프트맥스/ }).locator('[data-chapter-branch]');
  await expect(opened).toHaveAttribute('data-chapter-branch', 'open');
  await expect(main.locator('mark.anchor')).toHaveCount(1);

  // 추천 칩: 하위 세션 생성 → 다시 누르면 같은 세션 (중복 없음)
  await chips.first().click();
  await expect(page.getByText('하루 공부 순서를 짜줘').last()).toBeVisible();
  if (mobile) await page.getByRole('dialog', { name: '가지 시트' }).getByRole('button', { name: '시트 닫기' }).click();
  else await page.keyboard.press('Escape');
  await chips.first().click();
  await expect(page.getByText('하루 공부 순서를 짜줘').last()).toBeVisible();
  if (mobile) await page.getByRole('dialog', { name: '가지 시트' }).getByRole('button', { name: '시트 닫기' }).click();
  else await page.keyboard.press('Escape');

  // 사이드바 트리: 루트 아래 가지 2개 (챕터 1 + 추천 1)
  if (mobile) await page.getByRole('button', { name: '세션 목록', exact: true }).click();
  const nav = page.getByRole('navigation', { name: '학습 세션' });
  await expect(nav.getByText('하루 공부 순서를 짜줘')).toHaveCount(1);
  expect(errors).toEqual([]);
});
