import { describe, expect, it } from 'vitest';
import {
  isSilent,
  STT_MAX_AUDIO_B64,
  STT_MODELS,
  STT_SAMPLE_RATE,
  cleanTranscript,
  createBridgeClient,
  encodeWav,
  isSttAudio,
  isSttModelId,
  isSttWav,
  mixToMono,
  resample,
  sttModel,
  sttModelUrl,
  type BridgeClientMsg,
  type BridgeServerMsg,
  type BridgeTransport,
} from '../src';

function transport(onMsg: (m: BridgeClientMsg, reply: (r: BridgeServerMsg) => void) => void) {
  const listeners = new Set<(m: BridgeServerMsg) => void>();
  const disconnects = new Set<() => void>();
  const t: BridgeTransport = {
    send(m) {
      queueMicrotask(() => onMsg(m, (r) => listeners.forEach((l) => l(r))));
    },
    subscribe(l) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    onDisconnect(l) {
      disconnects.add(l);
      return () => disconnects.delete(l);
    },
  };
  return { t, listeners, close: () => disconnects.forEach((l) => l()) };
}

describe('stt catalog', () => {
  it('has verified official models with the default first', () => {
    expect(STT_MODELS[0]!.id).toBe('large-v3-turbo-q5_0');
    for (const m of STT_MODELS) {
      expect(m.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(sttModelUrl(m)).toBe(`https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${m.file}`);
    }
    expect(sttModel('small-q5_1')?.size).toBe(190_085_487);
    expect(isSttModelId('small-q5_1')).toBe(true);
    expect(isSttModelId('../evil')).toBe(false);
  });
});

describe('wav', () => {
  it('encodes 16kHz mono PCM16 that passes the check', () => {
    const wav = encodeWav(new Float32Array([0, 1, -1, 2, 0.5]), STT_SAMPLE_RATE);
    expect(wav.length).toBe(44 + 10);
    expect(isSttWav(wav)).toBe(true);
    const v = new DataView(wav.buffer);
    expect(v.getInt16(46, true)).toBe(32767);
    expect(v.getInt16(48, true)).toBe(-32768);
    expect(v.getInt16(50, true)).toBe(32767); // 잘림
    expect(isSttWav(encodeWav(new Float32Array(4), 44_100))).toBe(false);
    expect(isSttWav(new Uint8Array(44))).toBe(false);
    // 헤더의 길이가 실제 바이트와 다르면 거절
    expect(isSttWav(wav.slice(0, wav.length - 2))).toBe(false);
    const lying = wav.slice();
    new DataView(lying.buffer).setUint32(40, 2, true);
    expect(isSttWav(lying)).toBe(false);
  });

  it('mixes channels and resamples', () => {
    expect([...mixToMono([new Float32Array([1, 0]), new Float32Array([0, 0])])]).toEqual([0.5, 0]);
    const down = resample(new Float32Array(48_000).fill(0.25), 48_000, 16_000);
    expect(down.length).toBe(16_000);
    expect(down[100]).toBeCloseTo(0.25);
    const up = resample(new Float32Array([0, 1]), 8_000, 16_000);
    expect([...up]).toEqual([0, 0.5, 1, 1]);
  });
});

describe('audio validation', () => {
  it('accepts base64 within the limit only', () => {
    expect(isSttAudio('UklGRg==')).toBe(true);
    expect(isSttAudio('')).toBe(false);
    expect(isSttAudio('abc')).toBe(false);
    expect(isSttAudio('ab!d')).toBe(false);
    expect(isSttAudio(42)).toBe(false);
    expect(isSttAudio('A'.repeat(STT_MAX_AUDIO_B64 + 4))).toBe(false);
  });
});

describe('cleanTranscript', () => {
  it('drops sound tags and common hallucinations', () => {
    expect(cleanTranscript(' 안녕하세요, 이진 탐색 트리의\n 시간 복잡도를 설명해 주세요.\n')).toBe('안녕하세요, 이진 탐색 트리의 시간 복잡도를 설명해 주세요.');
    expect(cleanTranscript('[음악]\n(박수)\n시청해주셔서 감사합니다.')).toBe('');
    expect(cleanTranscript('질문 있어요 ♪')).toBe('질문 있어요');
  });
});

describe('bridge client stt', () => {
  it('asks status and transcribes', async () => {
    const { t } = transport((m, reply) => {
      if (m.type === 'stt.status.get') reply({ type: 'stt.status', reqId: m.reqId, stt: { enabled: true, ready: true } });
      if (m.type === 'stt.transcribe') reply({ type: 'stt.result', reqId: m.reqId, text: `len:${m.audio.length}` });
    });
    const c = createBridgeClient(t);
    expect(await c.sttStatus()).toEqual({ enabled: true, ready: true });
    expect(await c.transcribe('UklGRg==')).toBe('len:8');
  });

  it('rejects with the bridge error, unsupported servers, abort and disconnect', async () => {
    const { t, close } = transport((m, reply) => {
      if (m.type === 'stt.transcribe' && m.audio === 'QQ==') reply({ type: 'stt.error', reqId: m.reqId, error: '모델이 없습니다.' });
    });
    const c = createBridgeClient(t, { sttStatusTimeoutMs: 20, offlineMessage: '끊김' });
    await expect(c.transcribe('QQ==')).rejects.toThrow('모델이 없습니다.');
    await expect(c.sttStatus()).rejects.toThrow('음성 입력 상태를 확인하지 못했습니다.');
    const ac = new AbortController();
    const p = c.transcribe('QUI=', ac.signal);
    ac.abort();
    await expect(p).rejects.toThrow('중지');
    const p2 = c.transcribe('QUI=');
    close();
    await expect(p2).rejects.toThrow('끊김');
  });

  it('chat stream ignores stt messages for other requests', async () => {
    const { t } = transport((m, reply) => {
      if (m.type !== 'chat.start') return;
      reply({ type: 'stt.result', reqId: m.reqId, text: 'x' });
      reply({ type: 'chat.delta', reqId: m.reqId, text: '답' });
      reply({ type: 'chat.done', reqId: m.reqId });
    });
    const c = createBridgeClient(t);
    const evs = [];
    for await (const e of c.stream('claude-cli', { system: '', messages: [{ role: 'user', content: 'q' }] })) evs.push(e.type);
    expect(evs).toEqual(['delta', 'done']);
  });
});

describe('isSilent', () => {
  it('완전 무음·바닥 잡음은 무음, 짧은 말소리 구간이 있으면 무음이 아니다', () => {
    const rate = 16_000;
    expect(isSilent(new Float32Array(rate), rate)).toBe(true);
    const noise = Float32Array.from({ length: rate }, (_, i) => (i % 2 ? 0.001 : -0.001));
    expect(isSilent(noise, rate)).toBe(true);
    const speech = noise.slice();
    for (let i = 8000; i < 8800; i++) speech[i] = 0.05 * Math.sin(i / 5);
    expect(isSilent(speech, rate)).toBe(false);
    expect(isSilent(new Float32Array(0), rate)).toBe(true);
  });
});
