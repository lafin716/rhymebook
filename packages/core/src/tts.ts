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

export interface TtsPrefs {
  engine: TtsEngine;
  /** OpenAI에서 쓸 음성 하나 */
  openaiVoice: OpenAIVoice;
}

export const OPENAI_TTS_MODEL = 'gpt-4o-mini-tts';

export const OPENAI_VOICES = ['marin', 'cedar', 'coral', 'nova', 'shimmer', 'sage', 'alloy', 'ash', 'ballad', 'echo', 'fable', 'onyx', 'verse'] as const;
export type OpenAIVoice = (typeof OPENAI_VOICES)[number];

export const DEFAULT_TTS_PREFS: TtsPrefs = { engine: 'device', openaiVoice: 'marin' };

export function isOpenAIVoice(v: unknown): v is OpenAIVoice {
  return typeof v === 'string' && (OPENAI_VOICES as readonly string[]).includes(v);
}

/** 저장된 값을 안전하게 복원한다. 모르는 값은 기본값으로 */
export function parseTtsPrefs(raw: unknown): TtsPrefs {
  if (typeof raw !== 'object' || raw === null) return { ...DEFAULT_TTS_PREFS };
  const r = raw as Record<string, unknown>;
  return {
    engine: r.engine === 'openai' ? 'openai' : 'device',
    openaiVoice: isOpenAIVoice(r.openaiVoice) ? r.openaiVoice : DEFAULT_TTS_PREFS.openaiVoice,
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

/** 언어별 발음 지시 (gpt-4o-mini-tts instructions) */
const INSTRUCTIONS: Record<SpeechLang, string> = {
  vi: 'Speak as a native Vietnamese speaker with a standard Northern (Hanoi) accent. Pronounce every tone clearly and naturally, at a pace suitable for a language learner.',
  en: 'Speak as a native English speaker with clear, natural pronunciation, at a pace suitable for a language learner.',
  ko: '표준어를 쓰는 한국어 원어민처럼 또박또박 자연스럽게 읽어 주세요.',
};

export interface OpenAISpeechOptions {
  apiKey: string;
  text: string;
  voice: OpenAIVoice;
  lang: SpeechLang;
  baseUrl?: string | undefined;
  fetch?: FetchLike | undefined;
  signal?: AbortSignal | undefined;
}

/** OpenAI 음성 합성. 성공하면 mp3 바이트, 실패하면 ProviderError를 던진다 (키는 헤더에만, 로그 없음) */
export async function synthesizeOpenAISpeech(o: OpenAISpeechOptions): Promise<ArrayBuffer> {
  const key = o.apiKey.trim();
  if (!key) throw providerError('auth', 'OpenAI API 키가 없습니다.');
  const fetch = o.fetch ?? defaultFetch();
  let res: Response;
  try {
    res = await fetch(`${trimBase(o.baseUrl ?? OPENAI_BASE_URL)}/v1/audio/speech`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: OPENAI_TTS_MODEL,
        voice: o.voice,
        input: o.text,
        instructions: INSTRUCTIONS[o.lang],
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
  const tag = SPEECH_LANG_TAG[lang].toLowerCase();
  const norm = (l: string) => l.replace('_', '-').toLowerCase();
  const score = (v: V) => {
    const l = norm(v.lang);
    const base = l === tag ? 20 : l.split('-')[0] === lang ? 10 : 0;
    if (!base) return 0;
    return base + (v.localService ? 2 : 0) + (v.default ? 1 : 0);
  };
  let best: V | null = null;
  let bestScore = 0;
  for (const v of voices) {
    const s = score(v);
    if (s > bestScore) {
      best = v;
      bestScore = s;
    }
  }
  return best;
}
