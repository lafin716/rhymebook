import { expect, test, type Page } from '@playwright/test';

/**
 * 드래그 메뉴 서식·메모, 여러 블록 가지의 왼쪽 영역 막대 (IMP-07).
 * 모의 응답: "깊이 0 응답. **어텐션**은 … / - 스케일링: √d로 나눈다 / - 소프트맥스: … / 마지막 문장 [대상]."
 */
const KEY = 'sk-ant-e2e-ok';
const LOCAL = '/?platform=desktop';
const MAIN = '[data-panel="main"]';

function collectErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
}

async function start(page: Page, question: string) {
  await page.goto(LOCAL);
  const onboarding = page.getByRole('dialog', { name: '시작하기' });
  await onboarding.getByRole('button', { name: /^API 키/ }).click();
  const input = page.getByLabel('Anthropic API 키');
  await input.fill(KEY);
  await input.press('Enter');
  await page.keyboard.press('Escape');
  const main = page.locator(MAIN);
  await page.getByRole('button', { name: '새 학습 시작' }).click();
  await main.getByLabel('메시지 입력').fill(question);
  await main.getByRole('button', { name: '보내기' }).click();
  await expect(main.getByText(`마지막 문장 [${question.slice(0, 12)}].`)).toBeVisible();
}

/** 메인 패널 마지막 답변에서 from의 시작 ~ to의 끝까지 선택하고 메뉴가 뜰 때까지 기다린다 */
async function select(page: Page, from: string, to = from) {
  const menu = page.locator('[data-selection-menu]');
  await expect(async () => {
    await page.evaluate(
      ([sel, a, b]) => {
        const roots = [...document.querySelectorAll(`${sel} [data-anchorable]`)];
        const root = roots[roots.length - 1]!;
        const find = (needle: string) => {
          const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
          for (let n = w.nextNode(); n; n = w.nextNode()) {
            const i = (n as Text).data.indexOf(needle);
            if (i >= 0) return { node: n as Text, i };
          }
          throw new Error(`선택할 텍스트 없음: ${needle}`);
        };
        const s0 = find(a!);
        const e0 = find(b!);
        const r = document.createRange();
        r.setStart(s0.node, s0.i);
        r.setEnd(e0.node, e0.i + b!.length);
        const s = getSelection()!;
        s.removeAllRanges();
        s.addRange(r);
        document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      },
      [MAIN, from, to],
    );
    await expect(menu.first()).toBeVisible({ timeout: 500 });
  }).toPass();
  return menu;
}

test('형광펜·굵게 적용 → 새로고침 후 유지 → 같은 색 다시 누르면 해제', async ({ page }) => {
  const errors = collectErrors(page);
  await start(page, '형광펜 테스트');
  const main = page.locator(MAIN);

  let menu = await select(page, '가중합');
  await menu.getByRole('button', { name: /^형광펜 색상표/ }).click();
  await menu.getByRole('button', { name: '형광펜 초록' }).click();
  await menu.getByRole('button', { name: '서식으로 돌아가기' }).click();
  await menu.getByRole('button', { name: '굵게' }).click();
  const annot = main.locator('span.annot[data-hl="green"][data-bold="true"]');
  await expect(annot).toHaveText('가중합');

  await page.reload();
  await expect(main.locator('span.annot[data-hl="green"]')).toHaveText('가중합');

  // 글자색 색상표에서 색 적용, 같은 범위 형광펜 같은 색은 해제
  menu = await select(page, '가중합');
  await expect(menu.getByRole('button', { name: '굵게' })).toHaveAttribute('aria-pressed', 'true');
  await menu.getByRole('button', { name: /^글자색 색상표/ }).click();
  await menu.getByRole('button', { name: '글자색 빨강' }).click();
  await expect(main.locator('span.annot[data-tc="red"]')).toHaveText('가중합');
  await menu.getByRole('button', { name: '서식으로 돌아가기' }).click();
  await menu.getByRole('button', { name: /^형광펜 색상표/ }).click();
  await menu.getByRole('button', { name: '형광펜 초록' }).click();
  await expect(main.locator('span.annot[data-hl]')).toHaveCount(0);
  await menu.getByRole('button', { name: '서식으로 돌아가기' }).click();

  // 서식 지우기 → 어노테이션 제거, 본문 텍스트는 그대로
  await menu.getByRole('button', { name: '서식 지우기' }).click();
  await expect(main.locator('span.annot')).toHaveCount(0);
  await expect(main.getByText('쿼리와 키의 유사도로 값을 가중합한다', { exact: false })).toBeVisible();
  expect(errors).toEqual([]);
});

test('사용자 지정 색 적용 → 즐겨찾기 추가 → 새로고침 후에도 즐겨찾기 유지', async ({ page }) => {
  const errors = collectErrors(page);
  await start(page, '색상표 테스트');
  const main = page.locator(MAIN);

  let menu = await select(page, '가중합');
  await menu.getByRole('button', { name: /^밑줄 색상표/ }).click();
  await menu.getByLabel('HEX 색 코드').fill('#1A2B3C');
  await menu.getByRole('button', { name: '적용' }).click();
  const ul = main.locator('span.annot[data-ul="custom"]');
  await expect(ul).toHaveText('가중합');
  expect(await ul.evaluate((el) => getComputedStyle(el).textDecorationColor)).toBe('rgb(26, 43, 60)');

  await menu.getByRole('button', { name: '즐겨찾기에 추가' }).click();
  await expect(menu.getByRole('button', { name: '밑줄 #1A2B3C' })).toHaveCount(1);

  await page.reload();
  await expect(main.locator('span.annot[data-ul="custom"]')).toHaveText('가중합');
  menu = await select(page, '스케일링');
  await menu.getByRole('button', { name: /^형광펜 색상표/ }).click();
  // 즐겨찾기는 서식 종류와 무관하게 공유된다
  await menu.getByRole('button', { name: '형광펜 #1A2B3C' }).click();
  await expect(main.locator('span.annot[data-hl="custom"]')).toHaveText('스케일링');
  expect(errors).toEqual([]);
});

test('드래그 메뉴는 선택 영역을 가리지 않는다', async ({ page }) => {
  await start(page, '위치 테스트');
  const menu = await select(page, '스케일링', '소프트맥스');
  const box = (await menu.boundingBox())!;
  const sel = await page.evaluate(() => {
    const r = getSelection()!.getRangeAt(0).getBoundingClientRect();
    return { top: r.top, bottom: r.bottom, left: r.left, right: r.right };
  });
  const overlapY = box.y < sel.bottom && box.y + box.height > sel.top;
  const overlapX = box.x < sel.right && box.x + box.width > sel.left;
  expect(overlapX && overlapY).toBe(false);
});

test('드래그 메뉴의 복사: 선택한 글을 클립보드에 담고 메뉴는 남는다', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await start(page, '복사 테스트');
  const menu = await select(page, '가중합');
  await menu.getByRole('button', { name: '복사', exact: true }).click();
  await expect(menu.getByRole('button', { name: '복사됨' })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('가중합');
  await expect(menu.getByRole('button', { name: '복사', exact: true })).toBeVisible({ timeout: 3000 });
});

test('우클릭 모드: 드래그만으로는 메뉴가 뜨지 않고 우클릭하면 뜬다', async ({ page }, info) => {
  test.skip(info.project.name === 'mobile', '모바일은 항상 자동');
  await page.addInitScript(() => localStorage.setItem('branch.selectionTrigger', 'contextmenu'));
  await start(page, '우클릭 테스트');
  const menu = page.locator('[data-selection-menu]');
  const mark = page.locator(MAIN).locator('[data-anchorable]').last().getByText('가중합', { exact: false });
  await mark.selectText();
  await page.locator(MAIN).locator('[data-anchorable]').last().dispatchEvent('mouseup');
  await page.waitForTimeout(300);
  await expect(menu).toBeHidden();
  await mark.click({ button: 'right' });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('button', { name: '이게 뭐야?' })).toBeVisible();
});

test('가지 표시·이 페이지의 가지 목록·가지의 부모 원문 접기', async ({ page }, info) => {
  const errors = collectErrors(page);
  await start(page, '가지 목록 테스트');
  const main = page.locator(MAIN);
  const closeBranch = async () => {
    if (info.project.name === 'mobile') {
      await page.getByRole('dialog', { name: '가지 시트' }).getByRole('button', { name: '시트 닫기' }).click();
    } else {
      await page.keyboard.press('Escape');
    }
  };

  const menu = await select(page, '가중합');
  await menu.getByRole('button', { name: '이게 뭐야?' }).click();
  await expect(page.getByText('마지막 문장 [가중합].').last()).toBeVisible();

  // 가지 헤더의 부모 원문: provider 옆 토글로 완전히 숨김 → 다시 펼치기 (기기별 저장)
  await expect(page.locator('[data-quote]')).toHaveCount(1);
  await page.getByRole('button', { name: '부모 원문 접기' }).click();
  await expect(page.locator('[data-quote]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '부모에 요약 붙이기' })).toBeVisible();
  await page.getByRole('button', { name: '부모 원문 펼치기' }).click();
  await expect(page.locator('[data-quote]')).toHaveCount(1);
  await closeBranch();

  // 본문 가지 표시: 테마색 + 끝 아이콘
  const mark = main.locator('mark.anchor[data-branch-end="true"]');
  await expect(mark).toHaveText('가중합');
  const icon = await mark.evaluate((m) => getComputedStyle(m, '::after').maskImage || getComputedStyle(m, '::after').webkitMaskImage);
  expect(icon).toContain('svg');

  // 플로팅 가지 목록 → 항목 클릭으로 가지 열기
  await main.getByRole('button', { name: '이 페이지의 가지 1개' }).click();
  const list = main.getByRole('dialog', { name: '가지 목록' });
  await expect(list).toBeVisible();
  await expect(list.locator('li')).toHaveCount(1);
  await list.locator('li').first().getByRole('button').first().click();
  await expect(list).toBeHidden();
  await expect(page.getByText('마지막 문장 [가중합].').last()).toBeVisible();
  expect(errors).toEqual([]);
});

test('왼쪽 목록에서 세션을 우클릭해 이름 변경', async ({ page }, info) => {
  test.skip(info.project.name === 'mobile', '우클릭은 PC·웹');
  const errors = collectErrors(page);
  await start(page, '이름 테스트');
  const row = page.locator('[data-session-row]').first();
  await row.click({ button: 'right' });
  await page.getByRole('menuitem', { name: '이름 변경' }).click();
  const input = page.getByLabel('세션 이름');
  await input.fill('바꾼 이름');
  await input.press('Enter');
  await expect(page.locator('[data-session-row]').first()).toContainText('바꾼 이름');
  // Esc는 취소
  await page.locator('[data-session-row]').first().click({ button: 'right' });
  await page.getByRole('menuitem', { name: '이름 변경' }).click();
  await page.getByLabel('세션 이름').fill('취소될 이름');
  await page.getByLabel('세션 이름').press('Escape');
  await expect(page.locator('[data-session-row]').first()).toContainText('바꾼 이름');
  await page.reload();
  await expect(page.locator('[data-session-row]').first()).toContainText('바꾼 이름');
  expect(errors).toEqual([]);
});

test('메모 저장 → 본문 표시 → 팝오버에서 수정·삭제', async ({ page }) => {
  const errors = collectErrors(page);
  await start(page, '메모 테스트');
  const main = page.locator(MAIN);

  const menu = await select(page, '스케일링');
  await menu.getByRole('button', { name: '메모', exact: true }).click();
  await menu.getByLabel('메모').fill('√d는 분산을 1로 맞춘다');
  await menu.getByRole('button', { name: '메모 저장' }).click();
  await expect(page.locator('[data-selection-menu]')).toBeHidden();

  const noted = main.locator('span.annot[data-note="true"]');
  await expect(noted).toHaveText('스케일링');
  await noted.click();
  const pop = page.locator('[data-annotation-popover]');
  await expect(pop).toContainText('√d는 분산을 1로 맞춘다');

  await pop.getByRole('button', { name: '수정' }).click();
  await pop.locator('textarea').fill('수정한 메모');
  await pop.getByRole('button', { name: '저장' }).click();
  await expect(pop).toContainText('수정한 메모');

  await page.reload();
  await main.locator('span.annot[data-note="true"]').click();
  await expect(pop).toContainText('수정한 메모');
  await pop.getByRole('button', { name: '삭제' }).click();
  await expect(pop).toBeHidden();
  await expect(main.locator('span.annot')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('두 목록 항목에 걸친 가지 → 배경 없이 왼쪽 영역 막대, 막대 클릭으로 가지 열기', async ({ page }, info) => {
  const errors = collectErrors(page);
  await start(page, '영역 테스트');
  const main = page.locator(MAIN);

  const menu = await select(page, '스케일링', '소프트맥스');
  await menu.getByRole('button', { name: '이게 뭐야?' }).click();
  await expect(page.getByText(/마지막 문장 \[스케일링/).last()).toBeVisible();
  // 모바일은 시트, 데스크톱은 팝업 → 닫고 부모를 본다
  if (info.project.name === 'mobile') {
    await page.getByRole('dialog', { name: '가지 시트' }).getByRole('button', { name: '시트 닫기' }).click();
  } else {
    await page.keyboard.press('Escape');
  }

  const marks = main.locator('mark.anchor[data-region="true"]');
  await expect(marks.first()).toBeAttached();
  const bg = await marks.first().evaluate((m) => getComputedStyle(m).backgroundColor);
  expect(bg).toMatch(/rgba\(0, 0, 0, 0\)|transparent/);

  const bar = main.locator('[data-region-bar]');
  await expect(bar).toHaveCount(1);
  const box = (await bar.boundingBox())!;
  expect(box.height).toBeGreaterThan(30);

  // 한 블록 안 가지는 기존 인라인 하이라이트
  const inline = await select(page, '가중합');
  await inline.getByRole('button', { name: '이게 뭐야?' }).click();
  await expect(page.getByText('마지막 문장 [가중합].').last()).toBeVisible();
  if (info.project.name === 'mobile') {
    await page.getByRole('dialog', { name: '가지 시트' }).getByRole('button', { name: '시트 닫기' }).click();
  } else {
    await page.keyboard.press('Escape');
  }
  await expect(main.locator('mark.anchor:not([data-region])', { hasText: '가중합' })).toBeAttached();
  await expect(bar).toHaveCount(1);

  await bar.click();
  await expect(page.getByText(/마지막 문장 \[스케일링/).last()).toBeVisible();
  expect(errors).toEqual([]);
});
