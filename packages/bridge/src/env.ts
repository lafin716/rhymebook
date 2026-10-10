import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import type { CliProviderId } from '@branch/core';

export interface CliEnv {
  env: NodeJS.ProcessEnv;
  bin: Record<CliProviderId, string>;
}

const MARK = '__BRANCH_PATH__';

/**
 * GUI로 실행된 Electron은 로그인 셸의 PATH를 물려받지 못한다(macOS).
 * 로그인 셸에서 PATH만 읽어 오고, 흔한 설치 위치를 덧붙인다.
 */
function loginShellPath(timeoutMs = 4000): Promise<string | null> {
  if (process.platform === 'win32') return Promise.resolve(null);
  const shell = process.env.SHELL || '/bin/zsh';
  return new Promise((resolve) => {
    let out = '';
    const child = spawn(shell, ['-ilc', `printf '${MARK}%s${MARK}' "$PATH"`], {
      stdio: ['ignore', 'pipe', 'ignore'],
      env: process.env,
    });
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      resolve(null);
    }, timeoutMs);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (c: string) => (out += c));
    child.on('error', () => {
      clearTimeout(timer);
      resolve(null);
    });
    child.on('close', () => {
      clearTimeout(timer);
      const m = out.match(new RegExp(`${MARK}(.*)${MARK}`, 's'));
      resolve(m?.[1] ?? null);
    });
  });
}

function extraDirs(): string[] {
  const home = os.homedir();
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA;
    return appData ? [path.join(appData, 'npm')] : [];
  }
  return [path.join(home, '.local/bin'), path.join(home, '.npm-global/bin'), '/opt/homebrew/bin', '/usr/local/bin'];
}

export function mergePath(...parts: (string | null | undefined)[]): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of parts) {
    for (const dir of (p ?? '').split(path.delimiter)) {
      if (dir && !seen.has(dir)) {
        seen.add(dir);
        out.push(dir);
      }
    }
  }
  return out.join(path.delimiter);
}

/**
 * CLI 실행 환경. BRANCH_CLAUDE_BIN / BRANCH_CODEX_BIN으로 실행 파일을 지정할 수 있다.
 * 인증 정보 파일은 읽지 않는다 — CLI가 스스로 읽도록 HOME 등 환경만 그대로 넘긴다.
 */
export async function resolveCliEnv(base: NodeJS.ProcessEnv = process.env, opts: { loginShell?: boolean } = {}): Promise<CliEnv> {
  const shellPath = opts.loginShell === false ? null : await loginShellPath();
  const PATH = mergePath(base.PATH, shellPath, extraDirs().join(path.delimiter));
  return {
    env: { ...base, PATH, NO_COLOR: '1' },
    bin: {
      'claude-cli': base.BRANCH_CLAUDE_BIN || 'claude',
      'codex-cli': base.BRANCH_CODEX_BIN || 'codex',
    },
  };
}
