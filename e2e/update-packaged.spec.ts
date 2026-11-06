import { _electron, expect, test, type ElectronApplication } from '@playwright/test';
import { mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

/**
 * ADR-118 앱 업데이트 패키지 앱 Smoke. 실제 main 프로세스 updater·IPC·preload·알림 UI를 쓰고,
 * GitHub API(releases/latest) 응답만 main 프로세스의 https 핸들러로 바꾼다.
 * 미서명 macOS 빌드는 manual 모드(알림 + 다운로드 페이지 열기)로 동작한다.
 * 패키징 후 `RHYMEBOOK_PACKAGED=1 pnpm exec playwright test e2e/update-packaged.spec.ts --project=desktop`.
 */

type Reply = { status: number; body?: unknown };

/** api.github.com/repos/lafin716/octobooks/releases/latest 응답을 바꾼다. 다른 https 요청은 그대로 보낸다 */
async function mockLatest(app: ElectronApplication, reply: Reply) {
  await app.evaluate(({ protocol, net }, r) => {
    const g = globalThis as unknown as { __updReply: Reply; __updHits: number; __updInstalled?: boolean };
    g.__updReply = r;
    if (g.__updInstalled) return;
    g.__updInstalled = true;
    g.__updHits = 0;
    protocol.handle('https', (req) => {
      if (req.url.startsWith('https://api.github.com/repos/lafin716/octobooks/releases/latest')) {
        g.__updHits++;
        const cur = g.__updReply;
        return new Response(cur.body === undefined ? '' : JSON.stringify(cur.body), {
          status: cur.status,
          headers: { 'content-type': 'application/json' },
        });
      }
      return net.fetch(req, { bypassCustomProtocolHandlers: true });
    });
  }, reply);
}

const hits = (app: ElectronApplication) => app.evaluate(() => (globalThis as unknown as { __updHits: number }).__updHits);

const release = (version: string, extra: Record<string, unknown> = {}) => ({
  tag_name: `v${version}`,
  name: `OctoBooks ${version}`,
  body: '## 변경 사항\n- 앱 안에서 업데이트\n- 버그 수정',
  draft: false,
  prerelease: false,
  published_at: '2026-11-06T00:00:00Z',
  ...extra,
});

test('패키지 앱: 업데이트 확인·알림·나중에·오류 처리 (ADR-118)', async ({ browserName }, testInfo) => {
  test.skip(process.env.RHYMEBOOK_PACKAGED !== '1' || testInfo.project.name !== 'desktop' || browserName !== 'chromium', '패키징 후 RHYMEBOOK_PACKAGED=1로 실행');
  test.setTimeout(120_000);
  const userData = path.join(await mkdtemp(path.join(os.tmpdir(), 'octobooks-update-smoke-')), 'userData');
  const exe = process.env.RHYMEBOOK_EXE ?? 'apps/desktop/release/mac-arm64/OctoBooks.app/Contents/MacOS/OctoBooks';
  const app = await _electron.launch({ executablePath: path.resolve(exe), env: { ...process.env, BRANCH_USER_DATA: userData } });
  const log = (m: string) => console.log(`[update-smoke] ${m}`);
  try {
    // 자동 확인(실행 10초 뒤)보다 먼저 응답을 바꿔 둔다: 처음에는 최신 버전
    await mockLatest(app, { status: 404 });
    const page = await app.firstWindow();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await expect(page.locator('#root')).not.toBeEmpty();

    await app.evaluate(({ shell }) => {
      const g = globalThis as unknown as { __opened: string[] };
      g.__opened = [];
      (shell as unknown as { openExternal: (u: string) => Promise<void> }).openExternal = async (u: string) => {
        g.__opened.push(u);
      };
    });

    const mode = await page.evaluate(async () => (await (window as unknown as { branchDesktop: { updater: { getState(): Promise<{ mode: string; currentVersion: string }> } } }).branchDesktop.updater.getState()));
    log(`mode=${mode.mode} version=${mode.currentVersion}`);
    expect(mode.mode).not.toBe('disabled');

    // 처음 실행: 언어 선택(한국어 그대로) → 시작 안내 닫기
    const lang = page.getByRole('dialog', { name: '언어 선택' });
    await lang.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
    if (await lang.isVisible().catch(() => false)) {
      await lang.getByRole('button', { name: '시작하기' }).click();
      await expect(lang).toHaveCount(0);
    }
    const onboarding = page.getByRole('dialog', { name: '시작하기' });
    await onboarding.waitFor({ state: 'visible', timeout: 3000 }).catch(() => {});
    if (await onboarding.isVisible().catch(() => false)) await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.getByRole('button', { name: '설정', exact: true }).click();
    const settings = page.getByRole('dialog', { name: '설정', exact: true });
    await settings.getByRole('tab', { name: '일반', exact: true }).click();
    const section = settings.getByTestId('update-settings');
    await expect(section).toBeVisible();
    await expect(section).toContainText(`현재 버전 ${mode.currentVersion}`);
    const checkBtn = section.getByRole('button', { name: '업데이트 확인' });
    const notice = page.getByTestId('update-notice');
    // 수동 확인은 5초 간격 제한이 있다 (UPDATE_DEFAULTS.manualCooldownMs)
    const cool = () => page.waitForTimeout(5_300);

    // 1. 정식 릴리스 없음(404) → 최신, 알림 없음
    await checkBtn.click();
    await expect(section).toContainText('최신 버전을 쓰고 있어요.');
    await expect(notice).toBeHidden();
    log('1 최신(404) → 알림 없음 OK');
    const h1 = await hits(app);
    await checkBtn.click();
    await page.waitForTimeout(500);
    expect(await hits(app)).toBe(h1);
    log('1b 5초 안 재확인은 요청하지 않음 OK');

    // 2. 같은 버전 → 알림 없음
    await mockLatest(app, { status: 200, body: release(mode.currentVersion) });
    await cool();
    await checkBtn.click();
    await expect(section).toContainText('최신 버전을 쓰고 있어요.');
    await expect(notice).toBeHidden();
    log('2 같은 버전 → 알림 없음 OK');

    // 3. prerelease → 무시
    await mockLatest(app, { status: 200, body: release('99.0.0-beta.1', { prerelease: true }) });
    await cool();
    await checkBtn.click();
    await expect(section).toContainText('최신 버전을 쓰고 있어요.');
    await expect(notice).toBeHidden();
    log('3 prerelease 무시 OK');

    // 4. 네트워크/서버 오류 → 설정에 안내, 알림 카드는 띄우지 않음, 앱 계속 동작
    await mockLatest(app, { status: 500 });
    await cool();
    await checkBtn.click();
    await expect(section.getByRole('alert')).toBeVisible();
    await expect(notice).toBeHidden();
    // 요청 한도
    await mockLatest(app, { status: 403 });
    await cool();
    await checkBtn.click();
    await expect(section.getByRole('alert')).toContainText('요청 한도');
    log('4 오류(500·403) → 설정 안내, 앱 정상 OK');

    // 5. 새 정식 버전 → 알림 카드 (버전·변경 사항·버튼)
    await mockLatest(app, { status: 200, body: release('99.0.0') });
    await cool();
    await checkBtn.click();
    await expect(section).toContainText('새 버전 99.0.0');
    await settings.getByRole('button', { name: '설정 닫기' }).click();
    await expect(notice).toBeVisible();
    await expect(notice).toContainText(`현재 ${mode.currentVersion} → 새 버전 99.0.0`);
    await notice.getByRole('button', { name: '변경 사항 보기' }).click();
    await expect(notice.getByTestId('update-notes')).toContainText('앱 안에서 업데이트');
    if (mode.mode === 'manual') {
      await notice.getByRole('button', { name: '다운로드 페이지 열기' }).click();
      await expect.poll(() => app.evaluate(() => (globalThis as unknown as { __opened: string[] }).__opened)).toEqual([
        'https://github.com/lafin716/octobooks/releases/tag/v99.0.0',
      ]);
    } else {
      await expect(notice.getByRole('button', { name: '업데이트 다운로드' })).toBeVisible();
    }
    log('5 새 버전 알림·변경 사항·릴리스 페이지 OK');
    await page.screenshot({ path: testInfo.outputPath('update-notice-desktop.png') });

    // 6. 나중에 → 숨김, 자동 확인이 다시 같은 버전을 찾아도 안 띄움
    await notice.getByRole('button', { name: '나중에' }).click();
    await expect(notice).toBeHidden();
    const before = await hits(app);
    await cool();
    await page.evaluate(() => (window as unknown as { branchDesktop: { updater: { check(): Promise<unknown> } } }).branchDesktop.updater.check());
    expect(await hits(app)).toBeGreaterThan(before);
    await expect(notice).toBeHidden();
    log('6 나중에 → 같은 버전 재알림 없음 OK');

    // 7. 더 새 버전이 나오면 다시 알림
    await mockLatest(app, { status: 200, body: release('99.1.0') });
    await cool();
    await page.evaluate(() => (window as unknown as { branchDesktop: { updater: { check(): Promise<unknown> } } }).branchDesktop.updater.check());
    await expect(notice).toBeVisible();
    await expect(notice).toContainText('99.1.0');
    log('7 다음 버전 재알림 OK');

    // 8. 중복 확인 요청 → 한 번만 조회
    await cool();
    const b2 = await hits(app);
    await page.evaluate(async () => {
      const u = (window as unknown as { branchDesktop: { updater: { check(): Promise<unknown> } } }).branchDesktop.updater;
      await Promise.all([u.check(), u.check(), u.check()]);
    });
    expect((await hits(app)) - b2).toBe(1);
    log('8 동시 확인 3회 → 조회 1회 OK');

    expect(errors).toEqual([]);
  } finally {
    await app.close();
  }
});
