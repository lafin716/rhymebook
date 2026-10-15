import { createHash } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { createBridgeClient, encodeWav, type BridgeServerMsg, type SttModelInfo } from '@branch/core';
import { createBridgeServer, createSttEngine, validateClientMsg } from '../src';

const fakeWhisper = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/fake-whisper.mjs');
const BODY = 'tiny-model';
const MODEL: SttModelInfo = {
  id: 'small-q5_1',
  label: 't',
  note: '',
  file: 'ggml-test.bin',
  size: BODY.length,
  sha256: createHash('sha256').update(BODY).digest('hex'),
};

function fakeFetch(body = BODY, opts: { hang?: boolean } = {}): typeof fetch {
  return (async (_url: unknown, init?: RequestInit) => {
    const bytes = new TextEncoder().encode(body);
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(bytes.slice(0, 4));
        if (opts.hang) {
          init?.signal?.addEventListener('abort', () => c.error(new Error('aborted')));
          return;
        }
        c.enqueue(bytes.slice(4));
        c.close();
      },
    });
    return new Response(stream, { status: 200 });
  }) as typeof fetch;
}

const wav = () => encodeWav(new Float32Array(1600), 16_000);
const prevKey = process.env.ANTHROPIC_API_KEY;
afterEach(() => {
  if (prevKey === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = prevKey;
});

/** 받아 둔 모델 파일을 같은 길이의 다른 내용으로 바꿔 가짜 whisper 동작을 고른다 */
async function swapModel(dir: string, body: 'fail-model' | 'envs-model' | 'slow-model') {
  await writeFile(path.join(dir, 'models', MODEL.file), body);
}

function engine(f = fakeFetch(), bin: string[] = [fakeWhisper]) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'stt-test-'));
  return { dir, stt: createSttEngine({ dir, binCandidates: bin, fetch: f, models: [MODEL] }) };
}

describe('stt engine', () => {
  it('starts disabled and explains what is missing', async () => {
    const { stt } = engine();
    expect(await stt.status()).toEqual({ enabled: false, ready: false, detail: 'PC에서 음성 입력이 꺼져 있습니다.' });
    await stt.setModel('small-q5_1');
    await stt.setEnabled(true);
    expect((await stt.status()).detail).toBe('음성 모델을 받아야 합니다.');
    await expect(stt.transcribe(wav())).rejects.toThrow('음성 모델을 받아야 합니다.');
  });

  it('downloads with sha256 check, persists settings and transcribes', async () => {
    const { dir, stt } = engine();
    const seen: number[] = [];
    stt.onChange((s) => s.download && seen.push(s.download.received));
    await stt.setModel('small-q5_1');
    await stt.setEnabled(true);
    const s = await stt.download('small-q5_1');
    expect(s.installed).toEqual(['small-q5_1']);
    expect(s.ready).toBe(true);
    expect(await readFile(path.join(dir, 'models', MODEL.file), 'utf8')).toBe(BODY);
    expect(await stt.transcribe(wav())).toBe(`모델 ${BODY} 길이 ${44 + 3200} 언어 ko`);
    // 새 엔진도 같은 설정을 읽는다
    const again = createSttEngine({ dir, binCandidates: [fakeWhisper], models: [MODEL] });
    expect(await again.status()).toEqual({ enabled: true, ready: true });
    await again.remove('small-q5_1');
    expect((await again.state()).installed).toEqual([]);
  });

  it('rejects a corrupted download and leaves no file', async () => {
    const { stt } = engine(fakeFetch('tiny-modeX'));
    const s = await stt.download('small-q5_1');
    expect(s.installed).toEqual([]);
    expect(s.error).toContain('손상');
  });

  it('cancels a download without an error', async () => {
    const { stt } = engine(fakeFetch(BODY, { hang: true }));
    const p = stt.download('small-q5_1');
    await new Promise((r) => setTimeout(r, 20));
    expect((await stt.state()).download?.model).toBe('small-q5_1');
    await stt.cancelDownload();
    const s = await p;
    expect(s.download).toBeNull();
    expect(s.error).toBeUndefined();
    expect(s.installed).toEqual([]);
  });

  it('reports a missing engine and a failing engine', async () => {
    const { stt } = engine(fakeFetch(), ['/nonexistent/whisper-cli']);
    await stt.setModel('small-q5_1');
    await stt.setEnabled(true);
    const prevPath = process.env.PATH;
    process.env.PATH = '';
    try {
      const st = await stt.state();
      if (!st.engine) expect(st.detail).toContain('whisper-cli');
    } finally {
      process.env.PATH = prevPath;
    }
    const ok = engine();
    await ok.stt.setModel('small-q5_1');
    await ok.stt.setEnabled(true);
    await ok.stt.download('small-q5_1');
    await swapModel(ok.dir, 'fail-model');
    await expect(ok.stt.transcribe(wav())).rejects.toThrow('음성 변환에 실패했습니다.');
    await expect(ok.stt.transcribe(new Uint8Array(10))).rejects.toThrow('녹음 형식');
  });

  it('does not pass secrets in the environment to whisper-cli', async () => {
    const { dir, stt } = engine();
    await stt.setModel('small-q5_1');
    await stt.setEnabled(true);
    await stt.download('small-q5_1');
    await swapModel(dir, 'envs-model');
    process.env.ANTHROPIC_API_KEY = 'sk-test-secret';
    expect(await stt.transcribe(wav())).toBe('키 없음 경로 있음');
  });

  it('rejects transcriptions beyond the pending limit', async () => {
    const { dir, stt } = engine();
    await stt.setModel('small-q5_1');
    await stt.setEnabled(true);
    await stt.download('small-q5_1');
    await swapModel(dir, 'slow-model');
    const jobs = Array.from({ length: 5 }, () => stt.transcribe(wav()));
    const results = await Promise.allSettled(jobs);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(4);
    expect(results[4]).toMatchObject({ status: 'rejected', reason: { message: expect.stringContaining('밀려 있습니다') } });
    // 끝나면 다시 받는다
    await expect(stt.transcribe(wav())).resolves.toContain('언어 ko');
  });
});

describe('bridge server stt', () => {
  function link(stt?: ReturnType<typeof createSttEngine>) {
    const server = createBridgeServer({ cliEnv: { env: process.env, bin: { 'claude-cli': 'x', 'codex-cli': 'y' } }, ...(stt ? { stt } : {}) });
    const listeners = new Set<(m: BridgeServerMsg) => void>();
    const conn = server.connect((m) => listeners.forEach((l) => l(m)));
    return createBridgeClient({
      send: (m) => conn.receive(m),
      subscribe(l) {
        listeners.add(l);
        return () => listeners.delete(l);
      },
    });
  }

  it('answers unsupported without an engine', async () => {
    const c = link();
    expect((await c.sttStatus()).ready).toBe(false);
    await expect(c.transcribe('UklGRg==')).rejects.toThrow('지원하지 않습니다');
  });

  it('transcribes over the protocol', async () => {
    const { stt } = engine();
    await stt.setModel('small-q5_1');
    await stt.setEnabled(true);
    await stt.download('small-q5_1');
    const c = link(stt);
    expect(await c.sttStatus()).toEqual({ enabled: true, ready: true });
    expect(await c.transcribe(Buffer.from(wav()).toString('base64'))).toContain('언어 ko');
    await expect(c.transcribe('UklGRg==')).rejects.toThrow('녹음 형식');
  });

  it('remote validation accepts stt messages with valid audio only', () => {
    expect(validateClientMsg({ type: 'stt.status.get', reqId: 'a' })).toEqual({ type: 'stt.status.get', reqId: 'a' });
    expect(validateClientMsg({ type: 'stt.transcribe', reqId: 'a', audio: 'UklGRg==' })).toEqual({ type: 'stt.transcribe', reqId: 'a', audio: 'UklGRg==' });
    expect(validateClientMsg({ type: 'stt.transcribe', reqId: 'a', audio: 'not base64!' })).toBeNull();
    expect(validateClientMsg({ type: 'stt.transcribe', reqId: 'a' })).toBeNull();
  });
});
