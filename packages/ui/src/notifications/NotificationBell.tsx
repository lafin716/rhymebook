import { Bell, CalendarCheck, CalendarClock, CalendarX, Loader2, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useApp } from '../app/store';
import { cn } from '../lib/cn';
import { relativeTime } from '../lib/time';
import { scheduleText as tx } from '../schedules/scheduleText';
import { useSchedules } from '../schedules/store';

/**
 * Top bar notification bell. Holds scheduled-run notices: running tasks and
 * finished runs not yet opened. Opening a finished run drops it from the list.
 */
export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const sessions = useApp((s) => s.sessions);
  const runningMap = useSchedules((s) => s.running);
  const finishedAll = useSchedules((s) => s.finished);
  const running = Object.entries(runningMap).filter(([, r]) => sessions[r.sessionId]);
  // Newest first in the panel; runs whose conversation was deleted are hidden.
  const finished = finishedAll.filter((f) => sessions[f.sessionId]).reverse();
  const count = finished.length;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (!ref.current?.contains(target) && !panelRef.current?.contains(target)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  const label = count
    ? tx(`알림 ${count}개`, `${count} notification${count > 1 ? 's' : ''}`)
    : tx('알림', 'Notifications');
  const row = 'flex w-full min-w-0 items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] hover:bg-surface-2';

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        data-notification-bell
        aria-label={label}
        title={label}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'relative inline-flex size-10 shrink-0 items-center justify-center rounded-lg transition-colors select-none',
          open ? 'bg-accent-soft text-accent' : 'text-fg-2 hover:bg-surface-2 hover:text-fg',
        )}
      >
        <Bell size={18} />
        {count > 0 ? (
          <span
            data-notification-count={count}
            className="absolute top-1.5 right-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] leading-none font-semibold text-accent-fg tabular-nums"
          >
            {count > 9 ? '9+' : count}
          </span>
        ) : running.length > 0 ? (
          <Loader2 size={10} className="absolute right-2 bottom-2 animate-spin text-accent" />
        ) : null}
      </button>

      {open && createPortal(
        <div
          ref={panelRef}
          role="dialog"
          aria-label={tx('알림', 'Notifications')}
          className="animate-pop-in fixed top-[calc(env(safe-area-inset-top)+3.5rem)] right-2 z-[90] flex max-h-[min(28rem,calc(100dvh-5rem))] w-[min(22rem,calc(100vw-1rem))] flex-col rounded-xl border border-line bg-elev shadow-float md:right-3"
        >
          <div className="flex items-center justify-between border-b border-line px-3.5 py-2.5">
            <span className="text-[14px] font-semibold">{tx('알림', 'Notifications')}</span>
            {count > 0 && (
              <button
                type="button"
                onClick={() => useSchedules.getState().dismissFinished()}
                className="rounded-md px-1.5 py-0.5 text-[12px] text-muted hover:bg-surface-2 hover:text-fg"
              >
                {tx('모두 지우기', 'Clear all')}
              </button>
            )}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
            {!running.length && !count && (
              <p className="px-3 py-8 text-center text-[13px] text-muted">{tx('새 알림이 없어요', 'No new notifications')}</p>
            )}
            {running.map(([id, r]) => (
              <button
                key={id}
                type="button"
                data-schedule-running={id}
                onClick={() => {
                  setOpen(false);
                  useSchedules.getState().openRunning(id);
                }}
                className={row}
              >
                <span className="relative flex shrink-0 text-accent">
                  <CalendarClock size={16} />
                  <Loader2 size={10} className="absolute -right-1 -bottom-1 animate-spin" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">{tx('예약 실행 중', 'Running schedule')}</span>
                  <span className="block truncate text-fg-2">{r.title}</span>
                </span>
              </button>
            ))}
            {finished.map((f) => {
              const Icon = f.error ? CalendarX : CalendarCheck;
              return (
                <div key={f.id} className="group relative">
                  <button
                    type="button"
                    data-schedule-finished={f.id}
                    onClick={() => {
                      setOpen(false);
                      useSchedules.getState().openFinished(f.id);
                    }}
                    className={cn(row, 'pr-9')}
                  >
                    <Icon size={16} className={cn('shrink-0', f.error ? 'text-danger' : 'text-accent')} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline gap-2">
                        <span className="font-medium">{f.error ? tx('예약 작업 실패', 'Scheduled task failed') : tx('예약 응답 완료', 'Scheduled reply ready')}</span>
                        <span className="ml-auto shrink-0 text-[11px] text-muted">{relativeTime(f.at)}</span>
                      </span>
                      <span className="block truncate text-fg-2">{f.title}</span>
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => useSchedules.getState().dismissFinished(f.id)}
                    aria-label={tx(`알림 지우기: ${f.title}`, `Dismiss: ${f.title}`)}
                    className="absolute top-1/2 right-1.5 flex size-7 -translate-y-1/2 items-center justify-center rounded-md text-muted hover:bg-surface hover:text-fg"
                  >
                    <X size={14} />
                  </button>
                </div>
              );
            })}
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
