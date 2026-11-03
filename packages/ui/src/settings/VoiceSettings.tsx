import { LANGUAGES, rawMessage, STT_MODELS, type SttModelId, type SttState } from '@branch/core';
import { Download, Mic, Trash2, X } from 'lucide-react';
import { useState } from 'react';
import { desktop } from '../app/runtime';
import { pushNotice } from '../app/sync';
import { Badge, StatusDot } from '../components/Badge';
import { Button } from '../components/Button';
import { usePcOnline } from '../components/PcStatus';
import { cn } from '../lib/cn';
import { remoteSttActions, useRemoteSttState, useSttState, useSttStatus, type SttActions } from '../voice/sttStore';
import { t, tx } from '../i18n';
import { Section, Toggle } from './controls';
import { SpeechSettings } from './SpeechSettings';

/**
 * 음성 입력 설정 (ADR-045, ADR-046).
 * - 데스크톱: 켜기·모델 고르기·받기·지우기. 전사는 이 PC에서만 하고 녹음은 저장하지 않는다.
 * - 웹·모바일: 연결된 PC의 같은 설정을 원격으로 바꾼다. 모델은 PC에 저장된다.
 */
const stt = desktop?.stt;

const mb = (n: number) => `${Math.round(n / 1_000_000)}MB`;

function run(p: Promise<SttState>) {
  p.catch((e: unknown) => pushNotice(e instanceof Error ? e.message : t('settings.voice.requestFailed')));
}

export function VoiceSettings() {
  const state = useSttState();
  return (
    <div className="space-y-5">
      {stt && (state ? <VoiceManager state={state} actions={stt} remote={false} /> : <p className="text-[13px] text-muted">{t('common.loading')}</p>)}
      <SpeechSettings />
    </div>
  );
}

function VoiceManager({ state, actions, remote }: { state: SttState; actions: SttActions; remote: boolean }) {
  return (
    <>
      <Section
        title={t('settings.voice.inputTitle')}
        hint={remote ? t('settings.voice.inputHintRemote') : t('settings.voice.inputHintLocal')}
      >
        <div className="flex items-center gap-3 rounded-xl border border-line px-3 py-3">
          <Mic size={18} className="shrink-0 text-muted" />
          <div className="min-w-0 flex-1">
            <div className="text-[14px] font-medium">{t('settings.voice.askByVoice')}</div>
            <div className="mt-0.5 flex items-center gap-1.5 text-[12.5px] text-muted">
              <StatusDot tone={state.ready ? 'ok' : state.enabled ? 'warn' : 'neutral'} />
              {state.ready
                ? remote
                  ? t('settings.voice.readyRemote')
                  : t('settings.voice.readyLocal')
                : (state.detail ?? t('settings.voice.off'))}
            </div>
          </div>
          <Toggle checked={state.enabled} label={t('settings.voice.enableAria')} onChange={(v) => run(actions.setEnabled(v))} />
        </div>
        {!state.engine && (
          <p className="rounded-lg bg-surface-2 px-3 py-2 text-[12.5px] text-fg-2">
            {tx(remote ? 'settings.voice.engineMissingRemote' : 'settings.voice.engineMissingLocal', {
              code: <code>brew install whisper-cpp</code>,
            })}
          </p>
        )}
      </Section>

      <Section
        title={t('settings.voice.modelTitle')}
        hint={remote ? t('settings.voice.modelHintRemote') : t('settings.voice.modelHintLocal')}
      >
        {STT_MODELS.map((m) => (
          <ModelRow key={m.id} id={m.id} state={state} actions={actions} />
        ))}
        {state.error && <p className="text-[12.5px] text-danger">{state.error}</p>}
      </Section>
    </>
  );
}

function ModelRow({ id, state, actions }: { id: SttModelId; state: SttState; actions: SttActions }) {
  const m = STT_MODELS.find((x) => x.id === id)!;
  const installed = state.installed.includes(id);
  const selected = state.model === id;
  const dl = state.download?.model === id ? state.download : null;
  const otherDownloading = !!state.download && !dl;
  const [confirm, setConfirm] = useState(false);
  const pct = dl ? Math.floor((dl.received / dl.total) * 100) : 0;
  return (
    <div className={cn('rounded-xl border px-3 py-3', selected ? 'border-accent' : 'border-line')}>
      <div className="flex items-start gap-3">
        <input
          type="radio"
          name="stt-model"
          aria-label={t('settings.voice.useModelAria', { label: m.label })}
          checked={selected}
          onChange={() => run(actions.setModel(id))}
          className="mt-1 size-4 shrink-0 accent-[var(--accent)]"
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5 text-[14px] font-medium">
            {m.label}
            <span className="text-[12px] font-normal text-muted">{mb(m.size)}</span>
            {installed && <Badge tone="ok">{t('settings.voice.installed')}</Badge>}
          </div>
          <p className="mt-0.5 text-[12.5px] text-muted">{m.note}</p>
          {dl && (
            <div className="mt-2">
              <div className="h-1.5 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={t('settings.voice.downloadingAria')}>
                <div className="h-full bg-accent transition-[width]" style={{ width: `${pct}%` }} />
              </div>
              <div className="mt-1 text-[12px] text-muted tabular-nums">
                {mb(dl.received)} / {mb(dl.total)} ({pct}%)
              </div>
            </div>
          )}
        </div>
        <div className="flex shrink-0 gap-1.5">
          {dl ? (
            <Button size="sm" icon={<X size={14} />} onClick={() => run(actions.cancelDownload())}>
              {t('common.cancel')}
            </Button>
          ) : installed ? (
            confirm ? (
              <>
                <Button size="sm" variant="danger" onClick={() => (setConfirm(false), run(actions.remove(id)))}>
                  {t('settings.voice.remove')}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirm(false)}>
                  {t('common.cancel')}
                </Button>
              </>
            ) : (
              <Button size="sm" variant="ghost" icon={<Trash2 size={14} />} aria-label={t('settings.voice.removeModelAria', { label: m.label })} onClick={() => setConfirm(true)}>
                {t('settings.voice.remove')}
              </Button>
            )
          ) : (
            <Button size="sm" variant="soft" icon={<Download size={14} />} disabled={otherDownloading} onClick={() => run(actions.download(id))}>
              {t('settings.voice.download')}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

/** 웹·모바일(원격): 연결된 PC의 음성 설정을 보고 바꾼다 (ADR-046) */
export function RemoteVoiceSettings() {
  const online = usePcOnline();
  const { state, error } = useRemoteSttState(online);
  if (online && state) return <VoiceManager state={state} actions={remoteSttActions} remote />;
  // 연결 전·이전 버전 PC: 상태만 보여 준다
  return <RemoteVoiceStatus hint={!online ? t('settings.voice.followPcOffline') : error ? remoteErrorHint(error) : undefined} />;
}

/** 음성 입력이 없는 bridge(이전 octobooks 서버 등)는 업데이트 안내를 따로 한다 (ADR-047) */
function remoteErrorHint(error: string): string {
  // PC의 언어와 이 기기 언어가 다를 수 있어 모든 언어의 문구와 맞춰 본다 (이전 버전 PC는 한국어)
  const unsupported = LANGUAGES.map((l) => rawMessage('bridge.server.sttUnsupported', l.id)).filter((m): m is string => !!m);
  if (error.includes('음성 입력을 지원하지 않습니다') || unsupported.some((m) => error.includes(m))) return t('settings.voice.unsupportedPc');
  return t('settings.voice.updatePcHint');
}

function RemoteVoiceStatus({ hint }: { hint?: string | undefined }) {
  const status = useSttStatus();
  return (
    <Section title={t('settings.voice.inputTitle')} hint={hint ?? t('settings.voice.followPc')}>
      <div className="flex items-center gap-2 rounded-xl border border-line px-3 py-3 text-[13.5px]">
        <Mic size={17} className="shrink-0 text-muted" />
        <StatusDot tone={status?.ready ? 'ok' : status?.enabled ? 'warn' : 'neutral'} />
        <span className="min-w-0 flex-1">
          {!status ? t('settings.voice.checking') : status.ready ? t('settings.voice.readyRemote') : (status.detail ?? t('settings.voice.offOnPc'))}
        </span>
      </div>
    </Section>
  );
}
