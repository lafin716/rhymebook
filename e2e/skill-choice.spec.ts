import { expect, test } from '@playwright/test';

// Several task skills in one request: the composer asks for exactly one (ADR-111).
test.beforeEach(async ({ page }) => {
  await page.routeWebSocket('**/*', (socket) => socket.close());
  await page.addInitScript(() => { localStorage.setItem('octobooks.locale', 'ko'); localStorage.setItem('branch.profile', 'local'); });
  await page.goto('/?platform=desktop');
  await expect(page.locator('main')).toBeVisible();
  await page.evaluate(async () => {
    const path = performance.getEntriesByType('resource').map((entry) => entry.name).find((name) => new URL(name).pathname === '/src/app/store.ts')!;
    const { actions, registry, persistence } = await import(path);
    actions().updateSettings({ setupDone: true, defaultProviderId: 'anthropic-api' });
    actions().newRootSession('skill-choice');
    actions().setConnection('anthropic-api', { enabled: true, status: 'ready' });
    const target = window as unknown as { requests: { system?: string; content: string }[] };
    target.requests = [];
    registry.register({
      id: 'anthropic-api', label: 'choice test', available: async () => ({ status: 'ready' }),
      async *stream(req: { purpose?: string; system?: string; messages: { content: string }[] }) {
        if (req.purpose === 'title') { yield { type: 'delta', text: '스킬 선택' }; yield { type: 'done' }; return; }
        target.requests.push({ system: req.system, content: req.messages.at(-1)?.content ?? '' });
        // The AI names another skill on purpose: the user's choice must win.
        const question = req.messages.at(-1)?.content ?? '';
        const text = question.includes('발음 들려줘') && question.includes('매일')
          ? `\`\`\`schedule\n${JSON.stringify({ title: '매일 퀴즈', prompt: '퀴즈 내줘', runAt: new Date(Date.now() + 3600000).toISOString(), repeat: 'daily', skill: 'speak' })}\n\`\`\``
          : '답변입니다.';
        yield { type: 'delta', text }; yield { type: 'done' };
      },
    });
    await persistence.flush();
  });
});

const lastUser = (page: import('@playwright/test').Page) => page.evaluate(async () => {
  const path = performance.getEntriesByType('resource').map((entry) => entry.name).find((name) => new URL(name).pathname === '/src/app/store.ts')!;
  const { actions } = await import(path);
  const user = actions().messages['skill-choice'].filter((m: { role: string }) => m.role === 'user').at(-1);
  return user ? { skill: user.skill?.name ?? null, taskSkill: user.taskSkill?.name ?? null } : null;
});

test('여러 스킬 요청은 하나를 고르게 하고, 고른 스킬로 보낸다', async ({ page }, info) => {
  const main = page.locator('main');
  const input = main.getByLabel('메시지 입력');
  const send = main.getByRole('button', { name: '보내기', exact: true });
  await input.fill('퀴즈 내고 발음도 들려줘');
  const picker = main.locator('[data-skill-choice="chat"]');
  await expect(picker).toContainText('하나를 골라');
  await expect(picker.locator('[data-skill-choice-option]')).toHaveCount(3);
  await expect(main.locator('[data-auto-skill]')).toHaveCount(0);
  await page.screenshot({ path: info.outputPath(`skill-choice-${info.project.name}.png`) });
  // Sending before choosing is blocked.
  await send.click();
  await expect(page.getByText('보내기 전에 쓸 스킬 하나를 골라 주세요.')).toBeVisible();
  expect(await lastUser(page)).toBeNull();
  await picker.locator('[data-skill-choice-option="speak"]').click();
  await expect(picker.locator('[data-skill-choice-option="speak"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(main.locator('[data-auto-skill="speak"]')).toBeVisible();
  await send.click();
  await expect.poll(() => lastUser(page)).toEqual({ skill: 'speak', taskSkill: null });
  await expect(main.locator('[data-skill-choice]')).toHaveCount(0);
  // "스킬 없이" sends a plain question.
  await input.fill('커리큘럼 짜 주고 퀴즈도 내줘');
  await main.locator('[data-skill-choice-option=""]').click();
  await expect(main.locator('[data-auto-skill]')).toHaveCount(0);
  await send.click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { requests: unknown[] }).requests.length)).toBe(2);
  expect(await lastUser(page)).toEqual({ skill: null, taskSkill: null });
});

test('예약 + 스킬 하나는 그대로, 예약 + 여러 스킬은 예약에 쓸 스킬을 고른다', async ({ page }) => {
  const main = page.locator('main');
  const input = main.getByLabel('메시지 입력');
  const send = main.getByRole('button', { name: '보내기', exact: true });
  // A schedule that uses one skill is not a multi-skill request.
  await input.fill('매일 3시 퀴즈 내줘');
  await expect(main.locator('[data-auto-skill="schedule"]')).toBeVisible();
  await expect(main.locator('[data-skill-choice]')).toHaveCount(0);
  await send.click();
  await expect.poll(() => lastUser(page)).toEqual({ skill: 'schedule', taskSkill: null });
  // Schedule + two skills: choose the skill the schedule runs; no "스킬 없이".
  await input.fill('매일 3시에 퀴즈 내고 발음 들려줘');
  const picker = main.locator('[data-skill-choice="schedule"]');
  await expect(picker).toContainText('예약 작업 하나에는 스킬 하나만');
  await expect(picker.locator('[data-skill-choice-option]')).toHaveCount(2);
  await send.click();
  await expect(page.getByText('보내기 전에 쓸 스킬 하나를 골라 주세요.')).toBeVisible();
  await picker.locator('[data-skill-choice-option="quiz"]').click();
  await expect(main.locator('[data-auto-skill="schedule"]')).toBeVisible();
  await send.click();
  await expect.poll(() => lastUser(page)).toEqual({ skill: 'schedule', taskSkill: 'quiz' });
  await expect(main.locator('[data-task-skill-badge="quiz"]')).toBeVisible();
  const system = await page.evaluate(() => (window as unknown as { requests: { system?: string }[] }).requests.at(-1)?.system ?? '');
  expect(system).toContain('"skill":"quiz"');
  await expect.poll(() => page.evaluate(async () => {
    const path = performance.getEntriesByType('resource').map((entry) => entry.name).find((name) => new URL(name).pathname === '/src/app/store.ts')!;
    const { db } = await import(path);
    return (await db.schedules.toArray()).map((row: { skill?: { name: string } }) => row.skill?.name ?? null);
  })).toEqual(['quiz']);
});
