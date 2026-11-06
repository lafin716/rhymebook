import { defineConfig } from 'vitest/config';

// 수동 평가 전용 설정. `pnpm test`(vitest run)에는 포함되지 않는다.
export default defineConfig({
  test: {
    include: ['eval/**/*.eval.ts'],
    testTimeout: 60 * 60 * 1000,
    hookTimeout: 60 * 60 * 1000,
  },
});
