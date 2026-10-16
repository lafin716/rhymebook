import { useEffect } from 'react';
import { useStore } from 'zustand';
import { pushNotice, remoteNotices, syncClient } from '../app/sync';

/** 원격 조작이 거절·실패했을 때의 안내 (SyncActError 코드 → 한국어) */
const FAILURE_TEXT: Record<string, string> = {
  offline: 'PC와 연결되어 있지 않아 보내지 못했어요.',
  timeout: 'PC가 응답하지 않아 취소했어요. 연결을 확인해 주세요.',
  busy: '이 세션은 아직 답변 중이에요. 끝난 뒤 다시 시도하세요.',
  'rate-limit': '요청이 너무 잦아요. 잠시 후 다시 시도하세요.',
  forbidden: 'PC 설정에서 원격 삭제를 허용하지 않았어요.',
  'not-found': 'PC에 해당 세션이 없어요. 목록을 새로 받아 왔어요.',
  conflict: '다른 기기에서 먼저 바뀌었어요. 최신 내용으로 맞췄어요.',
  'not-ready': 'PC 앱이 아직 준비 중이에요. 잠시 후 다시 시도하세요.',
  outdated: 'PC 앱이 이 기능을 아직 몰라요. PC 앱(또는 octobooks serve)을 최신 버전으로 업데이트해 주세요.',
  invalid: '요청을 처리할 수 없어요.',
  failed: 'PC에서 처리하지 못했어요.',
};

/** 화면 하단 토스트. 원격 기기: 조작 실패 안내 · PC: 원격 조작 알림 */
export function Toasts() {
  const items = useStore(remoteNotices, (s) => s.items);

  useEffect(() => {
    if (!syncClient) return;
    return syncClient.state.subscribe((s, prev) => {
      const f = s.lastFailure;
      if (f && f !== prev.lastFailure) pushNotice(FAILURE_TEXT[f.code] ?? FAILURE_TEXT.failed!);
      if (s.resumeFailedAt && s.resumeFailedAt !== prev.resumeFailedAt) pushNotice(`${s.hostName ?? 'PC'}에 다시 연결하지 못했어요. PC 앱이 켜져 있는지 확인하고 [다시 연결]을 눌러 주세요.`);
    });
  }, []);

  if (!items.length) return null;
  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-[max(5.5rem,calc(env(safe-area-inset-bottom)+5.5rem))] z-[80] flex flex-col items-center gap-2 px-4"
    >
      {items.map((n) => (
        <div key={n.id} role="status" className="animate-pop-in max-w-sm rounded-xl bg-fg px-3.5 py-2 text-[13px] text-bg shadow-float">
          {n.text}
        </div>
      ))}
    </div>
  );
}
