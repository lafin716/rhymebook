import { type StreamEvent } from '@branch/core';
import { finishFromExit } from './claude';
import { classifyCliError, type CliErrorContext } from './errors';
import { isObj, str, type CliParser } from './parser';

export const CODEX_CTX: CliErrorContext = { label: 'Codex CLI', loginHint: 'codex login' };

/**
 * 대화에 필요 없는 에이전트 기능. 켜 두면 모델이 셸 명령(win32는 PowerShell)·플러그인·앱을
 * 시작하거나 호출해 답이 크게 늦어진다. --disable은 모르는 이름이면 실패하므로,
 * 버전에 없는 키를 무시하는 -c features.<name>=false로 끈다.
 */
const CODEX_OFF_FEATURES = [
  'shell_tool',
  'unified_exec',
  'apps',
  'plugins',
  'multi_agent',
  'browser_use',
  'browser_use_external',
  'computer_use',
  'in_app_browser',
  'image_generation',
  'view_image',
  'skill_search',
  'tool_suggest',
  'goals',
  'sleep_tool',
  'code_mode_host',
  'workspace_dependencies',
  'hooks',
  'memories',
];

/**
 * 공식 codex CLI 무상태 실행 인자. 읽기 전용 샌드박스, 세션 파일 저장 안 함,
 * 사용자 config.toml/rules 미적용(앱이 모델과 지시를 정한다), 도구 비활성. 프롬프트는 stdin('-').
 * 값에 따옴표를 넣지 않는다 — win32 cmd 경유 시 이스케이프가 깨진다(TOML이 아니면 문자열로 읽힌다).
 */
export function codexArgs(opts: { model?: string; effort?: string; images?: string[]; imageGen?: boolean }): string[] {
  // 이미지 생성은 일반 대화에서만 켠다 (ADR-041). 결과는 runChat이 generated_images에서 거둔다
  const off = opts.imageGen ? CODEX_OFF_FEATURES.filter((f) => f !== 'image_generation') : CODEX_OFF_FEATURES;
  return [
    'exec',
    // --image는 값을 여러 개 받으므로 다른 옵션 앞에 둬 마지막 '-'(stdin)를 먹지 않게 한다
    ...(opts.images ?? []).flatMap((f) => ['--image', f]),
    '--json',
    '--sandbox',
    'read-only',
    '--skip-git-repo-check',
    '--ephemeral',
    '--ignore-user-config',
    '--ignore-rules',
    '--color',
    'never',
    // --ignore-user-config 여도 -c 덮어쓰기는 적용된다
    ...off.flatMap((f) => ['-c', `features.${f}=false`]),
    '-c',
    'web_search=disabled',
    ...(opts.model ? ['-m', opts.model] : []),
    ...(opts.effort ? ['-c', `model_reasoning_effort=${opts.effort}`] : []),
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
export function createCodexParser(): CliParser & { threadId(): string | undefined } {
  const sent = new Map<string, number>();
  let any = false;
  let lastError = '';
  let thread: string | undefined;

  return {
    threadId: () => thread,
    line(obj) {
      if (!isObj(obj)) return [];
      const t = str(obj.type);
      if (t === 'thread.started') {
        thread = str(obj.thread_id);
        return [];
      }
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
