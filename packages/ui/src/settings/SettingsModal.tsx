import { AppearanceSettings } from './AppearanceSettings';
import type { ProviderId } from '@branch/core';
import { ArrowDown, ArrowUp, X } from 'lucide-react';
import { useState } from 'react';
import { caps, remoteMode } from '../app/capabilities';
import { actions, useApp } from '../app/store';
import { useUi } from '../app/uiState';
import { StatusDot } from '../components/Badge';
import { IconButton } from '../components/Button';
import { Modal } from '../components/Modal';
import { cn } from '../lib/cn';
import { Field, Section, Segmented } from './controls';
import { BackupTab } from './BackupTab';
import { AutoSkillField } from './AutoSkillField';
import { ApiCard, BridgeCard, CliCard, PolicyNote } from './connectionCards';
import { HostCard } from './HostCard';
import { RemoteSettings } from './RemoteSettings';
import { SelectionTriggerField } from './SelectionTriggerField';
import { VoiceSettings } from './VoiceSettings';
import { providerKind, providerLabel, STATUS_LABEL, statusTone } from '../lib/connection';

type Tab = 'connections' | 'backup' | 'voice' | 'appearance' | 'general';

const APP_VERSION = import.meta.env.VITE_APP_VERSION as string | undefined;

function SettingsTitle() {
  return (
    <h2 className="flex flex-1 items-baseline gap-2 text-[16px] font-semibold">
      설정
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
      <Modal open={open} onClose={close} label="설정" className="md:max-w-xl">
        <div className="flex h-13 shrink-0 items-center gap-2 border-b border-line px-4">
          <SettingsTitle />
          <IconButton label="설정 닫기" onClick={close}>
            <X size={18} />
          </IconButton>
        </div>
        <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-4 py-4 md:px-5">
          <RemoteSettings />
        </div>
      </Modal>
    );
  }
  return (
    <Modal open={open} onClose={close} label="설정" className="md:max-w-2xl">
      <div className="flex h-13 shrink-0 items-center gap-2 border-b border-line px-4">
        <SettingsTitle />
        <IconButton label="설정 닫기" onClick={close}>
          <X size={18} />
        </IconButton>
      </div>
      <div role="tablist" className="flex shrink-0 gap-1 border-b border-line px-3">
        {(
          [
            ['connections', '연결'],
            ['backup', '백업'],
            ['voice', '음성'],
            ['appearance', '테마'],
            ['general', '일반'],
          ] as const
        ).map(([t, label]) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={cn(
              '-mb-px border-b-2 px-3 py-2.5 text-[14px]',
              tab === t ? 'border-accent font-medium text-fg' : 'border-transparent text-muted hover:text-fg',
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
 * 웹·모바일은 원격 전용이라 RemoteSettings를 쓴다 (ADR-026)
 */
function ConnectionsTab() {
  return (
    <div className="space-y-5">
      <Section title="이 PC의 에이전트 (공식 CLI)" hint="이 PC에 설치·로그인된 공식 CLI를 그대로 실행해요. 기본 모델·노력치를 여기서 정해요.">
        <CliCard id="claude-cli" install="npm i -g @anthropic-ai/claude-code" login="claude auth login" />
        <CliCard id="codex-cli" install="npm i -g @openai/codex" login="codex login" />
      </Section>
      <Section title="API 키" hint="CLI 없이 API로 직접 호출해요.">
        <ApiCard id="anthropic-api" prefix="sk-ant-" />
        <ApiCard id="openai-api" prefix="sk-" />
      </Section>
      {caps.hostPairing && (
        <Section title="원격 페어링 열기" hint="휴대폰·웹에서 이 PC의 CLI로 채팅하도록 이 PC를 열어요.">
          <HostCard />
        </Section>
      )}
      <Section title="다른 PC에 연결" hint="다른 PC가 열어 둔 원격 페어링에 이 앱을 연결해요.">
        <BridgeCard />
      </Section>
      <PolicyNote />
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
      <Field label="기본 provider" hint="새 세션과 provider를 지정하지 않은 세션에 쓰입니다.">
        <select
          value={settings.defaultProviderId}
          onChange={(e) => actions().updateSettings({ defaultProviderId: e.target.value as ProviderId })}
          className="h-10 w-full rounded-lg border border-line bg-bg px-3 text-[14px] outline-none focus:border-accent"
        >
          {caps.providers.map((p) => (
            <option key={p} value={p}>
              {providerLabel(p)} — {STATUS_LABEL[conns[p].status]}
              {!conns[p].enabled ? ' (꺼짐)' : ''}
            </option>
          ))}
        </select>
      </Field>

      <Field label="대체 provider 순서" hint="현재 provider가 오프라인이면 이 순서로 대신 쓸 연결을 제안합니다.">
        <ol className="divide-y divide-line rounded-xl border border-line">
          {order.map((p, i) => (
            <li key={p} className="flex items-center gap-2 px-3 py-2">
              <span className="w-5 text-[12px] text-muted">{i + 1}</span>
              <StatusDot tone={statusTone(conns[p])} />
              <span className="flex-1 text-[13.5px]">{providerLabel(p)}</span>
              <span className="text-[11.5px] text-muted">{providerKind(p).toUpperCase()}</span>
              <IconButton size="sm" label="위로" disabled={i === 0} onClick={() => move(i, -1)}>
                <ArrowUp size={14} />
              </IconButton>
              <IconButton size="sm" label="아래로" disabled={i === order.length - 1} onClick={() => move(i, 1)}>
                <ArrowDown size={14} />
              </IconButton>
            </li>
          ))}
        </ol>
      </Field>

      <Field label="가지를 열 위치 (태블릿·데스크톱)" hint="모바일에서는 항상 바텀시트로 열립니다.">
        <Segmented
          value={settings.anchorOpenTarget}
          options={[
            ['popup', '플로팅 팝업'],
            ['split', '분할 패널'],
          ]}
          onChange={(v) => actions().updateSettings({ anchorOpenTarget: v })}
        />
      </Field>

      <SelectionTriggerField />

      <AutoSkillField />

      <Field label={`맥락 상속: 부모 대화 최근 ${settings.contextWindow}개`} hint="가지 질문에 함께 보낼 부모 세션의 최근 메시지 수입니다.">
        <input
          type="range"
          min={2}
          max={12}
          value={settings.contextWindow}
          onChange={(e) => actions().updateSettings({ contextWindow: Number(e.target.value) })}
          className="w-full accent-[var(--accent)]"
          aria-label="부모 대화 메시지 수"
        />
      </Field>
    </div>
  );
}
