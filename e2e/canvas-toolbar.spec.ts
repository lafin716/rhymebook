import { expect, test, type Page } from '@playwright/test';

/**
 * 캔버스 도구 막대 (ADR-088): 발표·전체 보기·가져오기 순서, 전체 보기에서 제목 숨김,
 * 팔레트 접기/펼치기·한 번에 보일 색 개수, 핸들로 동서남북 가장자리에 붙이기, 맞춤 상태에서 한 축만 밀기.
 */
const MAIN = '[data-panel="main"]';

function collectErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
}

async function onboard(page: Page) {
  await page.goto('/?platform=desktop');
  const onboarding = page.getByRole('dialog', { name: '시작하기' });
  await onboarding.getByRole('button', { name: /^API 키/ }).click();
  const input = page.getByLabel('Anthropic API 키');
  await input.fill('sk-ant-e2e-ok');
  await input.press('Enter');
  await page.keyboard.press('Escape');
}

async function newCanvas(page: Page, mobile: boolean) {
  if (mobile) await page.getByRole('button', { name: '세션 목록', exact: true }).click();
  await page.getByRole('button', { name: '새로 만들기' }).click();
  await page.locator(MAIN).getByRole('button', { name: '캔버스로 시작' }).click();
  await expect(page.getByLabel('캔버스 그림판')).toBeVisible();
}

test('발표 · 전체 보기 · 가져오기 순서, 전체 보기에서 제목 숨김과 Esc로 끝내기', async ({ page }, info) => {
  const errors = collectErrors(page);
  await onboard(page);
  await newCanvas(page, info.project.name === 'mobile');
  const toolbar = page.getByRole('toolbar', { name: '캔버스 도구' });

  // 버튼 순서: 발표 → 전체 화면 → 가져오기
  const order = await toolbar.locator('[data-canvas-present], [data-panel-full], [data-canvas-import]').evaluateAll((els) =>
    els.map((e) => (e.hasAttribute('data-canvas-present') ? 'present' : e.hasAttribute('data-panel-full') ? 'full' : 'import')),
  );
  expect(order).toEqual(['present', 'full', 'import']);

  const header = page.locator(`${MAIN} header`).first();
  await expect(header).toBeVisible();
  await toolbar.getByRole('button', { name: '전체 화면', exact: true }).click();
  await expect(page.getByRole('button', { name: '마인드맵' })).toHaveCount(0);
  await expect(page.locator(`${MAIN} header`)).toHaveCount(0);
  await expect(page.getByLabel('캔버스 그림판')).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: '마인드맵' })).toBeVisible();
  await expect(toolbar.getByRole('button', { name: '전체 화면', exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test('팔레트 접기/펼치기 · 한 번에 보일 색 개수 · 넘친 색은 더 많은 색에서 · 새로고침 후 유지', async ({ page }, info) => {
  const errors = collectErrors(page);
  await onboard(page);
  await newCanvas(page, info.project.name === 'mobile');
  const colors = page.getByRole('group', { name: '색' });

  // 기본은 7색 모두 보이고 '더 많은 색'은 없다
  await expect(colors.locator('[data-canvas-ink]')).toHaveCount(7);
  await expect(colors.getByRole('button', { name: '더 많은 색' })).toHaveCount(0);

  // 접으면 색이 숨고 다시 펼치면 돌아온다
  await colors.getByRole('button', { name: '색 팔레트 접기' }).click();
  await expect(colors.locator('[data-canvas-ink]')).toHaveCount(0);
  await colors.getByRole('button', { name: '색 팔레트 펼치기' }).click();
  await expect(colors.locator('[data-canvas-ink]')).toHaveCount(7);

  // 설정에서 3개로 줄이면 나머지는 '더 많은 색'에
  await page.getByRole('button', { name: '캔버스 설정' }).click();
  const settings = page.getByRole('dialog', { name: '캔버스 설정' });
  await settings.getByLabel('팔레트 색 개수').fill('3');
  await expect(settings.locator('[data-palette-count]')).toHaveText('3 / 7');
  await page.keyboard.press('Escape');
  await expect(colors.locator('[data-canvas-ink]')).toHaveCount(3);
  await colors.getByRole('button', { name: '더 많은 색' }).click();
  const more = page.getByRole('dialog', { name: '더 많은 색' });
  await expect(more.locator('[data-canvas-ink]')).toHaveCount(4);

  // 넘친 색을 고르면 팔레트에 함께 보인다
  await more.getByRole('button', { name: '보라 색' }).click();
  await expect(colors.getByRole('button', { name: '보라 색' })).toHaveAttribute('aria-pressed', 'true');
  await expect(colors.locator('[data-canvas-ink]')).toHaveCount(4);

  // 접힘·개수는 새로고침 뒤에도 남는다
  await colors.getByRole('button', { name: '색 팔레트 접기' }).click();
  await page.reload();
  const colorsAfter = page.getByRole('group', { name: '색' });
  await expect(colorsAfter.getByRole('button', { name: '색 팔레트 펼치기' })).toBeVisible();
  await colorsAfter.getByRole('button', { name: '색 팔레트 펼치기' }).click();
  await expect(colorsAfter.locator('[data-canvas-ink]')).toHaveCount(3);
  expect(errors).toEqual([]);
});

test('핸들로 도구 막대를 끌면 가장 가까운 가장자리(동서남북)에 붙고 새로고침 후 유지', async ({ page }, info) => {
  const errors = collectErrors(page);
  await onboard(page);
  await newCanvas(page, info.project.name === 'mobile');
  const toolbar = page.locator('[data-canvas-toolbar]');
  const handle = page.getByRole('button', { name: '도구 막대 위치 변경' });
  await expect(toolbar).toHaveAttribute('data-dock', 'top');

  const panel = (await page.locator('[data-canvas]').boundingBox())!;
  const dragTo = async (x: number, y: number) => {
    const h = (await handle.boundingBox())!;
    await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
    await page.mouse.down();
    await page.mouse.move(x, y, { steps: 10 });
    await expect(page.locator('[data-canvas-dock-preview]')).toHaveCount(1);
    await page.mouse.up();
    await expect(page.locator('[data-canvas-dock-preview]')).toHaveCount(0);
  };
  const midX = panel.x + panel.width / 2;
  const midY = panel.y + panel.height / 2;

  await dragTo(panel.x + 5, midY);
  await expect(toolbar).toHaveAttribute('data-dock', 'left');
  const left = (await toolbar.boundingBox())!;
  expect(left.x - panel.x).toBeLessThan(2);
  expect(left.height).toBeGreaterThan(left.width);

  await dragTo(midX, panel.y + panel.height - 5);
  await expect(toolbar).toHaveAttribute('data-dock', 'bottom');
  const bottom = (await toolbar.boundingBox())!;
  expect(panel.y + panel.height - (bottom.y + bottom.height)).toBeLessThan(2);

  await dragTo(panel.x + panel.width - 5, midY);
  await expect(toolbar).toHaveAttribute('data-dock', 'right');
  const right = (await toolbar.boundingBox())!;
  expect(panel.x + panel.width - (right.x + right.width)).toBeLessThan(2);

  await page.reload();
  await expect(page.locator('[data-canvas-toolbar]')).toHaveAttribute('data-dock', 'right');
  await dragTo(midX, panel.y + 5);
  await expect(page.locator('[data-canvas-toolbar]')).toHaveAttribute('data-dock', 'top');
  expect(errors).toEqual([]);
});

test('가로형 쪽이 화면에 맞춰져 있으면 위아래로 밀어도 판이 움직이지 않는다', async ({ page }, info) => {
  const errors = collectErrors(page);
  await onboard(page);
  await newCanvas(page, info.project.name === 'mobile');
  await page.getByRole('button', { name: '캔버스 설정' }).click();
  await page.getByRole('dialog', { name: '캔버스 설정' }).getByRole('radio', { name: /가로형 16:9/ }).click();
  const board = page.getByLabel('캔버스 그림판');
  const sheet = board.locator('[data-canvas-page]').first();
  await expect(sheet).toBeVisible();
  if (await page.getByRole('dialog', { name: '캔버스 설정' }).isVisible()) await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: '캔버스 설정' })).toHaveCount(0);
  await page.getByRole('button', { name: '선택/이동' }).click();
  // 맞춤 애니메이션이 끝날 때까지 기다린다
  let last = -1;
  await expect
    .poll(async () => {
      const y = (await sheet.boundingBox())!.y;
      const still = Math.abs(y - last) < 0.5;
      last = y;
      return still;
    })
    .toBe(true);

  const before = (await sheet.boundingBox())!;
  const r = (await board.boundingBox())!;
  await page.mouse.move(r.x + r.width / 2, r.y + r.height * 0.3);
  await page.mouse.down();
  await page.mouse.move(r.x + r.width / 2 + 30, r.y + r.height * 0.8, { steps: 8 });
  // 손을 떼기 전(되돌림 애니메이션 전): 위아래는 그대로, 좌우만 따라 움직인다
  const during = (await sheet.boundingBox())!;
  expect(Math.abs(during.y - before.y)).toBeLessThan(2);
  expect(during.x - before.x).toBeGreaterThan(20);
  await page.mouse.up();
  await expect(page.getByRole('navigation', { name: '쪽 넘김' })).toContainText('1 / 1');
  expect(errors).toEqual([]);
});

test('세로 막대에서는 팔레트도 세로로 쌓이고 토글은 맨 아래 · 가로에서는 맨 오른쪽 (ADR-092)', async ({ page }, info) => {
  const errors = collectErrors(page);
  await onboard(page);
  await newCanvas(page, info.project.name === 'mobile');
  const colors = page.getByRole('group', { name: '색' });
  const toggle = colors.locator('[data-canvas-palette-toggle]');
  const custom = colors.locator('[data-canvas-color-custom]');
  const inks = colors.locator('[data-canvas-ink]');

  // 가로: 색들 → 직접 고르기 → 토글 순으로 오른쪽으로
  await expect(inks).toHaveCount(7);
  const lastInk = (await inks.last().boundingBox())!;
  expect((await custom.boundingBox())!.x).toBeGreaterThan(lastInk.x);
  expect((await toggle.boundingBox())!.x).toBeGreaterThan((await custom.boundingBox())!.x);

  // 가로 막대의 구분선은 버튼 높이 가운데에 (위로 치우치지 않음)
  const custBox = (await custom.boundingBox())!;
  for (const sep of await page.locator('[data-canvas-toolbar] > span[aria-hidden]').all()) {
    const s = (await sep.boundingBox())!;
    expect(Math.abs(s.y + s.height / 2 - (custBox.y + custBox.height / 2))).toBeLessThan(3);
  }

  // 왼쪽에 붙이면 세로로 쌓인다
  const panel = (await page.locator('[data-canvas]').boundingBox())!;
  const handle = page.getByRole('button', { name: '도구 막대 위치 변경' });
  const h = (await handle.boundingBox())!;
  await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
  await page.mouse.down();
  await page.mouse.move(panel.x + 5, panel.y + panel.height / 2, { steps: 10 });
  await page.mouse.up();
  await expect(page.locator('[data-canvas-toolbar]')).toHaveAttribute('data-dock', 'left');

  const first = (await inks.first().boundingBox())!;
  const second = (await inks.nth(1).boundingBox())!;
  expect(Math.abs(first.x - second.x)).toBeLessThan(2);
  expect(second.y).toBeGreaterThan(first.y);
  const ty = (await toggle.boundingBox())!.y;
  expect(ty).toBeGreaterThan((await custom.boundingBox())!.y);
  expect(ty).toBeGreaterThan((await inks.last().boundingBox())!.y);
  // 팔레트가 막대 밖으로 삐져나가지 않는다
  const bar = (await page.locator('[data-canvas-toolbar]').boundingBox())!;
  const group = (await colors.boundingBox())!;
  expect(group.x).toBeGreaterThanOrEqual(bar.x - 1);
  expect(group.x + group.width).toBeLessThanOrEqual(bar.x + bar.width + 1);
  // 막대는 버튼 한 줄 너비 — 글자 버튼(가져오기)도 아이콘만 남아 넓히지 않는다
  expect(bar.width).toBeLessThan(72);
  // 구분선은 막대 가운데에
  for (const sep of await page.locator('[data-canvas-toolbar] > span[aria-hidden]').all()) {
    const s = (await sep.boundingBox())!;
    expect(Math.abs(s.x + s.width / 2 - (bar.x + bar.width / 2))).toBeLessThan(3);
  }

  // 접고 펼치기도 그대로
  await toggle.click();
  await expect(inks).toHaveCount(0);
  await expect(toggle).toHaveAttribute('aria-label', '색 팔레트 펼치기');
  await toggle.click();
  await expect(inks).toHaveCount(7);
  expect(errors).toEqual([]);
});

test('색 직접 고르기: 채도·명도 판과 색상 띠로 고르고 처음 색으로 되돌리기 (ADR-092)', async ({ page }, info) => {
  const errors = collectErrors(page);
  await onboard(page);
  await newCanvas(page, info.project.name === 'mobile');
  await page.locator('[data-canvas-color-custom]').click();
  const editor = page.locator('[data-canvas-color-editor]');
  const code = editor.getByLabel('색 코드');
  const before = await code.inputValue();

  // 끌다가 판·띠 밖으로 나가도 끝에 붙는다: 색상 띠 왼쪽 끝 = 빨강, 판 오른쪽 위 = 채도·명도 100%
  const drag = async (sel: string, toX: (b: { x: number; width: number }) => number, toY: (b: { y: number; height: number }) => number) => {
    const box = (await editor.locator(sel).boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(toX(box), toY(box), { steps: 5 });
    await page.mouse.up();
  };
  await drag('[data-canvas-color-hue]', (b) => b.x - 30, (b) => b.y);
  await drag('[data-canvas-color-sv]', (b) => b.x + b.width + 30, (b) => b.y - 30);
  await expect(code).toHaveValue('#ff0000');
  await expect(editor.getByLabel('R 값')).toHaveValue('255');

  // 색상 띠 1/3 지점 = 초록
  const hue = (await editor.locator('[data-canvas-color-hue]').boundingBox())!;
  await page.mouse.click(hue.x + hue.width / 3, hue.y + hue.height / 2);
  await expect(code).toHaveValue('#00ff00');

  // RGB 칸으로도 바꿀 수 있다
  await editor.getByLabel('B 값').fill('255');
  await expect(code).toHaveValue(/ff$/);

  await editor.getByRole('button', { name: /^처음 색/ }).click();
  await expect(code).toHaveValue(before);
  expect(errors).toEqual([]);
});

test('설정: 두 손가락 두 번 톡 동작을 고르면 새로고침 후에도 남는다 (ADR-092)', async ({ page }, info) => {
  const errors = collectErrors(page);
  await onboard(page);
  await newCanvas(page, info.project.name === 'mobile');
  await page.getByRole('button', { name: '캔버스 설정' }).click();
  const settings = page.getByRole('dialog', { name: '캔버스 설정' });
  const group = settings.getByRole('radiogroup', { name: '두 손가락으로 두 번 톡' });
  await expect(group.locator('[data-two-finger-tap="select-pen"]')).toHaveAttribute('aria-checked', 'true');
  await group.locator('[data-two-finger-tap="undo"]').click();
  await expect(group.locator('[data-two-finger-tap="undo"]')).toHaveAttribute('aria-checked', 'true');
  await page.reload();
  await page.getByRole('button', { name: '캔버스 설정' }).click();
  await expect(
    page.getByRole('dialog', { name: '캔버스 설정' }).locator('[data-two-finger-tap="undo"]'),
  ).toHaveAttribute('aria-checked', 'true');
  expect(errors).toEqual([]);
});

test('스포이드: 화면 스포이드가 없으면 판을 눌러 획·바탕 색을 따오고, RGB 칸은 색 창 안에 들어온다', async ({ page }, info) => {
  const errors = collectErrors(page);
  // 안드로이드·사파리처럼 EyeDropper가 없는 브라우저
  await page.addInitScript(() => {
    delete (window as { EyeDropper?: unknown }).EyeDropper;
  });
  await onboard(page);
  await newCanvas(page, info.project.name === 'mobile');
  await expect(page.getByRole('button', { name: '가져오기' })).not.toContainText('가져오기');

  const board = (await page.getByLabel('캔버스 그림판').boundingBox())!;
  const y = board.y + board.height / 2;
  await page.mouse.move(board.x + 40, y);
  await page.mouse.down();
  await page.mouse.move(board.x + 160, y, { steps: 8 });
  await page.mouse.up();

  const custom = page.locator('[data-canvas-color-custom]');
  const editor = page.locator('[data-canvas-color-editor]');
  const code = editor.getByLabel('색 코드');
  await custom.click();
  const ink = await code.inputValue();
  // RGB 칸이 색 창 밖으로 넘치지 않는다
  const box = (await editor.boundingBox())!;
  for (const name of ['R 값', 'G 값', 'B 값']) {
    const f = (await editor.getByLabel(name).boundingBox())!;
    expect(f.x).toBeGreaterThanOrEqual(box.x);
    expect(f.x + f.width).toBeLessThanOrEqual(box.x + box.width + 0.5);
  }
  await code.fill('#ff0000');
  await code.press('Enter');
  await expect(code).toHaveValue('#ff0000');

  // 획 위를 누르면 그 획 색
  await editor.getByRole('button', { name: '화면에서 색 따오기' }).click();
  await expect(page.getByText('판을 눌러 색을 따오세요')).toBeVisible();
  await page.mouse.click(board.x + 100, y);
  await expect(page.getByText('판을 눌러 색을 따오세요')).toBeHidden();
  await custom.click();
  await expect(code).toHaveValue(ink);

  // 빈 곳은 바탕색, Esc로 그만둘 수 있다
  await editor.getByRole('button', { name: '화면에서 색 따오기' }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByText('판을 눌러 색을 따오세요')).toBeHidden();
  await custom.click();
  await editor.getByRole('button', { name: '화면에서 색 따오기' }).click();
  await page.mouse.click(board.x + 100, board.y + board.height * 0.8);
  await custom.click();
  await expect(code).toHaveValue('#fbf9f4');
  expect(errors).toEqual([]);
});
