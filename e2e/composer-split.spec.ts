import { expect, test, type Locator, type Page } from '@playwright/test';

/**
 * IMP-09: 사이드바에서 끌어 좌우·상하 분할, 입력창 + 메뉴(사진·파일 첨부·스킬), 붙여넣기 미리보기, 슬래시 스킬, 스킬 관리 페이지.
 * 응답은 e2e/mock-anthropic.mjs: 받은 이미지 수·첨부 텍스트 수·적용 스킬을 답에 적는다.
 */
const KEY = 'sk-ant-e2e-ok';
const LOCAL = '/?platform=desktop';
/** 1x1 PNG */
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64');

function collectErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
}

async function start(page: Page) {
  await page.goto(LOCAL);
  const onboarding = page.getByRole('dialog', { name: '시작하기' });
  await onboarding.getByRole('button', { name: /^API 키/ }).click();
  const input = page.getByLabel('Anthropic API 키');
  await input.fill(KEY);
  await input.press('Enter');
  await expect(page.getByRole('dialog')).toContainText('연결됨');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '새 학습 시작' }).click();
  return page.locator('[data-panel="main"]');
}

async function ask(main: Locator, text: string) {
  await main.getByLabel('메시지 입력').fill(text);
  await main.getByRole('button', { name: '보내기' }).click();
}

async function branchFrom(page: Page, needle: string) {
  const menu = page.getByRole('button', { name: '이게 뭐야?' });
  await expect(async () => {
    await page.evaluate((text) => {
      const roots = [...document.querySelectorAll('[data-panel="main"] [data-anchorable]')];
      const root = roots[roots.length - 1]!;
      const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let last: Text | null = null;
      for (let n = w.nextNode(); n; n = w.nextNode()) if ((n as Text).data.includes(text)) last = n as Text;
      if (!last) throw new Error(`선택할 텍스트 없음: ${text}`);
      const i = last.data.indexOf(text);
      const r = document.createRange();
      r.setStart(last, i);
      r.setEnd(last, i + text.length);
      getSelection()!.removeAllRanges();
      getSelection()!.addRange(r);
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    }, needle);
    await expect(menu).toBeVisible({ timeout: 500 });
  }).toPass();
  await menu.click();
  await expect(page.getByText(`마지막 문장 [${needle}].`).last()).toBeVisible();
}

/** 사이드바 행을 끌어 대상 패널의 (fx, fy) 비율 위치에 놓는다 (HTML5 끌어 놓기) */
async function dragSession(page: Page, source: Locator, target: Locator, fx: number, fy: number) {
  const s = (await source.boundingBox())!;
  await page.mouse.move(s.x + s.width / 2, s.y + s.height / 2);
  await page.mouse.down();
  await page.mouse.move(s.x + s.width / 2 + 24, s.y + s.height / 2 + 4, { steps: 4 });
  await expect(page.locator('[data-drop-zone]').first()).toBeAttached();
  const t = (await target.boundingBox())!;
  await page.mouse.move(t.x + t.width * fx, t.y + t.height * fy, { steps: 10 });
  await page.mouse.up();
}

/** 클립보드 붙여넣기 흉내: 텍스트 또는 파일 */
async function paste(input: Locator, data: { text?: string; png?: number[] }) {
  await input.evaluate((el, d) => {
    const dt = new DataTransfer();
    if (d.text) dt.setData('text/plain', d.text);
    if (d.png) dt.items.add(new File([new Uint8Array(d.png)], 'clip.png', { type: 'image/png' }));
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  }, data);
}

test('사이드바에서 끌어 좌우·상하로 나누고, 마인드맵을 오가도 배치가 유지된다', async ({ page }, info) => {
  test.skip(info.project.name === 'mobile', '모바일은 분할 대신 탭');
  const errors = collectErrors(page);
  const main = await start(page);
  await ask(main, '어텐션을 설명해줘');
  await expect(main.getByText('마지막 문장 [어텐션을 설명해줘].')).toBeVisible();
  await branchFrom(page, '가중합');
  await branchFrom(page, '소프트맥스');
  // 가지 팝업은 닫아 둔다
  const popupClose = page.getByRole('dialog', { name: '가지 팝업' }).getByRole('button', { name: '닫기', exact: true });
  while ((await popupClose.count()) > 0) await popupClose.last().click();

  const nav = page.getByRole('navigation', { name: '학습 세션' });
  const rows = nav.locator('li > button[data-session-row]');
  await expect(rows).toHaveCount(2);
  const [a, b] = await Promise.all([rows.nth(0).getAttribute('data-session-row'), rows.nth(1).getAttribute('data-session-row')]);

  // 단일 보기 오른쪽 가장자리 → 좌우 분할
  await dragSession(page, rows.nth(0), page.locator('main [data-split-pane]').first(), 0.95, 0.5);
  await expect(page.locator('[data-split-pane]')).toHaveCount(2);
  // 오른쪽 패널 아래 가장자리 → 상하 분할
  await dragSession(page, rows.nth(1), page.locator(`[data-split-pane="${a}"]`), 0.5, 0.95);
  await expect(page.locator('[data-split-pane]')).toHaveCount(3);
  const boxA = (await page.locator(`[data-split-pane="${a}"]`).boundingBox())!;
  const boxB = (await page.locator(`[data-split-pane="${b}"]`).boundingBox())!;
  expect(Math.abs(boxA.x - boxB.x)).toBeLessThan(2);
  expect(boxB.y).toBeGreaterThan(boxA.y + boxA.height / 2);

  // 마인드맵 → 다시 끄면 분할 그대로
  const mindmap = page.getByRole('banner').getByRole('button', { name: '마인드맵' });
  await mindmap.click();
  await expect(page.locator('.react-flow__node').first()).toBeVisible();
  await mindmap.click();
  await expect(page.locator('[data-split-pane]')).toHaveCount(3);

  // 새로고침 후에도 배치 유지
  await page.reload();
  await expect(page.locator('[data-split-pane]')).toHaveCount(3);
  // 패널 닫기 → 둘 남으면 분할, 하나 남으면 단일
  await page.locator(`[data-split-pane="${b}"]`).getByRole('button', { name: '패널 닫기' }).click();
  await expect(page.locator('[data-split-pane]')).toHaveCount(2);
  await page.locator(`[data-split-pane="${a}"]`).getByRole('button', { name: '패널 닫기' }).click();
  await expect(page.locator('[data-panel="main"]')).toBeVisible();
  expect(errors).toEqual([]);
});

test('+ 메뉴로 사진·파일 첨부, 붙여넣은 이미지·긴 텍스트는 입력창 위 미리보기로', async ({ page }) => {
  const errors = collectErrors(page);
  const main = await start(page);
  const input = main.getByLabel('메시지 입력');

  await main.getByRole('button', { name: '첨부·스킬' }).click();
  await expect(page.getByRole('menuitem', { name: '사진 첨부' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: '파일 첨부' })).toBeVisible();
  await page.keyboard.press('Escape');

  await main.getByTestId('file-input').setInputFiles([
    { name: 'notes.md', mimeType: 'text/markdown', buffer: Buffer.from('# 메모\n가중합 정리') },
    { name: 'dot.png', mimeType: 'image/png', buffer: PNG },
  ]);
  await expect(main.locator('form [data-attachment]')).toHaveCount(2);
  await main.getByTestId('file-input').setInputFiles([{ name: 'app.exe', mimeType: 'application/octet-stream', buffer: Buffer.from('MZ') }]);
  await expect(page.getByText(/첨부할 수 없는 형식/)).toBeVisible();

  // 짧은 붙여넣기는 그대로 입력, 긴 텍스트·이미지는 첨부 미리보기
  await paste(input, { text: 'x'.repeat(1500) });
  await paste(input, { png: [...PNG] });
  await expect(main.locator('form [data-attachment]')).toHaveCount(4);
  await expect(main.locator('form [data-attachment="text"]').filter({ hasText: '붙여넣은 텍스트' })).toBeVisible();
  await expect(input).toHaveValue('');
  await main.getByRole('button', { name: 'dot.png 첨부 빼기' }).click();
  await expect(main.locator('form [data-attachment]')).toHaveCount(3);

  // 붙여넣은 텍스트 미리보기 열기
  await main.locator('form [data-attachment="text"]').filter({ hasText: '붙여넣은 텍스트' }).getByRole('button').first().click();
  await expect(page.getByRole('dialog', { name: '붙여넣은 텍스트' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: '붙여넣은 텍스트' })).toBeHidden();

  await ask(main, '첨부 확인해줘');
  await expect(main.getByText('이미지 1개를 받았다. 첨부 텍스트 2개를 읽었다.')).toBeVisible();
  await expect(main.locator('[data-turn] [data-attachment]')).toHaveCount(3);
  await expect(main.locator('form [data-attachment]')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('슬래시·+ 메뉴로 스킬을 고르고, 스킬 관리 페이지에서 새 스킬을 만든다', async ({ page }) => {
  const errors = collectErrors(page);
  const main = await start(page);
  const input = main.getByLabel('메시지 입력');

  // 예시 스킬(커리큘럼 생성)이 기본으로 있다: /cur → Enter로 고르기
  await input.fill('/cur');
  const list = page.getByRole('listbox', { name: '스킬' });
  await expect(list.getByRole('option', { name: /커리큘럼 생성/ })).toBeVisible();
  await input.press('Enter');
  await expect(main.locator('[data-skill-chip="curriculum"]')).toBeVisible();
  await expect(input).toHaveValue('');
  await ask(main, '러스트 입문');
  await expect(main.getByText('스킬 /curriculum 적용.')).toBeVisible();
  await expect(main.locator('[data-skill-badge="curriculum"]')).toBeVisible();
  await expect(main.locator('[data-skill-chip]')).toHaveCount(0);

  // 다음 질문에는 스킬이 붙지 않는다
  await ask(main, '고마워');
  await expect(main.getByText('마지막 문장 [고마워].')).toBeVisible();
  await expect(main.getByText('스킬 /curriculum 적용.')).toHaveCount(1);

  // + › 스킬 관리… → 새 스킬
  await main.getByRole('button', { name: '첨부·스킬' }).click();
  await page.getByRole('menuitem', { name: '스킬 관리…' }).click();
  const skills = page.getByRole('dialog', { name: '스킬 관리' });
  await expect(skills.locator('[data-skill-row="curriculum"]')).toBeVisible();
  await skills.getByRole('button', { name: '새 스킬' }).click();
  await skills.getByLabel('명령 이름').fill('Quiz Me');
  await skills.getByLabel('제목').fill('퀴즈');
  await skills.getByLabel('지시').fill('세 문제짜리 퀴즈를 낸다.');
  await skills.getByRole('button', { name: '저장' }).click();
  await expect(skills.locator('[data-skill-row="quiz-me"]')).toBeVisible();
  // 같은 이름은 거부 (모바일은 편집 화면에서 목록으로 돌아가야 '새 스킬'이 보인다)
  if (!(await skills.getByRole('button', { name: '새 스킬' }).isVisible())) await skills.getByRole('button', { name: '스킬 목록' }).click();
  await skills.getByRole('button', { name: '새 스킬' }).click();
  await skills.getByLabel('명령 이름').fill('curriculum');
  await skills.getByLabel('제목').fill('중복');
  await skills.getByLabel('지시').fill('x');
  await skills.getByRole('button', { name: '저장' }).click();
  await expect(skills.getByRole('alert')).toContainText('이미 있어요');
  await skills.getByLabel('명령 이름').fill('');
  await skills.getByLabel('제목').fill('');
  await skills.getByLabel('지시').fill('');
  await page.keyboard.press('Escape');
  await expect(skills).toBeHidden();

  // `/명령 나머지`로 바로 보내기
  await input.fill('/quiz-me 광합성');
  await main.getByRole('button', { name: '보내기' }).click();
  await expect(main.getByText('스킬 /quiz-me 적용.')).toBeVisible();
  await expect(main.getByText('마지막 문장 [광합성].')).toBeVisible();
  expect(errors).toEqual([]);
});
