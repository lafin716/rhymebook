import { encodeWav, isSilent, resample, STT_MAX_SECONDS, STT_SAMPLE_RATE } from '@branch/core';

/**
 * 마이크 녹음 → 16kHz mono PCM16 WAV(base64) (ADR-045).
 * MediaRecorder 포맷(webm/mp4)은 플랫폼마다 달라서 원시 PCM을 직접 모은다.
 */
export interface Recorder {
  /** 녹음을 끝내고 WAV(base64)를 돌려준다. 너무 짧거나 무음이면 그 이유 */
  stop(): Promise<{ audio: string } | { skip: 'short' | 'silent' }>;
  cancel(): void;
  /** 지금까지 녹음한 초 */
  seconds(): number;
}

/** 0.3초보다 짧으면 버린다 (실수로 누른 경우) */
const MIN_SECONDS = 0.3;

export function micSupported(): boolean {
  return typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && typeof AudioContext !== 'undefined';
}

/** 사용자에게 보여 줄 마이크 오류 문구 */
export function micErrorMessage(e: unknown): string {
  const name = e instanceof DOMException ? e.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') return '마이크 권한이 없습니다. 시스템·브라우저 설정에서 마이크를 허용해 주세요.';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return '사용할 수 있는 마이크가 없습니다.';
  if (name === 'NotReadableError') return '다른 앱이 마이크를 쓰고 있습니다.';
  return e instanceof Error && e.message ? e.message : '마이크를 열지 못했습니다.';
}

/** 녹음을 시작한다. 최대 길이(STT_MAX_SECONDS)에 닿으면 onLimit을 부른다 */
export async function startRecording(onLimit: () => void): Promise<Recorder> {
  if (!micSupported()) {
    throw new Error(
      typeof window !== 'undefined' && !window.isSecureContext
        ? '이 주소(HTTP)에서는 마이크를 쓸 수 없습니다. HTTPS나 앱에서 열어 주세요.'
        : '이 기기에서는 마이크 녹음을 지원하지 않습니다.',
    );
  }
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  });
  let ctx: AudioContext | null = null;
  try {
    ctx = new AudioContext();
    return await wire(stream, ctx, onLimit);
  } catch (e) {
    // 녹음 준비에 실패하면 마이크를 바로 놓는다 (켜진 채 남지 않게)
    for (const t of stream.getTracks()) t.stop();
    void ctx?.close().catch(() => {});
    throw e;
  }
}

async function wire(stream: MediaStream, ctx: AudioContext, onLimit: () => void): Promise<Recorder> {
  const rate = ctx.sampleRate;
  const maxSamples = Math.ceil(rate * STT_MAX_SECONDS);
  const chunks: Float32Array[] = [];
  let total = 0;
  let closed = false;

  const source = ctx.createMediaStreamSource(stream);
  // AudioWorklet은 모듈 파일이 필요해 CSP·번들 설정이 번거롭다. 짧은 녹음이라 ScriptProcessor로 충분하다
  const node = ctx.createScriptProcessor(4096, 1, 1);
  node.onaudioprocess = (ev) => {
    if (closed) return;
    const input = ev.inputBuffer.getChannelData(0);
    const take = Math.min(input.length, maxSamples - total);
    if (take > 0) {
      chunks.push(input.slice(0, take));
      total += take;
    }
    if (total >= maxSamples) onLimit();
  };
  source.connect(node);
  // 일부 브라우저는 destination에 연결해야 onaudioprocess가 돈다 (출력은 0으로 채워져 소리는 나지 않는다)
  node.connect(ctx.destination);
  if (ctx.state === 'suspended') await ctx.resume();

  const close = () => {
    if (closed) return;
    closed = true;
    node.onaudioprocess = null;
    source.disconnect();
    node.disconnect();
    for (const t of stream.getTracks()) t.stop();
    void ctx.close().catch(() => {});
  };

  return {
    async stop() {
      close();
      if (total < rate * MIN_SECONDS) return { skip: 'short' };
      const all = new Float32Array(total);
      let o = 0;
      for (const c of chunks) {
        all.set(c, o);
        o += c.length;
      }
      if (isSilent(all, rate)) return { skip: 'silent' };
      return { audio: toBase64(encodeWav(resample(all, rate, STT_SAMPLE_RATE), STT_SAMPLE_RATE)) };
    },
    cancel: close,
    seconds: () => total / rate,
  };
}

function toBase64(bytes: Uint8Array): string {
  let bin = '';
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) bin += String.fromCharCode(...bytes.subarray(i, i + step));
  return btoa(bin);
}
