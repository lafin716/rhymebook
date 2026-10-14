import type { Availability, BridgeStatus } from '@branch/core';
import type { CliEnv } from './env';
import { runCli, type RunResult } from './run';

/**
 * 명령 하나의 제한 시간. Windows에서는 백신 검사 등으로 `codex --version`조차 15~20초 걸릴 수 있어
 * 넉넉히 둔다. 클라이언트 대기 시간(core bridge client의 statusTimeoutMs)보다 짧아야 한다.
 */
export const DETECT_TIMEOUT_MS = 40_000;

function firstLine(s: string): string {
  return s.trim().split('\n')[0]?.trim() ?? '';
}

/** 버전 문자열에서 숫자 버전만 (예: "2.1.283 (Claude Code)" → "2.1.283") */
function versionOf(s: string): string {
  return s.match(/\d+\.\d+(\.\d+)?/)?.[0] ?? firstLine(s).slice(0, 40);
}

function notFound(r: RunResult): boolean {
  return r.notFound || r.code === 127;
}

const SLOW = '응답이 늦어 확인하지 못했습니다 · 채팅은 시도할 수 있습니다';

/**
 * 버전 확인과 로그인 확인을 동시에 실행한다(순차 실행하면 느린 환경에서 시간이 두 배로 든다).
 * 실패 판정: 명령 없음 → not-installed, 시간 초과 → offline(느림), 그 밖의 실패 → offline.
 */
async function probe(cli: CliEnv, bin: string, authArgs: string[]): Promise<{ ver: RunResult; st: RunResult }> {
  const run = (args: string[]) => runCli({ bin, args, env: cli.env, timeoutMs: DETECT_TIMEOUT_MS });
  const [ver, st] = await Promise.all([run(['--version']), run(authArgs)]);
  return { ver, st };
}

/**
 * Claude CLI 상태. 공식 `claude auth status --json`만 사용한다 (인증 파일 읽기 금지).
 * 이메일 등 계정 정보는 표시하지 않는다.
 */
export async function detectClaude(cli: CliEnv): Promise<Availability> {
  const { ver, st } = await probe(cli, cli.bin['claude-cli'], ['auth', 'status', '--json']);
  if (notFound(ver) || notFound(st)) return { status: 'not-installed', detail: 'claude 명령을 찾을 수 없습니다' };
  if (ver.timedOut && st.timedOut) return { status: 'offline', detail: `Claude Code · ${SLOW}` };
  const version = ver.code === 0 ? `Claude Code ${versionOf(ver.stdout)}` : 'Claude Code';
  if (st.timedOut) return { status: 'offline', detail: `${version} · ${SLOW}` };

  let loggedIn = st.code === 0;
  let method = '';
  try {
    const parsed = JSON.parse(st.stdout) as { loggedIn?: unknown; authMethod?: unknown };
    if (typeof parsed.loggedIn === 'boolean') loggedIn = parsed.loggedIn;
    if (typeof parsed.authMethod === 'string') method = parsed.authMethod;
  } catch {
    // 구버전: 종료 코드로 판단
  }
  if (!loggedIn) {
    if (ver.code !== 0) return { status: 'offline', detail: 'claude 실행에 실패했습니다' };
    return { status: 'not-logged-in', detail: `${version} · 로그인 필요` };
  }
  return { status: 'ready', detail: `${version} · 로그인됨${method && method !== 'none' ? ` (${method})` : ''}` };
}

/** Codex CLI 상태. 공식 `codex login status`의 종료 코드만 사용한다 (auth.json 읽기 금지) */
export async function detectCodex(cli: CliEnv): Promise<Availability> {
  const { ver, st } = await probe(cli, cli.bin['codex-cli'], ['login', 'status']);
  if (notFound(ver) || notFound(st)) return { status: 'not-installed', detail: 'codex 명령을 찾을 수 없습니다' };
  if (ver.timedOut && st.timedOut) return { status: 'offline', detail: `Codex · ${SLOW}` };
  const version = ver.code === 0 ? `Codex ${versionOf(ver.stdout)}` : 'Codex';
  if (st.timedOut) return { status: 'offline', detail: `${version} · ${SLOW}` };
  if (st.code !== 0) {
    if (ver.code !== 0) return { status: 'offline', detail: 'codex 실행에 실패했습니다' };
    return { status: 'not-logged-in', detail: `${version} · 로그인 필요` };
  }
  // 출력에 키 일부가 포함될 수 있으므로 방식만 추려 표시한다
  const out = `${st.stdout} ${st.stderr}`;
  const method = /chatgpt/i.test(out) ? 'ChatGPT' : /api key/i.test(out) ? 'API 키' : '';
  return { status: 'ready', detail: `${version} · 로그인됨${method ? ` (${method})` : ''}` };
}

export async function detectAll(cli: CliEnv): Promise<BridgeStatus> {
  const [claude, codex] = await Promise.all([detectClaude(cli), detectCodex(cli)]);
  return { 'claude-cli': claude, 'codex-cli': codex };
}
