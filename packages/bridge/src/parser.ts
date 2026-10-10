import type { StreamEvent } from '@branch/core';
import type { RunResult } from './run';

/** CLI JSON 줄 스트림 → StreamEvent. 종료 이벤트(done/error)는 한 번만 낸다 */
export interface CliParser {
  line(obj: unknown): StreamEvent[];
  /** 프로세스 종료 시점까지 종료 이벤트가 없었을 때의 마무리 */
  finish(res: RunResult): StreamEvent;
}

export type Json = Record<string, unknown>;

export function isObj(v: unknown): v is Json {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function str(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}
