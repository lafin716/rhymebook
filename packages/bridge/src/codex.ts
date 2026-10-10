import { type StreamEvent } from '@branch/core';
import { finishFromExit } from './claude';
import { classifyCliError, type CliErrorContext } from './errors';
import { isObj, str, type CliParser } from './parser';

export const CODEX_CTX: CliErrorContext = { label: 'Codex CLI', loginHint: 'codex login' };

/**
 * 공식 codex CLI 무상태 실행 인자. 읽기 전용 샌드박스, 세션 파일 저장 안 함,
 * 사용자 config.toml/rules 미적용(앱이 모델과 지시를 정한다). 프롬프트는 stdin('-').
 */
export function codexArgs(opts: { model?: string }): string[] {
  return [
    'exec',
    '--json',
    '--sandbox',
    'read-only',
    '--skip-git-repo-check',
    '--ephemeral',
    '--ignore-user-config',
    '--ignore-rules',
    '--color',
    'never',
    ...(opts.model ? ['-m', opts.model] : []),
    '-',
  ];
}

/** turn.failed / error 이벤트의 message는 JSON 문자열일 때가 있다 */
function innerMessage(raw: string): string {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (isObj(parsed)) {
      const err = parsed.error;
      if (isObj(err) && str(err.message)) return str(err.message)!;
      if (str(parsed.detail)) return str(parsed.detail)!;
      if (str(parsed.message)) return str(parsed.message)!;
    }
  } catch {
    // 일반 문자열
  }
  return raw;
}

/**
 * codex exec --json은 토큰 단위 델타가 없고 agent_message 항목 단위로 온다.
 * item.updated가 오면 그만큼, 아니면 item.completed에서 한 번에 내보낸다.
 */
export function createCodexParser(): CliParser {
  const sent = new Map<string, number>();
  let any = false;
  let lastError = '';

  return {
    line(obj) {
      if (!isObj(obj)) return [];
      const t = str(obj.type);
      if ((t === 'item.started' || t === 'item.updated' || t === 'item.completed') && isObj(obj.item)) {
        const item = obj.item;
        if (item.type !== 'agent_message') return [];
        const text = str(item.text) ?? '';
        const id = str(item.id) ?? 'item';
        const prev = sent.get(id);
        const from = prev ?? 0;
        if (text.length <= from) return [];
        const sep = prev === undefined && any ? '\n\n' : '';
        sent.set(id, text.length);
        any = true;
        return [{ type: 'delta', text: sep + text.slice(from) }];
      }
      if (t === 'error') {
        lastError = innerMessage(str(obj.message) ?? '');
        return [];
      }
      if (t === 'turn.failed') {
        const msg = isObj(obj.error) ? innerMessage(str(obj.error.message) ?? '') : '';
        return [{ type: 'error', error: classifyCliError(msg || lastError, CODEX_CTX) }];
      }
      if (t === 'turn.completed') {
        const ev: StreamEvent = { type: 'done', stopReason: 'end_turn' };
        return [ev];
      }
      return [];
    },
    finish(res) {
      return finishFromExit(res, lastError, CODEX_CTX);
    },
  };
}
