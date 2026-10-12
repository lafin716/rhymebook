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
  await menu.getByRole('button', { name: '형광펜 초록' }).click();
  await menu.getByRole('button', { name: '굵게' }).click();
  const annot = main.locator('span.annot[data-hl="green"][data-bold="true"]');
  await expect(annot).toHaveText('가중합');

  await page.reload();
  await expect(main.locator('span.annot[data-hl="green"]')).toHaveText('가중합');

  // 글자색 모드로 바꿔 색 적용, 같은 범위 형광펜 같은 색은 해제
  menu = await select(page, '가중합');
  await expect(menu.getByRole('button', { name: '굵게' })).toHaveAttribute('aria-pressed', 'true');
  await menu.getByRole('button', { name: '글자색', exact: true }).click();
  await menu.getByRole('button', { name: '글자색 빨강' }).click();
  await expect(main.locator('span.annot[data-tc="red"]')).toHaveText('가중합');
  await menu.getByRole('button', { name: '형광펜', exact: true }).click();
  await menu.getByRole('button', { name: '형광펜 초록' }).click();
  await expect(main.locator('span.annot[data-hl]')).toHaveCount(0);

  // 서식 지우기 → 어노테이션 제거, 본문 텍스트는 그대로
  await menu.getByRole('button', { name: '서식 지우기' }).click();
  await expect(main.locator('span.annot')).toHaveCount(0);
  await expect(main.getByText('쿼리와 키의 유사도로 값을 가중합한다', { exact: false })).toBeVisible();
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
