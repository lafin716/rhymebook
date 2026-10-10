import type { ReactNode } from 'react';
import { cn } from '../lib/cn';

/** 설정 화면 공용 컨트롤 */
export function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="text-[13px] font-semibold text-fg-2">{title}</h3>
      {hint && <p className="mt-0.5 mb-2 text-[12.5px] text-muted">{hint}</p>}
      <div className={cn('space-y-2', !hint && 'mt-2')}>{children}</div>
    </section>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange(v: boolean): void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn('relative h-6 w-10 shrink-0 rounded-full transition-colors', checked ? 'bg-accent' : 'bg-line-strong')}
    >
      <span className={cn('absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform', checked && 'translate-x-4')} />
    </button>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div>
      <div className="text-[13.5px] font-medium">{label}</div>
      {hint && <p className="mt-0.5 text-[12.5px] text-muted">{hint}</p>}
      <div className="mt-2">{children}</div>
    </div>
  );
}

export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: [T, string][]; onChange(v: T): void }) {
  return (
    <div role="radiogroup" className="inline-flex rounded-lg bg-surface-2 p-0.5">
      {options.map(([v, label]) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={value === v}
          onClick={() => onChange(v)}
          className={cn('h-8 rounded-md px-3 text-[13px]', value === v ? 'bg-surface font-medium shadow-pop' : 'text-muted hover:text-fg')}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
