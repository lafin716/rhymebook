import { parseScheduleBlock } from '@branch/core';
import { CalendarClock, Sparkles } from 'lucide-react';
import { useContext } from 'react';
import { actions, useApp } from '../app/store';
import { QuizContext } from '../chat/QuizCard';
import { Button } from '../components/Button';
import { scheduleDate, scheduleText as tx } from './scheduleText';
import { scheduleRemote, useSchedules } from './store';

/** Rendering only displays the receipt. Saving is exclusively a successful-response side effect. */
export function ScheduleCard({ source }: { source: string }) {
  const { messageId, streaming } = useContext(QuizContext);
  const userId = useApp((state) => {
    if (!messageId) return undefined;
    for (const list of Object.values(state.messages)) {
      const pos = list.findIndex((m) => m.id === messageId);
      if (pos >= 0) return list.slice(0, pos).findLast((m) => m.role === 'user')?.id;
    }
    return undefined;
  });
  const saved = useSchedules((state) => userId ? state.items.find((item) => item.sourceMessageId === userId) : undefined);
  // 원격에서는 PC 시간대로 보인다 (PC에서는 기기 시간대)
  const zone = useSchedules((state) => (scheduleRemote() ? state.timeZone : null));
  const input = parseScheduleBlock(`\`\`\`schedule\n${source}\n\`\`\``, 0);
  if (streaming) return <p className="text-[13px] text-muted">{tx('예약 정보를 작성하고 있어요…', 'Preparing schedule…')}</p>;
  if (!input) return <p role="note" className="text-[13px] text-warn">{tx('예약 형식을 확인해 주세요. 예약 관리에서 직접 등록할 수 있어요.', 'Check the schedule details, or create it in Schedules.')}</p>;
  const repeat = { once: tx('한 번', 'Once'), daily: tx('매일', 'Daily'), weekdays: tx('평일', 'Weekdays'), weekly: tx('매주', 'Weekly'), monthly: tx('매월', 'Monthly') }[input.repeat];
  return (
    <section aria-label={tx('예약 정보', 'Schedule details')} className="not-prose my-3 space-y-2 rounded-xl border border-line bg-surface p-4">
      <div className="flex items-center gap-2 text-[14px] font-semibold"><CalendarClock size={17} className="text-accent" />{input.title}</div>
      <p className="text-[13px] text-fg-2">{scheduleDate(Date.parse(input.runAt), zone ?? undefined)} · {repeat}</p>
      <p className="whitespace-pre-wrap text-[13px] text-fg-2">{input.prompt}</p>
      {(saved?.skill || input.skill) && <p data-schedule-skill className="flex items-center gap-1 text-[12px] text-accent"><Sparkles size={13} />{saved?.skill?.title ?? `/${input.skill}`}</p>}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[12px] text-muted">{saved ? tx('등록된 예약', 'Saved schedule') : tx('예약 관리에서 등록 상태를 확인해 주세요.', 'Check the saved status in Schedules.')}</span>
        <Button size="sm" variant="ghost" onClick={() => actions().setOverlay('schedules')}>{tx('예약 관리', 'Schedules')}</Button>
      </div>
    </section>
  );
}
