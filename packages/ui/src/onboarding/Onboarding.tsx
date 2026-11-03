import { OctoMark } from '../components/OctoMark';
import type { ProviderId } from '@branch/core';
import { ArrowLeft, ChevronRight, KeyRound, Laptop, MonitorSmartphone, TerminalSquare } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { caps, remoteMode } from '../app/capabilities';
import { isDemo, useRuntime } from '../app/runtime';
import { actions, useApp } from '../app/store';
import { chooseThisDevice, setPairing, useSync } from '../app/sync';
import { useUi } from '../app/uiState';
import { Button } from '../components/Button';
import { Modal } from '../components/Modal';
import { t } from '../i18n';
import { ApiCard, CliCard, PairForm, PolicyNote } from '../settings/connectionCards';

/**
 * 첫 실행 안내 (ADR-025·026).
 * - PC: 쓸 수 있는 연결이 하나도 없을 때 한 번. 이 PC의 CLI(구독) 또는 API 키
 * - 웹·모바일 PC 프로필: 페어링한 PC가 없으면 PC 페어링 화면 (또는 이 기기에서 쓰기, ADR-103)
 * - 웹·모바일 이 기기 프로필: API 키 등록
 */
type Step = 'choose' | 'cli' | 'api';

export function Onboarding() {
  return remoteMode ? <RemoteOnboarding /> : <LocalOnboarding />;
}

/** 원격 전용: PC와 페어링해야 학습을 볼 수 있다. [나중에]로 닫으면 이번 실행 동안은 다시 띄우지 않는다 */
function RemoteOnboarding() {
  const demo = useRuntime((s) => s.demo);
  const status = useSync((s) => s.status);
  const pairLink = useUi((s) => s.pairLink);
  const [dismissed, setDismissed] = useState(false);

  // 딥링크는 설정 화면이 처리한다
  useEffect(() => {
    if (pairLink) setDismissed(true);
  }, [pairLink]);

  if (demo || dismissed || status !== 'unpaired') return null;

  return (
    <Modal open onClose={() => setDismissed(true)} label={t('onboarding.remote.label')} className="md:max-w-lg">
      <div className="flex h-13 shrink-0 items-center gap-2 border-b border-line px-4">
        <h2 className="flex-1 text-[16px] font-semibold">{t('onboarding.remote.title')}</h2>
      </div>
      <div className="scroll-thin min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4 md:px-5">
        <div className="flex gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent">
            <MonitorSmartphone size={20} />
          </span>
          <p className="text-[13.5px] text-fg-2">{t('onboarding.remote.intro')}</p>
        </div>
        <ol className="space-y-1.5 text-[13px] text-fg-2">
          <StepItem n={1}>{t('onboarding.remote.step1')}</StepItem>
          <StepItem n={2}>{t('onboarding.remote.step2')}</StepItem>
          <StepItem n={3}>{t('onboarding.remote.step3')}</StepItem>
        </ol>
        <div className="rounded-xl border border-line bg-surface p-3.5">
          <PairForm onPaired={(p) => (p ? setPairing(p) : undefined)} />
        </div>
      </div>
      <div className="flex shrink-0 items-center justify-between gap-2 border-t border-line px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <span className="flex min-w-0 items-center gap-1.5 text-[12px] text-muted">
          <Laptop size={14} className="shrink-0" />
          {t('onboarding.remote.storeNote')}
        </span>
        <span className="flex shrink-0 gap-1">
          <Button variant="ghost" onClick={() => setDismissed(true)}>
            {t('onboarding.remote.later')}
          </Button>
          <Button variant="secondary" onClick={chooseThisDevice}>
            {t('onboarding.remote.useThisDevice')}
          </Button>
        </span>
      </div>
    </Modal>
  );
}

function StepItem({ n, children }: { n: number; children: ReactNode }) {
  return (
    <li className="flex gap-2.5">
      <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-surface-2 text-[11.5px] font-semibold text-fg-2">{n}</span>
      <span>{children}</span>
    </li>
  );
}

function snapshot(st: { connections: Record<ProviderId, { status: string; enabled: boolean }> }) {
  const ids = caps.providers.filter((id) => id !== 'mock');
  return {
    checking: ids.some((id) => st.connections[id].status === 'checking'),
    ready: ids.find((id) => st.connections[id].enabled && st.connections[id].status === 'ready'),
  };
}

// 웹·모바일 이 기기 프로필은 CLI를 실행할 수 없어 API 키만 등록한다
const home: Step = caps.localCli ? 'choose' : 'api';

function LocalOnboarding() {
  const demo = useRuntime((s) => s.demo);
  const setupDone = useApp((s) => !!s.settings.setupDone);
  const checking = useApp((s) => snapshot(s).checking);
  const ready = useApp((s) => snapshot(s).ready);
  const pairLink = useUi((s) => s.pairLink);
  const [step, setStep] = useState<Step>(home);
  const [opened, setOpened] = useState(false);

  // 이미 연결이 준비돼 있으면(기존 사용자·복원) 안내 없이 완료 처리
  useEffect(() => {
    if (!demo && !setupDone && ready && !opened) actions().updateSettings({ setupDone: true });
  }, [demo, setupDone, ready, opened]);

  // 딥링크로 페어링 링크를 받으면 설정 화면이 처리하도록 안내를 닫는다
  useEffect(() => {
    if (pairLink && opened) finish();
  }, [pairLink, opened]);

  const show = !demo && !setupDone && (opened || (!checking && !ready && !pairLink));
  useEffect(() => {
    if (show && !opened) setOpened(true);
  }, [show, opened]);

  function finish() {
    const st = actions();
    const patch: { setupDone: true; defaultProviderId?: ProviderId } = { setupDone: true };
    const cur = st.connections[st.settings.defaultProviderId];
    if (!(cur.enabled && cur.status === 'ready')) {
      const first = caps.providers.find((id) => id !== 'mock' && st.connections[id].enabled && st.connections[id].status === 'ready');
      if (first) patch.defaultProviderId = first;
    }
    st.updateSettings(patch);
    setOpened(false);
    setStep(home);
  }

  if (!show || isDemo()) return null;

  const title: Record<Step, string> = {
    choose: t('onboarding.local.titleChoose'),
    cli: t('onboarding.local.titleCli'),
    api: caps.localCli ? t('onboarding.local.titleApi') : t('onboarding.local.titleDevice'),
  };

  return (
    <Modal open onClose={finish} label={t('onboarding.local.label')} className="md:max-w-lg">
      <div className="flex h-13 shrink-0 items-center gap-2 border-b border-line px-4">
        {step !== home && (
          <button type="button" aria-label={t('onboarding.local.back')} onClick={() => setStep('choose')} className="-ml-1 rounded-md p-1 text-muted hover:text-fg">
            <ArrowLeft size={18} />
          </button>
        )}
        <OctoMark className="size-8 text-accent" /><h2 className="flex-1 text-[16px] font-semibold">{title[step]}</h2>
      </div>
      <div className="scroll-thin min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4 md:px-5">
        {step === 'choose' && (
          <>
            <p className="text-[13.5px] text-fg-2">{t('onboarding.local.choosePitch')}</p>
            <Choice
              icon={<TerminalSquare size={18} />}
              title={t('onboarding.local.cliChoice')}
              desc={t('onboarding.local.cliDesc')}
              badge={t('onboarding.local.recommended')}
              onClick={() => setStep('cli')}
            />
            <Choice icon={<KeyRound size={18} />} title={t('onboarding.local.apiChoice')} desc={t('onboarding.local.apiDesc')} onClick={() => setStep('api')} />
            <p className="flex gap-2 rounded-lg bg-surface-2 p-3 text-[12.5px] text-fg-2">
              <MonitorSmartphone size={16} className="mt-0.5 shrink-0 text-accent" />
              {t('onboarding.local.remoteTip')}
            </p>
          </>
        )}
        {step === 'cli' && (
          <>
            <CliCard id="claude-cli" install="npm i -g @anthropic-ai/claude-code" login="claude auth login" />
            <CliCard id="codex-cli" install="npm i -g @openai/codex" login="codex login" />
            <PolicyNote />
          </>
        )}
        {step === 'api' && (
          <>
            {!caps.localCli && <p className="text-[13.5px] text-fg-2">{t('onboarding.local.apiNote')}</p>}
            <ApiCard id="anthropic-api" prefix="sk-ant-" />
            <ApiCard id="openai-api" prefix="sk-" />
          </>
        )}
      </div>
      <div className="flex shrink-0 items-center justify-end gap-2 border-t border-line px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <Button variant="ghost" onClick={finish}>
          {t('onboarding.local.later')}
        </Button>
        <Button variant="primary" disabled={!ready} onClick={finish}>
          {ready ? t('onboarding.local.start') : t('onboarding.local.waiting')}
        </Button>
      </div>
    </Modal>
  );
}

function Choice({ icon, title, desc, badge, onClick }: { icon: ReactNode; title: string; desc: string; badge?: string; onClick(): void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-xl border border-line bg-surface p-3.5 text-left hover:border-accent"
    >
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-surface-2 text-fg-2">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2 text-[14px] font-medium">
          {title}
          {badge && <span className="rounded-md bg-accent-soft px-1.5 text-[11px] text-accent">{badge}</span>}
        </span>
        <span className="block text-[12.5px] text-muted">{desc}</span>
      </span>
      <ChevronRight size={16} className="shrink-0 text-muted" />
    </button>
  );
}
