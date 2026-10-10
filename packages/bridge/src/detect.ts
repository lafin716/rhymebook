import type { Availability, BridgeStatus } from '@branch/core';
import type { CliEnv } from './env';
import { runCli } from './run';

const TIMEOUT = 15_000;

function firstLine(s: string): string {
  return s.trim().split('\n')[0]?.trim() ?? '';
}

/** 버전 문자열에서 숫자 버전만 (예: "2.1.283 (Claude Code)" → "2.1.283") */
function versionOf(s: string): string {
  return s.match(/\d+\.\d+(\.\d+)?/)?.[0] ?? firstLine(s).slice(0, 40);
}

/**
 * Claude CLI 상태. 공식 `claude auth status --json`만 사용한다 (인증 파일 읽기 금지).
 * 이메일 등 계정 정보는 표시하지 않는다.
 */
export async function detectClaude(cli: CliEnv): Promise<Availability> {
  const bin = cli.bin['claude-cli'];
  const ver = await runCli({ bin, args: ['--version'], env: cli.env, timeoutMs: TIMEOUT });
  if (ver.notFound || ver.code === 127) return { status: 'not-installed', detail: 'claude 명령을 찾을 수 없습니다' };
  if (ver.code !== 0) return { status: 'offline', detail: 'claude --version 실행에 실패했습니다' };
  const version = `Claude Code ${versionOf(ver.stdout)}`;

  const st = await runCli({ bin, args: ['auth', 'status', '--json'], env: cli.env, timeoutMs: TIMEOUT });
  let loggedIn = st.code === 0;
  let method = '';
  try {
    const parsed = JSON.parse(st.stdout) as { loggedIn?: unknown; authMethod?: unknown };
    if (typeof parsed.loggedIn === 'boolean') loggedIn = parsed.loggedIn;
    if (typeof parsed.authMethod === 'string') method = parsed.authMethod;
  } catch {
    // 구버전: 종료 코드로 판단
  }
  if (!loggedIn) return { status: 'not-logged-in', detail: `${version} · 로그인 필요` };
  return { status: 'ready', detail: `${version} · 로그인됨${method && method !== 'none' ? ` (${method})` : ''}` };
}

/** Codex CLI 상태. 공식 `codex login status`의 종료 코드만 사용한다 (auth.json 읽기 금지) */
export async function detectCodex(cli: CliEnv): Promise<Availability> {
  const bin = cli.bin['codex-cli'];
  const ver = await runCli({ bin, args: ['--version'], env: cli.env, timeoutMs: TIMEOUT });
  if (ver.notFound || ver.code === 127) return { status: 'not-installed', detail: 'codex 명령을 찾을 수 없습니다' };
  if (ver.code !== 0) return { status: 'offline', detail: 'codex --version 실행에 실패했습니다' };
  const version = `Codex ${versionOf(ver.stdout)}`;

  const st = await runCli({ bin, args: ['login', 'status'], env: cli.env, timeoutMs: TIMEOUT });
  if (st.code !== 0) return { status: 'not-logged-in', detail: `${version} · 로그인 필요` };
  // 출력에 키 일부가 포함될 수 있으므로 방식만 추려 표시한다
  const out = `${st.stdout} ${st.stderr}`;
  const method = /chatgpt/i.test(out) ? 'ChatGPT' : /api key/i.test(out) ? 'API 키' : '';
  return { status: 'ready', detail: `${version} · 로그인됨${method ? ` (${method})` : ''}` };
}

export async function detectAll(cli: CliEnv): Promise<BridgeStatus> {
  const [claude, codex] = await Promise.all([detectClaude(cli), detectCodex(cli)]);
  return { 'claude-cli': claude, 'codex-cli': codex };
}
