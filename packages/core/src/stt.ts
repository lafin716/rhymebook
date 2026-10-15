/**
 * 음성 입력 (IMP-16, ADR-045).
 * 전사는 PC의 로컬 whisper.cpp가 한다. 웹·모바일은 bridge 메시지로 PC에 녹음을 보내고 PC 설정을 따른다.
 * 이 파일은 플랫폼 무관 순수 로직(모델 카탈로그·WAV 인코딩·검증·결과 정리)만 둔다.
 */

export type SttModelId = 'large-v3-turbo-q5_0' | 'small-q5_1';

export interface SttModelInfo {
  id: SttModelId;
  label: string;
  /** 설정 화면 안내 */
  note: string;
  file: string;
  /** 바이트 */
  size: number;
  sha256: string;
}

const HF_BASE = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/';

/** 받을 수 있는 모델 (whisper.cpp 공식 ggml). 첫 항목이 기본 */
export const STT_MODELS: readonly SttModelInfo[] = [
  {
    id: 'large-v3-turbo-q5_0',
    label: '기본 (정확)',
    note: 'Apple Silicon·최근 GPU PC 권장. 한국어 정확도가 가장 좋아요.',
    file: 'ggml-large-v3-turbo-q5_0.bin',
    size: 574_041_195,
    sha256: '394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2',
  },
  {
    id: 'small-q5_1',
    label: '가벼운 (빠름)',
    note: '오래된·저사양 PC용. 빠르지만 정확도가 조금 낮아요.',
    file: 'ggml-small-q5_1.bin',
    size: 190_085_487,
    sha256: 'ae85e4a935d7a567bd102fe55afc16bb595bdb618e11b2fc7591bc08120411bb',
  },
];

export const DEFAULT_STT_MODEL: SttModelId = 'large-v3-turbo-q5_0';

export function sttModel(id: string): SttModelInfo | undefined {
  return STT_MODELS.find((m) => m.id === id);
}

export function isSttModelId(v: unknown): v is SttModelId {
  return typeof v === 'string' && STT_MODELS.some((m) => m.id === v);
}

export function sttModelUrl(m: SttModelInfo): string {
  return HF_BASE + m.file;
}

/** 원격 기기도 받는 요약 상태 (stt.status) */
export interface SttStatus {
  /** PC에서 음성 입력을 켜 두었는지 */
  enabled: boolean;
  /** 지금 바로 전사할 수 있는지 (켜짐 + 모델 + 엔진) */
  ready: boolean;
  /** 준비되지 않은 이유 (표시용) */
  detail?: string;
}

/** PC 설정 화면용 전체 상태 (데스크톱 IPC만) */
export interface SttState extends SttStatus {
  model: SttModelId;
  /** 받아 둔 모델 */
  installed: SttModelId[];
  /** whisper-cli 경로를 찾았는지 */
  engine: boolean;
  /** 받는 중이면 진행률 */
  download: { model: SttModelId; received: number; total: number } | null;
  /** 마지막 다운로드·전사 오류 */
  error?: string;
}

/** 녹음 최대 길이(초). 16kHz mono PCM16이면 약 1.9MB */
export const STT_MAX_SECONDS = 60;
export const STT_SAMPLE_RATE = 16_000;
/** WAV 헤더 + 최대 길이 PCM, 여유 1초 */
export const STT_MAX_AUDIO_BYTES = 44 + (STT_MAX_SECONDS + 1) * STT_SAMPLE_RATE * 2;
/** base64 문자열 최대 길이 */
export const STT_MAX_AUDIO_B64 = Math.ceil(STT_MAX_AUDIO_BYTES / 3) * 4;

/** 원격에서 들어온 오디오 문자열 검사 (형식·크기) */
export function isSttAudio(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0 && v.length <= STT_MAX_AUDIO_B64 && v.length % 4 === 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(v);
}

/** 여러 채널을 평균해 mono로 */
export function mixToMono(channels: Float32Array[]): Float32Array {
  if (channels.length === 1) return channels[0]!;
  const n = Math.min(...channels.map((c) => c.length));
  const out = new Float32Array(n);
  for (const c of channels) for (let i = 0; i < n; i++) out[i]! += c[i]! / channels.length;
  return out;
}

/** 선형 보간 리샘플 (낮추는 경우 구간 평균으로 앨리어싱을 줄인다) */
export function resample(input: Float32Array, from: number, to: number): Float32Array {
  if (from === to || !input.length) return input;
  const ratio = from / to;
  const n = Math.max(1, Math.floor(input.length / ratio));
  const out = new Float32Array(n);
  if (ratio > 1) {
    for (let i = 0; i < n; i++) {
      const start = Math.floor(i * ratio);
      const end = Math.min(input.length, Math.max(start + 1, Math.floor((i + 1) * ratio)));
      let sum = 0;
      for (let j = start; j < end; j++) sum += input[j]!;
      out[i] = sum / (end - start);
    }
  } else {
    for (let i = 0; i < n; i++) {
      const x = i * ratio;
      const j = Math.floor(x);
      const a = input[j]!;
      const b = input[Math.min(j + 1, input.length - 1)]!;
      out[i] = a + (b - a) * (x - j);
    }
  }
  return out;
}

/** mono float 샘플 → 16bit PCM WAV */
export function encodeWav(samples: Float32Array, sampleRate: number): Uint8Array {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buf);
  const str = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i));
  };
  str(0, 'RIFF');
  v.setUint32(4, 36 + samples.length * 2, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, 'data');
  v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]!));
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Uint8Array(buf);
}

/** 무음 판정 문턱(30ms 구간 RMS). 약 -50dBFS — 작은 목소리는 넘고 마이크 바닥 잡음은 못 넘는다 */
export const STT_SILENCE_RMS = 0.003;

/**
 * 녹음 전체가 무음인지. whisper는 무음에서 '고맙습니다' 같은 문구를 지어내므로 보내기 전에 거른다.
 * 30ms 구간 중 하나라도 문턱을 넘으면 말이 있다고 본다.
 */
export function isSilent(samples: Float32Array, sampleRate: number, threshold = STT_SILENCE_RMS): boolean {
  const frame = Math.max(1, Math.round(sampleRate * 0.03));
  for (let start = 0; start < samples.length; start += frame) {
    const end = Math.min(samples.length, start + frame);
    let sum = 0;
    for (let i = start; i < end; i++) sum += samples[i]! * samples[i]!;
    if (Math.sqrt(sum / (end - start)) >= threshold) return false;
  }
  return true;
}

/** 16kHz mono PCM16 WAV인지 (bridge가 whisper-cli에 넘기기 전 확인) */
export function isSttWav(bytes: Uint8Array): boolean {
  if (bytes.length < 44 || bytes.length > STT_MAX_AUDIO_BYTES) return false;
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (o: number) => String.fromCharCode(bytes[o]!, bytes[o + 1]!, bytes[o + 2]!, bytes[o + 3]!);
  return (
    tag(0) === 'RIFF' &&
    v.getUint32(4, true) === bytes.length - 8 &&
    tag(8) === 'WAVE' &&
    tag(12) === 'fmt ' &&
    v.getUint16(20, true) === 1 &&
    v.getUint16(22, true) === 1 &&
    v.getUint32(24, true) === STT_SAMPLE_RATE &&
    v.getUint16(34, true) === 16 &&
    tag(36) === 'data' &&
    v.getUint32(40, true) === bytes.length - 44
  );
}

/** 무음에서 whisper가 흔히 지어내는 문구 (자막 데이터 영향) */
const HALLUCINATIONS = [
  /시청해\s*주셔서\s*감사합니다\.?/g,
  /구독과\s*좋아요(\s*부탁드립니다)?\.?/g,
  /MBC\s*뉴스\s*[가-힣]+입니다\.?/g,
  /자막\s*제공\s*및\s*자막\s*편집\s*:?\s*[^\n]*/g,
];

/** whisper-cli 출력 정리: [음악]·(박수) 같은 소리 표기, 흔한 환각 문구, 공백 */
export function cleanTranscript(raw: string): string {
  let t = raw.replace(/\[[^\]\n]{0,40}\]|\([^)\n]{0,20}\)|♪+/g, ' ');
  for (const re of HALLUCINATIONS) t = t.replace(re, ' ');
  return t
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join(' ')
    .trim();
}
