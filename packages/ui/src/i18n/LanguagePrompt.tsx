import { Check, Languages } from 'lucide-react';
import { useState } from 'react';
import { isDemo } from '../app/runtime';
import { Button } from '../components/Button';
import { Modal } from '../components/Modal';
import { cn } from '../lib/cn';
import { LANGUAGES, t, useLocale, type Locale } from '.';

/** 설치 후 첫 실행: 앱 언어를 고른다 (ADR-105). 고르기 전에는 시작 안내를 띄우지 않는다 */
export function LanguagePrompt() {
  const needsPrompt = useLocale((s) => s.needsPrompt);
  const current = useLocale((s) => s.locale);
  const [pick, setPick] = useState<Locale>(current);
  if (!needsPrompt || isDemo()) return null;
  const start = () => useLocale.getState().choose(pick);
  return (
    <Modal open onClose={start} label={t('common.language.promptTitle')} className="md:max-w-md">
      <div className="flex h-13 shrink-0 items-center gap-2 border-b border-line px-4">
        <Languages size={18} className="text-accent" />
        <h2 className="flex-1 text-[16px] font-semibold">
          {t('common.language.promptTitle')}
          <span className="ml-2 text-[12.5px] font-normal text-muted">Language</span>
        </h2>
      </div>
      <div className="space-y-3 px-4 py-4 md:px-5">
        <p className="text-[13.5px] text-fg-2">{t('common.language.promptBody')}</p>
        <div role="radiogroup" aria-label={t('common.language.label')} className="space-y-1.5">
          {LANGUAGES.map((l) => (
            <button
              key={l.id}
              type="button"
              role="radio"
              aria-checked={pick === l.id}
              lang={l.id}
              onClick={() => setPick(l.id)}
              className={cn(
                'flex h-11 w-full items-center gap-2 rounded-xl border px-3.5 text-left text-[14px]',
                pick === l.id ? 'border-accent bg-accent-soft font-medium' : 'border-line hover:bg-surface-2',
              )}
            >
              <span className="flex-1">{l.name}</span>
              {pick === l.id && <Check size={16} className="text-accent" />}
            </button>
          ))}
        </div>
      </div>
      <div className="flex shrink-0 justify-end border-t border-line px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <Button variant="primary" onClick={start}>{t('common.language.promptStart')}</Button>
      </div>
    </Modal>
  );
}
