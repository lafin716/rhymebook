import { parseSpeakBlock, SPEAK_LANG, type SpeakScript } from '@branch/core';
import type { Element } from 'hast';
import { AudioLines, Play, Square, Volume2 } from 'lucide-react';
import { useContext, type ComponentProps } from 'react';
import type { ExtraProps } from 'react-markdown';
import { Button } from '../components/Button';
import { cn } from '../lib/cn';
import { speak, speakAll, stopSpeaking, useSpeech } from '../voice/speak';
import { codeSource, QuizContext } from './QuizCard';

/** ```speak 코드 블록이면 그 본문 */
export const speakSource = (node: Element | undefined) => codeSource(node, SPEAK_LANG);

const LANG_LABEL = { vi: '베트남어', en: '영어', ko: '한국어' } as const;

/**
 * 코드 블록(pre) 자리에 읽기 카드를 그린다 (IMP-21). 줄마다 듣기, [모두 듣기]로 차례로 읽는다.
 * 퀴즈 카드처럼 원래 코드 블록은 숨긴 채 남겨 가지 앵커 위치 계산이 원문과 어긋나지 않게 한다.
 */
export function SpeakBlock({ node, source, children, ...props }: ComponentProps<'pre'> & ExtraProps & { source: string }) {
  const { messageId, streaming } = useContext(QuizContext);
  const script = streaming ? null : parseSpeakBlock(source);
  const hidden = (
    <pre {...props} hidden>
      {children}
    </pre>
  );
  if (!script && !streaming) return <pre {...props}>{children}</pre>;
  const key = `${messageId ?? 'local'}:${node?.position?.start.offset ?? 0}`;
  return (
    <div className="speak-block">
      <div
        data-anchor-ignore
        data-speak
        className="my-3 overflow-hidden rounded-2xl border border-accent/25 bg-surface shadow-[0_1px_2px_rgb(0_0_0/0.04),0_6px_20px_rgb(0_0_0/0.05)]"
      >
        {script ? (
          <SpeakList script={script} blockKey={key} />
        ) : (
          <div className="flex items-center gap-2 px-4 py-3.5 text-[14px] text-muted">
            <AudioLines size={16} className="text-accent" />
            읽을 글을 준비하는 중…
          </div>
        )}
      </div>
      {hidden}
    </div>
  );
}

function SpeakList({ script, blockKey }: { script: SpeakScript; blockKey: string }) {
  const status = useSpeech((s) => s.status);
  const current = useSpeech((s) => s.key);
  const rowKey = (i: number) => `${blockKey}#${i}`;
  const mine = status !== 'idle' && !!current?.startsWith(`${blockKey}#`);
  const lines = script.items.map((it, i) => ({ text: it.text, lang: it.lang, key: rowKey(i) }));
  return (
    <>
      <header className="flex items-center gap-2 border-b border-line bg-accent-soft/60 px-4 py-2.5">
        <AudioLines size={16} className="shrink-0 text-accent" />
        <span className="min-w-0 flex-1 truncate text-[14px] font-semibold text-fg">{script.title || '소리 내어 읽기'}</span>
        <Button
          size="sm"
          variant={mine ? 'secondary' : 'soft'}
          icon={mine ? <Square size={13} /> : <Play size={14} />}
          onClick={() => (mine ? stopSpeaking() : speakAll(lines))}
        >
          {mine ? '멈춤' : script.items.length > 1 ? '모두 듣기' : '듣기'}
        </Button>
      </header>
      <ol className="divide-y divide-line">
        {script.items.map((it, i) => {
          const active = status !== 'idle' && current === rowKey(i);
          return (
            <li key={i} data-speak-item className={cn('flex items-start gap-2.5 px-3 py-2.5 transition-colors', active && 'bg-accent-soft/50')}>
              <button
                type="button"
                aria-label={`${active ? '멈춤' : '듣기'}: ${it.text}`}
                title={active ? '멈춤' : '듣기'}
                onClick={() => (active ? stopSpeaking() : speak(it.text, { lang: it.lang, key: rowKey(i) }))}
                className={cn(
                  'mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-full transition-colors',
                  active ? 'bg-accent text-accent-fg' : 'bg-accent-soft text-accent hover:brightness-95',
                )}
              >
                {active ? <Square size={12} /> : <Volume2 size={15} />}
              </button>
              <div className="min-w-0 flex-1">
                <p className="text-[15px] leading-snug break-words text-fg">{it.text}</p>
                {it.note && <p className="mt-0.5 text-[13px] leading-snug break-words text-muted">{it.note}</p>}
              </div>
              <span className="mt-1 shrink-0 rounded-md bg-surface-2 px-1.5 py-0.5 text-[11px] text-muted">{LANG_LABEL[it.lang]}</span>
            </li>
          );
        })}
      </ol>
    </>
  );
}
