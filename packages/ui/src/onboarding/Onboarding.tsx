import type { ProviderId } from '@branch/core';
import { ArrowLeft, ChevronRight, KeyRound, Laptop, MonitorSmartphone, TerminalSquare } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { caps } from '../app/capabilities';
import { isDemo, useRuntime } from '../app/runtime';
import { actions, useApp } from '../app/store';
import { useUi } from '../app/uiState';
import { Button } from '../components/Button';
import { Modal } from '../components/Modal';
import { ApiCard, BridgeCard, CliCard, PolicyNote } from '../settings/connectionCards';

/**
 * 첫 실행 안내 (ADR-025). 쓸 수 있는 연결이 하나도 없을 때 한 번 보여 준다.
 * - PC: 이 PC의 CLI(구독) 또는 API 키. 원격 페어링 열기는 설정에서 안내
 * - 웹·모바일: 내 PC와 페어링(추천) 또는 API 키. 모델·노력치는 고르지 않는다(PC가 정함)
 */
type Step = 'choose' | 'cli' | 'api' | 'pair';

function snapshot(st: { connections: Record<ProviderId, { status: string; enabled: boolean }> }) {
  const ids = caps.providers.filter((id) => id !== 'mock');
  return {
    checking: ids.some((id) => st.connections[id].status === 'checking'),
    ready: ids.find((id) => st.connections[id].enabled && st.connections[id].status === 'ready'),
  };
}

export function Onboarding() {
  const demo = useRuntime((s) => s.demo);
  const setupDone = useApp((s) => !!s.settings.setupDone);
  const checking = useApp((s) => snapshot(s).checking);
  const ready = useApp((s) => snapshot(s).ready);
  const pairLink = useUi((s) => s.pairLink);
  const [step, setStep] = useState<Step>('choose');
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
    setStep('choose');
  }

  if (!show || isDemo()) return null;

  const title: Record<Step, string> = {
    choose: 'rhymebook 시작하기',
    cli: '이 PC의 CLI 연결',
    api: 'API 키 등록',
    pair: '내 PC와 페어링',
  };

  return (
    <Modal open onClose={finish} label="시작하기" className="md:max-w-lg">
      <div className="flex h-13 shrink-0 items-center gap-2 border-b border-line px-4">
        {step !== 'choose' && (
          <button type="button" aria-label="뒤로" onClick={() => setStep('choose')} className="-ml-1 rounded-md p-1 text-muted hover:text-fg">
            <ArrowLeft size={18} />
          </button>
        )}
        <h2 className="flex-1 text-[16px] font-semibold">{title[step]}</h2>
      </div>
      <div className="scroll-thin min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4 md:px-5">
        {step === 'choose' && (
          <>
            <p className="text-[13.5px] text-fg-2">
              답변 속 문장을 골라 가지를 치며 배우는 채팅이에요. 먼저 답변을 만들 AI를 연결하세요.
              {!caps.localCli && ' 이 기기에서는 CLI를 실행할 수 없어서, PC와 페어링하거나 API 키를 쓰면 돼요.'}
            </p>
            {caps.localCli ? (
              <>
                <Choice
                  icon={<TerminalSquare size={18} />}
                  title="이 PC의 CLI (구독 계정)"
                  desc="설치·로그인된 Claude Code·Codex CLI를 그대로 실행해요. 모델·노력치도 고를 수 있어요."
                  badge="추천"
                  onClick={() => setStep('cli')}
                />
                <Choice icon={<KeyRound size={18} />} title="API 키" desc="Anthropic·OpenAI API 키로 직접 호출해요." onClick={() => setStep('api')} />
                <p className="flex gap-2 rounded-lg bg-surface-2 p-3 text-[12.5px] text-fg-2">
                  <MonitorSmartphone size={16} className="mt-0.5 shrink-0 text-accent" />
                  휴대폰·웹에서도 이 PC의 CLI로 쓰려면 연결 후 설정 → 연결 → [원격 페어링 열기]를 켜세요.
                </p>
              </>
            ) : (
              <>
                <Choice
                  icon={<Laptop size={18} />}
                  title="내 PC와 페어링"
                  desc="PC의 rhymebook 앱이 구독 CLI로 답해요. 에이전트·모델·노력치는 PC 설정을 따라요."
                  badge="추천"
                  onClick={() => setStep('pair')}
                />
                <Choice icon={<KeyRound size={18} />} title="API 키" desc="PC 없이 바로 써요. 모델은 기본값으로 고정돼요." onClick={() => setStep('api')} />
              </>
            )}
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
            <ApiCard id="anthropic-api" prefix="sk-ant-" />
            <ApiCard id="openai-api" prefix="sk-" />
          </>
        )}
        {step === 'pair' && (
          <>
            <BridgeCard />
            <PolicyNote />
          </>
        )}
      </div>
      <div className="flex shrink-0 items-center justify-end gap-2 border-t border-line px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <Button variant="ghost" onClick={finish}>
          나중에 하기
        </Button>
        <Button variant="primary" disabled={!ready} onClick={finish}>
          {ready ? '시작하기' : '연결을 기다리는 중'}
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
