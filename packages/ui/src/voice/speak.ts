import {
  detectSpeechLang,
  normalizeSpeechText,
  pickDeviceVoice,
  rankDeviceVoices,
  secretName,
  SPEECH_LANG_TAG,
  synthesizeOpenAISpeech,
  ttsFallbackNotice,
  type MobileSpeech,
  type OpenAIVoice,
  type ProviderError,
  type SpeechLang,
} from '@branch/core';
import { create } from 'zustand';
import { baseUrls, mobile, secrets } from '../app/runtime';
import { pushNotice } from '../app/sync';
import { useUi } from '../app/uiState';

/**
 * 발음 듣기 (ADR-050).
 * - 기본: 기기 OS 음성. 언어(vi/en/ko)를 글에서 골라 맞는 음성으로 읽는다.
 *   웹·데스크톱은 speechSynthesis, 모바일 앱은 네이티브 TTS(Android WebView에는 speechSynthesis가 없음, ADR-051).
 * - OpenAI: 활성 음성 하나로 합성해 재생. 키 없음·한도 부족·네트워크 오류면 기기 음성으로 대신 읽고 알린다.
 * 한 번에 하나만 읽는다. 새로 읽으면 이전 것은 멈춘다.
 * 읽기 카드의 [모두 듣기]는 여러 줄을 차례로 읽는다 (IMP-21). 한 줄이 끝나면 다음 줄, 멈추거나 새로 읽으면 남은 줄은 버린다.
 */

export type SpeechStatus = 'idle' | 'loading' | 'playing';

/** key: 지금 읽는 줄을 부른 쪽이 붙인 이름 (읽기 카드가 어느 줄을 읽는지 표시) */
export const useSpeech = create<{ status: SpeechStatus; key: string | null }>(() => ({ status: 'idle', key: null }));
const setStatus = (status: SpeechStatus) => useSpeech.setState(status === 'idle' ? { status, key: null } : { status });

/** 읽을 한 줄. lang이 없으면 글에서 고른다 */
export interface SpeechLine {
  text: string;
  lang?: SpeechLang;
  key?: string;
}

const LANG_NAME: Record<SpeechLang, string> = { vi: '베트남어', en: '영어', ko: '한국어' };

/** iOS 자동 재생 제한: 누른 순간 무음을 한 번 재생해 이 audio 요소를 풀어 둔다 */
const SILENT_WAV = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=';

const native: MobileSpeech | undefined = mobile?.speech;
const synth: SpeechSynthesis | undefined = !native && typeof window !== 'undefined' ? window.speechSynthesis : undefined;
// 크로미움은 목록을 늦게 채우므로 미리 한 번 불러 둔다
synth?.getVoices();
void native?.voices();

let player: HTMLAudioElement | null = null;
let seq = 0;
let ctrl: AbortController | null = null;
/** [모두 듣기]에서 아직 읽지 않은 줄 */
let queue: SpeechLine[] = [];
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
  queue = [];
  if (native && useSpeech.getState().status !== 'idle') void native.stop().catch(() => {});
  halt();
}

/** 진행 중인 것을 무효로 하고 멈춘다. 네이티브는 새로 읽을 때 앞의 것을 스스로 끊으므로 여기서 멈추지 않는다 */
function halt() {
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
export function speak(raw: string, opts: Omit<SpeechLine, 'text'> = {}) {
  queue = [];
  play({ ...opts, text: raw });
}

/** 여러 줄을 차례로 읽는다 */
export function speakAll(lines: readonly SpeechLine[]) {
  queue = lines.slice(1);
  if (lines[0]) play(lines[0]);
  else stopSpeaking();
}

/** 한 줄이 끝나면(실패 포함) 다음 줄로. 멈췄거나 다른 것을 읽기 시작했으면(id가 낡음) 아무것도 하지 않는다 */
function finished(id: number) {
  if (id !== seq) return;
  const next = queue.shift();
  if (next) play(next);
  else setStatus('idle');
}

function play(line: SpeechLine) {
  halt();
  if (line.key) useSpeech.setState({ key: line.key });
  const text = normalizeSpeechText(line.text);
  const id = seq;
  if (!text) return finished(id);
  const lang = line.lang ?? detectSpeechLang(text);
  const { tts } = useUi.getState();
  if (tts.engine === 'openai') {
    void native?.stop().catch(() => {});
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
  p.onended = () => finished(id);
  try {
    await p.play();
    if (id === seq) setStatus('playing');
  } catch {
    if (id === seq) fallback(undefined, text, lang, id);
  }
}

function fallback(code: ProviderError['code'] | undefined, text: string, lang: SpeechLang, id: number) {
  const notice = ttsFallbackNotice(code);
  if (!notice) return finished(id);
  pushNotice(notice);
  speakDevice(text, lang, id);
}

function speakDevice(text: string, lang: SpeechLang, id: number) {
  if (native) return void speakNative(native, text, lang, id);
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
  const done = () => finished(id);
  u.onstart = () => {
    if (id === seq) setStatus('playing');
  };
  u.onend = done;
  u.onerror = done;
  setStatus('loading');
  synth.speak(u);
}

/** 고른 음성이 실패하면(음성 데이터 손상 등) 같은 언어의 다음 음성으로 몇 번 더 읽어 본다 */
async function speakNative(n: MobileSpeech, text: string, lang: SpeechLang, id: number) {
  setStatus('loading');
  const voices = await n.voices();
  if (id !== seq) return;
  // 내장 음성들은 같은 음성 데이터를 나눠 쓰므로 하나가 깨지면 다 깨진다. 두 번째는 종류(내장/온라인)가 다른 것으로
  const ranked = rankDeviceVoices(voices, lang);
  const other = ranked.find((v) => !!v.localService !== !!ranked[0]?.localService);
  const tries: (number | undefined)[] = [...new Set([ranked[0], other, ...ranked])]
    .filter((v) => v !== undefined)
    .slice(0, 3)
    .map((v) => voices.indexOf(v));
  if (!tries.length) tries.push(undefined);
  setStatus('playing');
  for (const voice of tries) {
    try {
      const ok = await n.speak(text, SPEECH_LANG_TAG[lang], voice);
      if (!ok && id === seq) pushNotice(`이 기기에 ${LANG_NAME[lang]} 음성이 없어 읽지 못했어요. 기기 설정의 음성(텍스트 음성 변환)에서 ${LANG_NAME[lang]}를 추가해 주세요.`);
      break;
    } catch {
      if (id !== seq) return;
      if (voice === tries.at(-1)) pushNotice('기기 음성으로 읽지 못했어요.');
    }
  }
  finished(id);
}
