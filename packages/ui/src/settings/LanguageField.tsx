import { LANGUAGES, t, useLocale, type Locale } from '../i18n';
import { Field } from './controls';

/** 설정 → 일반: 앱 언어 (ADR-105). 바꾸면 앱을 다시 불러온다 */
export function LanguageField() {
  const locale = useLocale((s) => s.locale);
  return (
    <Field label={t('common.language.label')} hint={t('common.language.hint')}>
      <select
        value={locale}
        aria-label={t('common.language.label')}
        onChange={(e) => useLocale.getState().choose(e.target.value as Locale)}
        className="h-10 w-full rounded-lg border border-line bg-bg px-3 text-[14px] outline-none focus:border-accent"
      >
        {LANGUAGES.map((l) => (
          <option key={l.id} value={l.id} lang={l.id}>
            {l.name}
          </option>
        ))}
      </select>
      <p className="mt-1.5 text-[12px] text-muted">{t('common.language.contribute')}</p>
    </Field>
  );
}
