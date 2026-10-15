import { STT_MODELS, type SttModelId, type SttState } from '@branch/core';
import { Download, Mic, Trash2, X } from 'lucide-react';
import { useState } from 'react';
import { desktop } from '../app/runtime';
import { pushNotice } from '../app/sync';
import { Badge, StatusDot } from '../components/Badge';
import { Button } from '../components/Button';
import { usePcOnline } from '../components/PcStatus';
import { cn } from '../lib/cn';
import { remoteSttActions, useRemoteSttState, useSttState, useSttStatus, type SttActions } from '../voice/sttStore';
import { Section, Toggle } from './controls';

/**
 * 음성 입력 설정 (ADR-045, ADR-046).
 * - 데스크톱: 켜기·모델 고르기·받기·지우기. 전사는 이 PC에서만 하고 녹음은 저장하지 않는다.
 * - 웹·모바일: 연결된 PC의 같은 설정을 원격으로 바꾼다. 모델은 PC에 저장된다.
 */
const stt = desktop?.stt;

const mb = (n: number) => `${Math.round(n / 1_000_000)}MB`;

function run(p: Promise<SttState>) {
  p.catch((e: unknown) => pushNotice(e instanceof Error ? e.message : '요청을 처리하지 못했습니다.'));
}

export function VoiceSettings() {
  const state = useSttState();
  if (!stt) return null;
  if (!state) return <p className="text-[13px] text-muted">불러오는 중…</p>;
  return (
    <div className="space-y-5">
      <VoiceManager state={state} actions={stt} remote={false} />
    </div>
  );
}

function VoiceManager({ state, actions, remote }: { state: SttState; actions: SttActions; remote: boolean }) {
  return (
    <>
      <Section
        title="음성 입력"
        hint={
          remote
            ? '입력창의 마이크로 말하면 연결된 PC가 글자로 바꿔요. 여기서 바꾼 설정은 PC와 PC에 연결된 모든 기기에 함께 적용돼요.'
            : '입력창의 마이크로 말하면 이 PC가 글자로 바꿔요. 녹음은 인터넷으로 보내지 않고 바꾼 뒤 바로 지워요.'
        }
      >
        <div className="flex items-center gap-3 rounded-xl border border-line px-3 py-3">
          <Mic size={18} className="shrink-0 text-muted" />
          <div className="min-w-0 flex-1">
            <div className="text-[14px] font-medium">음성으로 질문하기</div>
            <div className="mt-0.5 flex items-center gap-1.5 text-[12.5px] text-muted">
              <StatusDot tone={state.ready ? 'ok' : state.enabled ? 'warn' : 'neutral'} />
              {state.ready
                ? remote
                  ? '사용할 수 있어요. 입력창의 마이크를 누르세요.'
                  : '사용할 수 있어요. 연결된 휴대폰·웹도 같이 써요.'
                : (state.detail ?? '꺼져 있어요.')}
            </div>
          </div>
          <Toggle checked={state.enabled} label="음성 입력 사용" onChange={(v) => run(actions.setEnabled(v))} />
        </div>
        {!state.engine && (
          <p className="rounded-lg bg-surface-2 px-3 py-2 text-[12.5px] text-fg-2">
            {remote ? 'PC에 ' : ''}음성 엔진(whisper-cli)이 없어요. {remote ? 'PC 앱을' : '앱을'} 다시 설치하거나 {remote ? 'PC의 ' : ''}터미널에서{' '}
            <code>brew install whisper-cpp</code>로 설치해 주세요.
          </p>
        )}
      </Section>

      <Section
        title="음성 모델"
        hint={remote ? 'PC에 한 번 받아 두면 계속 써요. 받는 동안 이 화면을 닫아도 PC가 계속 받아요.' : '처음 한 번 받아 두면 이 PC에서 계속 써요. 쓸 모델을 고르세요.'}
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
          aria-label={`${m.label} 모델 사용`}
          checked={selected}
          onChange={() => run(actions.setModel(id))}
          className="mt-1 size-4 shrink-0 accent-[var(--accent)]"
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5 text-[14px] font-medium">
            {m.label}
            <span className="text-[12px] font-normal text-muted">{mb(m.size)}</span>
            {installed && <Badge tone="ok">받음</Badge>}
          </div>
          <p className="mt-0.5 text-[12.5px] text-muted">{m.note}</p>
          {dl && (
            <div className="mt-2">
              <div className="h-1.5 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="모델 받는 중">
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
              취소
            </Button>
          ) : installed ? (
            confirm ? (
              <>
                <Button size="sm" variant="danger" onClick={() => (setConfirm(false), run(actions.remove(id)))}>
                  지우기
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirm(false)}>
                  취소
                </Button>
              </>
            ) : (
              <Button size="sm" variant="ghost" icon={<Trash2 size={14} />} aria-label={`${m.label} 모델 지우기`} onClick={() => setConfirm(true)}>
                지우기
              </Button>
            )
          ) : (
            <Button size="sm" variant="soft" icon={<Download size={14} />} disabled={otherDownloading} onClick={() => run(actions.download(id))}>
              받기
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
  return <RemoteVoiceStatus hint={!online ? 'PC 설정을 따릅니다. PC와 연결되면 여기서 켜고 모델을 받을 수 있어요.' : error ? remoteErrorHint(error) : undefined} />;
}

/** 음성 입력이 없는 bridge(이전 rhymebook 서버 등)는 업데이트 안내를 따로 한다 (ADR-047) */
function remoteErrorHint(error: string): string {
  if (error.includes('음성 입력을 지원하지 않습니다')) return '이 PC는 아직 음성 입력을 지원하지 않아요. PC 앱이나 rhymebook 서버를 업데이트하면 쓸 수 있어요.';
  return 'PC 설정을 따릅니다. PC 앱을 업데이트하면 여기서도 바꿀 수 있어요.';
}

function RemoteVoiceStatus({ hint }: { hint?: string | undefined }) {
  const status = useSttStatus();
  return (
    <Section title="음성 입력" hint={hint ?? 'PC 설정을 따릅니다.'}>
      <div className="flex items-center gap-2 rounded-xl border border-line px-3 py-3 text-[13.5px]">
        <Mic size={17} className="shrink-0 text-muted" />
        <StatusDot tone={status?.ready ? 'ok' : status?.enabled ? 'warn' : 'neutral'} />
        <span className="min-w-0 flex-1">
          {!status ? '확인 중…' : status.ready ? '사용할 수 있어요. 입력창의 마이크를 누르세요.' : (status.detail ?? 'PC에서 음성 입력이 꺼져 있습니다.')}
        </span>
      </div>
    </Section>
  );
}
