import { providerError } from './provider';
import type { ProviderErrorCode } from './model';
import { defaultFetch, httpError, thrownError, trimBase, type FetchLike } from './providers/http';
import { OPENAI_BASE_URL } from './providers/openai';

/**
 * 발음 듣기(TTS, ADR-050).
 * 기본은 기기 OS 음성(speechSynthesis). OpenAI를 고르면 활성 음성 하나로 합성하고,
 * 실패하면(한도·키·네트워크) 기기 음성으로 대신 읽는다. 여기는 플랫폼 무관 순수 로직만 둔다.
 */

export type TtsEngine = 'device' | 'openai';
export type SpeechLang = 'vi' | 'en' | 'ko';

/** 베트남어 억양: 북부(하노이) · 남부(호찌민) */
export type ViAccent = 'north' | 'south';
/** 영어 억양: 미국 · 영국 */
export type EnAccent = 'us' | 'uk';

export interface TtsPrefs {
  engine: TtsEngine;
  /** OpenAI 합성 모델 (공통) */
  openaiModel: OpenAITtsModel;
  /** OpenAI에서 쓸 음성 하나 (공통) */
  openaiVoice: OpenAIVoice;
  /** 언어별 억양 — OpenAI 지시(instructions)에만 쓴다. 기기 음성은 기기에 깔린 음성을 따른다 */
  viAccent: ViAccent;
  enAccent: EnAccent;
}

export const OPENAI_TTS_MODELS = ['gpt-4o-mini-tts', 'gpt-4o-mini-tts-2025-12-15', 'tts-1', 'tts-1-hd'] as const;
export type OpenAITtsModel = (typeof OPENAI_TTS_MODELS)[number];
export const OPENAI_TTS_MODEL: OpenAITtsModel = 'gpt-4o-mini-tts';

export const OPENAI_VOICES = ['marin', 'cedar', 'coral', 'nova', 'shimmer', 'sage', 'alloy', 'ash', 'ballad', 'echo', 'fable', 'onyx', 'verse'] as const;
export type OpenAIVoice = (typeof OPENAI_VOICES)[number];

/** tts-1·tts-1-hd가 지원하는 음성 (marin·cedar·ballad·verse는 gpt-4o-mini-tts 전용) */
const LEGACY_VOICES: readonly OpenAIVoice[] = ['alloy', 'ash', 'coral', 'echo', 'fable', 'onyx', 'nova', 'sage', 'shimmer'];

/** 억양 등 말투 지시를 받는 모델인지 (tts-1 계열은 instructions를 받지 않는다) */
export function ttsModelTakesInstructions(model: OpenAITtsModel): boolean {
  return model.startsWith('gpt-');
}

/** 그 모델에서 고를 수 있는 음성 */
export function openaiVoicesFor(model: OpenAITtsModel): readonly OpenAIVoice[] {
  return ttsModelTakesInstructions(model) ? OPENAI_VOICES : LEGACY_VOICES;
}

export const DEFAULT_TTS_PREFS: TtsPrefs = {
  engine: 'device',
  openaiModel: OPENAI_TTS_MODEL,
  openaiVoice: 'marin',
  viAccent: 'north',
  enAccent: 'us',
};

export function isOpenAIVoice(v: unknown): v is OpenAIVoice {
  return typeof v === 'string' && (OPENAI_VOICES as readonly string[]).includes(v);
}

function isTtsModel(v: unknown): v is OpenAITtsModel {
  return typeof v === 'string' && (OPENAI_TTS_MODELS as readonly string[]).includes(v);
}

/** 모델이 지원하지 않는 음성이면 그 모델의 첫 음성으로 바꾼다 */
export function fitVoiceToModel(model: OpenAITtsModel, voice: OpenAIVoice): OpenAIVoice {
  const voices = openaiVoicesFor(model);
  return voices.includes(voice) ? voice : voices[0]!;
}

/** 저장된 값을 안전하게 복원한다. 모르는 값은 기본값으로 */
export function parseTtsPrefs(raw: unknown): TtsPrefs {
  if (typeof raw !== 'object' || raw === null) return { ...DEFAULT_TTS_PREFS };
  const r = raw as Record<string, unknown>;
  const openaiModel = isTtsModel(r.openaiModel) ? r.openaiModel : DEFAULT_TTS_PREFS.openaiModel;
  const voice = isOpenAIVoice(r.openaiVoice) ? r.openaiVoice : DEFAULT_TTS_PREFS.openaiVoice;
  return {
    engine: r.engine === 'openai' ? 'openai' : 'device',
    openaiModel,
    openaiVoice: fitVoiceToModel(openaiModel, voice),
    viAccent: r.viAccent === 'south' ? 'south' : 'north',
    enAccent: r.enAccent === 'uk' ? 'uk' : 'us',
  };
}

/** speechSynthesis·OpenAI에 넘길 BCP-47 태그 */
export const SPEECH_LANG_TAG: Record<SpeechLang, string> = { vi: 'vi-VN', en: 'en-US', ko: 'ko-KR' };

/** OpenAI 합성 입력 한도(문자) */
export const MAX_SPEECH_CHARS = 4000;

/**
 * 읽을 글 정리: NFC(베트남어 성조 조합형 → 완성형), 마크다운 기호·링크 주소 제거, 공백 정리, 길이 제한.
 */
export function normalizeSpeechText(text: string, max = MAX_SPEECH_CHARS): string {
  const s = text
    .normalize('NFC')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[`*_#>~|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return s.length > max ? s.slice(0, max) : s;
}

/** 베트남어에만 쓰이는 글자 (ă â đ ê ô ơ ư + 성조 표시 모음) */
const VI_CHARS = /[ăâđêôơưàảãáạằẳẵắặầẩẫấậèẻẽéẹềểễếệìỉĩíịòỏõóọồổỗốộờởỡớợùủũúụừửữứựỳỷỹýỵ]/i;
const HANGUL = /[ᄀ-ᇿ㄰-㆏가-힯]/g;
const LATIN_WORD = /[a-zà-ỹđ]+/gi;

/**
 * 읽을 언어를 고른다. 한글이 라틴 글자보다 많으면 한국어,
 * 라틴 단어 중 베트남어 글자가 든 단어가 20% 이상이면 베트남어, 아니면 영어.
 */
export function detectSpeechLang(text: string): SpeechLang {
  const s = text.normalize('NFC');
  const hangul = s.match(HANGUL)?.length ?? 0;
  const words = s.match(LATIN_WORD) ?? [];
  const latin = words.reduce((n, w) => n + w.length, 0);
  if (hangul > latin) return 'ko';
  if (!words.length) return hangul ? 'ko' : 'en';
  const vi = words.filter((w) => VI_CHARS.test(w)).length;
  return vi / words.length >= 0.2 ? 'vi' : 'en';
}

const PACE = 'at a pace suitable for a language learner.';
const VI_ACCENT: Record<ViAccent, string> = {
  north: 'Speak as a native Vietnamese speaker with a standard Northern (Hanoi) accent. Pronounce every tone clearly and naturally, ',
  south:
    'Speak as a native Vietnamese speaker with a natural Southern (Saigon / Ho Chi Minh City) accent, using Southern pronunciation and tones. Pronounce clearly and naturally, ',
};
const EN_ACCENT: Record<EnAccent, string> = {
  us: 'Speak as a native American English speaker with clear, natural pronunciation, ',
  uk: 'Speak as a native British English speaker (standard Southern British / RP accent) with clear, natural pronunciation, ',
};

/** 언어별 발음 지시 (gpt-4o-mini-tts instructions) */
export function speechInstructions(lang: SpeechLang, accent: Pick<TtsPrefs, 'viAccent' | 'enAccent'> = DEFAULT_TTS_PREFS): string {
  if (lang === 'vi') return VI_ACCENT[accent.viAccent] + PACE;
  if (lang === 'en') return EN_ACCENT[accent.enAccent] + PACE;
  return '표준어를 쓰는 한국어 원어민처럼 또박또박 자연스럽게 읽어 주세요.';
}

export interface OpenAISpeechOptions {
  apiKey: string;
  text: string;
  voice: OpenAIVoice;
  lang: SpeechLang;
  /** 기본 gpt-4o-mini-tts */
  model?: OpenAITtsModel | undefined;
  /** 언어별 억양. 기본 북부·미국 */
  accent?: Pick<TtsPrefs, 'viAccent' | 'enAccent'> | undefined;
  baseUrl?: string | undefined;
  fetch?: FetchLike | undefined;
  signal?: AbortSignal | undefined;
}

/** OpenAI 음성 합성. 성공하면 mp3 바이트, 실패하면 ProviderError를 던진다 (키는 헤더에만, 로그 없음) */
export async function synthesizeOpenAISpeech(o: OpenAISpeechOptions): Promise<ArrayBuffer> {
  const key = o.apiKey.trim();
  if (!key) throw providerError('auth', 'OpenAI API 키가 없습니다.');
  const fetch = o.fetch ?? defaultFetch();
  const model = o.model ?? OPENAI_TTS_MODEL;
  let res: Response;
  try {
    res = await fetch(`${trimBase(o.baseUrl ?? OPENAI_BASE_URL)}/v1/audio/speech`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        voice: fitVoiceToModel(model, o.voice),
        input: o.text,
        ...(ttsModelTakesInstructions(model) && { instructions: speechInstructions(o.lang, o.accent) }),
        response_format: 'mp3',
      }),
      signal: o.signal ?? null,
    });
  } catch (e) {
    throw thrownError(e);
  }
  if (!res.ok) throw await httpError(res);
  try {
    return await res.arrayBuffer();
  } catch (e) {
    throw thrownError(e);
  }
}

/** OpenAI 실패 시 기기 음성으로 대신 읽는다는 안내. 중지(aborted)는 대체하지 않으므로 null */
export function ttsFallbackNotice(code: ProviderErrorCode | undefined): string | null {
  if (code === 'aborted') return null;
  const why: Partial<Record<ProviderErrorCode, string>> = {
    auth: 'OpenAI API 키가 없거나 거부되어',
    'rate-limit': 'OpenAI 사용 한도(크레딧)가 부족하거나 요청이 많아',
    offline: 'OpenAI에 연결할 수 없어',
    network: 'OpenAI 서버 응답에 문제가 있어',
  };
  return `${(code && why[code]) ?? 'OpenAI 음성을 만들지 못해'} 기기 음성으로 읽어요.`;
}

export interface DeviceVoiceLike {
  name: string;
  lang: string;
  localService?: boolean;
  default?: boolean;
}

/**
 * 기기 음성 중 언어에 맞는 하나를 고른다.
 * 정확한 지역(vi-VN) > 같은 언어(vi-*) 순, 같은 순위면 기기 내장(localService) > 기본 음성.
 * 맞는 음성이 없으면 null (그래도 lang만 지정해 OS에 맡긴다).
 */
export function pickDeviceVoice<V extends DeviceVoiceLike>(voices: readonly V[], lang: SpeechLang): V | null {
  return rankDeviceVoices(voices, lang)[0] ?? null;
}

/** 언어에 맞는 음성을 나은 순서로. 앞의 음성이 실패하면(음성 데이터 손상 등) 다음 것으로 읽는다 (ADR-051) */
export function rankDeviceVoices<V extends DeviceVoiceLike>(voices: readonly V[], lang: SpeechLang): V[] {
  const tag = SPEECH_LANG_TAG[lang].toLowerCase();
  const norm = (l: string) => l.replace('_', '-').toLowerCase();
  const score = (v: V) => {
    const l = norm(v.lang);
    const base = l === tag ? 20 : l.split('-')[0] === lang ? 10 : 0;
    if (!base) return 0;
    return base + (v.localService ? 2 : 0) + (v.default ? 1 : 0);
  };
  return voices
    .map((v, i) => ({ v, i, s: score(v) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .map((x) => x.v);
}
