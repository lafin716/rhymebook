import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  binaryNote,
  cliPrompt,
  isAttachment,
  isSttAudio,
  isValidEffort,
  isValidModelName,
  providerError,
  withInstructions,
  type BridgeClientMsg,
  type BridgeServerMsg,
  type BridgeStatus,
  type ChatStartMsg,
  type StreamEvent,
  type SttManageMsg,
  type SttState,
} from '@branch/core';
import { claudeArgs, claudeJsonInput, createClaudeParser } from './claude';
import { codexArgs, createCodexParser } from './codex';
import { codexImagesDir, collectCodexImages } from './codexImages';
import { detectAll } from './detect';
import { resolveCliEnv, type CliEnv } from './env';
import type { CliParser } from './parser';
import { runCli } from './run';
import type { SttEngine } from './stt/engine';

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
  /** 음성 전사 엔진 (ADR-045). 없으면 stt.* 요청에 '지원 안 함'으로 답한다 */
  stt?: SttEngine;
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

const IMAGE_EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' };

/** 이미지 생성을 켤 때 덧붙이는 지시. 결과는 앱이 답변에 붙이므로 경로·저장 위치를 말할 필요가 없다 */
const IMAGE_GEN_NOTE =
  '이미지가 필요하면 이미지 생성 도구로 만드세요. 만든 이미지는 앱이 답변 아래에 자동으로 붙이므로 파일 경로나 저장 위치는 말하지 마세요. SVG·ASCII 그림으로 대신하지 마세요.';

const STT_UNSUPPORTED = '이 Bridge는 음성 입력을 지원하지 않습니다.';

/**
 * 원격 기기의 음성 설정 요청 (ADR-046). 페어링된 기기는 PC 설정 화면과 같은 일을 할 수 있다.
 * 받기는 수 분 걸리므로 시작만 하고 바로 상태를 돌려준다(진행률·실패는 stt.state.get의 download·error로 본다).
 */
async function manageStt(stt: SttEngine, msg: { type: 'stt.state.get' } | SttManageMsg): Promise<SttState> {
  if (msg.type === 'stt.state.get') return stt.state();
  const need = () => {
    if (!msg.model) throw new Error('모델을 골라 주세요.');
    return msg.model;
  };
  switch (msg.op) {
    case 'enable':
      return stt.setEnabled(true);
    case 'disable':
      return stt.setEnabled(false);
    case 'select':
      return stt.setModel(need());
    case 'cancel':
      return stt.cancelDownload();
    case 'remove':
      return stt.remove(need());
    case 'download': {
      const model = need();
      const now = await stt.state();
      if (now.download && now.download.model !== model) throw new Error('다른 모델을 받는 중입니다.');
      if (now.installed.includes(model) || now.download) return now;
      // 끝날 때까지 기다리지 않는다. 실패는 엔진이 state.error에 남긴다
      stt.download(model).catch(() => {});
      return stt.state();
    }
  }
}

const FALLBACK_SYSTEM = '당신은 학습을 돕는 친절한 튜터입니다. 한국어로 짧고 명확하게 답하세요.';

/** CLI 인자로 넘길 모델·노력치. 형식이 틀린 값은 버리고 CLI 기본값을 쓴다 (IPC·원격 공통 검증) */
export function cliModelOptions(msg: Pick<ChatStartMsg, 'providerId' | 'model' | 'effort'>): {
  model?: string;
  effort?: string;
} {
  const model = msg.model && isValidModelName(msg.model) ? msg.model : undefined;
  const effort = msg.effort && isValidEffort(msg.providerId, msg.effort, model) ? msg.effort : undefined;
  return { ...(model ? { model } : {}), ...(effort ? { effort } : {}) };
}

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
      // 대화 전체의 이미지·PDF 첨부 (형식이 맞는 것만)
      const files = msg.messages.flatMap((m) => m.attachments ?? []).filter((a) => isAttachment(a) && a.kind !== 'text');
      let args: string[];
      let stdin: string;
      let parser: CliParser;
      let codexThread: (() => string | undefined) | null = null;
      if (msg.providerId === 'claude-cli') {
        const systemFile = path.join(workDir, 'system.txt');
        await writeFile(systemFile, system, { mode: 0o600 });
        args = claudeArgs({ systemFile, ...cliModelOptions(msg), inputJson: files.length > 0, webSearch: msg.webSearch === true });
        stdin = files.length ? claudeJsonInput(prompt, files) : prompt;
        parser = createClaudeParser();
      } else {
        // Codex는 이미지만 파일로 넘길 수 있다. PDF는 이름만 알린다
        const images: string[] = [];
        for (const [i, a] of files.filter((f) => f.kind === 'image').entries()) {
          const file = path.join(workDir, `image-${i}.${IMAGE_EXT[a.mime] ?? 'png'}`);
          await writeFile(file, Buffer.from(a.data, 'base64'), { mode: 0o600 });
          images.push(file);
        }
        const note = binaryNote(files.filter((f) => f.kind === 'pdf'));
        const imageGen = msg.imageGen === true;
        args = codexArgs({ ...cliModelOptions(msg), images, imageGen, webSearch: msg.webSearch === true });
        stdin = withInstructions(imageGen ? `${system}\n\n${IMAGE_GEN_NOTE}` : system, note ? `${prompt}\n\n${note}` : prompt);
        const codex = createCodexParser();
        parser = codex;
        if (imageGen) codexThread = codex.threadId;
      }

      let ended = false;
      // 이미지 생성 중이면 done을 붙잡아 두고 프로세스가 끝난 뒤 이미지를 먼저 보낸다
      let heldDone: StreamEvent | null = null;
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
            if (ev.type === 'done' && codexThread) heldDone = ev;
            else emit(ev);
            if (ev.type === 'done' || ev.type === 'error') ended = true;
          }
        },
      });
      log(`${msg.providerId} exit=${res.code} ${Date.now() - started}ms${res.aborted ? ' aborted' : ''}${res.timedOut ? ' timeout' : ''}`);
      if (!ended) {
        if (res.aborted) emit({ type: 'error', error: providerError('aborted', '사용자가 중지했습니다.') });
        else {
          const fin = parser.finish(res);
          if (fin.type === 'done' && codexThread) heldDone = fin;
          else emit(fin);
        }
      }
      const thread = codexThread?.();
      const dir = thread ? codexImagesDir(env.env, thread) : null;
      if (dir) {
        const { images, skipped } = await collectCodexImages(dir);
        if (heldDone) {
          for (const attachment of images) emit({ type: 'image', attachment });
          if (skipped) emit({ type: 'delta', text: `\n\n(이미지 ${skipped}장은 크기·개수 한도를 넘어 붙이지 못했습니다.)` });
          if (images.length || skipped) log(`codex images=${images.length} skipped=${skipped}`);
        }
      }
      if (heldDone) emit(heldDone);
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
          if (msg.type === 'stt.status.get') {
            const reqId = msg.reqId;
            if (!opts.stt) {
              safeSend({ type: 'stt.status', reqId, stt: { enabled: false, ready: false, detail: STT_UNSUPPORTED } });
              return;
            }
            opts.stt.status().then(
              (stt) => safeSend({ type: 'stt.status', reqId, stt }),
              (e: unknown) => safeSend({ type: 'stt.error', reqId, error: e instanceof Error ? e.message : String(e) }),
            );
            return;
          }
          if (msg.type === 'stt.state.get' || msg.type === 'stt.manage') {
            const reqId = msg.reqId;
            if (!opts.stt) {
              safeSend({ type: 'stt.error', reqId, error: STT_UNSUPPORTED });
              return;
            }
            manageStt(opts.stt, msg).then(
              (state) => safeSend({ type: 'stt.state', reqId, state }),
              (e: unknown) => safeSend({ type: 'stt.error', reqId, error: e instanceof Error ? e.message : String(e) }),
            );
            return;
          }
          if (msg.type === 'stt.transcribe') {
            const reqId = msg.reqId;
            if (!opts.stt) {
              safeSend({ type: 'stt.error', reqId, error: STT_UNSUPPORTED });
              return;
            }
            if (running.has(reqId)) return;
            if (!isSttAudio(msg.audio)) {
              safeSend({ type: 'stt.error', reqId, error: '녹음 형식이 올바르지 않습니다.' });
              return;
            }
            const ac = new AbortController();
            running.set(reqId, ac);
            all.add(ac);
            opts.stt
              .transcribe(new Uint8Array(Buffer.from(msg.audio, 'base64')), ac.signal)
              .then(
                (text) => safeSend({ type: 'stt.result', reqId, text }),
                (e: unknown) => safeSend({ type: 'stt.error', reqId, error: e instanceof Error ? e.message : String(e) }),
              )
              .finally(() => {
                running.delete(reqId);
                all.delete(ac);
              });
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
              else if (ev.type === 'image') safeSend({ type: 'chat.image', reqId, attachment: ev.attachment });
              else if (ev.type === 'tool') safeSend({ type: 'chat.tool', reqId, tool: ev.tool });
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
