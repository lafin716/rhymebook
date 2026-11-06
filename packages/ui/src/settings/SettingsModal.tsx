import { NotificationSettings } from '../notifications/NotificationSettings';
import { AppearanceSettings } from './AppearanceSettings';
import type { ProviderId } from '@branch/core';
import { ArrowDown, ArrowUp, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { caps, remoteMode } from '../app/capabilities';
import { desktop } from '../app/runtime';
import { actions, useApp } from '../app/store';
import { useUi } from '../app/uiState';
import { StatusDot } from '../components/Badge';
import { IconButton } from '../components/Button';
import { HostList } from '../components/HostList';
import { Modal } from '../components/Modal';
import { cn } from '../lib/cn';
import { t } from '../i18n';
import { LanguageField } from './LanguageField';
import { Field, Section, Segmented } from './controls';
import { BackupTab } from './BackupTab';
import { AutoSkillField } from './AutoSkillField';
import { ApiCard, BridgeCard, CliCard, PolicyNote } from './connectionCards';
import { HostCard } from './HostCard';
import { RemoteSettings } from './RemoteSettings';
import { SelectionTriggerField } from './SelectionTriggerField';
import { VoiceSettings } from './VoiceSettings';
import { UpdateSettings } from './UpdateSettings';
import { providerKind, providerLabel, STATUS_LABEL, statusTone } from '../lib/connection';

type Tab = 'connections' | 'backup' | 'voice' | 'appearance' | 'general';

const APP_VERSION = import.meta.env.VITE_APP_VERSION as string | undefined;

function SettingsTitle() {
  return (
    <h2 className="flex flex-1 items-baseline gap-2 text-[16px] font-semibold">
      {t('settings.title')}
      {APP_VERSION && <span className="text-[11.5px] font-normal text-muted">v{APP_VERSION}</span>}
    </h2>
  );
}

export function SettingsModal() {
  const open = useApp((s) => s.overlay === 'settings');
  const [tab, setTab] = useState<Tab>('connections');
  const pairLink = useUi((s) => s.pairLink);
  const close = () => actions().setOverlay('none');
  if (pairLink && tab !== 'connections') setTab('connections');
  if (remoteMode) {
    return (
      <Modal open={open} onClose={close} label={t('settings.title')} className="md:max-w-xl">
        <div className="flex h-13 shrink-0 items-center gap-2 border-b border-line px-4">
          <SettingsTitle />
          <IconButton label={t('settings.closeAria')} onClick={close}>
            <X size={18} />
          </IconButton>
        </div>
        <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-4 py-4 md:px-5">
          <RemoteSettings />
          <div className="mt-6"><NotificationSettings /></div>
        </div>
      </Modal>
    );
  }
  return (
    <Modal open={open} onClose={close} label={t('settings.title')} className="md:max-w-2xl">
      <div className="flex h-13 shrink-0 items-center gap-2 border-b border-line px-4">
        <SettingsTitle />
        <IconButton label={t('settings.closeAria')} onClick={close}>
          <X size={18} />
        </IconButton>
      </div>
      <div role="tablist" className="flex shrink-0 gap-1 border-b border-line px-3">
        {(
          [
            ['connections', t('settings.tabs.connections')],
            ['backup', t('settings.tabs.backup')],
            ['voice', t('settings.tabs.voice')],
            ['appearance', t('settings.tabs.appearance')],
            ['general', t('settings.tabs.general')],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={cn(
              '-mb-px border-b-2 px-3 py-2.5 text-[14px]',
              tab === key ? 'border-accent font-medium text-fg' : 'border-transparent text-muted hover:text-fg',
            )}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-4 py-4 md:px-5">
        {tab === 'connections' ? <ConnectionsTab /> : tab === 'backup' ? <BackupTab /> : tab === 'voice' ? <VoiceSettings /> : tab === 'appearance' ? <AppearanceSettings /> : <GeneralTab />}
      </div>
    </Modal>
  );
}

/* ── 연결 탭 ───────────────────────────────────────────── */

/**
 * PC 연결 구성 (ADR-025): 이 PC의 CLI · API 키 · 원격 페어링 열기 · 다른 PC에 연결.
 * 웹·모바일 PC 프로필은 RemoteSettings를 쓴다 (ADR-026)
 */
function ConnectionsTab() {
  if (!caps.localCli) return <DeviceConnections />;
  return (
    <div className="space-y-5">
      <Section title={t('settings.connections.cliTitle')} hint={t('settings.connections.cliHint')}>
        <CliCard id="claude-cli" install="npm i -g @anthropic-ai/claude-code" login="claude auth login" />
        <CliCard id="codex-cli" install="npm i -g @openai/codex" login="codex login" />
      </Section>
      <Section title={t('settings.connections.apiKeyTitle')} hint={t('settings.connections.apiKeyHint')}>
        <ApiCard id="anthropic-api" prefix="sk-ant-" />
        <ApiCard id="openai-api" prefix="sk-" />
      </Section>
      {caps.hostPairing && (
        <Section title={t('settings.connections.pairTitle')} hint={t('settings.connections.pairHint')}>
          <HostCard />
        </Section>
      )}
      <Section title={t('settings.connections.bridgeTitle')} hint={t('settings.connections.bridgeHint')}>
        <BridgeCard />
      </Section>
      <PolicyNote />
    </div>
  );
}

/** 웹·모바일 이 기기 프로필 (ADR-103): API 키로 답하고, 저장한 PC 프로필로 바꿀 수 있다 */
function DeviceConnections() {
  const pairLink = useUi((s) => s.pairLink);
  const [link, setLink] = useState('');
  // 딥링크(branch://pair)로 열렸으면 PC 추가 폼에 채워 둔다. 연결은 사용자가 지문을 보고 누른다
  useEffect(() => {
    if (!pairLink) return;
    useUi.setState({ pairLink: null });
    setLink(pairLink);
  }, [pairLink]);
  return (
    <div className="space-y-5">
      <Section title={t('settings.connections.apiKeyTitle')} hint={t('settings.device.apiKeyHint')}>
        <ApiCard id="anthropic-api" prefix="sk-ant-" />
        <ApiCard id="openai-api" prefix="sk-" />
      </Section>
      <Section title={t('settings.device.switchTitle')} hint={t('settings.device.switchHint')}>
        <HostList key={link} device={false} initialLink={link} />
      </Section>
    </div>
  );
}

/* ── 일반 탭 ───────────────────────────────────────────── */

function GeneralTab() {
  const settings = useApp((s) => s.settings);
  const conns = useApp((s) => s.connections);
  const order = settings.fallbackOrder;
  const move = (i: number, d: -1 | 1) => {
    const next = [...order];
    const j = i + d;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j]!, next[i]!];
    actions().updateSettings({ fallbackOrder: next });
  };

  return (
    <div className="space-y-6">
      <LanguageField />
      {desktop?.updater && <UpdateSettings />}
      <NotificationSettings />
      <Field label={t('settings.general.defaultProvider')} hint={t('settings.general.defaultProviderHint')}>
        <select
          value={settings.defaultProviderId}
          onChange={(e) => actions().updateSettings({ defaultProviderId: e.target.value as ProviderId })}
          className="h-10 w-full rounded-lg border border-line bg-bg px-3 text-[14px] outline-none focus:border-accent"
        >
          {caps.providers.map((p) => (
            <option key={p} value={p}>
              {conns[p].enabled
                ? t('settings.general.providerOption', { label: providerLabel(p), status: STATUS_LABEL[conns[p].status] })
                : t('settings.general.providerOptionOff', { label: providerLabel(p), status: STATUS_LABEL[conns[p].status] })}
            </option>
          ))}
        </select>
      </Field>

      <Field label={t('settings.general.fallbackOrder')} hint={t('settings.general.fallbackOrderHint')}>
        <ol className="divide-y divide-line rounded-xl border border-line">
          {order.map((p, i) => (
            <li key={p} className="flex items-center gap-2 px-3 py-2">
              <span className="w-5 text-[12px] text-muted">{i + 1}</span>
              <StatusDot tone={statusTone(conns[p])} />
              <span className="flex-1 text-[13.5px]">{providerLabel(p)}</span>
              <span className="text-[11.5px] text-muted">{providerKind(p).toUpperCase()}</span>
              <IconButton size="sm" label={t('settings.general.moveUp')} disabled={i === 0} onClick={() => move(i, -1)}>
                <ArrowUp size={14} />
              </IconButton>
              <IconButton size="sm" label={t('settings.general.moveDown')} disabled={i === order.length - 1} onClick={() => move(i, 1)}>
                <ArrowDown size={14} />
              </IconButton>
            </li>
          ))}
        </ol>
      </Field>

      <Field label={t('settings.screen.anchorTarget')} hint={t('settings.screen.anchorTargetHint')}>
        <Segmented
          value={settings.anchorOpenTarget}
          options={[
            ['popup', t('settings.screen.popup')],
            ['split', t('settings.screen.split')],
          ]}
          onChange={(v) => actions().updateSettings({ anchorOpenTarget: v })}
        />
      </Field>

      <SelectionTriggerField />

      <AutoSkillField />

      <Field label={t('settings.general.contextLabel', { count: settings.contextWindow })} hint={t('settings.general.contextHint')}>
        <input
          type="range"
          min={2}
          max={12}
          value={settings.contextWindow}
          onChange={(e) => actions().updateSettings({ contextWindow: Number(e.target.value) })}
          className="w-full accent-[var(--accent)]"
          aria-label={t('settings.general.contextAria')}
        />
      </Field>
    </div>
  );
}
