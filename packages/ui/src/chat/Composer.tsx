import { effectiveProviderId, nextFallback, type ID } from '@branch/core';
import { ArrowUp, Settings2, Square, WifiOff } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { actions, useApp } from '../app/store';
import { Button } from '../components/Button';
import { PcOfflineBanner, usePcOnline } from '../components/PcStatus';
import { remoteMode } from '../app/capabilities';
import { cn } from '../lib/cn';
import { isUsable, providerLabel, STATUS_LABEL } from '../lib/connection';
import { ModelChips } from './ModelChips';

export function Composer({ sessionId, compact }: { sessionId: ID; compact?: boolean }) {
  const [text, setText] = useState('');
  const ref = useRef<HTMLTextAreaElement>(null);
  const streaming = useApp((s) => !!s.streaming[sessionId]);
  const isBranch = useApp((s) => !!s.sessions[sessionId]?.parentId);
  const eff = useApp((s) => effectiveProviderId(s, sessionId));
  const conn = useApp((s) => s.connections[eff]);
  const fallback = useApp((s) => (isUsable(s.connections[eff]) ? null : nextFallback(s, eff)));
  const pcOnline = usePcOnline();
  const usable = isUsable(conn);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  }, [text]);

  const send = () => {
    const t = text.trim();
    if (!t || streaming || (remoteMode && !pcOnline)) return;
    actions().sendMessage(sessionId, t);
    setText('');
  };

  return (
    <div className={cn('shrink-0 bg-bg', compact ? 'px-2.5 pt-1.5 pb-2.5' : 'safe-bottom px-3 pt-2 pb-3 md:px-6')}>
      <div className="mx-auto max-w-3xl">
        {/* 원격 모드: 응답 가능 여부는 PC 연결이 결정한다 (어떤 CLI를 쓸지는 PC가 정함) */}
        {remoteMode && !pcOnline && <PcOfflineBanner />}
        {!remoteMode && !usable && (
          <div role="status" className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1.5 rounded-xl border border-warn/30 bg-warn-soft px-3 py-2 text-[13px] text-warn">
            <WifiOff size={15} className="shrink-0" />
            <span className="min-w-[14rem] flex-1">
              <b className="font-semibold">{providerLabel(eff)}</b> {conn?.enabled === false ? '꺼짐' : STATUS_LABEL[conn?.status ?? 'offline']} — 지금은 응답을 받을 수 없어요
            </span>
            <span className="ml-auto flex gap-1.5">
              {fallback && (
                <Button size="sm" variant="secondary" onClick={() => actions().setSessionProvider(sessionId, fallback)}>
                  {providerLabel(fallback)}로 전환
                </Button>
              )}
              <Button size="sm" variant="ghost" icon={<Settings2 size={14} />} onClick={() => actions().setOverlay('settings')}>
                설정
              </Button>
            </span>
          </div>
        )}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
          className="flex items-end gap-2 rounded-2xl border border-line bg-surface p-1.5 pl-3.5 shadow-pop focus-within:border-line-strong"
        >
          <textarea
            ref={ref}
            rows={1}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && !('ontouchstart' in window)) {
                e.preventDefault();
                send();
              }
            }}
            placeholder={isBranch ? '이 가지에서 더 물어보기…' : '무엇이든 물어보세요…'}
            aria-label="메시지 입력"
            className="max-h-[180px] min-h-9 flex-1 resize-none bg-transparent py-1.5 text-[15px] leading-6 outline-none placeholder:text-muted"
          />
          {streaming ? (
            <button
              type="button"
              aria-label="응답 중지"
              onClick={() => actions().stopStream(sessionId)}
              className="inline-flex size-9 shrink-0 items-center justify-center rounded-xl bg-fg text-bg"
            >
              <Square size={14} fill="currentColor" />
            </button>
          ) : (
            <button
              type="submit"
              aria-label="보내기"
              disabled={!text.trim() || (remoteMode && !pcOnline)}
              className="inline-flex size-9 shrink-0 items-center justify-center rounded-xl bg-accent text-accent-fg transition-opacity disabled:opacity-35"
            >
              <ArrowUp size={18} />
            </button>
          )}
        </form>
        {!remoteMode && <ModelChips sessionId={sessionId} compact={compact} />}
      </div>
    </div>
  );
}
