import type { SyncStatus } from '@branch/core';
import { Laptop, Link2, LoaderCircle, RefreshCw, WifiOff } from 'lucide-react';
import { actions } from '../app/store';
import { useRuntime } from '../app/runtime';
import { syncClient, useSync } from '../app/sync';
import { StatusDot } from './Badge';
import { Button } from './Button';

export const PC_STATUS_LABEL: Record<SyncStatus, string> = {
  online: '연결됨',
  connecting: '연결 중',
  offline: '연결 끊김',
  unpaired: '페어링 필요',
  unsupported: 'PC 앱 업데이트 필요',
};

const TONE = { online: 'ok', connecting: 'warn', offline: 'danger', unpaired: 'neutral', unsupported: 'danger' } as const;

/** 원격 모드: 지금 PC와 연결되어 있는지 (데모 중에는 항상 사용 가능) */
export function usePcOnline(): boolean {
  const demo = useRuntime((s) => s.demo);
  const status = useSync((s) => s.status);
  return demo || !syncClient || status === 'online';
}

/** 상단 바의 PC 연결 상태 칩 (원격 모드 전용). 누르면 연결 설정. 연결 중에는 좁은 화면에서도 글자로 알린다 */
export function PcStatusChip({ compact }: { compact?: boolean }) {
  const demo = useRuntime((s) => s.demo);
  const status = useSync((s) => s.status);
  const hostName = useSync((s) => s.hostName);
  if (!syncClient || demo) return null;
  const connecting = status === 'connecting';
  const label = status === 'online' && hostName ? hostName : connecting && hostName ? `${hostName} 연결 중` : PC_STATUS_LABEL[status];
  return (
    <button
      type="button"
      onClick={() => actions().setOverlay('settings')}
      aria-label={`연결된 PC: ${hostName ?? '없음'} · ${PC_STATUS_LABEL[status]}`}
      title={`연결된 PC · ${PC_STATUS_LABEL[status]}`}
      className="flex h-8 max-w-[11rem] shrink-0 items-center gap-1.5 rounded-lg border border-line px-2 text-[13px] text-fg-2 hover:bg-surface-2"
    >
      {connecting ? (
        <LoaderCircle size={15} className="shrink-0 animate-spin text-warn" aria-hidden />
      ) : (
        <span className="relative">
          <Laptop size={15} />
          <StatusDot tone={TONE[status]} className="absolute -right-1 -bottom-0.5 size-1.5 ring-2 ring-surface" />
        </span>
      )}
      {(!compact || connecting) && <span className="truncate">{compact ? PC_STATUS_LABEL.connecting : label}</span>}
    </button>
  );
}

/** 입력창 위: PC와 연결되지 않아 질문을 보낼 수 없을 때의 안내 */
export function PcOfflineBanner() {
  const status = useSync((s) => s.status);
  const hostName = useSync((s) => s.hostName);
  const text =
    status === 'unpaired'
      ? 'PC와 페어링하면 PC에서 학습 중인 내용을 보고 질문할 수 있어요'
      : status === 'connecting'
        ? `${hostName ?? 'PC'}에 연결하는 중…`
        : status === 'unsupported'
          ? 'PC 앱을 최신 버전으로 업데이트해 주세요'
          : `${hostName ?? 'PC'}와 연결이 끊겼어요 — PC 앱이 켜져 있는지 확인하세요`;
  return (
    <div role="status" className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1.5 rounded-xl border border-warn/30 bg-warn-soft px-3 py-2 text-[13px] text-warn">
      <WifiOff size={15} className="shrink-0" />
      <span className="min-w-[14rem] flex-1">{text}</span>
      <span className="ml-auto flex gap-1.5">
        {status === 'offline' && (
          <Button size="sm" variant="secondary" icon={<RefreshCw size={14} />} onClick={() => syncClient?.reconnect()}>
            다시 연결
          </Button>
        )}
        {status !== 'connecting' && (
          <Button size="sm" variant="ghost" icon={<Link2 size={14} />} onClick={() => actions().setOverlay('settings')}>
            {status === 'unpaired' ? '페어링' : '연결 설정'}
          </Button>
        )}
      </span>
    </div>
  );
}
