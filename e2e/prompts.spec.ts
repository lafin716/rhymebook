import { expect, test } from '@playwright/test';

/** 사이드바 툴바 '모두 접기' — 최상위 세션 트리를 모두 접는다 (ADR-098) */
test('사이드바 모두 접기', async ({ page }, info) => {
  await page.goto('/#scenario=home');
  if (info.project.name === 'mobile') await page.getByRole('button', { name: '세션 목록', exact: true }).click();
  const nav = page.getByRole('navigation', { name: '학습 세션' });
  const toolbar = page.getByRole('toolbar', { name: '세션 목록 도구' });
  if ((await nav.getByText('코사인 유사도').count()) === 0) await nav.getByRole('button', { name: '가지 펼치기' }).first().click();
  await expect(nav.getByText('코사인 유사도')).toBeVisible();

  await toolbar.getByRole('button', { name: '모두 접기' }).click();
  await expect(nav.getByText('코사인 유사도')).toHaveCount(0);
  await expect(nav.getByRole('button', { name: '가지 접기' })).toHaveCount(0);
  await page.screenshot({ path: `test-results/sidebar-collapse-all-${info.project.name}.png` });
});

/** 프롬프트 관리: 기본 시스템 프롬프트를 고쳐 저장하면 유지되고, 기본값으로 되돌릴 수 있다 (ADR-098) */
test('프롬프트 관리: 고치기 · 유지 · 기본값으로 되돌리기', async ({ page }, info) => {
  const mobile = info.project.name === 'mobile';
  await page.goto('/?platform=desktop');
  const onboarding = page.getByRole('dialog', { name: '시작하기' });
  await onboarding.getByRole('button', { name: /^API 키/ }).click();
  const key = page.getByLabel('Anthropic API 키');
  await key.fill('sk-ant-e2e-ok');
  await key.press('Enter');
  await expect(page.getByRole('dialog')).toContainText('연결됨');
  await page.keyboard.press('Escape');
  if (mobile) await page.getByRole('button', { name: '세션 목록', exact: true }).click();
  await page.getByRole('button', { name: '프롬프트 관리' }).click();
  const dlg = page.getByRole('dialog', { name: '프롬프트 관리' });
  await expect(dlg).toBeVisible();
  for (const key of ['base', 'branchSuggest', 'branch', 'subsession', 'summary', 'title', 'pageOrganize', 'pageFill', 'skillAssist', 'promptAssist']) {
    await expect(dlg.locator(`[data-prompt-row="${key}"]`)).toBeVisible();
  }
  if (mobile) await dlg.locator('[data-prompt-row="base"]').click();
  const box = dlg.getByLabel('기본 시스템 프롬프트 프롬프트');
  await expect(box).toHaveValue(/학습을 돕는 튜터/);
  await box.fill('너는 소크라테스식 질문으로 가르치는 튜터다.');
  await dlg.getByRole('button', { name: '저장' }).click();
  if (mobile) await expect(dlg.locator('[data-prompt-row="base"]')).toContainText('수정됨');
  else await expect(dlg.getByRole('button', { name: '저장' })).toBeDisabled();
  await page.screenshot({ path: `test-results/prompts-${info.project.name}.png` });

  // 새로고침해도 유지
  await page.reload();
  await expect(dlg).toBeVisible();
  await expect(dlg.locator('[data-prompt-row="base"]')).toContainText('수정됨');
  if (mobile) await dlg.locator('[data-prompt-row="base"]').click();
  await expect(box).toHaveValue('너는 소크라테스식 질문으로 가르치는 튜터다.');

  await dlg.getByRole('button', { name: '기본값으로 되돌리기' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: '되돌리기' }).click();
  await expect(box).toHaveValue(/학습을 돕는 튜터/);
  if (mobile) await dlg.getByRole('button', { name: '프롬프트 목록' }).click();
  await expect(dlg.locator('[data-prompt-row="base"]')).not.toContainText('수정됨');
});

/** 원격(웹·모바일)은 대화가 PC에서 돌아 프롬프트를 보기만 한다 */
test('프롬프트 관리: 원격에서는 읽기 전용', async ({ page }, info) => {
  await page.goto('/#scenario=home');
  if (info.project.name === 'mobile') await page.getByRole('button', { name: '세션 목록', exact: true }).click();
  await page.getByRole('button', { name: '프롬프트 관리' }).click();
  const dlg = page.getByRole('dialog', { name: '프롬프트 관리' });
  await expect(dlg.getByRole('note')).toContainText('PC 앱에서 바꿀 수 있어요');
  await dlg.locator('[data-prompt-row="title"]').click();
  await expect(dlg.getByLabel('세션 제목 프롬프트')).not.toBeEditable();
  await expect(dlg.getByRole('button', { name: '저장' })).toHaveCount(0);
  await expect(dlg.locator('[data-prompt-assist]')).toHaveCount(0);
});

/** 프롬프트 관리: AI로 수정하기 — 요청대로 편집 칸을 채우고, 되돌리거나 저장한다 (ADR-112) */
test('프롬프트 관리: AI로 수정하기 · 되돌리기 · 저장', async ({ page }, info) => {
  await page.routeWebSocket('**/*', (socket) => socket.close());
  await page.addInitScript(() => { localStorage.setItem('branch.profile', 'local'); localStorage.setItem('octobooks.locale', 'ko'); });
  await page.goto('/?platform=desktop');
  await expect(page.locator('main')).toBeVisible();
  await page.evaluate(async () => {
    const path = performance.getEntriesByType('resource').map((e) => e.name).find((n) => new URL(n).pathname === '/src/app/store.ts')!;
    const { actions, registry } = await import(path);
    const w = window as unknown as { requests: { system: string; content: string }[] };
    w.requests = [];
    actions().updateSettings({ setupDone: true, defaultProviderId: 'anthropic-api' });
    actions().setConnection('anthropic-api', { enabled: true, status: 'ready' });
    registry.register({
      id: 'anthropic-api', label: 'Prompt assist test', available: async () => ({ status: 'ready' }),
      async *stream(req: { system?: string; purpose?: string; messages: { content: string }[] }) {
        w.requests.push({ system: req.system ?? '', content: req.messages.at(-1)?.content ?? '' });
        yield { type: 'delta', text: '<prompt>\n대화 제목을 열 자 이내로' };
        await new Promise((r) => setTimeout(r, 150));
        yield { type: 'delta', text: ' 짓는다.\n</prompt>\n<note>더 짧게 고쳤어요.</note>' };
        yield { type: 'done' };
      },
    });
    actions().setOverlay('prompts');
  });
  const dlg = page.getByRole('dialog', { name: '프롬프트 관리' });
  await dlg.locator('[data-prompt-row="title"]').click();
  const box = dlg.getByLabel('세션 제목 프롬프트');
  const original = await box.inputValue();
  const assist = dlg.locator('[data-prompt-assist]');
  await assist.getByRole('button', { name: '더 간결하게' }).click();
  await assist.getByRole('button', { name: 'AI로 수정하기' }).click();
  // 스트리밍 중에는 부분 결과가 채워지고 저장은 막힌다
  await expect(box).toHaveValue('대화 제목을 열 자 이내로');
  await expect(dlg.getByRole('button', { name: '저장' })).toBeDisabled();
  await expect(box).toHaveValue('대화 제목을 열 자 이내로 짓는다.');
  await expect(assist.getByRole('status')).toContainText('더 짧게 고쳤어요.');
  const req = await page.evaluate(() => (window as unknown as { requests: { system: string; content: string }[] }).requests);
  expect(req).toHaveLength(1);
  expect(req[0]!.system).toContain('시스템 프롬프트');
  expect(req[0]!.content).toContain(original.trim().split('\n')[0]!);
  expect(req[0]!.content).toContain('더 짧고 간결하게');
  await page.screenshot({ path: `test-results/prompt-assist-${info.project.name}.png` });

  // 되돌리기 → 원래 문구, 다시 고쳐 저장하면 수정됨
  await assist.getByRole('button', { name: 'AI 변경 취소' }).click();
  await expect(box).toHaveValue(original);
  await assist.getByRole('button', { name: 'AI로 수정하기' }).click();
  await expect(box).toHaveValue('대화 제목을 열 자 이내로 짓는다.');
  await dlg.getByRole('button', { name: '저장' }).click();
  await expect(dlg.locator('[data-prompt-row="title"]')).toContainText('수정됨');
});
