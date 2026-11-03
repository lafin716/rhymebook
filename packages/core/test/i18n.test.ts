import { afterEach, describe, expect, it } from 'vitest';
import { LANGUAGES, DEFAULT_LOCALE, getLocale, matchLocale, messagesOf, setLocale, t, type MessageKey } from '../src/i18n';

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

afterEach(() => setLocale(DEFAULT_LOCALE));

describe('i18n', () => {
  it('기본 언어는 한국어', () => {
    expect(getLocale()).toBe('ko');
    expect(t('common.close')).toBe('닫기');
  });

  it('언어를 바꾸면 그 언어 문구, 자리표시자 채우기', () => {
    setLocale('en');
    expect(t('common.close')).toBe('Close');
    expect(t('common.language.label')).toBe('Language');
  });

  it('없는 키는 한국어 → 키 순으로 대신한다', () => {
    setLocale('en');
    expect(t('nope.missing' as MessageKey)).toBe('nope.missing');
  });

  it('matchLocale', () => {
    expect(matchLocale('en-US')).toBe('en');
    expect(matchLocale('en_GB.UTF-8')).toBe('en');
    expect(matchLocale('ko')).toBe('ko');
    expect(matchLocale('fr')).toBeNull();
    expect(matchLocale(undefined)).toBeNull();
  });

  // 기여자용 검사: 모든 언어 파일이 한국어 파일과 같은 키·자리표시자를 가진다
  const ko = messagesOf('ko');
  for (const lang of LANGUAGES.filter((l) => l.id !== 'ko')) {
    describe(`${lang.id} 언어 파일`, () => {
      const other = messagesOf(lang.id);
      it('한국어의 모든 키가 있다', () => {
        const missing = [...ko.keys()].filter((k) => !other.has(k));
        expect(missing).toEqual([]);
      });
      it('한국어에 없는 키가 없다 (복수형 _one 제외)', () => {
        const extra = [...other.keys()].filter((k) => !ko.has(k) && !(k.endsWith('_one') && ko.has(k.slice(0, -4))));
        expect(extra).toEqual([]);
      });
      it('자리표시자가 같다', () => {
        const wrong = [...other.entries()]
          .filter(([k]) => ko.has(k.endsWith('_one') && !ko.has(k) ? k.slice(0, -4) : k))
          .filter(([k, v]) => {
            const base = ko.get(k) ?? ko.get(k.slice(0, -4))!;
            // 복수형 단수 문구는 {count}를 생략할 수 있다
            const want = placeholders(base).filter((p) => !(k.endsWith('_one') && !ko.has(k) && p === 'count'));
            const got = placeholders(v).filter((p) => !(k.endsWith('_one') && !ko.has(k) && p === 'count'));
            return JSON.stringify([...new Set(want)]) !== JSON.stringify([...new Set(got)]);
          })
          .map(([k]) => k);
        expect(wrong).toEqual([]);
      });
    });
  }
});
