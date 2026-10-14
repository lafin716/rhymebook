import { _electron, expect, test, type Page } from '@playwright/test';
import { mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const SVG = '<svg viewBox="0 0 640 240" onload="window.__svgScript = true"><script>window.__svgScript = true</script><rect width="640" height="240" rx="16" fill="#eef2ff"/><circle cx="130" cy="120" r="65" fill="#6366f1"/><text x="230" y="132" font-size="30" fill="#312e81">SVG 이미지 &amp; 코드</text></svg>';
const ANSWER = ['이미지 예시입니다.', '', '```svg', SVG, '```', '', '이미지 뒤 선택 문장.', '', '```xml', '<svg><broken></svg>', '```'].join('\n');
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,OPTIONS' };

async function mock(page: Page, answer = ANSWER) {
  await page.route('**/v1/models**', (route) => route.fulfill({ contentType: 'application/json', body: '{"data":[]}', headers: CORS }));
  await page.route('**/v1/messages', async (route) => {
    const body = route.request().postDataJSON() as { system?: string };
    const text = body.system?.startsWith('다음 대화의 주제') ? 'SVG 학습' : answer;
    const events = [
      { type: 'message_start', message: {} },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } },
      { type: 'message_delta', delta: { stop_reason: 'end_turn' } },
      { type: 'message_stop' },
    ];
    await route.fulfill({ contentType: 'text/event-stream', headers: CORS, body: events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join('') });
  });
}

async function start(page: Page, onboarding = true) {
  if (onboarding) {
    await page.getByRole('dialog', { name: '시작하기' }).getByRole('button', { name: /^API 키/ }).click();
  } else {
    // 실제 PC에서는 준비된 CLI가 있으면 첫 실행 안내가 자동으로 생략된다.
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: '설정', exact: true }).click();
  }
  await page.getByLabel('Anthropic API 키').fill('sk-ant-e2e-ok');
  await page.getByLabel('Anthropic API 키').press('Enter');
  if (!onboarding) {
    await expect(page.getByLabel('Anthropic API 키')).toHaveValue('');
    const settings = page.getByRole('dialog', { name: '설정', exact: true });
    await settings.getByRole('tab', { name: '일반' }).click();
    await settings.getByRole('combobox').first().selectOption('anthropic-api');
  }
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '새 학습 시작' }).click();
  const main = page.locator('[data-panel="main"]');
  await main.getByLabel('메시지 입력').fill('SVG를 그려줘');
  await main.getByRole('button', { name: '보내기' }).click();
  await expect(main.getByText('이미지 뒤 선택 문장.')).toBeVisible();
  return main;
}

async function verifyImage(page: Page) {
  const main = page.locator('[data-panel="main"]');
  const image = main.getByRole('img', { name: 'SVG 이미지' });
  await expect(image).toHaveCount(1);
  await expect(image).toBeVisible();
  await expect.poll(() => image.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true);
  expect(await image.evaluate((el) => el.getBoundingClientRect().right <= window.innerWidth)).toBe(true);
  expect(await page.evaluate(() => (window as unknown as { __svgScript?: boolean }).__svgScript)).toBeUndefined();
  // 잘못된 XML은 이미지 로드 실패 시 원본 코드로 복귀한다.
  await expect(main.locator('pre').filter({ hasText: '<svg><broken></svg>' })).toBeVisible();
  const preview = main.locator('[data-svg-preview]');
  await expect(preview.locator('pre')).toBeHidden();
  await preview.locator('summary').click();
  await expect(preview.locator('pre')).toBeVisible();
  await expect(preview.locator('pre')).toContainText('SVG 이미지 &amp; 코드');
  await preview.locator('summary').click();
}

test('SVG 이미지·코드 펼침·깨진 XML 복귀·새로고침·이미지 뒤 가지 선택', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await mock(page);
  await page.goto('/?platform=desktop');
  await start(page);
  await verifyImage(page);
  await page.screenshot({ path: testInfo.outputPath('svg-preview.png') });
  await page.reload();
  await verifyImage(page);
  await expect(async () => {
    await page.evaluate(() => {
      const root = document.querySelector('[data-panel="main"] [data-anchorable]')!;
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const at = node.textContent?.indexOf('이미지 뒤 선택 문장') ?? -1;
        if (at < 0) continue;
        const range = document.createRange();
        range.setStart(node, at);
        range.setEnd(node, at + '이미지 뒤 선택 문장'.length);
        getSelection()!.removeAllRanges();
        getSelection()!.addRange(range);
        document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
        break;
      }
    });
    await expect(page.getByRole('button', { name: '이게 뭐야?' })).toBeVisible({ timeout: 500 });
  }).toPass();
  await page.getByRole('button', { name: '이게 뭐야?' }).click();
  await expect(page.locator('[data-panel="main"] mark.anchor')).toHaveText('이미지 뒤 선택 문장');
  expect(errors).toEqual([]);
});

test('빈 줄·중첩·수식 기호가 있는 단독 SVG도 이미지로 표시한다', async ({ page }) => {
  const raw = '<svg viewBox="0 0 320 120">\n\n<rect width="320" height="120" fill="#eef2ff"/>\n\n<svg><text x="10" y="65">\\(hello\\)</text></svg>\n\n</svg>';
  await mock(page, raw + '\n\n이미지 뒤 선택 문장.');
  await page.goto('/?platform=desktop');
  const main = await start(page);
  const image = main.getByRole('img', { name: 'SVG 이미지' });
  await expect.poll(() => image.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true);
  await main.locator('summary').click();
  await expect(main.locator('pre')).toHaveText(raw);
});

test('Windows 패키지 앱 SVG smoke', async ({ browserName }, testInfo) => {
  test.skip(process.env.RHYMEBOOK_PACKAGED !== '1' || testInfo.project.name !== 'desktop' || browserName !== 'chromium', '패키징 후 RHYMEBOOK_PACKAGED=1로 실행');
  const userData = await mkdtemp(path.join(os.tmpdir(), 'rhymebook-svg-'));
  const app = await _electron.launch({
    executablePath: path.resolve(process.env.RHYMEBOOK_EXE ?? 'apps/desktop/release/win-unpacked/rhymebook.exe'),
    env: { ...process.env, BRANCH_USER_DATA: userData },
  });
  try {
    const page = await app.firstWindow();
    page.on('pageerror', (error) => console.log(`packaged renderer: ${error.message}`));
    page.on('console', (message) => { if (message.type() === 'error') console.log(`packaged console: ${message.text()}`); });
    await mock(page);
    await page.reload();
    await expect(page.locator('#root')).not.toBeEmpty();
    await start(page, false);
    await verifyImage(page);
    await page.screenshot({ path: testInfo.outputPath('svg-packaged.png') });
  } finally {
    await app.close();
  }
});
