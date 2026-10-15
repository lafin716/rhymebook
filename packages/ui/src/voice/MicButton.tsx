import { LoaderCircle, Mic, Square } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { sttClient } from '../app/runtime';
import { pushNotice } from '../app/sync';
import { cn } from '../lib/cn';
import { micErrorMessage, startRecording, type Recorder } from './recorder';
import { refreshStt, useSttStatus } from './sttStore';

type Phase = 'idle' | 'starting' | 'recording' | 'transcribing';

/**
 * 입력창 마이크 (ADR-045). PC에서 음성 입력을 켜고 모델이 준비됐을 때만 보인다.
 * 누르면 녹음, 다시 누르면 PC가 글자로 바꿔 입력창에 붙인다(보내기 전에 고칠 수 있다).
 */
export function MicButton({ onText, disabled }: { onText(text: string): void; disabled?: boolean }) {
  const status = useSttStatus();
  const [phase, setPhase] = useState<Phase>('idle');
  const [secs, setSecs] = useState(0);
  const rec = useRef<Recorder | null>(null);
  const abort = useRef<AbortController | null>(null);
  const finishRef = useRef<() => void>(() => {});

  // 녹음 시간 표시
  useEffect(() => {
    if (phase !== 'recording') return;
    const t = window.setInterval(() => setSecs(Math.floor(rec.current?.seconds() ?? 0)), 250);
    return () => window.clearInterval(t);
  }, [phase]);

  // 화면을 떠나면 녹음·전사를 멈춘다
  useEffect(
    () => () => {
      rec.current?.cancel();
      abort.current?.abort();
    },
    [],
  );

  const finish = async () => {
    const r = rec.current;
    if (!r) return;
    rec.current = null;
    setPhase('transcribing');
    try {
      const res = await r.stop();
      if ('skip' in res) {
        pushNotice(res.skip === 'short' ? '녹음이 너무 짧아요.' : '들린 소리가 없어요. 마이크를 확인하고 다시 말해 주세요.');
        return;
      }
      const { audio } = res;
      const ac = new AbortController();
      abort.current = ac;
      const text = await sttClient.client.transcribe(audio, ac.signal);
      if (ac.signal.aborted) return;
      if (text) onText(text);
      else pushNotice('알아들은 말이 없어요. 다시 말해 주세요.');
    } catch (e) {
      if (abort.current?.signal.aborted) return;
      pushNotice(e instanceof Error ? e.message : '음성 변환에 실패했습니다.');
      void refreshStt();
    } finally {
      abort.current = null;
      setPhase('idle');
    }
  };
  finishRef.current = () => void finish();

  const start = async () => {
    setPhase('starting');
    setSecs(0);
    try {
      rec.current = await startRecording(() => finishRef.current());
      setPhase('recording');
    } catch (e) {
      rec.current = null;
      setPhase('idle');
      pushNotice(micErrorMessage(e));
    }
  };

  if (!status?.ready && phase === 'idle') return null;

  const recording = phase === 'recording';
  const busy = phase === 'starting' || phase === 'transcribing';
  const label = recording ? '녹음 끝내고 글자로 바꾸기' : phase === 'transcribing' ? '글자로 바꾸는 중' : '음성으로 입력';
  return (
    <button
      type="button"
      aria-label={label}
      title={recording ? `녹음 중 ${secs}초 · 누르면 끝` : label}
      aria-pressed={recording}
      disabled={busy || (disabled && !recording)}
      onClick={() => (recording ? finishRef.current() : void start())}
      className={cn(
        'inline-flex h-9 shrink-0 items-center justify-center gap-1 rounded-xl transition-colors disabled:opacity-60',
        recording ? 'bg-danger px-2.5 text-white' : 'w-9 text-fg-2 hover:bg-surface-2 hover:text-fg',
      )}
    >
      {busy ? (
        <LoaderCircle size={18} className="animate-spin" aria-hidden />
      ) : recording ? (
        <>
          <Square size={12} fill="currentColor" aria-hidden />
          <span className="text-[12.5px] tabular-nums">{secs}초</span>
        </>
      ) : (
        <Mic size={19} aria-hidden />
      )}
    </button>
  );
}
