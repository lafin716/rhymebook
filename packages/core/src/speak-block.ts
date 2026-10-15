import { detectSpeechLang, type SpeechLang } from './tts';

/**
 * 읽어 주기 블록 (IMP-21, ADR-052).
 * /speak 스킬 답변의 ```speak 코드 블록을 읽을 문장 목록으로 바꾼다. 대화창은 이 목록을 재생 카드로 그린다.
 * 모델 출력은 그대로 믿지 않는다: JSON이 아니면 줄마다 한 문장으로 읽고, 쓸 문장이 없으면 null.
 */

export interface SpeakItem {
  text: string;
  lang: SpeechLang;
  /** 뜻·발음 설명 (읽지 않는다) */
  note?: string;
}

export interface SpeakScript {
  title: string;
  items: SpeakItem[];
}

/** 코드 블록 언어 이름 */
export const SPEAK_LANG = 'speak';

export const SPEAK_LIMITS = { items: 50, text: 1000, note: 300, title: 120 } as const;

const str = (v: unknown, max: number): string | null => (typeof v === 'string' && v.trim() ? v.trim().normalize('NFC').slice(0, max) : null);

/** `vi`·`vi-VN`·`Vietnamese`·`베트남어` 등을 읽기 언어로. 모르면 null */
export function speakLang(v: unknown): SpeechLang | null {
  if (typeof v !== 'string') return null;
  const s = v.trim().toLowerCase();
  if (/^vi([-_]|$)|vietnam|베트남/.test(s)) return 'vi';
  if (/^en([-_]|$)|english|영어/.test(s)) return 'en';
  if (/^ko([-_]|$)|korean|한국/.test(s)) return 'ko';
  return null;
}

function parseItem(raw: unknown): SpeakItem | null {
  if (typeof raw === 'string') {
    const text = str(raw, SPEAK_LIMITS.text);
    return text ? { text, lang: detectSpeechLang(text) } : null;
  }
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const text = str(r.text ?? r.say ?? r.speak, SPEAK_LIMITS.text);
  if (!text) return null;
  const note = str(r.note ?? r.meaning ?? r.translation, SPEAK_LIMITS.note);
  return { text, lang: speakLang(r.lang ?? r.language) ?? detectSpeechLang(text), ...(note ? { note } : {}) };
}

export function parseSpeakBlock(source: string): SpeakScript | null {
  const src = source.trim();
  if (!src) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(src);
  } catch {
    // JSON이 아니면 빈 줄을 뺀 줄마다 한 문장
    raw = src.split('\n');
  }
  let title = '';
  let list: unknown[];
  let lang: SpeechLang | null = null;
  if (Array.isArray(raw)) list = raw;
  else if (raw && typeof raw === 'object') {
    const r = raw as Record<string, unknown>;
    title = str(r.title, SPEAK_LIMITS.title) ?? '';
    lang = speakLang(r.lang ?? r.language);
    list = Array.isArray(r.items) ? r.items : r.text !== undefined ? [r] : [];
  } else if (typeof raw === 'string') list = [raw];
  else return null;
  const items: SpeakItem[] = [];
  for (const entry of list) {
    if (items.length >= SPEAK_LIMITS.items) break;
    const item = parseItem(entry);
    if (!item) continue;
    // 블록 전체 언어를 정했고 문장에 따로 없으면 그 언어로
    const own = entry && typeof entry === 'object' ? speakLang((entry as Record<string, unknown>).lang ?? (entry as Record<string, unknown>).language) : null;
    items.push(lang && !own ? { ...item, lang } : item);
  }
  return items.length ? { title, items } : null;
}
