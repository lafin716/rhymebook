import type { ID } from '@branch/core';
import { GitBranch, Laptop, Link2, RefreshCw, Sparkles } from 'lucide-react';
import { remoteMode } from '../app/capabilities';
import { actions } from '../app/store';
import { syncClient, useSync } from '../app/sync';
import { usePcOnline } from '../components/PcStatus';

const SUGGESTIONS = ['트랜스포머의 어텐션이 뭔지 설명해줘', '역전파가 어떻게 동작하는지 알려줘', '멀티헤드 어텐션은 왜 필요해?'];

/** 메시지가 없는 세션의 첫 화면 */
export function EmptyChat({ sessionId, compact }: { sessionId: ID; compact?: boolean }) {
  const online = usePcOnline();
  return (
    <div className="mx-auto flex max-w-md flex-col items-center px-2 py-10 text-center">
      <div className="mb-4 flex size-12 items-center justify-center rounded-2xl bg-accent-soft text-accent">
        <GitBranch size={24} />
      </div>
      <h2 className="text-[18px] font-semibold">무엇을 배워볼까요?</h2>
      <p className="mt-1.5 text-[14px] leading-relaxed text-muted">
        답변에서 모르는 단어를 <b className="font-medium text-fg-2">드래그</b>(모바일은 길게 누르기)하면
        <br className={compact ? 'hidden' : undefined} /> 그 자리에서 가지를 쳐서 물어볼 수 있어요.
      </p>
      <div className="mt-5 flex w-full flex-col gap-2">
        {SUGGESTIONS.map((q) => (
          <button
            key={q}
            type="button"
            disabled={!online}
            onClick={() => actions().sendMessage(sessionId, q)}
            className="flex disabled:opacity-50 disabled:hover:border-line disabled:hover:text-fg-2 items-center gap-2 rounded-xl border border-line bg-surface px-3.5 py-2.5 text-left text-[14px] text-fg-2 hover:border-line-strong hover:text-fg"
          >
            <Sparkles size={14} className="shrink-0 text-accent" />
            {q}
          </button>
        ))}
      </div>
    </div>
  );
}

/** 세션이 하나도 없을 때. 원격 모드는 PC와 연결된 뒤에만 시작할 수 있다 */
export function NoSessions() {
  const online = usePcOnline();
  if (remoteMode && !online) return <PcNotConnected />;
  return (
    <div className="flex h-full flex-col items-center justify-center px-6 text-center">
      <div className="mb-4 flex size-14 items-center justify-center rounded-2xl bg-accent-soft text-accent">
        <GitBranch size={28} />
      </div>
      <h2 className="text-[19px] font-semibold">{remoteMode ? 'PC에 아직 학습 기록이 없어요' : '아직 학습 기록이 없어요'}</h2>
      <p className="mt-1.5 max-w-xs text-[14px] leading-relaxed text-muted">
        {remoteMode
          ? '여기서 시작한 학습은 PC에 저장되고, 답변은 PC의 CLI가 만들어요.'
          : '질문이 생긴 자리에서 가지를 치며 배우는 채팅입니다. 첫 학습을 시작해 보세요.'}
      </p>
      <button
        type="button"
        onClick={() => actions().newRootSession()}
        className="mt-5 inline-flex h-11 items-center gap-2 rounded-xl bg-accent px-5 text-[15px] font-medium text-accent-fg"
      >
        새 학습 시작
      </button>
    </div>
  );
}

/** 원격 모드: PC와 연결되지 않아 학습을 볼 수 없을 때 */
function PcNotConnected() {
  const status = useSync((s) => s.status);
  const hostName = useSync((s) => s.hostName);
  const pc = hostName ?? 'PC';
  const copy = {
    unpaired: ['PC와 연결해 주세요', 'rhymebook PC 앱과 페어링하면 PC에서 학습 중인 내용을 여기서 보고 이어서 질문할 수 있어요.'],
    connecting: [`${pc}에 연결하는 중`, 'PC의 학습 목록을 불러오고 있어요.'],
    offline: [`${pc}와 연결이 끊겼어요`, 'PC 앱이 켜져 있고 원격 페어링이 열려 있는지 확인하세요.'],
    unsupported: ['PC 앱 업데이트가 필요해요', 'PC의 rhymebook 앱을 최신 버전으로 업데이트하면 원격 학습을 쓸 수 있어요.'],
    online: ['', ''],
  }[status];
  return (
    <div className="flex h-full flex-col items-center justify-center px-6 text-center">
      <div className="mb-4 flex size-14 items-center justify-center rounded-2xl bg-accent-soft text-accent">
        <Laptop size={28} className={status === 'connecting' ? 'animate-pulse' : undefined} />
      </div>
      <h2 className="text-[19px] font-semibold">{copy[0]}</h2>
      <p className="mt-1.5 max-w-xs text-[14px] leading-relaxed text-muted">{copy[1]}</p>
      <div className="mt-5 flex flex-wrap justify-center gap-2">
        {status === 'offline' && (
          <button
            type="button"
            onClick={() => syncClient?.reconnect()}
            className="inline-flex h-11 items-center gap-2 rounded-xl bg-accent px-5 text-[15px] font-medium text-accent-fg"
          >
            <RefreshCw size={16} />
            다시 연결
          </button>
        )}
        {status !== 'connecting' && (
          <button
            type="button"
            onClick={() => actions().setOverlay('settings')}
            className={
              status === 'offline'
                ? 'inline-flex h-11 items-center gap-2 rounded-xl border border-line px-5 text-[15px] font-medium text-fg-2 hover:bg-surface-2'
                : 'inline-flex h-11 items-center gap-2 rounded-xl bg-accent px-5 text-[15px] font-medium text-accent-fg'
            }
          >
            <Link2 size={16} />
            {status === 'unpaired' ? 'PC와 페어링' : '연결 설정'}
          </button>
        )}
      </div>
    </div>
  );
}
