import type { Schedule, ScheduleRepeat } from '@branch/core';
import { ArrowLeft, CalendarClock, ExternalLink, Pause, Play, Plus, Save, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { actions, appStore, useApp } from '../app/store';
import { Badge } from '../components/Badge';
import { Button, IconButton } from '../components/Button';
import { confirm } from '../components/ConfirmDialog';
import { cn } from '../lib/cn';
import { localScheduleDate, scheduleDate, scheduleText as tx } from './scheduleText';
import { scheduleAvailable, useSchedules } from './store';

const repeats: ScheduleRepeat[] = ['once', 'daily', 'weekdays', 'weekly', 'monthly'];
const repeatLabel = (repeat: ScheduleRepeat) => ({
  once: tx('한 번', 'Once'), daily: tx('매일', 'Daily'), weekdays: tx('평일', 'Weekdays'),
  weekly: tx('매주', 'Weekly'), monthly: tx('매월', 'Monthly'),
})[repeat];
const fieldClass = 'min-w-0 w-full rounded-xl border border-line bg-surface px-3 py-2.5 text-[14px] text-fg outline-none focus:border-accent';
interface Draft { title: string; prompt: string; sessionId: string; runAt: string; repeat: ScheduleRepeat }

export function SchedulesPage() {
  const open = useApp((state) => state.overlay === 'schedules');
  return open ? <SchedulesPageBody /> : null;
}

function SchedulesPageBody() {
  const sessions = useApp((state) => state.sessions);
  const { items, loaded, error, refresh, save, remove, toggle } = useSchedules();
  const chats = Object.values(sessions).filter((session) => !session.kind);
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [baseline, setBaseline] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const operation = useRef(false);
  const dirty = draft !== null && JSON.stringify(draft) !== baseline;

  useEffect(() => {
    if (scheduleAvailable) void refresh().catch(() => undefined);
  }, [refresh]);

  const leave = async () => !dirty || confirm({
    title: tx('저장하지 않은 변경사항', 'Unsaved changes'),
    message: tx('변경사항을 버리고 이동할까요?', 'Discard your changes and leave?'),
    confirmLabel: tx('버리기', 'Discard'), tone: 'danger',
  });
  const close = async () => {
    if (!operation.current && await leave()) actions().setOverlay('none');
  };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || document.querySelector('[role="alertdialog"]')) return;
      event.preventDefault();
      if (selected) void cancelEditor();
      else void close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const cancelEditor = async () => {
    if (operation.current || !await leave()) return;
    setSelected(null); setDraft(null); setFailure(null);
  };
  const pick = async (item?: Schedule) => {
    if (operation.current || !await leave()) return;
    const next: Draft = item ? {
      title: item.title, prompt: item.prompt, sessionId: item.sessionId,
      runAt: localScheduleDate(item.nextRunAt), repeat: item.repeat,
    } : {
      title: '', prompt: '', sessionId: chats[0]?.id ?? '',
      runAt: localScheduleDate(Date.now() + 60 * 60 * 1000), repeat: 'once',
    };
    setSelected(item?.id ?? 'new'); setDraft(next); setBaseline(JSON.stringify(next)); setFailure(null);
  };
  const perform = async (work: () => Promise<void>): Promise<boolean> => {
    if (operation.current) return false;
    operation.current = true; setBusy(true); setFailure(null);
    try { await work(); return true; }
    catch (cause) { setFailure(cause instanceof Error ? cause.message : tx('예약을 저장하지 못했습니다. 다시 시도해 주세요.', 'The schedule could not be updated. Please try again.')); return false; }
    finally { operation.current = false; setBusy(false); }
  };
  const submit = async () => {
    if (!draft || !selected) return;
    const previous = items.find((item) => item.id === selected);
    const at = previous && draft.runAt === localScheduleDate(previous.nextRunAt) ? previous.nextRunAt : new Date(draft.runAt).getTime();
    if (!Number.isFinite(at)) { setFailure(tx('실행 시간을 확인해 주세요.', 'Check the run time.')); return; }
    const ok = await perform(() => save({ title: draft.title, prompt: draft.prompt, runAt: new Date(at).toISOString(), repeat: draft.repeat }, draft.sessionId, selected === 'new' ? undefined : selected));
    if (ok) { setSelected(null); setDraft(null); }
  };
  const deleteItem = async (item: Schedule) => {
    if (operation.current) return;
    if (!await confirm({ title: tx('예약 삭제', 'Delete schedule'), message: tx(`“${item.title}” 예약을 삭제할까요?`, `Delete “${item.title}”?`), confirmLabel: tx('삭제', 'Delete'), tone: 'danger' })) return;
    const ok = await perform(() => remove(item.id));
    if (ok && selected === item.id) { setSelected(null); setDraft(null); }
  };
  const openSession = async (id: string) => {
    if (operation.current || !await leave()) return;
    if (!appStore.getState().sessions[id]) { setFailure(tx('대화가 삭제되었습니다.', 'This conversation was deleted.')); return; }
    actions().openSession(id); actions().setOverlay('none');
  };
  const patch = (value: Partial<Draft>) => setDraft((current) => current && ({ ...current, ...value }));

  return (
    <div role="dialog" aria-modal="true" aria-label={tx('예약', 'Schedules')} className="animate-fade-in fixed inset-0 z-[60] flex flex-col bg-bg pt-[env(safe-area-inset-top)]">
      <header className="flex h-13 shrink-0 items-center gap-2 border-b border-line bg-surface px-2 md:px-4">
        <IconButton label={tx('뒤로', 'Back')} disabled={busy} onClick={() => selected ? void cancelEditor() : void close()}><ArrowLeft size={19} /></IconButton>
        <CalendarClock size={18} className="text-accent" />
        <h2 className="flex-1 text-[16px] font-semibold">{tx('예약', 'Schedules')}</h2>
        {scheduleAvailable && <Button size="sm" variant="primary" icon={<Plus size={15} />} disabled={busy || !loaded} onClick={() => void pick()}>{tx('새 예약', 'New schedule')}</Button>}
      </header>
      {!scheduleAvailable ? (
        <div className="mx-auto w-full max-w-xl px-5 py-12">
          <CalendarClock size={32} className="mb-4 text-accent" />
          <h3 className="text-lg font-semibold">{tx('PC의 메인 창에서 예약을 관리하세요', 'Manage schedules in the main PC window')}</h3>
          <p className="mt-3 text-sm leading-relaxed text-muted">{tx('예약은 기기에만 저장됩니다. 연결된 PC의 OctoBooks 메인 창에서 예약을 만들거나 변경하세요. 이 창에서는 원격으로 예약을 관리할 수 없습니다.', 'Schedules are stored only on the device. Create or change them in the main OctoBooks window on your PC. Remote schedule management is unavailable in this window.')}</p>
        </div>
      ) : <>
        <div role="note" className="shrink-0 border-b border-line bg-surface px-4 py-3 text-[12px] leading-relaxed text-muted md:px-6">
          <p>{tx('앱이 실행 중일 때만 예약을 실행합니다. 앱 종료·절전 중 놓친 예약은 다음 시작 시 한 번 실행합니다.', 'Schedules run while the app is running. Missed runs during shutdown or sleep run once when the app resumes.')}</p>
          <p>{tx('이 기기에만 저장되며 원격으로 제어할 수 없습니다. 실행 시간은 기기의 현재 시간대를 따릅니다.', 'Stored on this device only, without remote control. Run times follow the device’s current time zone.')} <span className="font-medium">{Intl.DateTimeFormat().resolvedOptions().timeZone}</span></p>
        </div>
        {(failure || error) && <div role="alert" className="shrink-0 border-b border-line bg-danger-soft px-4 py-3 text-[13px] text-danger">{failure || error}</div>}
        <div className="flex min-h-0 flex-1">
          <section aria-label={tx('예약 목록', 'Schedule list')} className={cn('scroll-thin min-h-0 min-w-0 overflow-y-auto px-4 py-5 md:px-6', selected ? 'hidden md:block md:w-[42%] md:max-w-xl md:shrink-0 md:border-r md:border-line' : 'mx-auto w-full max-w-3xl')}>
            {!loaded ? <p role="status" className="py-10 text-center text-sm text-muted">{tx('예약을 불러오는 중…', 'Loading schedules…')}</p> : error && items.length === 0 ? <Button onClick={() => void perform(refresh)} disabled={busy}>{tx('다시 불러오기', 'Retry')}</Button> : items.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-line px-6 py-12 text-center">
                <CalendarClock size={32} className="mx-auto mb-3 text-muted" />
                <h3 className="font-semibold">{tx('아직 예약이 없습니다', 'No schedules yet')}</h3>
                <p className="mt-2 text-[13px] leading-relaxed text-muted">{tx('정해진 시간에 대화에 보낼 질문을 예약하세요.', 'Schedule a question to send to a conversation at a chosen time.')}</p>
                <Button className="mt-5" variant="soft" onClick={() => void pick()}>{tx('첫 예약 만들기', 'Create your first schedule')}</Button>
              </div>
            ) : <div className="space-y-3">{items.map((item) => {
              const finished = item.repeat === 'once' && !item.enabled && !!item.lastRunAt;
              const completed = finished && !item.lastError;
              return <article key={item.id} data-schedule-id={item.id} className={cn('rounded-2xl border bg-surface p-4', selected === item.id ? 'border-accent' : 'border-line')}>
                <div className="flex items-start justify-between gap-2"><h3 className="min-w-0 break-words text-[15px] font-semibold">{item.title}</h3><Badge tone={item.lastError ? 'danger' : item.enabled ? 'accent' : 'neutral'}>{item.lastError ? tx('실행 오류', 'Run error') : item.enabled ? tx('예약됨', 'Scheduled') : completed ? tx('완료', 'Completed') : tx('일시정지', 'Paused')}</Badge></div>
                <p className="mt-2 text-[13px] font-medium text-fg-2">{repeatLabel(item.repeat)} · {scheduleDate(item.nextRunAt)}</p>
                <p className="mt-1 truncate text-xs text-muted">{sessions[item.sessionId]?.title ?? tx('삭제된 대화', 'Deleted conversation')}</p>
                <p className="mt-3 line-clamp-3 break-words whitespace-pre-wrap text-[13px] leading-relaxed text-fg-2">{item.prompt}</p>
                {item.lastRunAt && <p className="mt-2 text-xs text-muted">{tx('최근 실행', 'Last run')}: {scheduleDate(item.lastRunAt)}</p>}
                {item.lastError && <p className="mt-2 break-words text-xs text-danger">{item.lastError}</p>}
                <div className="mt-3 flex flex-wrap items-center gap-1">
                  <Button size="sm" variant="ghost" disabled={busy} onClick={() => void pick(item)}>{tx('수정', 'Edit')}</Button>
                  {!finished && <IconButton size="sm" label={item.enabled ? tx('일시정지', 'Pause') : tx('다시 시작', 'Resume')} disabled={busy || selected === item.id} onClick={() => void perform(() => toggle(item.id))}>{item.enabled ? <Pause size={15} /> : <Play size={15} />}</IconButton>}
                  <IconButton size="sm" label={tx('대화 열기', 'Open conversation')} disabled={busy || !sessions[item.sessionId]} onClick={() => void openSession(item.sessionId)}><ExternalLink size={15} /></IconButton>
                  <span className="flex-1" /><IconButton size="sm" label={tx('예약 삭제', 'Delete schedule')} disabled={busy} onClick={() => void deleteItem(item)}><Trash2 size={15} /></IconButton>
                </div>
              </article>;
            })}</div>}
          </section>
          {draft && <section aria-label={tx('예약 편집', 'Schedule editor')} className="scroll-thin min-h-0 min-w-0 flex-1 overflow-y-auto">
            <form className="safe-bottom mx-auto flex max-w-2xl flex-col gap-4 px-4 py-5 md:px-6" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
              <h3 className="text-[16px] font-semibold">{selected === 'new' ? tx('새 예약', 'New schedule') : tx('예약 수정', 'Edit schedule')}</h3>
              <fieldset disabled={busy} className="flex min-w-0 flex-col gap-4 disabled:opacity-60">
                <label className="flex flex-col gap-1.5 text-[13px] font-medium">{tx('이름', 'Title')}<input autoFocus required maxLength={120} value={draft.title} onChange={(event) => patch({ title: event.target.value })} className={fieldClass} /></label>
                <label className="flex flex-col gap-1.5 text-[13px] font-medium">{tx('실행할 질문', 'Question to send')}<textarea required maxLength={20000} rows={5} value={draft.prompt} onChange={(event) => patch({ prompt: event.target.value })} className={cn(fieldClass, 'min-h-32 resize-y leading-relaxed')} /></label>
                <label className="flex flex-col gap-1.5 text-[13px] font-medium">{tx('대화', 'Conversation')}<select aria-label={tx('대화', 'Conversation')} required value={draft.sessionId} onChange={(event) => patch({ sessionId: event.target.value })} className={fieldClass}><option value="">{tx('대화 선택', 'Choose a conversation')}</option>{chats.map((session) => <option key={session.id} value={session.id}>{session.title}</option>)}</select></label>
                {!chats.length && <p className="text-xs text-warn">{tx('먼저 대화를 만든 뒤 예약을 추가하세요.', 'Create a conversation before adding a schedule.')}</p>}
                <label className="flex min-w-0 flex-col gap-1.5 text-[13px] font-medium">{tx('다음 실행 시간', 'Next run time')}<input type="datetime-local" required value={draft.runAt} onChange={(event) => patch({ runAt: event.target.value })} className={fieldClass} /></label>
                <label className="flex flex-col gap-1.5 text-[13px] font-medium">{tx('반복', 'Repeat')}<select aria-label={tx('반복', 'Repeat')} value={draft.repeat} onChange={(event) => patch({ repeat: event.target.value as ScheduleRepeat })} className={fieldClass}>{repeats.map((repeat) => <option key={repeat} value={repeat}>{repeatLabel(repeat)}</option>)}</select></label>
                {draft.repeat === 'monthly' && <p className="text-xs leading-relaxed text-muted">{tx('해당 날짜가 없는 달에는 마지막 날에 실행합니다.', 'In months without that day, runs on the last day.')}</p>}
              </fieldset>
              <div className="flex justify-end gap-2 pb-4"><Button variant="ghost" disabled={busy} onClick={() => void cancelEditor()}>{tx('취소', 'Cancel')}</Button><Button type="submit" variant="primary" icon={<Save size={15} />} disabled={busy || !chats.length || (selected !== 'new' && !dirty)}>{busy ? tx('저장 중…', 'Saving…') : tx('저장', 'Save')}</Button></div>
            </form>
          </section>}
        </div>
      </>}
    </div>
  );
}
