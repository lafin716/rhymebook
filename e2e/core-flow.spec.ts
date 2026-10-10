import { expect, test, type Page } from '@playwright/test';

/**
 * 핵심 플로우: API 키 등록 → 루트 질문 → 3단계 가지 → 요약 카드 → 보기 모드 → 검색 → 새로고침 후 유지.
 * 응답은 e2e/mock-anthropic.mjs가 질문 대상을 끝 문장에 넣어 돌려준다: "마지막 문장 [대상]."
 */
const KEY = 'sk-ant-e2e-ok';

function collectErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
}

async function setKey(page: Page, key: string) {
  // 상단 바의 설정 (개발 서버의 데모 바에도 '설정' 시나리오 버튼이 있다)
  await page.getByRole('banner').getByRole('button', { name: '설정', exact: true }).click();
  const input = page.getByLabel('Anthropic API 키');
  await input.fill(key);
  await input.press('Enter');
}

/** 마지막으로 열린 영역(scope)의 마지막 답변에서 needle을 선택하고 '이게 뭐야?'로 가지를 친다 */
async function branchFrom(page: Page, scope: string, needle: string) {
  const menu = page.getByRole('button', { name: '이게 뭐야?' });
  // 직전 메뉴 클릭 직후(600ms)에는 선택 평가를 건너뛰므로, 메뉴가 뜰 때까지 선택을 다시 알린다
  await expect(async () => {
    await page.evaluate(
      ([sel, text]) => {
        const roots = [...document.querySelectorAll(sel!)];
        const root = roots[roots.length - 1]!;
        const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        let last: Text | null = null;
        for (let n = w.nextNode(); n; n = w.nextNode()) if ((n as Text).data.includes(text!)) last = n as Text;
        if (!last) throw new Error(`선택할 텍스트 없음: ${text}`);
        const i = last.data.indexOf(text!);
        const r = document.createRange();
        r.setStart(last, i);
        r.setEnd(last, i + text!.length);
        const s = getSelection()!;
        s.removeAllRanges();
        s.addRange(r);
        document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      },
      [scope, needle],
    );
    await expect(menu).toBeVisible({ timeout: 500 });
  }).toPass();
  await menu.click();
  await expect(page.getByText(`마지막 문장 [${needle}].`).last()).toBeVisible();
}

async function askRoot(page: Page, text: string) {
  const main = page.locator('[data-panel="main"]');
  await main.getByLabel('메시지 입력').fill(text);
  await main.getByRole('button', { name: '보내기' }).click();
  await expect(main.getByText(`마지막 문장 [${text.slice(0, 12)}].`)).toBeVisible();
}

test('잘못된 키는 거부되고, 저장된 키는 평문으로 노출되지 않는다', async ({ page }) => {
  await page.goto('/');
  await setKey(page, 'sk-ant-wrong');
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText(/거부|유효하지|확인/);
  const input = page.getByLabel('Anthropic API 키');
  await input.fill(KEY);
  await input.press('Enter');
  await expect(dialog).toContainText('연결됨');
  await expect(dialog).not.toContainText(KEY);
});

test('루트 질문 → 3단계 가지 → 요약 카드 → 새로고침 후 유지', async ({ page }, info) => {
  const errors = collectErrors(page);
  const mobile = info.project.name === 'mobile';
  await page.goto('/');
  await setKey(page, KEY);
  await page.keyboard.press('Escape');

  await askRoot(page, '어텐션을 한 문단으로 설명해줘');
  await branchFrom(page, '[data-panel="main"]', '쿼리와 키의 유사도');
  const sub = mobile ? '[role="dialog"]' : '[role="dialog"], [data-popup]';
  await branchFrom(page, sub, '가중합');
  await branchFrom(page, sub, '소프트맥스');

  // 깊이 3 서브세션의 breadcrumb
  await expect(page.getByText('소프트맥스').first()).toBeVisible();

  // 요약 → 부모에 카드
  await page.getByRole('button', { name: '부모에 요약 붙이기' }).last().click();
  await expect(page.getByText('요약[소프트맥스]').last()).toBeVisible();
  await page.getByRole('button', { name: /^(부모에 붙이기|요약 교체)$/ }).last().click();
  await expect(page.getByText(/가지 요약 · /).first()).toBeAttached();

  // 루트 답변에 앵커가 남는다
  await expect(page.locator('mark.anchor').first()).toBeAttached();
  const anchors = await page.locator('mark.anchor').count();

  // 새로고침 후 트리·앵커·요약 유지 (키는 세션 메모리라 다시 필요 없음 — 저장 데이터만 확인)
  await page.reload();
  await expect(page.locator('[data-panel="main"]').getByText('마지막 문장 [어텐션을 한 문단으로 ].')).toBeVisible();
  await expect(page.locator('mark.anchor').first()).toBeAttached();
  expect(await page.locator('mark.anchor').count()).toBeGreaterThanOrEqual(Math.min(anchors, 1));
  expect(errors).toEqual([]);
});

test('보기 모드(분할·마인드맵)와 Cmd+K 검색', async ({ page }, info) => {
  test.skip(info.project.name === 'mobile', '모바일은 탭/전체화면 규칙이라 데스크톱에서 검증');
  const errors = collectErrors(page);
  await page.goto('/');
  await setKey(page, KEY);
  await page.keyboard.press('Escape');
  await askRoot(page, '행렬 곱을 알려줘');
  await branchFrom(page, '[data-panel="main"]', '스케일링');

  const modes = page.getByRole('radiogroup', { name: '보기 모드' });
  await modes.getByRole('radio', { name: /분할/ }).click();
  await expect(page.locator('[data-panel]')).not.toHaveCount(0);
  await modes.getByRole('radio', { name: /마인드맵/ }).click();
  await expect(page.locator('.react-flow__node').first()).toBeVisible();
  expect(await page.locator('.react-flow__node').count()).toBeGreaterThanOrEqual(2);

  await page.keyboard.press('ControlOrMeta+k');
  const search = page.getByRole('dialog').getByRole('textbox').first();
  await expect(search).toBeVisible();
  await search.fill('스케일링');
  await expect(page.getByRole('dialog').getByText('스케일링').first()).toBeVisible();
  expect(errors).toEqual([]);
});

test('데모 시나리오는 오류 없이 렌더된다', async ({ page }) => {
  const errors = collectErrors(page);
  for (const id of ['home', 'deep', 'summary', 'split', 'mindmap', 'search', 'settings', 'offline']) {
    await page.goto(`/#scenario=${id}`);
    await expect(page.locator('#root')).not.toBeEmpty();
  }
  expect(errors).toEqual([]);
});
