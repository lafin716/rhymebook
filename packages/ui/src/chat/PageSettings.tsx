import { X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { caps } from '../app/capabilities';
import { t } from '../i18n';
import { loadEmoji, loadKeyboardBar, saveEmoji, saveKeyboardBar } from './pagePrefs';

interface PageSettingsProps {
  open: boolean;
  onClose(): void;
  onEmojiChange?(value: boolean): void;
}

/** 페이지 편집기 설정 창: 키보드 바(모바일만), 이모지 미리보기 */
export function PageSettings({ open, onClose, onEmojiChange }: PageSettingsProps) {
  const [keyboardBar, setKeyboardBar] = useState(() => loadKeyboardBar());
  const [emoji, setEmoji] = useState(() => loadEmoji());

  const handleKeyboardBarChange = useCallback(
    (value: boolean) => {
      setKeyboardBar(value);
      saveKeyboardBar(value);
    },
    [],
  );

  const handleEmojiChange = useCallback(
    (value: boolean) => {
      setEmoji(value);
      saveEmoji(value);
      onEmojiChange?.(value);
    },
    [onEmojiChange],
  );

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="animate-fade-in fixed inset-0 z-[60] flex items-end justify-center bg-black/40 md:items-center md:p-6"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="page-settings-title"
        className="animate-pop-in w-full border-line bg-surface px-5 pt-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-float max-md:rounded-t-3xl max-md:border-t md:max-w-[380px] md:rounded-2xl md:border md:pb-5"
      >
        <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-line-strong md:hidden" />
        <div className="flex items-center justify-between mb-4">
          <h2 id="page-settings-title" className="text-[16px] leading-snug font-semibold text-fg">
            {t('page.settings.title')}
          </h2>
          <button
            type="button"
            aria-label={t('page.settings.close')}
            onClick={onClose}
            className="inline-flex size-8 items-center justify-center rounded-lg text-fg-2 hover:bg-surface-2 md:hidden"
          >
            <X size={20} />
          </button>
        </div>

        <div className="space-y-3">
          {caps.kind === 'mobile' && (
            <SettingRow
              label={t('page.settings.keyboardBar')}
              description={t('page.settings.keyboardBarDesc')}
              checked={keyboardBar}
              onChange={handleKeyboardBarChange}
            />
          )}
          <SettingRow
            label={t('page.settings.emoji')}
            description={t('page.settings.emojiDesc')}
            checked={emoji}
            onChange={handleEmojiChange}
          />
        </div>

        <div className="mt-5 flex gap-2 md:justify-end">
          <button
            type="button"
            onClick={onClose}
            className="h-10 flex-1 rounded-xl border border-line bg-surface px-3.5 text-sm font-medium text-fg hover:bg-surface-2 md:flex-none md:w-auto"
          >
            {t('page.settings.close')}
          </button>
        </div>
      </div>
    </div>
  );
}

interface SettingRowProps {
  label: string;
  description: string;
  checked: boolean;
  onChange(value: boolean): void;
}

function SettingRow({ label, description, checked, onChange }: SettingRowProps) {
  return (
    <label className="flex items-start gap-3 cursor-pointer hover:bg-surface-2 p-2 rounded-lg">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-1 size-5 cursor-pointer accent-accent"
      />
      <div className="min-w-0 flex-1">
        <div className="text-[14px] font-medium text-fg">{label}</div>
        <div className="text-[13px] text-muted mt-0.5">{description}</div>
      </div>
    </label>
  );
}
