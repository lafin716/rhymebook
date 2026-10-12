import { spawn } from 'node:child_process';

/** win32의 npm 셸 래퍼(.cmd)를 실행하려면 shell이 필요하다. 그때만 인자를 따옴표로 감싼다 */
const IS_WIN = process.platform === 'win32';

/** cmd.exe 명령줄용 인자. 빈 문자열은 ""로 남겨야 사라지지 않는다(--setting-sources '' 등) */
export function winQuote(arg: string): string {
  if (arg === '') return '""';
  return /[\s"&|<>^]/.test(arg) ? `"${arg.replace(/"/g, '""')}"` : arg;
}

export interface RunOptions {
  bin: string;
  args: string[];
  stdin?: string;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  signal?: AbortSignal;
  timeoutMs?: number;
  /** stdout 한 줄마다 호출 */
  onLine?: (line: string) => void;
}

export interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
  notFound: boolean;
  timedOut: boolean;
  aborted: boolean;
}

const MAX_CAPTURE = 64 * 1024;

/** CLI를 실행하고 stdout을 줄 단위로 넘긴다. 실패해도 throw하지 않고 결과로 돌려준다 */
export function runCli(opts: RunOptions): Promise<RunResult> {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let buf = '';
    let timedOut = false;
    let aborted = false;
    let settled = false;
    const finish = (r: Omit<RunResult, 'stdout' | 'stderr' | 'timedOut' | 'aborted'>) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(killTimer);
      opts.signal?.removeEventListener('abort', onAbort);
      resolve({ ...r, stdout, stderr, timedOut, aborted });
    };

    const child = spawn(IS_WIN ? winQuote(opts.bin) : opts.bin, IS_WIN ? opts.args.map(winQuote) : opts.args, {
      cwd: opts.cwd,
      env: opts.env,
      shell: IS_WIN,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let killTimer: ReturnType<typeof setTimeout> | undefined;
    const stop = () => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      child.kill('SIGTERM');
      killTimer = setTimeout(() => child.kill('SIGKILL'), 2000);
    };
    const onAbort = () => {
      aborted = true;
      stop();
    };
    const timer = opts.timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          stop();
        }, opts.timeoutMs)
      : undefined;
    if (opts.signal?.aborted) onAbort();
    else opts.signal?.addEventListener('abort', onAbort, { once: true });

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      if (stdout.length < MAX_CAPTURE) stdout += chunk.slice(0, MAX_CAPTURE - stdout.length);
      if (!opts.onLine) return;
      buf += chunk;
      let i: number;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).replace(/\r$/, '');
        buf = buf.slice(i + 1);
        if (line.trim()) opts.onLine(line);
      }
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      if (stderr.length < MAX_CAPTURE) stderr += chunk.slice(0, MAX_CAPTURE - stderr.length);
    });
    child.stdin.on('error', () => {
      // 프로세스가 먼저 끝나면 EPIPE가 날 수 있다
    });
    child.on('error', (err: NodeJS.ErrnoException) => {
      finish({ code: null, notFound: err.code === 'ENOENT' });
    });
    child.on('close', (code) => {
      if (buf.trim() && opts.onLine) opts.onLine(buf.replace(/\r$/, ''));
      buf = '';
      // win32 셸 경유 시 명령이 없으면 9009(cmd) 종료 코드
      finish({ code, notFound: IS_WIN && code === 9009 });
    });

    child.stdin.end(opts.stdin ?? '');
  });
}
