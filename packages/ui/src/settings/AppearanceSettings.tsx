import { Check, Monitor, Moon, Sun, Waves } from 'lucide-react';
import { actions, useApp } from '../app/store';
import { PALETTES, usePalette } from '../app/palette';
import { cn } from '../lib/cn';
import { Field, Section } from './controls';

export function AppearanceSettings() {
  const theme = useApp((s) => s.settings.theme);
  const { palette, setPalette } = usePalette();
  return (
    <Section title="나의 바다" hint="오늘의 배움에 어울리는 색을 골라 보세요. 이 기기에만 적용돼요.">
      <div className="mb-4 flex items-center gap-3 rounded-xl bg-accent-soft p-3.5 text-accent">
        <Waves size={22} className="shrink-0" />
        <p className="text-[13px] leading-relaxed">어떤 바다에서도, 호기심은 계속 뻗어나가요.</p>
      </div>
      <Field label="색상 테마">
        <div role="group" aria-label="색상 테마" className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
          {PALETTES.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-pressed={palette === item.id}
              aria-label={`${item.name} 테마`}
              onClick={() => setPalette(item.id)}
              className={cn('relative min-w-0 rounded-xl border p-3 text-left transition-colors', palette === item.id ? 'border-accent bg-accent-soft' : 'border-line bg-surface hover:border-line-strong')}
            >
              <span aria-hidden="true" className="mb-3 flex h-7 overflow-hidden rounded-lg">
                {item.colors.map((color) => <span key={color} className="flex-1" style={{ background: color }} />)}
              </span>
              <span className="flex items-center justify-between gap-1 text-[13px] font-semibold">
                {item.name}{palette === item.id && <Check size={15} className="text-accent" />}
              </span>
              <span className="mt-1 block text-[11px] leading-relaxed text-fg-2">{item.description}</span>
            </button>
          ))}
        </div>
      </Field>
      <Field label="화면 밝기">
        <div role="group" aria-label="화면 밝기" className="flex gap-1 rounded-xl bg-surface-2 p-1">
          {([
            ['system', '시스템', Monitor], ['light', '라이트', Sun], ['dark', '다크', Moon],
          ] as const).map(([value, label, Icon]) => (
            <button key={value} type="button" aria-pressed={theme === value} onClick={() => actions().setTheme(value)}
              className={cn('flex min-h-10 flex-1 items-center justify-center gap-1.5 rounded-lg text-[13px]', theme === value ? 'bg-surface font-medium text-fg shadow-sm' : 'text-fg-2 hover:text-fg')}>
              <Icon size={15} />{label}
            </button>
          ))}
        </div>
      </Field>
    </Section>
  );
}
