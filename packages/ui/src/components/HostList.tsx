import { t } from '../i18n';
import { remoteRoute, type RemotePairing } from '@branch/core';
import { Check, Laptop, Monitor, Plus, Smartphone, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { kind, remoteMode } from '../app/capabilities';
import { sessionWindowId } from '../app/runtime';
import { addHost, chooseThisDevice, choosePcProfile, forgetHost, openHost, pairingSurvivesRestart, useRemoteHosts, useSync } from '../app/sync';
import { PairForm } from '../settings/connectionCards';
import { StatusDot } from './Badge';
import { confirm } from './ConfirmDialog';
import { PC_STATUS_LABEL, PC_STATUS_TONE } from './PcStatus';

/** 프로필 목록에서 이 기기를 부르는 이름 (렌더 시점에 번역한다) */
export const thisDeviceName = () => (kind === 'desktop' ? t('components.host.thisPc') : t('components.host.thisDevice'));
/** 제목·줄 맨 앞에 쓸 때 (영어 'this PC' → 'This PC') */
export const thisDeviceTitle = () => { const s = thisDeviceName(); return s.charAt(0).toUpperCase() + s.slice(1); };

/**
 * 프로필 목록 (ADR-063·103): [이 기기] · 저장한 PC들 · [PC 추가].
 * PC 프로필에서는 줄을 누르면 그 PC로 바로 전환하고(끊긴 지금 PC는 다시 잇는다),
 * 이 기기 프로필에서 PC를 고르면 그 PC 프로필로 다시 시작한다. [PC 추가]는 이 자리에서 페어링 폼을 연다.
 */
export function HostList({ addable = true, device = true, initialLink = '' }: { addable?: boolean; device?: boolean; initialLink?: string }) {
  const hosts = useRemoteHosts((s) => s.hosts);
  const activeId = useRemoteHosts((s) => s.activeId);
  const [adding, setAdding] = useState(!!initialLink);

  const onPaired = async (p: RemotePairing | null) => {
    if (p) await addHost(p);
    setAdding(false);
  };
  // 웹은 다시 시작하면 페어링이 사라지므로 PC 프로필로 먼저 바꾼 뒤 그 화면에서 페어링한다
  const add = () => (!remoteMode && !pairingSurvivesRestart ? choosePcProfile() : setAdding(true));

  return (
    <div className="w-full max-w-sm space-y-3 text-left" data-testid="host-list">
      {device && !sessionWindowId && <DeviceRow />}
      {hosts.length > 0 && (
        <div>
          <p className="mb-1.5 px-1 text-[12px] font-medium text-muted">{t('components.host.myPcs')}</p>
          <ul className="space-y-1.5">
            {hosts.map((h) => (
              <HostRow key={h.bridgeId} host={h} active={remoteMode && h.bridgeId === activeId} />
            ))}
          </ul>
        </div>
      )}
      {addable &&
        (adding ? (
          <div className="mt-2 rounded-xl border border-line bg-surface p-3 text-[12.5px] text-fg-2">
            <PairForm initialLink={initialLink} onPaired={onPaired} onCancel={() => setAdding(false)} />
          </div>
        ) : (
          <button
            type="button"
            onClick={add}
            className="flex h-11 w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-line-strong text-[14px] text-fg-2 hover:bg-surface-2"
          >
            <Plus size={15} />
            {t('components.host.addPc')}
          </button>
        ))}
    </div>
  );
}

/** 이 기기 프로필: 학습은 이 기기에 두고 답변은 이 기기의 연결(API 키 등)로 받는다 */
function DeviceRow() {
  const active = !remoteMode;
  const Icon = kind === 'desktop' ? Monitor : Smartphone;
  const sub = active ? t('components.host.deviceActive') : kind === 'desktop' ? t('components.host.deviceDesktop') : t('components.host.deviceOther');
  return (
    <div>
      <p className="mb-1.5 px-1 text-[12px] font-medium text-muted">{thisDeviceTitle()}</p>
      <button
        type="button"
        onClick={chooseThisDevice}
        disabled={active}
        data-active={active || undefined}
        aria-label={t('components.host.useHere', { device: thisDeviceName() })}
        className={`flex min-h-14 w-full items-center gap-3 rounded-xl border bg-surface px-3 py-2 text-left ${active ? 'border-accent/60' : 'border-line hover:border-line-strong'}`}
      >
        <span className={`grid size-9 shrink-0 place-items-center rounded-lg ${active ? 'bg-accent-soft text-accent' : 'bg-surface-2 text-fg-2'}`}>
          <Icon size={18} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[14px] font-medium">{t('components.host.useHere', { device: thisDeviceName() })}</span>
          <span className="block truncate text-[12px] text-muted">{sub}</span>
        </span>
        {active && <Check size={16} className="shrink-0 text-accent" aria-hidden />}
      </button>
    </div>
  );
}

function HostRow({ host, active }: { host: RemotePairing; active: boolean }) {
  const status = useSync((s) => s.status);
  const hostName = useSync((s) => s.hostName);
  const name = active && status === 'online' && hostName ? hostName : host.bridgeName;
  const sub = active ? (status === 'online' ? `${PC_STATUS_LABEL.online} · ${remoteRoute(host.url)}` : PC_STATUS_LABEL[status]) : remoteRoute(host.url);

  const forget = async () => {
    const ok = await confirm({
      title: t('components.host.forgetTitle', { name: host.bridgeName }),
      message: t('components.host.forgetMessage'),
      confirmLabel: t('components.host.forgetConfirm'),
      tone: 'danger',
    });
    if (ok) await forgetHost(host.bridgeId);
  };

  return (
    <li
      className={`flex items-center rounded-xl border bg-surface ${active ? 'border-accent/60' : 'border-line hover:border-line-strong'}`}
      data-active={active || undefined}
    >
      <button
        type="button"
        onClick={() => void openHost(host.bridgeId)}
        disabled={active && (status === 'online' || status === 'connecting')}
        aria-label={t('components.host.ariaRow', { name, sub: active ? sub : t('components.host.connect') })}
        className="flex min-h-14 min-w-0 flex-1 items-center gap-3 px-3 py-2 text-left"
      >
        <span className={`grid size-9 shrink-0 place-items-center rounded-lg ${active ? 'bg-accent-soft text-accent' : 'bg-surface-2 text-fg-2'}`}>
          <Laptop size={18} className={active && status === 'connecting' ? 'animate-pulse' : undefined} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[14px] font-medium">{name}</span>
          <span className="flex items-center gap-1.5 text-[12px] text-muted">
            {active && <StatusDot tone={PC_STATUS_TONE[status]} className={status === 'connecting' ? 'animate-pulse' : undefined} />}
            <span className="truncate">{sub}</span>
          </span>
        </span>
        {active && status === 'online' && <Check size={16} className="shrink-0 text-accent" aria-hidden />}
      </button>
      <button
        type="button"
        onClick={() => void forget()}
        aria-label={t('components.host.ariaForget', { name: host.bridgeName })}
        className="mr-1 grid size-10 shrink-0 place-items-center rounded-lg text-muted hover:bg-surface-2 hover:text-danger"
      >
        <Trash2 size={15} />
      </button>
    </li>
  );
}
