/** 지수 백오프 재시도 헬퍼 */
export interface RetryOptions {
  attempts: number;
  baseDelayMs: number;
  shouldRetry: (err: unknown) => boolean;
}

export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i < opts.attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (!opts.shouldRetry(err) || i === opts.attempts - 1) break;
      await new Promise((r) => setTimeout(r, opts.baseDelayMs * 2 ** i));
    }
  }
  throw lastError;
}
