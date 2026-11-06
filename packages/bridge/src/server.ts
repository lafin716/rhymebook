import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { t, binaryNote, cliPrompt, isAttachment, isKnowledgeId, isSttAudio, isValidEffort, isValidModelName, KB_TOOL_NAMES, knowledgeIdsOf, providerError, withInstructions, type BridgeClientMsg, type BridgeServerMsg, type BridgeStatus, type ChatStartMsg, type StreamEvent, type SttManageMsg, type SttState } from '@branch/core';
import { claudeArgs, claudeJsonInput, createClaudeParser } from './claude';
import { codexArgs, createCodexParser } from './codex';
import { codexImagesDir, collectCodexImages } from './codexImages';
import { detectAll } from './detect';
import { resolveCliEnv, type CliEnv } from './env';
import type { CliParser } from './parser';
import { runCli } from './run';
import { KnowledgeNotFoundError, type KnowledgeStore } from './knowledgeStore';
import type { SttEngine } from './stt/engine';
import { KB_MAX_KBS_PER_CHAT, KB_MCP_SERVER_NAME, KB_MCP_TOOL_PREFIX, type KbToolsLauncher } from './kbTools/config';
import { kbToolsNote } from './kbTools/note';
import { loadKbEntries } from './kbTools/serve';
import type { KbEntry } from './kbTools/service';

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
  /** 학습별 지식베이스 (ADR-107). chat.start.knowledgeId가 있을 때만 쓴다 */
  knowledge?: KnowledgeStore;
  /**
   * 지식베이스 MCP 서버 실행 정보 (ADR-124). 있으면 CLI는 이 서버의 읽기 도구로 여러 KB를 찾는다.
   * 없으면 예전 방식(첫 KB의 개요를 안내문에 붙임)을 쓴다
   */
  knowledgeTools?: KbToolsLauncher;
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
const imageGenNote = () => t('bridge.server.imageGenNote');

const sttUnsupported = () => t('bridge.server.sttUnsupported');

/** 답변에 붙는 지식베이스 정보: 폴더 절대 경로와 얕은 폴더 개요 (ADR-119) */
interface KnowledgeContext {
  dir: string;
  paths: string[];
  truncated: boolean;
}

/** MCP 지식 도구 계획: 실행 인자, 이번 답의 KB 목록 (ADR-124) */
interface KbMcpPlan {
  command: string;
  args: string[];
  env: Record<string, string>;
  entries: KbEntry[];
}

/** 폴더(<root>/<id>/files)가 실제로 있는 KB id만 남긴다 */
async function existingKbIds(root: string, ids: string[]): Promise<string[]> {
  const out: string[] = [];
  for (const id of ids) {
    const s = await stat(path.join(root, id, 'files')).catch(() => null);
    if (s?.isDirectory()) out.push(id);
  }
  return out;
}

/** 지식베이스 안내문. 개요는 한 줄에 하나, 잘렸으면 끝에 '…' */
export function knowledgeNote(kb: KnowledgeContext, key: 'bridge.knowledge.systemNote' | 'bridge.knowledge.codexIndex'): string {
  // 파일 이름의 줄바꿈·제어 문자는 공백으로: 이름으로 안내문에 줄을 끼워 넣지 못하게
  const lines = kb.paths.length ? kb.paths.map((p) => `- ${p.replace(/[\p{Cc}\u2028\u2029]+/gu, ' ')}`) : ['-'];
  if (kb.truncated) lines.push('- …');
  return t(key, { dir: kb.dir, outline: lines.join('\n') });
}

/**
 * 원격 기기의 음성 설정 요청 (ADR-046). 페어링된 기기는 PC 설정 화면과 같은 일을 할 수 있다.
 * 받기는 수 분 걸리므로 시작만 하고 바로 상태를 돌려준다(진행률·실패는 stt.state.get의 download·error로 본다).
 */
async function manageStt(stt: SttEngine, msg: { type: 'stt.state.get' } | SttManageMsg): Promise<SttState> {
  if (msg.type === 'stt.state.get') return stt.state();
  const need = () => {
    if (!msg.model) throw new Error(t('bridge.server.pickModel'));
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
      if (now.download && now.download.model !== model) throw new Error(t('bridge.stt.otherDownloading'));
      if (now.installed.includes(model) || now.download) return now;
      // 끝날 때까지 기다리지 않는다. 실패는 엔진이 state.error에 남긴다
      stt.download(model).catch(() => {});
      return stt.state();
    }
  }
}

const fallbackSystem = () => t('bridge.server.fallbackSystem');

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

  /**
   * 학습의 지식베이스 (ADR-107). 저장소가 없거나, knowledgeId가 없거나 형식이 틀리거나,
   * 없는 지식베이스면 null (지식베이스 없이 답한다). 그 밖의 읽기 오류만 throw
   */
  async function knowledgeFor(msg: ChatStartMsg): Promise<KnowledgeContext | null> {
    // 빠른 모드는 CLI에 지식베이스를 열어 주지 않는다 (RAG 설정 롤백 규칙)
    if (!opts.knowledge || msg.knowledgeMode === 'fast' || !isKnowledgeId(msg.knowledgeId)) return null;
    try {
      const { paths, truncated } = await opts.knowledge.index(msg.knowledgeId);
      return { dir: opts.knowledge.dirFor(msg.knowledgeId), paths, truncated };
    } catch (err) {
      if (err instanceof KnowledgeNotFoundError) return null;
      throw err;
    }
  }

  /**
   * 이번 답의 지식베이스 MCP 계획 (ADR-124). 선택된 KB 중 폴더가 있는 것만 최대 8개.
   * 실행 정보가 없거나 빠른 모드거나 쓸 KB가 없으면 null
   */
  async function kbMcpFor(msg: ChatStartMsg): Promise<KbMcpPlan | null> {
    const launcher = opts.knowledgeTools;
    if (!launcher || msg.knowledgeMode === 'fast') return null;
    const ids = await existingKbIds(launcher.root, knowledgeIdsOf(msg).filter(isKnowledgeId).slice(0, KB_MAX_KBS_PER_CHAT));
    if (!ids.length) return null;
    const { entries } = await loadKbEntries(launcher.root, ids);
    if (!entries.length) return null;
    return {
      command: launcher.command,
      args: [...launcher.args, '--root', launcher.root, ...entries.flatMap((e) => ['--kb', e.kbId])],
      env: launcher.env ?? {},
      entries,
    };
  }

  async function runChat(msg: ChatStartMsg, signal: AbortSignal, emit: (ev: StreamEvent) => void): Promise<void> {
    if (!(await gate.acquire(signal))) {
      emit({ type: 'error', error: providerError('aborted', t('bridge.common.stopped')) });
      return;
    }
    const env = await cliEnv;
    const workDir = await mkdtemp(path.join(os.tmpdir(), 'branch-bridge-'));
    try {
      let kb: KnowledgeContext | null = null;
      let mcp: KbMcpPlan | null = null;
      try {
        mcp = await kbMcpFor(msg);
        // MCP 실행 정보가 있으면 예전 개요 방식은 쓰지 않는다 (지식 도구가 대신한다)
        if (!mcp && !opts.knowledgeTools) kb = await knowledgeFor(msg);
      } catch (err) {
        emit({ type: 'error', error: providerError('unknown', err instanceof Error ? err.message : String(err)) });
        return;
      }
      const prompt = cliPrompt(msg.messages);
      const system = msg.system.trim() || fallbackSystem();
      // 대화 전체의 이미지·PDF 첨부 (형식이 맞는 것만)
      const files = msg.messages.flatMap((m) => m.attachments ?? []).filter((a) => isAttachment(a) && a.kind !== 'text');
      let args: string[];
      let stdin: string;
      let parser: CliParser;
      let codexThread: (() => string | undefined) | null = null;
      if (msg.providerId === 'claude-cli') {
        const systemFile = path.join(workDir, 'system.txt');
        const claudeNote = mcp ? kbToolsNote(mcp.entries, 'claude-cli', msg.knowledgeMode) : kb ? knowledgeNote(kb, 'bridge.knowledge.systemNote') : '';
        const claudeSystem = claudeNote ? `${system}\n\n${claudeNote}` : system;
        await writeFile(systemFile, claudeSystem, { mode: 0o600 });
        args = claudeArgs({
          systemFile,
          ...cliModelOptions(msg),
          inputJson: files.length > 0,
          webSearch: msg.webSearch === true,
          knowledge: !mcp && kb !== null,
          knowledgeDir: mcp ? undefined : kb?.dir,
          kbMcp: mcp
            ? {
                config: JSON.stringify({ mcpServers: { [KB_MCP_SERVER_NAME]: { type: 'stdio', command: mcp.command, args: mcp.args, env: mcp.env } } }),
                tools: KB_TOOL_NAMES.map((n) => `${KB_MCP_TOOL_PREFIX}${n}`),
              }
            : undefined,
        });
        stdin = files.length ? claudeJsonInput(prompt, files) : prompt;
        parser = createClaudeParser({ knowledgeDir: mcp ? undefined : kb?.dir });
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
        // Codex는 셸이 꺼져 있어 파일 내용을 읽지 못한다 (ADR-070). 개요만 알리고 검색 발췌에 근거하게 한다
        const codexNote = mcp ? kbToolsNote(mcp.entries, 'codex-cli', msg.knowledgeMode) : kb ? knowledgeNote(kb, 'bridge.knowledge.codexIndex') : '';
        const codexSystem = codexNote ? `${system}\n\n${codexNote}` : system;
        args = codexArgs({
          ...cliModelOptions(msg),
          images,
          imageGen,
          webSearch: msg.webSearch === true,
          ...(mcp ? { mcp: { command: mcp.command, args: mcp.args, env: mcp.env } } : {}),
        });
        stdin = withInstructions(imageGen ? `${codexSystem}\n\n${imageGenNote()}` : codexSystem, note ? `${prompt}\n\n${note}` : prompt);
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
        if (res.aborted) emit({ type: 'error', error: providerError('aborted', t('bridge.common.stopped')) });
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
          if (skipped) emit({ type: 'delta', text: `\n\n${t('bridge.server.imagesSkipped', { count: skipped })}` });
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
              safeSend({ type: 'stt.status', reqId, stt: { enabled: false, ready: false, detail: sttUnsupported() } });
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
              safeSend({ type: 'stt.error', reqId, error: sttUnsupported() });
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
              safeSend({ type: 'stt.error', reqId, error: sttUnsupported() });
              return;
            }
            if (running.has(reqId)) return;
            if (!isSttAudio(msg.audio)) {
              safeSend({ type: 'stt.error', reqId, error: t('bridge.stt.badFormat') });
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
              safeSend({ type: 'chat.error', reqId: msg.reqId, error: providerError('cli', t('bridge.server.unsupportedCli')) });
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
