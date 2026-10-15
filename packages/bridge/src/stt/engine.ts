import { createHash } from 'node:crypto';
import { constants, createWriteStream } from 'node:fs';
import { access, mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  DEFAULT_STT_MODEL,
  STT_MODELS,
  cleanTranscript,
  isSttModelId,
  isSttWav,
  sttModel,
  sttModelUrl,
  type SttModelId,
  type SttModelInfo,
  type SttState,
  type SttStatus,
} from '@branch/core';
import { runCli } from '../run';

/**
 * PC의 로컬 음성 전사 엔진 (ADR-045). whisper.cpp의 whisper-cli를 녹음마다 한 번 실행한다.
 * 설정은 `<dir>/settings.json`, 모델은 `<dir>/models/`. 원격 기기는 bridge 메시지로 상태 확인·전사만 한다.
 */
export interface SttEngine {
  status(): Promise<SttStatus>;
  state(): Promise<SttState>;
  /** 16kHz mono PCM16 WAV를 전사한다. 실패하면 사용자에게 보여줄 문구로 throw */
  transcribe(wav: Uint8Array, signal?: AbortSignal): Promise<string>;
  setEnabled(enabled: boolean): Promise<SttState>;
  setModel(model: SttModelId): Promise<SttState>;
  /** 모델을 받아 sha256까지 확인한다. 이미 받는 중이면 그 결과를 기다린다 */
  download(model: SttModelId): Promise<SttState>;
  cancelDownload(): Promise<SttState>;
  remove(model: SttModelId): Promise<SttState>;
  onChange(listener: (state: SttState) => void): () => void;
}

export interface SttEngineOptions {
  dir: string;
  /** whisper-cli 후보 경로 (앱 번들 등). 없으면 BRANCH_WHISPER_CLI → PATH 순으로 찾는다 */
  binCandidates?: string[];
  /** 녹음 1건 최대 전사 시간 */
  timeoutMs?: number;
  /** 테스트용 */
  fetch?: typeof fetch;
  models?: readonly SttModelInfo[];
  log?: (msg: string) => void;
}

interface Settings {
  enabled: boolean;
  model: SttModelId;
}

const BIN_NAMES = process.platform === 'win32' ? ['whisper-cli.exe'] : ['whisper-cli'];
const EXTRA_PATHS = process.platform === 'win32' ? [] : ['/opt/homebrew/bin', '/usr/local/bin'];

const MAX_PENDING = 4;

/** whisper-cli에는 필요한 환경 변수만 넘긴다 (API 키 등 다른 값이 딸려 가지 않게) */
function whisperEnv(): NodeJS.ProcessEnv {
  const keep = ['PATH', 'HOME', 'TMPDIR', 'TMP', 'TEMP', 'LANG', 'SystemRoot', 'USERPROFILE', 'GGML_METAL_PATH_RESOURCES'];
  const env: NodeJS.ProcessEnv = {};
  for (const k of keep) if (process.env[k] !== undefined) env[k] = process.env[k];
  return env;
}

async function isExecutable(file: string): Promise<boolean> {
  try {
    await access(file, process.platform === 'win32' ? constants.F_OK : constants.X_OK);
    return (await stat(file)).isFile();
  } catch {
    return false;
  }
}

export function createSttEngine(opts: SttEngineOptions): SttEngine {
  const log = opts.log ?? (() => {});
  const models = opts.models ?? STT_MODELS;
  const doFetch = opts.fetch ?? fetch;
  const modelsDir = path.join(opts.dir, 'models');
  const settingsFile = path.join(opts.dir, 'settings.json');
  const listeners = new Set<(s: SttState) => void>();
  const findModel = (id: string) => models.find((m) => m.id === id) ?? sttModel(id);

  let settings: Settings | null = null;
  let download: { model: SttModelId; received: number; total: number; ac: AbortController; done: Promise<void> } | null = null;
  let lastError: string | undefined;
  /** 전사는 한 번에 하나 (GPU·메모리) */
  let queue: Promise<unknown> = Promise.resolve();
  /** 실행 중 + 기다리는 전사 수. 원격 기기가 몰아 보내도 메모리를 묶지 않게 제한한다 */
  let pending = 0;

  async function loadSettings(): Promise<Settings> {
    if (settings) return settings;
    try {
      const raw = JSON.parse(await readFile(settingsFile, 'utf8')) as Partial<Settings>;
      settings = { enabled: raw.enabled === true, model: isSttModelId(raw.model) ? raw.model : DEFAULT_STT_MODEL };
    } catch {
      settings = { enabled: false, model: DEFAULT_STT_MODEL };
    }
    return settings;
  }

  async function saveSettings(next: Settings): Promise<void> {
    settings = next;
    await mkdir(opts.dir, { recursive: true });
    await writeFile(settingsFile, JSON.stringify(next), 'utf8');
  }

  async function findBin(): Promise<string | null> {
    const fromEnv = process.env.BRANCH_WHISPER_CLI;
    const dirs = [...(process.env.PATH ?? '').split(path.delimiter).filter(Boolean), ...EXTRA_PATHS];
    const candidates = [
      ...(opts.binCandidates ?? []),
      ...(fromEnv ? [fromEnv] : []),
      ...dirs.flatMap((d) => BIN_NAMES.map((n) => path.join(d, n))),
    ];
    for (const c of candidates) if (await isExecutable(c)) return c;
    return null;
  }

  const modelPath = (m: SttModelInfo) => path.join(modelsDir, m.file);

  async function installed(): Promise<SttModelId[]> {
    const out: SttModelId[] = [];
    for (const m of models) {
      try {
        // 내용 검증은 받을 때 했다. 크기가 다르면(손상·덮어씀) 없는 것으로 본다
        if ((await stat(modelPath(m))).size === m.size) out.push(m.id);
      } catch {
        // 없음
      }
    }
    return out;
  }

  async function state(): Promise<SttState> {
    const s = await loadSettings();
    const [bin, have] = await Promise.all([findBin(), installed()]);
    const downloadingSelected = download?.model === s.model;
    let detail: string | undefined;
    if (!s.enabled) detail = 'PC에서 음성 입력이 꺼져 있습니다.';
    else if (!bin) detail = '음성 엔진(whisper-cli)을 찾지 못했습니다.';
    else if (downloadingSelected) detail = '음성 모델을 받는 중입니다.';
    else if (!have.includes(s.model)) detail = '음성 모델을 받아야 합니다.';
    return {
      enabled: s.enabled,
      ready: !detail,
      ...(detail ? { detail } : {}),
      model: s.model,
      installed: have,
      engine: !!bin,
      download: download ? { model: download.model, received: download.received, total: download.total } : null,
      ...(lastError ? { error: lastError } : {}),
    };
  }

  function emit() {
    if (!listeners.size) return;
    state().then(
      (s) => {
        for (const l of [...listeners]) l(s);
      },
      () => {},
    );
  }

  async function runDownload(m: SttModelInfo, d: NonNullable<typeof download>): Promise<void> {
    const target = modelPath(m);
    const part = `${target}.part`;
    await mkdir(modelsDir, { recursive: true });
    const res = await doFetch(sttModelUrl(m), { signal: d.ac.signal });
    if (!res.ok || !res.body) throw new Error(`모델 서버 응답 오류 (${res.status})`);
    const out = createWriteStream(part, { mode: 0o600 });
    const hash = createHash('sha256');
    let lastEmit = 0;
    try {
      const reader = res.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        d.received += value.byteLength;
        if (d.received > m.size) throw new Error('모델 크기가 예상과 다릅니다.');
        hash.update(value);
        if (!out.write(value)) await new Promise<void>((r) => out.once('drain', () => r()));
        if (Date.now() - lastEmit > 300) {
          lastEmit = Date.now();
          emit();
        }
      }
      await new Promise<void>((resolve, reject) => out.end((e?: Error | null) => (e ? reject(e) : resolve())));
    } catch (e) {
      out.destroy();
      await rm(part, { force: true });
      throw e;
    }
    if (d.received !== m.size || hash.digest('hex') !== m.sha256) {
      await rm(part, { force: true });
      throw new Error('받은 모델이 손상되었습니다. 다시 받아 주세요.');
    }
    await rename(part, target);
  }

  return {
    async status() {
      const { enabled, ready, detail } = await state();
      return { enabled, ready, ...(detail ? { detail } : {}) };
    },
    state,

    transcribe(wav, signal) {
      if (pending >= MAX_PENDING) return Promise.reject(new Error('음성 변환 요청이 밀려 있습니다. 잠시 후 다시 해 주세요.'));
      pending++;
      const job = queue.then(async () => {
        if (signal?.aborted) throw new Error('사용자가 중지했습니다.');
        const s = await state();
        if (!s.ready) throw new Error(s.detail ?? '음성 입력을 사용할 수 없습니다.');
        if (!isSttWav(wav)) throw new Error('녹음 형식이 올바르지 않습니다.');
        const bin = await findBin();
        const m = findModel(s.model);
        if (!bin || !m) throw new Error('음성 엔진을 찾지 못했습니다.');
        const work = await mkdtemp(path.join(os.tmpdir(), 'branch-stt-'));
        try {
          const file = path.join(work, 'input.wav');
          await writeFile(file, wav, { mode: 0o600 });
          const threads = Math.max(1, Math.min(8, os.cpus().length));
          const started = Date.now();
          const res = await runCli({
            bin,
            args: ['-m', modelPath(m), '-f', file, '-l', 'ko', '-nt', '-np', '-t', String(threads)],
            cwd: work,
            env: whisperEnv(),
            ...(signal ? { signal } : {}),
            timeoutMs: opts.timeoutMs ?? 120_000,
          });
          log(`stt exit=${res.code} ${Date.now() - started}ms bytes=${wav.length}${res.timedOut ? ' timeout' : ''}`);
          if (res.aborted) throw new Error('사용자가 중지했습니다.');
          if (res.timedOut) throw new Error('음성 변환 시간이 초과되었습니다.');
          if (res.notFound) throw new Error('음성 엔진(whisper-cli)을 실행하지 못했습니다.');
          if (res.code !== 0) {
            log(`stt stderr: ${res.stderr.slice(-400)}`);
            throw new Error('음성 변환에 실패했습니다.');
          }
          return cleanTranscript(res.stdout);
        } finally {
          await rm(work, { recursive: true, force: true }).catch(() => {});
        }
      });
      queue = job.catch(() => {});
      return job.finally(() => {
        pending--;
      });
    },

    async setEnabled(enabled) {
      await saveSettings({ ...(await loadSettings()), enabled });
      emit();
      return state();
    },

    async setModel(model) {
      if (!findModel(model)) throw new Error('알 수 없는 모델입니다.');
      await saveSettings({ ...(await loadSettings()), model });
      emit();
      return state();
    },

    async download(model) {
      const m = findModel(model);
      if (!m) throw new Error('알 수 없는 모델입니다.');
      if (download) {
        if (download.model !== model) throw new Error('다른 모델을 받는 중입니다.');
        await download.done.catch(() => {});
        return state();
      }
      lastError = undefined;
      const d = { model, received: 0, total: m.size, ac: new AbortController(), done: Promise.resolve() };
      download = d;
      d.done = runDownload(m, d);
      emit();
      try {
        await d.done;
        log(`stt model ${model} downloaded`);
      } catch (e) {
        lastError = d.ac.signal.aborted ? undefined : e instanceof Error ? e.message : String(e);
        if (lastError) log(`stt download failed: ${lastError}`);
      } finally {
        if (download === d) download = null;
        emit();
      }
      return state();
    },

    async cancelDownload() {
      const d = download;
      d?.ac.abort();
      await d?.done.catch(() => {});
      return state();
    },

    async remove(model) {
      const m = findModel(model);
      if (!m) throw new Error('알 수 없는 모델입니다.');
      if (download?.model === model) throw new Error('받는 중인 모델은 지울 수 없습니다.');
      await rm(modelPath(m), { force: true });
      emit();
      return state();
    },

    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
