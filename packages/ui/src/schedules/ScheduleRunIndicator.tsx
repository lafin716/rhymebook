import { CalendarCheck, CalendarClock, CalendarX, Loader2, X } from 'lucide-react';
import { scheduleText as tx } from './scheduleText';
import { useSchedules } from './store';

/**
 * Floating pill for scheduled runs (ADR-110).
 * Finished runs queue up in finish order; a click opens the earliest one and drops it.
 * With nothing finished it shows the running task and opens that conversation.
 */
export function ScheduleRunIndicator() {
  const running = useSchedules((state) => state.running);
  const finished = useSchedules((state) => state.finished);
  const openNext = useSchedules((state) => state.openNextFinished);
  const runningList = Object.entries(running);
  if (!runningList.length && !finished.length) return null;
  const done = finished[0];
  const firstRunning = runningList[0]?.[1];
  const title = done?.title ?? firstRunning?.title ?? '';
  const more = done ? finished.length - 1 : runningList.length - 1;
  const label = done
    ? done.error ? tx('예약 작업 실패', 'Scheduled task failed') : tx('예약 응답 완료', 'Scheduled reply ready')
    : tx('예약 실행 중', 'Running schedule');
  const Icon = done ? (done.error ? CalendarX : CalendarCheck) : CalendarClock;
  const dismiss = () => useSchedules.setState({ finished: [] });
  return (
    <div className="pointer-events-none fixed inset-x-0 top-[calc(env(safe-area-inset-top)+3.75rem)] z-[70] flex justify-center px-4">
      <div className="animate-pop-in pointer-events-auto flex max-w-sm items-center rounded-full border border-accent/40 bg-surface text-[13px] text-fg shadow-float">
        <button
          type="button"
          data-schedule-running={done ? undefined : runningList[0]?.[0]}
          data-schedule-finished={done?.id}
          data-schedule-finished-count={finished.length || undefined}
          onClick={openNext}
          aria-label={done
            ? tx(`${label}: ${title}. 대화 열기${more > 0 ? `, 남은 완료 ${more}개` : ''}`, `${label}: ${title}. Open conversation${more > 0 ? `, ${more} more` : ''}`)
            : tx(`예약 작업 실행 중: ${title}. 대화 열기`, `Scheduled task running: ${title}. Open conversation`)}
          className={`flex min-w-0 items-center gap-2 rounded-full py-1.5 pl-3.5 hover:bg-surface-2 ${done ? 'pr-2' : 'pr-3.5'}`}
        >
          <span className={`relative flex shrink-0 items-center ${done?.error ? 'text-danger' : 'text-accent'}`}>
            <Icon size={15} />
            {!done && <Loader2 size={10} className="absolute -right-1 -bottom-1 animate-spin" />}
          </span>
          <span className="shrink-0 font-medium">{label}</span>
          <span className="min-w-0 truncate text-fg-2">· {title}</span>
          {more > 0 && <span className="shrink-0 text-muted">+{more}</span>}
          {done && runningList.length > 0 && (
            <span className="flex shrink-0 items-center gap-1 text-muted">
              <Loader2 size={11} className="animate-spin" />
              {tx(`실행 중 ${runningList.length}`, `${runningList.length} running`)}
            </span>
          )}
        </button>
        {done && (
          <button
            type="button"
            onClick={dismiss}
            aria-label={tx('완료 알림 모두 닫기', 'Dismiss all finished')}
            className="mr-1 flex size-7 shrink-0 items-center justify-center rounded-full text-muted hover:bg-surface-2 hover:text-fg"
          >
            <X size={14} />
          </button>
        )}
      </div>
    </div>
  );
}
