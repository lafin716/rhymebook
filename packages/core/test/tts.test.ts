import { describe, expect, it } from 'vitest';
import {
  detectSpeechLang,
  normalizeSpeechText,
  parseTtsPrefs,
  fitVoiceToModel,
  openaiVoicesFor,
  speechInstructions,
  pickDeviceVoice,
  rankDeviceVoices,
  synthesizeOpenAISpeech,
  ttsFallbackNotice,
  type ProviderError,
} from '../src';

describe('detectSpeechLang', () => {
  it('베트남어 글자가 든 문장은 vi', () => {
    expect(detectSpeechLang('Xin chào, tôi là sinh viên.')).toBe('vi');
    expect(detectSpeechLang('Cảm ơn')).toBe('vi');
    expect(detectSpeechLang('đi')).toBe('vi');
  });
  it('조합형(NFD) 베트남어도 vi', () => {
    expect(detectSpeechLang('Cảm ơn bạn'.normalize('NFD'))).toBe('vi');
  });
  it('영어는 en, 성조 없는 베트남어 단어만 있으면 en으로 본다', () => {
    expect(detectSpeechLang('The quick brown fox')).toBe('en');
    expect(detectSpeechLang('pho')).toBe('en');
    expect(detectSpeechLang('café latte with milk and sugar, please')).toBe('en');
  });
  it('한글이 더 많으면 ko, 영어 단어가 섞인 설명은 글자 수로', () => {
    expect(detectSpeechLang('안녕하세요')).toBe('ko');
    expect(detectSpeechLang('apple은 사과라는 뜻이에요')).toBe('ko');
    expect(detectSpeechLang('pronunciation 발음')).toBe('en');
  });
  it('글자가 없으면 en', () => {
    expect(detectSpeechLang('123 !?')).toBe('en');
  });
});

describe('normalizeSpeechText', () => {
  it('NFC로 합치고 마크다운 기호·링크 주소·공백을 정리한다', () => {
    const nfd = 'Cảm ơn'.normalize('NFD');
    expect(normalizeSpeechText(nfd)).toBe('Cảm ơn');
    expect(normalizeSpeechText(nfd).length).toBe('Cảm ơn'.length);
    expect(normalizeSpeechText('**bold** `code`\n\n# Title [link](https://x.y)')).toBe('bold code Title link');
  });
  it('길이를 자른다', () => {
    expect(normalizeSpeechText('a'.repeat(10), 4)).toBe('aaaa');
  });
});

describe('parseTtsPrefs', () => {
  const defaults = { engine: 'device', openaiModel: 'gpt-4o-mini-tts', openaiVoice: 'marin', viAccent: 'north', enAccent: 'us' };
  it('기본값은 기기 음성·북부·미국', () => {
    expect(parseTtsPrefs(null)).toEqual(defaults);
    expect(parseTtsPrefs({ engine: 'x', openaiVoice: 'nope', openaiModel: 'x', viAccent: 'x' })).toEqual(defaults);
    // 이전 저장값(모델·억양 없음)도 그대로 읽힌다
    expect(parseTtsPrefs({ engine: 'openai', openaiVoice: 'coral' })).toEqual({ ...defaults, engine: 'openai', openaiVoice: 'coral' });
  });
  it('알려진 값은 그대로', () => {
    const v = { engine: 'openai', openaiModel: 'tts-1-hd', openaiVoice: 'nova', viAccent: 'south', enAccent: 'uk' };
    expect(parseTtsPrefs(v)).toEqual(v);
  });
  it('모델이 지원하지 않는 음성은 그 모델 음성으로 바꾼다', () => {
    expect(parseTtsPrefs({ openaiModel: 'tts-1', openaiVoice: 'marin' }).openaiVoice).toBe('alloy');
    expect(openaiVoicesFor('tts-1')).not.toContain('marin');
    expect(fitVoiceToModel('tts-1', 'coral')).toBe('coral');
  });
});

describe('speechInstructions', () => {
  it('베트남어는 북부/남부, 영어는 미국/영국 억양', () => {
    expect(speechInstructions('vi')).toMatch(/Hanoi/);
    expect(speechInstructions('vi', { viAccent: 'south', enAccent: 'us' })).toMatch(/Saigon/);
    expect(speechInstructions('en', { viAccent: 'north', enAccent: 'uk' })).toMatch(/British/);
    expect(speechInstructions('en')).toMatch(/American/);
  });
});

describe('pickDeviceVoice', () => {
  const voices = [
    { name: 'Samantha', lang: 'en-US', localService: true, default: true },
    { name: 'Google Tiếng Việt', lang: 'vi-VN', localService: false },
    { name: 'Linh', lang: 'vi-VN', localService: true },
    { name: 'Daniel', lang: 'en-GB', localService: true },
    { name: 'Yuna', lang: 'ko_KR', localService: true },
  ];
  it('정확한 지역 + 내장 음성을 우선한다', () => {
    expect(pickDeviceVoice(voices, 'vi')?.name).toBe('Linh');
    expect(pickDeviceVoice(voices, 'en')?.name).toBe('Samantha');
    expect(pickDeviceVoice(voices, 'ko')?.name).toBe('Yuna');
  });
  it('같은 언어 다른 지역도 쓰고, 없으면 null', () => {
    expect(pickDeviceVoice([voices[3]!], 'en')?.name).toBe('Daniel');
    expect(pickDeviceVoice([voices[0]!], 'vi')).toBeNull();
  });
  it('후보 순서: 내장 > 원격 > 다른 지역, 다른 언어는 빠진다', () => {
    expect(rankDeviceVoices(voices, 'vi').map((v) => v.name)).toEqual(['Linh', 'Google Tiếng Việt']);
    expect(rankDeviceVoices(voices, 'en').map((v) => v.name)).toEqual(['Samantha', 'Daniel']);
  });
});

describe('synthesizeOpenAISpeech', () => {
  it('음성 하나·언어 지시로 요청하고 바이트를 돌려준다', async () => {
    let url = '';
    let init: RequestInit | undefined;
    const buf = await synthesizeOpenAISpeech({
      apiKey: ' sk-test ',
      text: 'Xin chào',
      voice: 'coral',
      lang: 'vi',
      baseUrl: 'http://mock/',
      fetch: async (u, i) => {
        url = u;
        init = i;
        return new Response(new Uint8Array([1, 2, 3]));
      },
    });
    expect(new Uint8Array(buf)).toEqual(new Uint8Array([1, 2, 3]));
    expect(url).toBe('http://mock/v1/audio/speech');
    expect((init?.headers as Record<string, string>).authorization).toBe('Bearer sk-test');
    const body = JSON.parse(init?.body as string) as Record<string, string>;
    expect(body).toMatchObject({ model: 'gpt-4o-mini-tts', voice: 'coral', input: 'Xin chào', response_format: 'mp3' });
    expect(body.instructions).toMatch(/Hanoi/);
  });

  it('모델·억양을 바꾸고, tts-1 계열에는 지시를 보내지 않는다', async () => {
    const bodies: Record<string, string>[] = [];
    const fetch = async (_u: string, i?: RequestInit) => {
      bodies.push(JSON.parse(i?.body as string) as Record<string, string>);
      return new Response(new Uint8Array([1]));
    };
    const base = { apiKey: 'sk-x', text: 'Xin chào', lang: 'vi' as const, fetch };
    await synthesizeOpenAISpeech({ ...base, voice: 'marin', accent: { viAccent: 'south', enAccent: 'us' } });
    await synthesizeOpenAISpeech({ ...base, voice: 'marin', model: 'tts-1' });
    expect(bodies[0]?.instructions).toMatch(/Saigon/);
    expect(bodies[1]).toMatchObject({ model: 'tts-1', voice: 'alloy' });
    expect(bodies[1]).not.toHaveProperty('instructions');
  });

  it('키가 없으면 auth, 한도 초과(429)는 rate-limit, 연결 실패는 offline', async () => {
    const fail = (p: Promise<unknown>) => p.then(() => null, (e: ProviderError) => e.code);
    const base = { text: 'hi', voice: 'marin' as const, lang: 'en' as const };
    expect(await fail(synthesizeOpenAISpeech({ ...base, apiKey: '', fetch: async () => new Response('') }))).toBe('auth');
    const quota = async () => new Response(JSON.stringify({ error: { message: 'You exceeded your current quota' } }), { status: 429 });
    expect(await fail(synthesizeOpenAISpeech({ ...base, apiKey: 'sk-x', fetch: quota }))).toBe('rate-limit');
    expect(await fail(synthesizeOpenAISpeech({ ...base, apiKey: 'sk-x', fetch: async () => new Response('{}', { status: 401 }) }))).toBe('auth');
    const offline = async () => {
      throw new TypeError('Failed to fetch');
    };
    expect(await fail(synthesizeOpenAISpeech({ ...base, apiKey: 'sk-x', fetch: offline }))).toBe('offline');
  });

  it('오류 메시지에 키가 들어가지 않는다', async () => {
    const err = await synthesizeOpenAISpeech({
      apiKey: 'sk-secret-123456',
      text: 'hi',
      voice: 'marin',
      lang: 'en',
      fetch: async () => new Response(JSON.stringify({ error: { message: 'bad' } }), { status: 400 }),
    }).catch((e: ProviderError) => e);
    expect(JSON.stringify(err)).not.toContain('sk-secret');
  });
});

describe('ttsFallbackNotice', () => {
  it('원인별 안내, 중지는 대체하지 않는다', () => {
    expect(ttsFallbackNotice('rate-limit')).toMatch(/한도.*기기 음성/);
    expect(ttsFallbackNotice('auth')).toMatch(/키/);
    expect(ttsFallbackNotice(undefined)).toMatch(/기기 음성/);
    expect(ttsFallbackNotice('aborted')).toBeNull();
  });
});
