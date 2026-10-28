import { expect, test, type Page } from '@playwright/test';

/**
 * 마크다운 페이지 세션 (ADR-072): 새로 만들기 → 빈 페이지 → 마크다운 작성 → 렌더 → 글을 골라 가지 → 새로고침 후 유지.
 * 편집 모드가 따로 없이 늘 편집기이고 쓰는 대로 저장된다 (ADR-086).
 * 가지 응답은 e2e/mock-anthropic.mjs가 "마지막 문장 [대상]."으로 돌려준다.
 */
const KEY = 'sk-ant-e2e-ok';
const LOCAL = '/?platform=desktop';
const MAIN = '[data-panel="main"]';
const DOC = '# 어텐션 노트\n\n- 쿼리와 키를 비교한다\n- **가중합**으로 값을 섞는다\n\n소프트맥스로 정규화한다.';

/** CodeMirror 편집기의 마크다운 원문 (실시간 렌더라 화면 글자와 다르다, ADR-075) */
async function source(page: Page) {
  return page
    .locator(`${MAIN} [data-page-editor] .cm-content`)
    .evaluate((el) => (el as unknown as { cmTile: { root: { view: { state: { doc: { toString(): string } } } } } }).cmTile.root.view.state.doc.toString());
}

/** 편집기에서 글을 골라 선택 메뉴를 띄운다 */
async function selectInEditor(page: Page, text: string) {
  await page.locator(`${MAIN} [data-page-editor] .cm-content`).evaluate((el, t) => {
    const v = (el as unknown as { cmTile: { root: { view: { state: { doc: { toString(): string } }; dispatch(s: unknown): void; focus(): void } } } }).cmTile.root.view;
    const i = v.state.doc.toString().indexOf(t);
    if (i < 0) throw new Error('선택할 텍스트 없음');
    v.focus();
    v.dispatch({ selection: { anchor: i, head: i + t.length } });
  }, text);
}

function collectErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
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

async function writePage(page: Page) {
  const main = page.locator(MAIN);
  const body = main.getByLabel('페이지 본문 (마크다운)');
  await expect(body).toBeVisible();
  // 대화 입력창은 없다
  await expect(main.getByLabel('메시지 입력')).toHaveCount(0);
  await body.fill(DOC);
  // 완료 버튼 없이 Esc로 편집기를 벗어나면 서식으로 보인다
  await expect(main.getByRole('button', { name: '완료' })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(main.locator('.cm-line.cm-lp-h1')).toHaveText('어텐션 노트');
  await expect(main.locator('.cm-lp-strong', { hasText: '가중합' })).toBeVisible();
}

test('빈 페이지 작성 → 글을 골라 가지 → 새로고침 후 본문·앵커 유지', async ({ page }) => {
  const errors = collectErrors(page);
  await onboard(page);
  await page.getByRole('button', { name: '빈 페이지' }).click();
  await writePage(page);

  // 페이지 글을 골라 묻기
  const ask = page.getByRole('button', { name: '이게 뭐야?' });
  await expect(async () => {
    await selectInEditor(page, '소프트맥스');
    await expect(ask).toBeVisible({ timeout: 500 });
  }).toPass();
  await ask.click();
  await expect(page.getByText('마지막 문장 [소프트맥스].').last()).toBeVisible();

  await page.reload();
  const main = page.locator(MAIN);
  await expect(main.locator('.cm-line.cm-lp-h1')).toHaveText('어텐션 노트');
  expect(await source(page)).toBe(DOC);
  // 편집기 위에도 가지 앵커와 여는 단추가 보인다
  await expect(main.locator('[data-page-editor] .anchor', { hasText: '소프트맥스' })).toBeVisible();
  await expect(main.locator('[data-page-editor] [data-branch-open]')).toHaveCount(1);
  expect(errors).toEqual([]);
});

test('사이드바 새로 만들기 → 빈 화면에서 빈 페이지로 시작, 문서 아이콘과 제목 바꾸기', async ({ page }, info) => {
  test.skip(info.project.name === 'mobile', '모바일은 사이드바가 서랍이라 데스크톱에서 검증');
  const errors = collectErrors(page);
  await onboard(page);

  // 작은 메뉴 없이 바로 빈 대화 화면이 열린다 (ADR-074)
  await page.getByRole('button', { name: '새로 만들기' }).click();
  await expect(page.getByRole('menu')).toHaveCount(0);
  await page.locator(MAIN).getByRole('button', { name: '빈 페이지로 시작' }).click();
  await writePage(page);
  await expect(page.locator('svg[aria-label="페이지"]').first()).toBeVisible();

  // 헤더 제목을 눌러 이름 바꾸기
  const main = page.locator(MAIN);
  await main.locator('[data-page-title]').click();
  const rename = main.getByRole('textbox').first();
  await rename.fill('어텐션 정리');
  await rename.press('Enter');
  await expect(main.locator('[data-page-title]')).toHaveText(/어텐션 정리/);

  // 원문이 그대로다
  expect(await source(page)).toBe(DOC);
  expect(errors).toEqual([]);
});

test('/ 블록 넣기 — 검색·키보드로 고르고 Esc는 메뉴만 닫는다 (ADR-073)', async ({ page }) => {
  const errors = collectErrors(page);
  await onboard(page);
  await page.getByRole('button', { name: '빈 페이지' }).click();
  const main = page.locator(MAIN);
  const body = main.getByLabel('페이지 본문 (마크다운)');
  const menu = main.getByRole('listbox', { name: '블록 넣기' });
  await expect(body).toBeFocused();

  // /제목 → 제목 1·2·3, ↓로 제목 2 → Enter
  await page.keyboard.type('/제목');
  await expect(menu.getByRole('option')).toHaveCount(3);
  await expect(menu.getByRole('option', { selected: true })).toContainText('제목 1');
  await page.keyboard.press('ArrowDown');
  await expect(menu.getByRole('option', { selected: true })).toContainText('제목 2');
  await page.keyboard.press('Enter');
  await expect(menu).toHaveCount(0);
  await page.keyboard.type('어텐션 노트');
  await expect.poll(() => source(page)).toBe('## 어텐션 노트');

  // 문단 뒤 /hr → 구분선은 빈 줄로 띄운다, 영문 검색어
  await page.keyboard.press('Enter');
  await page.keyboard.type('본문 문장');
  await page.keyboard.press('Enter');
  await page.keyboard.type('/hr');
  await expect(menu.getByRole('option')).toHaveCount(1);
  await page.keyboard.press('Enter');
  // 할 일 목록은 클릭으로
  await page.keyboard.type('/할');
  await menu.getByRole('option', { name: /할 일 목록/ }).click();
  await page.keyboard.type('복습하기');
  await expect.poll(() => source(page)).toBe('## 어텐션 노트\n본문 문장\n\n---\n- [ ] 복습하기');

  // Esc는 메뉴만 닫고 편집을 이어간다. 같은 / 자리에선 다시 열리지 않는다
  // (Enter는 목록을 이어 가고, 빈 항목에서 한 번 더 누르면 목록을 끝낸다)
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await page.keyboard.type('/제');
  await expect(menu).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(body).toBeVisible();
  await page.keyboard.type('목'); // 여전히 맞는 검색어여도 닫힌 채다
  await expect(menu).toHaveCount(0);
  await expect.poll(() => source(page)).toMatch(/\/제목$/);
  // 맞는 블록이 없으면 메뉴가 없고, 경로 같은 a/b에서는 열리지 않는다
  await page.keyboard.type(' /없는블록 a/b');
  await expect(menu).toHaveCount(0);

  await page.keyboard.press('Escape');
  await expect(main.locator('.cm-line.cm-lp-h2')).toHaveText('어텐션 노트');
  await expect(main.locator('.cm-lp-hr')).toHaveCount(1);
  await expect(main.locator('.cm-lp-check')).toHaveCount(1);
  expect(errors).toEqual([]);
});

test('실시간 렌더 — 커서가 없는 줄은 마크다운 기호를 숨기고 서식으로 보인다 (ADR-075)', async ({ page }) => {
  const errors = collectErrors(page);
  await onboard(page);
  await page.getByRole('button', { name: '빈 페이지' }).click();
  const main = page.locator(MAIN);
  const editor = main.locator('[data-page-editor]');
  await page.keyboard.type('## 제목 줄');
  await page.keyboard.press('Enter');
  await page.keyboard.type('**굵게** 그리고 `코드`');
  await page.keyboard.press('Enter');
  await page.keyboard.type('- [ ] 할 일');
  // 목록은 Enter로 이어지고, 빈 항목에서 Enter를 한 번 더 누르면 끝난다
  await page.keyboard.press('Enter');
  await expect.poll(() => source(page)).toMatch(/- \[ \] 할 일\n- \[ \] $/);
  await page.keyboard.press('Enter');
  await page.keyboard.type('마지막 줄');

  // 제목 줄: 줄 서식이 붙고 # 기호는 숨긴다
  const heading = editor.locator('.cm-line.cm-lp-h2');
  await expect(heading).toHaveText('제목 줄');
  await expect(editor.locator('.cm-lp-strong')).toHaveText('굵게');
  await expect(editor.locator('.cm-lp-inline-code')).toHaveText('코드');
  await expect(editor.locator('.cm-line', { hasText: '굵게' })).not.toContainText('**');
  // 할 일 체크박스는 눌러서 원문을 바꾼다
  await editor.locator('.cm-lp-check').click();
  await expect.poll(() => source(page)).toContain('- [x] 할 일');

  // 커서를 제목 줄로 옮기면 그 줄만 원문(## )이 드러난다
  await heading.click();
  await expect(editor.locator('.cm-line.cm-lp-h2')).toContainText('## ');
  expect(await source(page)).toBe('## 제목 줄\n**굵게** 그리고 `코드`\n- [x] 할 일\n마지막 줄');
  await page.screenshot({ path: `test-results/page-live-${test.info().project.name}.png` });
  expect(errors).toEqual([]);
});

test('/하위 페이지 → 링크로 열고, 이름을 바꾸면 부모 링크도 바뀐다 (ADR-075)', async ({ page }, info) => {
  test.skip(info.project.name === 'mobile', '모바일은 사이드바가 서랍이라 데스크톱에서 검증');
  const errors = collectErrors(page);
  await onboard(page);
  await page.getByRole('button', { name: '빈 페이지' }).click();
  const main = page.locator(MAIN);
  const title = main.locator('[data-page-title]');
  await page.keyboard.type('부모 본문');
  await page.keyboard.press('Enter');
  await page.keyboard.type('/하위');
  await main.getByRole('listbox', { name: '블록 넣기' }).getByRole('option', { name: /하위 페이지/ }).click();
  await expect.poll(() => source(page)).toMatch(/^부모 본문\n\[새 페이지\]\(#page:[^)]+\)$/);
  await title.click();
  await main.getByRole('textbox').first().fill('부모 노트');
  await page.keyboard.press('Enter');
  await expect(title).toHaveText(/부모 노트/);

  // 편집기의 링크를 누르면 하위 페이지가 열린다
  const link = main.locator('a.cm-lp-pagelink', { hasText: '새 페이지' });
  await expect(link).toBeVisible();
  await link.click();
  await expect(title).toHaveText(/새 페이지/);
  await title.click();
  await main.getByRole('textbox').first().fill('하위 노트');
  await page.keyboard.press('Enter');
  await expect(title).toHaveText(/하위 노트/);

  // 부모로 돌아가면 링크 제목도 바뀌어 있다
  await page.getByRole('navigation', { name: '학습 세션' }).getByText('부모 노트').first().click();
  await expect(main.locator('a.cm-lp-pagelink', { hasText: '하위 노트' })).toBeVisible();
  await page.screenshot({ path: `test-results/page-sublink-${info.project.name}.png` });
  expect(errors).toEqual([]);
});

test('빈 페이지 안내는 여러 줄이어도 커서는 한 줄 높이다', async ({ page }) => {
  await onboard(page);
  await page.getByRole('button', { name: '빈 페이지' }).click();
  const main = page.locator(MAIN);
  await expect(main.locator('.cm-placeholder')).toBeVisible();
  // 커서(네이티브 캐럿)는 첫 줄 높이를 따른다 — 안내 글이 줄 높이를 늘리지 않아야 한다
  const h = await main.locator('.cm-line').first().evaluate((el) => el.getBoundingClientRect().height);
  expect(h).toBeGreaterThan(10);
  expect(h).toBeLessThan(40);
});

test('우클릭 메뉴로 블록 넣기 · AI로 내용 채우기 · AI로 정리와 되돌리기 (ADR-076)', async ({ page }) => {
  const errors = collectErrors(page);
  await onboard(page);
  await page.getByRole('button', { name: '빈 페이지' }).click();
  const main = page.locator(MAIN);
  const body = main.getByLabel('페이지 본문 (마크다운)');
  await page.keyboard.type('어텐션 메모');
  await expect.poll(() => source(page)).toBe('어텐션 메모');

  // 우클릭 → 블록 넣기: 문단 중간이면 다음 줄에 제목을 연다
  const menu = main.getByRole('menu', { name: '블록·AI 메뉴' });
  await body.click({ button: 'right' });
  await expect(menu).toBeVisible();
  await menu.getByRole('menuitem', { name: /제목 2/ }).click();
  await expect(menu).toHaveCount(0);
  await page.keyboard.type('장점');
  await expect.poll(() => source(page)).toBe('어텐션 메모\n## 장점');

  // Esc는 메뉴만 닫는다
  await body.click({ button: 'right' });
  await expect(menu).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);

  // AI로 내용 채우기 — 요청을 적으면 커서 자리에 목록이 들어온다
  await main.locator('.cm-line').last().click({ button: 'right', position: { x: 200, y: 5 } });
  await menu.getByRole('menuitem', { name: 'AI로 내용 채우기' }).click();
  await menu.getByLabel(/무엇을 채울까요/).fill('병렬 처리');
  await menu.getByRole('button', { name: '채우기' }).click();
  await expect.poll(() => source(page)).toBe('어텐션 메모\n## 장점\n\n- 채운 항목: 병렬 처리');

  // AI로 정리 — 울타리를 걷고 바꾸며, 따로 된 되돌리기 버튼 없이 상단 실행 취소로 돌아간다 (ADR-087)
  await main.getByRole('button', { name: /AI로 정리/ }).click();
  await expect.poll(() => source(page)).toMatch(/^## 정리/m);
  expect(await source(page)).not.toContain('```');
  await expect(main.getByRole('button', { name: '되돌리기', exact: true })).toHaveCount(0);
  await main.getByRole('button', { name: '실행 취소' }).click();
  await expect.poll(() => source(page)).toBe('어텐션 메모\n## 장점\n\n- 채운 항목: 병렬 처리');
  expect(errors).toEqual([]);
});

test('글을 끌어 고르면 선택 메뉴에 서식이 뜨고, 버튼·단축키로 감싸고 벗긴다 (ADR-077·086)', async ({ page }, info) => {
  test.skip(info.project.name === 'mobile', '모바일은 하단 액션바라 데스크톱에서 검증');
  const errors = collectErrors(page);
  await onboard(page);
  await page.getByRole('button', { name: '빈 페이지' }).click();
  const main = page.locator(MAIN);
  const pop = page.locator('[data-selection-menu]');
  const bold = pop.locator('[data-format="bold"]');
  await page.keyboard.type('가나 다라 마바');
  await page.keyboard.press('Enter');
  await page.keyboard.type('**굵은** 둘째 줄 글');
  await expect.poll(() => source(page)).toBe('가나 다라 마바\n**굵은** 둘째 줄 글');

  // 키보드로 고르기 → 팝업 → 굵게
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('End');
  for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowLeft');
  for (let i = 0; i < 2; i++) await page.keyboard.press('Shift+ArrowLeft');
  await expect(pop).toBeVisible();
  await bold.click();
  await expect.poll(() => source(page)).toBe('가나 **다라** 마바\n**굵은** 둘째 줄 글');
  // 선택이 그대로라 다시 누르면 벗긴다, 단축키도 같다
  await bold.click();
  await expect.poll(() => source(page)).toBe('가나 다라 마바\n**굵은** 둘째 줄 글');
  await page.keyboard.press('ControlOrMeta+i');
  await expect.poll(() => source(page)).toBe('가나 *다라* 마바\n**굵은** 둘째 줄 글');

  // 서식이 있는 줄을 마우스로 끌어 고른다 — 끄는 동안 줄 모양이 바뀌지 않아 선택이 끝까지 이어진다
  await page.keyboard.press('ArrowDown');
  await expect(pop).toHaveCount(0); // 선택이 접히면 메뉴가 닫힌다
  const line = main.locator('.cm-line').nth(1);
  const box = (await line.boundingBox())!;
  const text = (await line.evaluate((el) => {
    const r = document.createRange();
    r.selectNodeContents(el);
    return r.getBoundingClientRect().right;
  }))!;
  await page.mouse.move(box.x + 2, box.y + box.height / 2);
  await page.mouse.down();
  const before = await line.evaluate((el) => el.textContent);
  await page.mouse.move((box.x + text) / 2, box.y + box.height / 2, { steps: 5 });
  expect(await line.evaluate((el) => el.textContent)).toBe(before);
  await expect(pop).toHaveCount(0); // 끄는 중에는 팝업을 띄우지 않는다
  await page.mouse.move(text - 1, box.y + box.height / 2, { steps: 5 });
  await page.mouse.up();
  await expect(pop).toBeVisible();
  const picked = await main
    .locator('[data-page-editor] .cm-content')
    .evaluate((el) => {
      const v = (el as unknown as { cmTile: { root: { view: { state: { selection: { main: { from: number; to: number } }; sliceDoc(a: number, b: number): string } } } } }).cmTile.root.view;
      return v.state.sliceDoc(v.state.selection.main.from, v.state.selection.main.to);
    });
  expect(picked.length).toBeGreaterThan(8);
  await pop.locator('[data-format="strike"]').click();
  await expect.poll(() => source(page)).toContain('~~');
  expect(errors).toEqual([]);
});

test('체크박스를 눌러 바로 저장되고, 새로고침해도 유지된다 (ADR-086)', async ({ page }) => {
  const errors = collectErrors(page);
  await onboard(page);
  await page.getByRole('button', { name: '빈 페이지' }).click();
  const main = page.locator(MAIN);
  await main.getByLabel('페이지 본문 (마크다운)').fill('할 일\n\n- [ ] 하나\n- [x] 둘\n\n```\n- [ ] 코드\n```\n- [ ] 셋');
  await page.keyboard.press('Escape');
  const boxes = main.locator('.cm-lp-check');
  await expect(boxes).toHaveCount(3);
  await boxes.nth(2).click();
  await boxes.nth(1).click();
  const want = '할 일\n\n- [ ] 하나\n- [ ] 둘\n\n```\n- [ ] 코드\n```\n- [x] 셋';
  await expect.poll(() => source(page)).toBe(want);

  // 저장 지연(0.5초)이 지나면 새로고침해도 그대로다
  await page.waitForTimeout(800);
  await page.reload();
  await expect.poll(() => source(page)).toBe(want);
  expect(errors).toEqual([]);
});

test('/이미지 · /파일 — 고른 파일을 본문에 넣고 그림으로 보이며, ⌘/Ctrl+클릭으로 내려받는다 (ADR-077·086)', async ({ page }, info) => {
  test.skip(info.project.name === 'mobile', '⌘/Ctrl+클릭은 데스크톱에서 검증');
  const errors = collectErrors(page);
  await onboard(page);
  await page.getByRole('button', { name: '빈 페이지' }).click();
  const main = page.locator(MAIN);
  const menu = main.getByRole('listbox', { name: '블록 넣기' });
  // 1x1 png
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

  await page.keyboard.type('/이미지');
  const imgChooser = page.waitForEvent('filechooser');
  await menu.getByRole('option', { name: /이미지/ }).click();
  await (await imgChooser).setFiles({ name: 'dot.png', mimeType: 'image/png', buffer: png });
  await expect.poll(() => source(page)).toMatch(/^!\[dot\.png\]\(data:image\/png;base64,[A-Za-z0-9+/=]+\)/);
  await expect(main.locator('.cm-lp-image img')).toBeVisible();

  await page.keyboard.press('Enter');
  await page.keyboard.type('/파일');
  const fileChooser = page.waitForEvent('filechooser');
  await menu.getByRole('option', { name: /파일/ }).first().click();
  await (await fileChooser).setFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('안녕') });
  await expect.poll(() => source(page)).toMatch(/\[📎 notes\.txt\]\(data:text\/plain;base64,[A-Za-z0-9+/=]+ "notes\.txt"\)/);
  expect(await source(page)).not.toContain('/파일');

  await page.keyboard.press('Escape');
  const img = main.locator('.cm-lp-image img');
  await expect(img).toBeVisible();
  expect(await img.evaluate((el) => (el as HTMLImageElement).naturalWidth)).toBe(1);
  const download = page.waitForEvent('download');
  await main.locator('.cm-line', { hasText: 'notes.txt' }).getByText('notes.txt').click({ modifiers: ['ControlOrMeta'] });
  expect((await download).suggestedFilename()).toBe('notes.txt');
  expect(errors).toEqual([]);
});
