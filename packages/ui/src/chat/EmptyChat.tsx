import type { ID } from '@branch/core';
import { GitBranch, Sparkles } from 'lucide-react';
import { actions } from '../app/store';

const SUGGESTIONS = ['트랜스포머의 어텐션이 뭔지 설명해줘', '역전파가 어떻게 동작하는지 알려줘', '멀티헤드 어텐션은 왜 필요해?'];

/** 메시지가 없는 세션의 첫 화면 */
export function EmptyChat({ sessionId, compact }: { sessionId: ID; compact?: boolean }) {
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
            onClick={() => actions().sendMessage(sessionId, q)}
            className="flex items-center gap-2 rounded-xl border border-line bg-surface px-3.5 py-2.5 text-left text-[14px] text-fg-2 hover:border-line-strong hover:text-fg"
          >
            <Sparkles size={14} className="shrink-0 text-accent" />
            {q}
          </button>
        ))}
      </div>
    </div>
  );
}

/** 세션이 하나도 없을 때 */
export function NoSessions() {
  return (
    <div className="flex h-full flex-col items-center justify-center px-6 text-center">
      <div className="mb-4 flex size-14 items-center justify-center rounded-2xl bg-accent-soft text-accent">
        <GitBranch size={28} />
      </div>
      <h2 className="text-[19px] font-semibold">아직 학습 기록이 없어요</h2>
      <p className="mt-1.5 max-w-xs text-[14px] leading-relaxed text-muted">
        질문이 생긴 자리에서 가지를 치며 배우는 채팅입니다. 첫 학습을 시작해 보세요.
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
