import { defineConfig, devices } from '@playwright/test';

/**
 * 핵심 플로우 E2E (Phase 7).
 * 실제 모드(데모 아님) 웹 앱을 모의 Anthropic SSE 서버에 붙여 돌린다. 실제 키·네트워크 불필요.
 *   pnpm e2e            (최초 1회: pnpm exec playwright install chromium)
 */
const MOCK_PORT = 8799;
const APP_PORT = 5191;

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  outputDir: 'test-results',
  use: { baseURL: `http://localhost:${APP_PORT}`, trace: 'retain-on-failure' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'mobile', use: { ...devices['Desktop Chrome'], viewport: { width: 390, height: 844 }, hasTouch: true } },
  ],
  webServer: [
    {
      command: `node e2e/mock-anthropic.mjs`,
      url: `http://127.0.0.1:${MOCK_PORT}/health`,
      env: { MOCK_ANTHROPIC_PORT: String(MOCK_PORT) },
      reuseExistingServer: !process.env.CI,
    },
    {
      command: `pnpm --filter @branch/ui exec vite --port ${APP_PORT} --strictPort`,
      url: `http://localhost:${APP_PORT}`,
      env: { VITE_ANTHROPIC_BASE_URL: `http://127.0.0.1:${MOCK_PORT}` },
      reuseExistingServer: !process.env.CI,
    },
  ],
});
