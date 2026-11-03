import { expect, test } from '@playwright/test';

// Keep the fixture stable while independent work updates source files.
test.beforeEach(async ({ page }) => { await page.routeWebSocket('**/*', (socket) => socket.close()); await page.addInitScript(() => localStorage.setItem('octobooks.locale', 'ko')); });

test('예약 요청 → 자동 저장 → 만료 실행 → 완료 알림, 재귀 예약·중복 없음', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => {
    localStorage.setItem('branch.profile', 'local');
    const target = window as unknown as { delivered: string[]; Notification: unknown };
    target.delivered = [];
    target.Notification = class {
      static permission = 'granted';
      onclick: (() => void) | null = null;
      constructor(title: string) { target.delivered.push(title); }
      close() {}
    };
  });
  await page.goto('/?platform=desktop');
  await expect(page.locator('main')).toBeVisible();
  await page.evaluate(async () => {
    const path = performance.getEntriesByType('resource').map((entry) => entry.name).find((name) => new URL(name).pathname === '/src/app/store.ts')!;
    const { actions, registry, persistence } = await import(path);
    actions().updateSettings({ setupDone: true, defaultProviderId: 'anthropic-api' });
    actions().newRootSession('schedule-chat-ai');
    actions().renameSession('schedule-chat-ai', '자동 예약 대화');
    actions().setConnection('anthropic-api', { enabled: true, status: 'ready' });
    registry.register({
      id: 'anthropic-api', label: 'Schedule test', available: async () => ({ status: 'ready' }),
      async *stream(req: { purpose?: string; messages: { content: string }[] }) {
        if (req.purpose === 'title') { yield { type: 'delta', text: '자동 예약 대화' }; yield { type: 'done' }; return; }
        const question = req.messages.at(-1)?.content ?? '';
        const text = question.includes('예약해줘') ? `예약 정보를 확인해 주세요.\n\n\`\`\`schedule\n${JSON.stringify({ title: '매일 퀴즈', prompt: '예약하지 말고 오늘의 퀴즈를 내줘', runAt: new Date(Date.now() + 3600000).toISOString(), repeat: 'daily' })}\n\`\`\`` : '오늘의 예약 퀴즈 응답입니다.';
        yield { type: 'delta', text }; yield { type: 'done' };
      },
    });
    await persistence.flush();
    actions().sendMessage('schedule-chat-ai', '매일 오전 9시에 퀴즈 내도록 예약해줘');
  });
  const card = page.getByRole('region', { name: '예약 정보' });
  // section with accessible name is a region.
  await expect(card).toContainText('등록된 예약');
  await expect.poll(() => page.evaluate(() => (window as unknown as { delivered: string[] }).delivered.length)).toBe(1);
  await card.getByRole('button', { name: '예약 관리', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '예약', exact: true });
  await expect(dialog.locator('[data-schedule-id]')).toHaveCount(1);
  await page.screenshot({ path: info.outputPath(`schedule-auto-${info.project.name}.png`) });
  // Simulate a missed due time; the real scheduler and response hook run normally.
  await page.evaluate(async () => {
    const path = performance.getEntriesByType('resource').map((entry) => entry.name).find((name) => new URL(name).pathname === '/src/app/store.ts')!;
    const { db } = await import(path);
    const row = (await db.schedules.toArray())[0];
    await db.schedules.update(row.id, { nextRunAt: Date.now() - 1000, originAt: Date.now() - 1000 });
  });
  await expect.poll(() => page.evaluate(async () => {
    const path = performance.getEntriesByType('resource').map((entry) => entry.name).find((name) => new URL(name).pathname === '/src/app/store.ts')!; const { db } = await import(path);
    const row = (await db.schedules.toArray())[0]; return !!row?.lastRunAt;
  })).toBe(true);
  await expect.poll(() => page.evaluate(() => (window as unknown as { delivered: string[] }).delivered.length)).toBe(2);
  await expect(dialog.locator('[data-schedule-id]')).toHaveCount(1);
  await page.evaluate(async () => {
    const path = performance.getEntriesByType('resource').map((entry) => entry.name).find((name) => new URL(name).pathname === '/src/app/store.ts')!; const { actions, db } = await import(path);
    const messages = actions().messages['schedule-chat-ai'];
    const scheduled = messages.filter((m: { scheduleRun?: boolean }) => m.scheduleRun);
    if (scheduled.length !== 1) throw new Error(`expected one dispatch, got ${scheduled.length}`);
    const row = (await db.schedules.toArray())[0];
    if (row.nextRunAt <= Date.now()) throw new Error('recurring task was not advanced');
    actions().setOverlay('none');
  });
  await expect(page.getByText('오늘의 예약 퀴즈 응답입니다.', { exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath(`schedule-result-${info.project.name}.png`) });
  expect(errors).toEqual([]);
});

test('예약 엔진은 다른 탭에서 만든 세션을 읽고 한 번만 실행한다', async ({ page, context }) => {
  await page.addInitScript(() => localStorage.setItem('branch.profile', 'local'));
  await page.goto('/?platform=desktop');
  await expect(page.locator('main')).toBeVisible();
  await page.evaluate(async () => {
    const path = performance.getEntriesByType('resource').map((entry) => entry.name).find((name) => new URL(name).pathname === '/src/app/store.ts')!;
    const { actions, registry, persistence } = await import(path);
    actions().updateSettings({ setupDone: true, defaultProviderId: 'anthropic-api' });
    actions().setConnection('anthropic-api', { enabled: true, status: 'ready' });
    registry.register({ id: 'anthropic-api', label: 'owner', available: async () => ({ status: 'ready' }), async *stream() { yield { type: 'delta', text: '다른 탭의 예약 완료' }; yield { type: 'done' }; } });
    await persistence.flush();
  });
  const other = await context.newPage();
  await other.routeWebSocket('**/*', (socket) => socket.close());
  await other.goto('/?platform=desktop');
  await expect(other.locator('main')).toBeVisible();
  await other.evaluate(async () => {
    const path = performance.getEntriesByType('resource').map((entry) => entry.name).find((name) => new URL(name).pathname === '/src/app/store.ts')!;
    const { actions, persistence, db } = await import(path);
    actions().newRootSession('other-tab-session');
    await persistence.flush();
    const at = Date.now() - 1000;
    await db.schedules.put({ id: 'other-tab-schedule', sessionId: 'other-tab-session', title: '다른 탭', prompt: '복습하자', repeat: 'once', nextRunAt: at, originAt: at, anchorDay: new Date(at).getDate(), enabled: true, createdAt: at, updatedAt: at });
  });
  await expect.poll(() => page.evaluate(async () => {
    const path = performance.getEntriesByType('resource').map((entry) => entry.name).find((name) => new URL(name).pathname === '/src/app/store.ts')!;
    const { db } = await import(path);
    const row = await db.schedules.get('other-tab-schedule');
    return !!row?.lastRunAt && !row?.lastError && !row?.enabled;
  })).toBe(true);
  expect(await page.evaluate(async () => {
    const path = performance.getEntriesByType('resource').map((entry) => entry.name).find((name) => new URL(name).pathname === '/src/app/store.ts')!;
    const { db } = await import(path);
    return (await db.messages.where('sessionId').equals('other-tab-session').toArray()).filter((m: { role: string }) => m.role === 'user').length;
  })).toBe(1);
  await other.close();
});
