import { providerError, type StreamEvent } from '@branch/core';
import { classifyCliError, type CliErrorContext } from './errors';
import { isObj, str, type CliParser } from './parser';
import type { RunResult } from './run';

export const CLAUDE_CTX: CliErrorContext = { label: 'Claude CLI', loginHint: 'claude auth login' };

/**
 * 공식 claude CLI 무상태 실행 인자 (03-PROVIDERS 정책).
 * 도구 전부 비활성, 세션 저장 안 함, MCP/사용자 설정 미적용. 프롬프트는 stdin으로 넘긴다.
 */
export function claudeArgs(opts: { systemFile: string; model?: string }): string[] {
  return [
    '-p',
    '--output-format',
    'stream-json',
    '--verbose',
    '--include-partial-messages',
    '--tools',
    '',
    '--system-prompt-file',
    opts.systemFile,
    '--no-session-persistence',
    '--strict-mcp-config',
    '--setting-sources',
    '',
    ...(opts.model ? ['--model', opts.model] : []),
  ];
}

function textOf(content: unknown): string {
  if (!Array.isArray(content)) return '';
  return content
    .map((b) => (isObj(b) && b.type === 'text' ? (str(b.text) ?? '') : ''))
    .join('');
}

export function createClaudeParser(): CliParser {
  let sawPartial = false;
  let emitted = false;
  /** 오류 시 CLI가 만드는 합성 메시지(model "<synthetic>")의 문구 */
  let synthetic = '';

  return {
    line(obj) {
      if (!isObj(obj)) return [];
      if (obj.type === 'stream_event' && isObj(obj.event)) {
        const ev = obj.event;
        if (ev.type === 'content_block_delta' && isObj(ev.delta) && ev.delta.type === 'text_delta') {
          const text = str(ev.delta.text) ?? '';
          if (!text) return [];
          sawPartial = true;
          emitted = true;
          return [{ type: 'delta', text }];
        }
        return [];
      }
      if (obj.type === 'assistant' && isObj(obj.message)) {
        const text = textOf(obj.message.content);
        if (obj.message.model === '<synthetic>') {
          synthetic = text;
          return [];
        }
        // 부분 메시지가 꺼져 있거나 오지 않았을 때만 완성 메시지를 쓴다
        if (sawPartial || !text) return [];
        emitted = true;
        return [{ type: 'delta', text }];
      }
      if (obj.type === 'result') {
        const isError = obj.is_error === true || (str(obj.subtype) ?? 'success') !== 'success' || !!synthetic;
        if (isError) {
          const errors = Array.isArray(obj.errors) ? obj.errors.filter((e) => typeof e === 'string').join(' ') : '';
          const raw = [str(obj.result), synthetic, errors, str(obj.subtype)].filter(Boolean).join(' ');
          return [{ type: 'error', error: classifyCliError(raw, CLAUDE_CTX) }];
        }
        if (!emitted && str(obj.result)) {
          return [{ type: 'delta', text: str(obj.result)! }, done(obj.stop_reason)];
        }
        return [done(obj.stop_reason)];
      }
      return [];
    },
    finish(res) {
      return finishFromExit(res, synthetic, CLAUDE_CTX);
    },
  };
}

function done(stopReason: unknown): StreamEvent {
  const s = str(stopReason);
  return { type: 'done', ...(s ? { stopReason: s } : {}) };
}

/** 종료 이벤트 없이 프로세스가 끝났을 때 */
export function finishFromExit(res: RunResult, extra: string, ctx: CliErrorContext): StreamEvent {
  if (res.aborted) return { type: 'error', error: providerError('aborted', '사용자가 중지했습니다.') };
  if (res.notFound) return { type: 'error', error: providerError('cli', `${ctx.label}가 설치되어 있지 않거나 PATH에서 찾을 수 없습니다.`) };
  if (res.timedOut) return { type: 'error', error: providerError('network', `${ctx.label} 응답 시간이 초과되었습니다.`) };
  return { type: 'error', error: classifyCliError([extra, res.stderr].filter(Boolean).join(' ') || `종료 코드 ${res.code ?? '?'}`, ctx) };
}
