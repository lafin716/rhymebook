import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  cliPrompt,
  providerError,
  withInstructions,
  type BridgeClientMsg,
  type BridgeServerMsg,
  type BridgeStatus,
  type ChatStartMsg,
  type StreamEvent,
} from '@branch/core';
import { claudeArgs, createClaudeParser } from './claude';
import { codexArgs, createCodexParser } from './codex';
import { detectAll } from './detect';
import { resolveCliEnv, type CliEnv } from './env';
import type { CliParser } from './parser';
import { runCli } from './run';

export interface BridgeServerOptions {
  /** CLI 실행 환경 (기본: 로그인 셸 PATH 해석) */
  cliEnv?: CliEnv | Promise<CliEnv>;
  /** 동시에 실행할 CLI 프로세스 수 */
  maxConcurrent?: number;
  /** 요청 1건 최대 시간 */
  timeoutMs?: number;
  /** status.get(refresh 아님) 캐시 시간 */
  statusCacheMs?: number;
  /** 진단 로그. 프롬프트·응답·비밀 값은 넘기지 않는다 */
  log?: (msg: string) => void;
}

export interface BridgeConnection {
  receive(msg: BridgeClientMsg): void;
  /** 연결 종료: 이 연결의 진행 중 요청을 모두 중지 */
  close(): void;
}

export interface BridgeServer {
  connect(send: (msg: BridgeServerMsg) => void): BridgeConnection;
  status(refresh?: boolean): Promise<BridgeStatus>;
  /** 모든 연결의 진행 중 요청 중지 */
  shutdown(): void;
}

const FALLBACK_SYSTEM = '당신은 학습을 돕는 친절한 튜터입니다. 한국어로 짧고 명확하게 답하세요.';

function semaphore(max: number) {
  let active = 0;
  const waiters: (() => void)[] = [];
  return {
    async acquire(signal: AbortSignal): Promise<boolean> {
      if (active < max) {
        active++;
        return true;
      }
      await new Promise<void>((resolve) => {
        const go = () => {
          signal.removeEventListener('abort', cancel);
          resolve();
        };
        const cancel = () => {
          const i = waiters.indexOf(go);
          if (i >= 0) waiters.splice(i, 1);
          resolve();
        };
        waiters.push(go);
        signal.addEventListener('abort', cancel, { once: true });
      });
      if (signal.aborted) return false;
      active++;
      return true;
    },
    release() {
      active--;
      waiters.shift()?.();
    },
  };
}

export function createBridgeServer(opts: BridgeServerOptions = {}): BridgeServer {
  const cliEnv = Promise.resolve(opts.cliEnv ?? resolveCliEnv());
  const timeoutMs = opts.timeoutMs ?? 5 * 60_000;
  const statusCacheMs = opts.statusCacheMs ?? 10_000;
  const log = opts.log ?? (() => {});
  const gate = semaphore(opts.maxConcurrent ?? 2);
  const all = new Set<AbortController>();
  let statusInflight: Promise<BridgeStatus> | null = null;
  let statusCache: { at: number; value: BridgeStatus } | null = null;

  function status(refresh = false): Promise<BridgeStatus> {
    if (!refresh && statusCache && Date.now() - statusCache.at < statusCacheMs) return Promise.resolve(statusCache.value);
    statusInflight ??= cliEnv
      .then(detectAll)
      .then((value) => {
        statusCache = { at: Date.now(), value };
        return value;
      })
      .finally(() => {
        statusInflight = null;
      });
    return statusInflight;
  }

  async function runChat(msg: ChatStartMsg, signal: AbortSignal, emit: (ev: StreamEvent) => void): Promise<void> {
    if (!(await gate.acquire(signal))) {
      emit({ type: 'error', error: providerError('aborted', '사용자가 중지했습니다.') });
      return;
    }
    const env = await cliEnv;
    const workDir = await mkdtemp(path.join(os.tmpdir(), 'branch-bridge-'));
    try {
      const prompt = cliPrompt(msg.messages);
      const system = msg.system.trim() || FALLBACK_SYSTEM;
      let args: string[];
      let stdin: string;
      let parser: CliParser;
      if (msg.providerId === 'claude-cli') {
        const systemFile = path.join(workDir, 'system.txt');
        await writeFile(systemFile, system, { mode: 0o600 });
        args = claudeArgs({ systemFile, ...(msg.model ? { model: msg.model } : {}) });
        stdin = prompt;
        parser = createClaudeParser();
      } else {
        args = codexArgs(msg.model ? { model: msg.model } : {});
        stdin = withInstructions(system, prompt);
        parser = createCodexParser();
      }

      let ended = false;
      const started = Date.now();
      const res = await runCli({
        bin: env.bin[msg.providerId],
        args,
        stdin,
        cwd: workDir,
        env: env.env,
        signal,
        timeoutMs,
        onLine(line) {
          if (ended) return;
          let obj: unknown;
          try {
            obj = JSON.parse(line);
          } catch {
            return;
          }
          for (const ev of parser.line(obj)) {
            if (ended) break;
            emit(ev);
            if (ev.type !== 'delta') ended = true;
          }
        },
      });
      log(`${msg.providerId} exit=${res.code} ${Date.now() - started}ms${res.aborted ? ' aborted' : ''}${res.timedOut ? ' timeout' : ''}`);
      if (!ended) {
        if (res.aborted) emit({ type: 'error', error: providerError('aborted', '사용자가 중지했습니다.') });
        else emit(parser.finish(res));
      }
    } finally {
      gate.release();
      await rm(workDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  return {
    status,
    shutdown() {
      for (const c of all) c.abort();
    },
    connect(send) {
      const running = new Map<string, AbortController>();
      let closed = false;
      const safeSend = (m: BridgeServerMsg) => {
        if (closed) return;
        try {
          send(m);
        } catch (e) {
          log(`send failed: ${e instanceof Error ? e.message : String(e)}`);
        }
      };

      return {
        receive(msg) {
          if (closed) return;
          if (msg.type === 'status.get') {
            status(msg.refresh).then(
              (providers) => safeSend({ type: 'status', reqId: msg.reqId, providers }),
              (e: unknown) => {
                const detail = e instanceof Error ? e.message : String(e);
                safeSend({
                  type: 'status',
                  reqId: msg.reqId,
                  providers: { 'claude-cli': { status: 'offline', detail }, 'codex-cli': { status: 'offline', detail } },
                });
              },
            );
            return;
          }
          if (msg.type === 'chat.abort') {
            running.get(msg.reqId)?.abort();
            return;
          }
          if (msg.type === 'chat.start') {
            if (running.has(msg.reqId)) return;
            if (msg.providerId !== 'claude-cli' && msg.providerId !== 'codex-cli') {
              safeSend({ type: 'chat.error', reqId: msg.reqId, error: providerError('cli', '지원하지 않는 CLI입니다.') });
              return;
            }
            const ac = new AbortController();
            running.set(msg.reqId, ac);
            all.add(ac);
            const reqId = msg.reqId;
            runChat(msg, ac.signal, (ev) => {
              if (ev.type === 'delta') safeSend({ type: 'chat.delta', reqId, text: ev.text });
              else if (ev.type === 'done') safeSend({ type: 'chat.done', reqId, ...(ev.stopReason ? { stopReason: ev.stopReason } : {}) });
              else safeSend({ type: 'chat.error', reqId, error: ev.error });
            })
              .catch((e: unknown) => {
                safeSend({ type: 'chat.error', reqId, error: providerError('cli', e instanceof Error ? e.message : String(e)) });
              })
              .finally(() => {
                running.delete(reqId);
                all.delete(ac);
              });
          }
        },
        close() {
          closed = true;
          for (const ac of running.values()) ac.abort();
          running.clear();
        },
      };
    },
  };
}
