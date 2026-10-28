import { expect, test, type Locator, type Page } from '@playwright/test';

/**
 * 캔버스 (ADR-079): 새로 만들기 → 캔버스 → 펜으로 쓰기 → 페이지 내용 가져오기 → 그 위에 쓰기 → 실행 취소 → 새로고침 후 유지.
 */
const KEY = 'sk-ant-e2e-ok';
const LOCAL = '/?platform=desktop';
const MAIN = '[data-panel="main"]';

function collectErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
}

/** 마우스로 board 위 (fx, fy) 비율 위치에서 오른쪽 아래로 한 획 긋는다 */
async function stroke(page: Page, board: Locator, fx: number, fy: number) {
  const r = (await board.boundingBox())!;
  const x = r.x + r.width * fx;
  const y = r.y + r.height * fy;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 40, y + 10, { steps: 5 });
  await page.mouse.move(x + 80, y + 30, { steps: 5 });
  await page.mouse.up();
}

async function onboard(page: Page) {
  await page.goto(LOCAL);
  const onboarding = page.getByRole('dialog', { name: '시작하기' });
  await onboarding.getByRole('button', { name: /^API 키/ }).click();
  const input = page.getByLabel('Anthropic API 키');
  await input.fill(KEY);
  await input.press('Enter');
  await page.keyboard.press('Escape');
}

test('캔버스: 펜 필기 · 페이지 내용 가져오기 · 그 위에 쓰기 · 실행 취소 · 새로고침 후 유지', async ({ page }, info) => {
  const errors = collectErrors(page);
  const mobile = info.project.name === 'mobile';
  await onboard(page);
  const main = page.locator(MAIN);

  // 가져올 페이지를 먼저 만든다
  await page.getByRole('button', { name: '빈 페이지' }).click();
  await main.getByLabel('페이지 본문 (마크다운)').fill('# 어텐션 노트\n\n쿼리와 키를 비교한다.');
  await main.getByRole('button', { name: '완료' }).click();
  await expect(main.getByRole('heading', { name: '어텐션 노트' })).toBeVisible();

  // 새로 만들기 → 캔버스로 시작
  if (mobile) await page.getByRole('button', { name: '세션 목록', exact: true }).click();
  await page.getByRole('button', { name: '새로 만들기' }).click();
  await main.getByRole('button', { name: '캔버스로 시작' }).click();
  await expect(page.locator('[data-canvas]')).toBeVisible();
  await expect(main.getByLabel('메시지 입력')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '펜', exact: true })).toHaveAttribute('aria-pressed', 'true');

  const board = page.getByLabel('캔버스 그림판');
  const strokes = board.locator('svg path');
  await stroke(page, board, 0.6, 0.15);
  await expect(strokes).toHaveCount(1);

  // 페이지 내용을 글 카드로 가져오기
  await page.getByRole('button', { name: '가져오기' }).click();
  await page.locator('[data-canvas-import-source="page"]').click();
  const picker = page.getByRole('dialog', { name: '페이지 내용 가져오기' });
  await picker.locator('[data-canvas-import-picker] button').first().click();
  await expect(picker).toHaveCount(0);
  const card = board.locator('[data-canvas-item]');
  await expect(card).toHaveCount(1);
  await expect(card).toContainText('쿼리와 키를 비교한다');
  // 가져온 직후에는 선택 도구로 바뀌고 가져온 카드가 골라져 있다
  await expect(page.getByRole('button', { name: '선택/이동' })).toHaveAttribute('aria-pressed', 'true');
  await expect(card).toHaveAttribute('data-selected', 'true');

  // 펜을 고르면 카드 선택이 풀린다. 카드 위에 쓰기
  await page.getByRole('button', { name: '펜', exact: true }).click();
  await expect(card).not.toHaveAttribute('data-selected', 'true');
  const cr = (await card.boundingBox())!;
  const br = (await board.boundingBox())!;
  await stroke(page, board, (cr.x + cr.width * 0.2 - br.x) / br.width, (cr.y + cr.height * 0.5 - br.y) / br.height);
  await expect(strokes).toHaveCount(2);

  await page.getByRole('button', { name: '실행 취소' }).click();
  await expect(strokes).toHaveCount(1);
  await page.getByRole('button', { name: '다시 실행' }).click();
  await expect(strokes).toHaveCount(2);

  // 저장(0.5초 지연) 뒤 새로고침해도 남는다
  await page.waitForTimeout(1200);
  await page.reload();
  const after = page.getByLabel('캔버스 그림판');
  await expect(after.locator('svg path')).toHaveCount(2);
  await expect(after.locator('[data-canvas-item]')).toContainText('쿼리와 키를 비교한다');
  expect(errors).toEqual([]);
});

test('캔버스 설정: 가로형 쪽 나눔 · 새 쪽 · 옆으로/위아래로 밀어 쪽 넘기기 · 새로고침 후 유지', async ({ page }, info) => {
  const errors = collectErrors(page);
  const mobile = info.project.name === 'mobile';
  await onboard(page);
  const main = page.locator(MAIN);

  if (mobile) await page.getByRole('button', { name: '세션 목록', exact: true }).click();
  await page.getByRole('button', { name: '새로 만들기' }).click();
  await main.getByRole('button', { name: '캔버스로 시작' }).click();
  const board = page.getByLabel('캔버스 그림판');
  await expect(board).toBeVisible();
  await expect(board.locator('[data-canvas-page]')).toHaveCount(0);

  await page.getByRole('button', { name: '캔버스 설정' }).click();
  const settings = page.getByRole('dialog', { name: '캔버스 설정' });
  await expect(settings.getByRole('radio', { name: /자유/ })).toHaveAttribute('aria-checked', 'true');
  await settings.getByRole('radio', { name: /가로형 16:9/ }).click();
  await expect(settings).toHaveCount(0);

  const pages = board.locator('[data-canvas-page]');
  await expect(pages).toHaveCount(1);
  const pr = (await pages.first().boundingBox())!;
  expect(Math.abs(pr.width / pr.height - 16 / 9)).toBeLessThan(0.02);
  const nav = page.getByRole('navigation', { name: '쪽 넘김' });
  await expect(nav).toContainText('1 / 1');

  // 마지막 쪽에서 [새 쪽]
  await nav.getByRole('button', { name: '새 쪽' }).click();
  await expect(pages).toHaveCount(2);
  await expect(nav).toContainText('2 / 2');
  await nav.getByRole('button', { name: '이전 쪽' }).click();
  await expect(nav).toContainText('1 / 2');

  // 선택 도구로 빈 곳을 왼쪽으로 끌면 다음 쪽, 마지막 쪽에서 또 밀면 새 쪽
  await page.getByRole('button', { name: '선택/이동' }).click();
  const swipe = async () => {
    const r = (await board.boundingBox())!;
    const y = r.y + r.height * 0.5;
    await page.mouse.move(r.x + r.width * 0.8, y);
    await page.mouse.down();
    await page.mouse.move(r.x + r.width * 0.2, y, { steps: 8 });
    await page.mouse.up();
  };
  await swipe();
  await expect(nav).toContainText('2 / 2');
  await swipe();
  await expect(nav).toContainText('3 / 3');
  await expect(pages).toHaveCount(3);

  // 쪽 넘김 방향을 위아래로: 쪽이 아래로 이어지고, 위로 밀면 다음(새) 쪽, 아래로 밀면 이전 쪽
  await page.getByRole('button', { name: '캔버스 설정' }).click();
  await expect(settings.getByRole('radio', { name: /옆으로/ })).toHaveAttribute('aria-checked', 'true');
  await settings.getByRole('radio', { name: /위아래로/ }).click();
  await expect(settings.getByRole('radio', { name: /위아래로/ })).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('Escape');
  await expect(settings).toHaveCount(0);
  // 화면이 새 배치로 미끄러져 가는 중일 수 있어 자리 잡을 때까지 다시 잰다
  await expect
    .poll(async () => {
      const b0 = (await pages.nth(0).boundingBox())!;
      const b1 = (await pages.nth(1).boundingBox())!;
      return Math.abs(b0.x - b1.x) < 1 && b1.y > b0.y + b0.height;
    })
    .toBe(true);
  const swipeV = async (from: number, to: number) => {
    const r = (await board.boundingBox())!;
    const x = r.x + r.width * 0.5;
    await page.mouse.move(x, r.y + r.height * from);
    await page.mouse.down();
    await page.mouse.move(x, r.y + r.height * to, { steps: 8 });
    await page.mouse.up();
  };
  await swipeV(0.8, 0.2);
  await expect(nav).toContainText('4 / 4');
  await swipeV(0.2, 0.8);
  await expect(nav).toContainText('3 / 4');

  await page.waitForTimeout(1200);
  await page.reload();
  const after = page.getByLabel('캔버스 그림판');
  await expect(after.locator('[data-canvas-page]')).toHaveCount(4);
  await expect(page.getByRole('navigation', { name: '쪽 넘김' })).toContainText('1 / 4');
  await expect(page.getByRole('button', { name: '다음 쪽' }).locator('svg')).toHaveClass(/chevron-down/);
  expect(errors).toEqual([]);
});

/** 쪽마다 글 한 줄이 있는 작은 PDF (가로 842 × 세로 595pt) */
function tinyPdf(pages: number): Buffer {
  const objs: string[] = [];
  const kids = Array.from({ length: pages }, (_, i) => `${4 + i * 2} 0 R`).join(' ');
  objs.push('<< /Type /Catalog /Pages 2 0 R >>');
  objs.push(`<< /Type /Pages /Kids [${kids}] /Count ${pages} >>`);
  objs.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  for (let i = 0; i < pages; i++) {
    const text = `BT /F1 48 Tf 80 300 Td (Page ${i + 1}) Tj ET`;
    objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 842 595] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + i * 2} 0 R >>`);
    objs.push(`<< /Length ${text.length} >>\nstream\n${text}\nendstream`);
  }
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((n) => `${String(n).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

async function newCanvas(page: Page, mobile: boolean) {
  const main = page.locator(MAIN);
  if (mobile) await page.getByRole('button', { name: '세션 목록', exact: true }).click();
  await page.getByRole('button', { name: '새로 만들기' }).click();
  await main.getByRole('button', { name: '캔버스로 시작' }).click();
  const board = page.getByLabel('캔버스 그림판');
  await expect(board).toBeVisible();
  return board;
}

test('캔버스 도구: 흰색 · 직접 고른 색 즐겨찾기 · 펜 굵기 창 · 긴 글 카드 스크롤(선택 도구만) · 카드 위 필기', async ({ page }, info) => {
  const errors = collectErrors(page);
  const mobile = info.project.name === 'mobile';
  await onboard(page);
  const main = page.locator(MAIN);

  // 긴 페이지를 먼저 만든다
  await page.getByRole('button', { name: '빈 페이지' }).click();
  const lines = Array.from({ length: 40 }, (_, i) => `${i + 1}번째 줄입니다.`).join('\n\n');
  await main.getByLabel('페이지 본문 (마크다운)').fill(`# 긴 노트\n\n${lines}`);
  await main.getByRole('button', { name: '완료' }).click();
  await expect(main.getByRole('heading', { name: '긴 노트' })).toBeVisible();

  const board = await newCanvas(page, mobile);
  const pen = page.getByRole('button', { name: '펜', exact: true });

  // 흰색으로 한 획
  await page.getByRole('button', { name: '흰색 색' }).click();
  await stroke(page, board, 0.3, 0.2);
  await expect(board.locator('svg path[fill="#ffffff"]')).toHaveCount(1);

  // 펜을 누르면 굵기 창: 숫자로 바꾸면 펜 단추에 보이고, 다시 누르면 닫힌다
  await pen.click();
  const sizeEditor = page.locator('[data-canvas-size-editor="pen"]');
  await expect(sizeEditor).toBeVisible();
  await sizeEditor.getByLabel('굵기 숫자').fill('12');
  await expect(pen).toContainText('12');
  await expect(sizeEditor.getByLabel('굵기', { exact: true })).toHaveValue('12');
  await pen.click();
  await expect(sizeEditor).toHaveCount(0);

  // 색 직접 고르기 → 즐겨찾기에 넣으면 색 줄에 남는다
  await page.locator('[data-canvas-color-custom]').click();
  const colorEditor = page.locator('[data-canvas-color-editor]');
  const code = colorEditor.getByLabel('색 코드');
  await code.fill('#ff8800');
  await code.press('Enter');
  await colorEditor.locator('[data-canvas-favorite]').click();
  await expect(colorEditor.locator('[data-canvas-favorite]')).toContainText('즐겨찾기에서 빼기');
  await page.keyboard.press('Escape');
  await expect(colorEditor).toHaveCount(0);
  const fav = page.getByRole('button', { name: '즐겨찾는 색 #ff8800' });
  await expect(fav).toHaveAttribute('aria-pressed', 'true');
  await stroke(page, board, 0.3, 0.35);
  await expect(board.locator('svg path[fill="#ff8800"]')).toHaveCount(1);

  // 긴 페이지를 글 카드로 가져오면 카드 안에서 스크롤된다
  await page.getByRole('button', { name: '가져오기' }).click();
  await page.locator('[data-canvas-import-source="page"]').click();
  const picker = page.getByRole('dialog', { name: '페이지 내용 가져오기' });
  await picker.locator('[data-canvas-import-picker] button').first().click();
  const body = board.locator('[data-canvas-item] [data-canvas-scroll]');
  await expect(body).toHaveCount(1);
  expect(await body.evaluate((el) => el.scrollHeight > el.clientHeight + 20)).toBe(true);
  const br = (await body.boundingBox())!;
  await page.mouse.move(br.x + br.width / 2, br.y + br.height / 2);
  await page.mouse.wheel(0, 200);
  await expect.poll(() => body.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);

  // 다른 도구에서 펜을 누르면 고르기만 하고, 한 번 더 누르면 세부 조정 창(펜 종류·굵기)이 뜬다
  await pen.click();
  await expect(pen).toHaveAttribute('aria-pressed', 'true');
  await expect(sizeEditor).toHaveCount(0);
  await pen.click();
  await expect(sizeEditor).toBeVisible();
  const nibs = page.getByRole('radiogroup', { name: '펜 종류' });
  await expect(nibs.getByRole('radio', { name: '만년필' })).toHaveAttribute('aria-checked', 'true');
  await nibs.getByRole('radio', { name: '붓펜' }).click();
  await expect(nibs.getByRole('radio', { name: '붓펜' })).toHaveAttribute('aria-checked', 'true');
  await expect(pen).toHaveAttribute('data-canvas-nib', 'brush');
  await page.keyboard.press('Escape');
  await expect(sizeEditor).toHaveCount(0);

  // 펜 도구에서는 카드가 스크롤되지 않고, 카드 위에 그대로 필기된다
  const scrolled = await body.evaluate((el) => el.scrollTop);
  await page.mouse.move(br.x + br.width / 2, br.y + br.height / 2);
  await page.mouse.wheel(0, 200);
  await page.waitForTimeout(200);
  expect(await body.evaluate((el) => el.scrollTop)).toBe(scrolled);
  await expect(body).toHaveCSS('touch-action', 'none');
  const before = await board.locator('svg path').count();
  await page.mouse.move(br.x + br.width * 0.3, br.y + br.height * 0.4);
  await page.mouse.down();
  await page.mouse.move(br.x + br.width * 0.5, br.y + br.height * 0.5, { steps: 5 });
  await page.mouse.move(br.x + br.width * 0.7, br.y + br.height * 0.6, { steps: 5 });
  await page.mouse.up();
  await expect(board.locator('svg path')).toHaveCount(before + 1);
  await expect(board.locator('svg path[data-canvas-nib="brush"]')).toHaveCount(1);

  // 형광펜도 카드 위에 그어지고 카드는 스크롤되지 않는다 (처음 누르면 창 없이 고르기만)
  const marker = page.getByRole('button', { name: '형광펜', exact: true });
  await marker.click();
  await expect(page.locator('[data-canvas-size-editor="marker"]')).toHaveCount(0);
  await marker.click();
  await expect(page.locator('[data-canvas-size-editor="marker"]')).toBeVisible();
  await expect(page.getByRole('radiogroup', { name: '펜 종류' })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.mouse.move(br.x + br.width * 0.3, br.y + br.height * 0.7);
  await page.mouse.down();
  await page.mouse.move(br.x + br.width * 0.5, br.y + br.height * 0.75, { steps: 5 });
  await page.mouse.move(br.x + br.width * 0.7, br.y + br.height * 0.8, { steps: 5 });
  await page.mouse.up();
  await expect(board.locator('svg path')).toHaveCount(before + 2);
  expect(await body.evaluate((el) => el.scrollTop)).toBe(scrolled);

  // 지우개로 카드 위의 획을 지운다
  await page.getByRole('button', { name: '지우개', exact: true }).click();
  await page.mouse.move(br.x + br.width * 0.25, br.y + br.height * 0.55);
  await page.mouse.down();
  await page.mouse.move(br.x + br.width * 0.5, br.y + br.height * 0.5, { steps: 10 });
  await page.mouse.move(br.x + br.width * 0.75, br.y + br.height * 0.6, { steps: 10 });
  await page.mouse.up();
  await expect(board.locator('svg path')).toHaveCount(before + 1);
  expect(await body.evaluate((el) => el.scrollTop)).toBe(scrolled);

  // 즐겨찾기 색과 굵기는 새로고침 뒤에도 남는다
  await page.reload();
  await expect(page.getByRole('button', { name: '즐겨찾는 색 #ff8800' })).toBeVisible();
  await expect(page.getByRole('button', { name: '펜', exact: true })).toContainText('12');
  await expect(page.getByRole('button', { name: '펜', exact: true })).toHaveAttribute('data-canvas-nib', 'brush');
  expect(errors).toEqual([]);
});

test('캔버스: PDF 가져오기 → PDF 모드 · A4 가로로 바꾸기 · 바탕색과 줄공책', async ({ page }, info) => {
  const errors = collectErrors(page);
  const mobile = info.project.name === 'mobile';
  await onboard(page);
  const board = await newCanvas(page, mobile);

  // PDF를 가져오면 쪽마다 PDF 한 장
  await page.getByRole('button', { name: '가져오기' }).click();
  const chooser = page.waitForEvent('filechooser');
  await page.locator('[data-canvas-import-source="pdf"]').click();
  await (await chooser).setFiles({ name: '강의자료.pdf', mimeType: 'application/pdf', buffer: tinyPdf(2) });
  const pdfPages = board.locator('[data-canvas-pdf-page]');
  await expect(pdfPages).toHaveCount(2, { timeout: 20_000 });
  const pr = (await board.locator('[data-canvas-page]').first().boundingBox())!;
  expect(Math.abs(pr.width / pr.height - 842 / 595)).toBeLessThan(0.02);
  const nav = page.getByRole('navigation', { name: '쪽 넘김' });
  await expect(nav).toContainText('1 / 2');
  await nav.getByRole('button', { name: '다음 쪽' }).click();
  await expect(nav).toContainText('2 / 2');
  // PDF 판의 마지막 쪽에서는 새 쪽을 만들지 않는다
  await expect(nav.getByRole('button', { name: '다음 쪽' })).toBeDisabled();

  // 위에 필기
  await stroke(page, board, 0.4, 0.4);
  await expect(board.locator('svg path')).toHaveCount(1);

  await page.waitForTimeout(1200);
  await page.reload();
  await expect(page.getByLabel('캔버스 그림판').locator('[data-canvas-pdf-page]')).toHaveCount(2);

  // 설정에 PDF 모드가 보이고, A4 가로로 바꾸면 확인 뒤 PDF가 빠진다
  await page.getByRole('button', { name: '캔버스 설정' }).click();
  const settings = page.getByRole('dialog', { name: '캔버스 설정' });
  await expect(settings.locator('[data-canvas-pdf-mode]')).toContainText('강의자료');
  await settings.getByRole('radio', { name: /A4 가로/ }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: '바꾸기' }).click();
  const after = page.getByLabel('캔버스 그림판');
  await expect(after.locator('[data-canvas-pdf-page]')).toHaveCount(0);
  const pages = after.locator('[data-canvas-page]');
  await expect(pages).toHaveCount(1);
  const ar = (await pages.first().boundingBox())!;
  expect(Math.abs(ar.width / ar.height - 1600 / 1131)).toBeLessThan(0.02);
  await expect(after.locator('svg path')).toHaveCount(1);

  // 바탕: 칠판색 + 줄공책
  await page.getByRole('button', { name: '캔버스 설정' }).click();
  await settings.locator('[data-canvas-bg-color="#24332b"]').click();
  await settings.locator('[data-canvas-bg-pattern="lines"]').click();
  await expect(settings.locator('[data-canvas-bg-pattern="lines"]')).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('Escape');
  await expect(pages.first()).toHaveCSS('background-color', 'rgb(36, 51, 43)');
  await expect(pages.first()).toHaveCSS('background-image', /linear-gradient/);

  await page.waitForTimeout(1200);
  await page.reload();
  const last = page.getByLabel('캔버스 그림판').locator('[data-canvas-page]').first();
  await expect(last).toHaveCSS('background-color', 'rgb(36, 51, 43)');
  await expect(last).toHaveCSS('background-image', /linear-gradient/);
  expect(errors).toEqual([]);
});
