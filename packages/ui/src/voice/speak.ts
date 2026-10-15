import {
  detectSpeechLang,
  normalizeSpeechText,
  pickDeviceVoice,
  secretName,
  SPEECH_LANG_TAG,
  synthesizeOpenAISpeech,
  ttsFallbackNotice,
  type OpenAIVoice,
  type ProviderError,
  type SpeechLang,
} from '@branch/core';
import { create } from 'zustand';
import { baseUrls, secrets } from '../app/runtime';
import { pushNotice } from '../app/sync';
import { useUi } from '../app/uiState';

/**
 * 발음 듣기 (ADR-050).
 * - 기본: 기기 OS 음성(speechSynthesis). 언어(vi/en/ko)를 글에서 골라 맞는 음성으로 읽는다.
 * - OpenAI: 활성 음성 하나로 합성해 재생. 키 없음·한도 부족·네트워크 오류면 기기 음성으로 대신 읽고 알린다.
 * 한 번에 하나만 읽는다. 새로 읽으면 이전 것은 멈춘다.
 */

export type SpeechStatus = 'idle' | 'loading' | 'playing';

export const useSpeech = create<{ status: SpeechStatus }>(() => ({ status: 'idle' }));
const setStatus = (status: SpeechStatus) => useSpeech.setState({ status });

const LANG_NAME: Record<SpeechLang, string> = { vi: '베트남어', en: '영어', ko: '한국어' };

/** iOS 자동 재생 제한: 누른 순간 무음을 한 번 재생해 이 audio 요소를 풀어 둔다 */
const SILENT_WAV = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=';

const synth: SpeechSynthesis | undefined = typeof window !== 'undefined' ? window.speechSynthesis : undefined;
// 크로미움은 목록을 늦게 채우므로 미리 한 번 불러 둔다
synth?.getVoices();

let player: HTMLAudioElement | null = null;
let seq = 0;
let ctrl: AbortController | null = null;
const warnedLang = new Set<SpeechLang>();

/** 같은 글·음성은 다시 합성하지 않는다 (토큰 절약). 최근 것만 둔다 */
const cache = new Map<string, string>();
const CACHE_MAX = 30;

function remember(key: string, url: string) {
  cache.set(key, url);
  if (cache.size <= CACHE_MAX) return;
  const [oldKey, oldUrl] = cache.entries().next().value as [string, string];
  cache.delete(oldKey);
  URL.revokeObjectURL(oldUrl);
}

export function stopSpeaking() {
  seq++;
  ctrl?.abort();
  ctrl = null;
  if (player) {
    player.onended = null;
    player.pause();
  }
  synth?.cancel();
  setStatus('idle');
}

/** 글을 읽는다. 클릭 핸들러 안에서 바로 불러야 모바일 자동 재생 제한에 걸리지 않는다 */
export function speak(raw: string) {
  stopSpeaking();
  const text = normalizeSpeechText(raw);
  if (!text) return;
  const lang = detectSpeechLang(text);
  const id = seq;
  const { tts } = useUi.getState();
  if (tts.engine === 'openai') {
    unlock();
    void speakOpenAI(text, lang, tts.openaiVoice, id);
  } else {
    speakDevice(text, lang, id);
  }
}

function unlock() {
  player ??= new Audio();
  player.src = SILENT_WAV;
  player.play().catch(() => {});
  // 대체 재생에 대비해 기기 음성도 이 제스처 안에서 깨워 둔다 (iOS)
  synth?.speak(new SpeechSynthesisUtterance(''));
}

async function speakOpenAI(text: string, lang: SpeechLang, voice: OpenAIVoice, id: number) {
  setStatus('loading');
  const key = `${voice}|${text}`;
  let url = cache.get(key);
  if (!url) {
    const apiKey = await secrets.get(secretName.apiKey('openai-api'));
    if (id !== seq) return;
    ctrl = new AbortController();
    try {
      const bytes = await synthesizeOpenAISpeech({
        apiKey: apiKey ?? '',
        text,
        voice,
        lang,
        baseUrl: baseUrls['openai-api'],
        signal: ctrl.signal,
      });
      url = URL.createObjectURL(new Blob([bytes], { type: 'audio/mpeg' }));
      remember(key, url);
    } catch (e) {
      if (id !== seq) return;
      return fallback((e as ProviderError).code, text, lang, id);
    }
    if (id !== seq) return;
  }
  const p = (player ??= new Audio());
  p.src = url;
  p.onended = () => {
    if (id === seq) setStatus('idle');
  };
  try {
    await p.play();
    if (id === seq) setStatus('playing');
  } catch {
    if (id === seq) fallback(undefined, text, lang, id);
  }
}

function fallback(code: ProviderError['code'] | undefined, text: string, lang: SpeechLang, id: number) {
  const notice = ttsFallbackNotice(code);
  if (!notice) return setStatus('idle');
  pushNotice(notice);
  speakDevice(text, lang, id);
}

function speakDevice(text: string, lang: SpeechLang, id: number) {
  if (!synth) {
    pushNotice('이 기기에서는 음성으로 읽어 줄 수 없어요.');
    return setStatus('idle');
  }
  const u = new SpeechSynthesisUtterance(text);
  u.lang = SPEECH_LANG_TAG[lang];
  const voice = pickDeviceVoice(synth.getVoices(), lang);
  if (voice) u.voice = voice;
  else if (!warnedLang.has(lang) && synth.getVoices().length) {
    warnedLang.add(lang);
    pushNotice(`이 기기에 ${LANG_NAME[lang]} 음성이 없어요. 기기 설정에서 음성을 추가하면 발음이 정확해져요.`);
  }
  const done = () => {
    if (id === seq) setStatus('idle');
  };
  u.onstart = () => {
    if (id === seq) setStatus('playing');
  };
  u.onend = done;
  u.onerror = done;
  setStatus('loading');
  synth.speak(u);
}
