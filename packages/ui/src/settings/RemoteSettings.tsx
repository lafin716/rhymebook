import { AppearanceSettings } from './AppearanceSettings';
import { createSnapshot, keyFingerprint, remoteRoute, serializeBackup, backupFileName, type RemotePairing } from '@branch/core';
import { Download, Info, Laptop, Link2, RefreshCw, Smartphone, Unlink } from 'lucide-react';
import { useEffect, useState } from 'react';
import { caps } from '../app/capabilities';
import { actions, persistence, useApp } from '../app/store';
import { chooseThisDevice, setPairing, syncClient, useRemoteHosts, useRemotePairing, useSync } from '../app/sync';
import { useUi } from '../app/uiState';
import { StatusDot } from '../components/Badge';
import { Button } from '../components/Button';
import { HostList } from '../components/HostList';
import { confirm } from '../components/ConfirmDialog';
import { PC_STATUS_LABEL } from '../components/PcStatus';
import { saveTextFile } from '../lib/download';
import { Field, Section, Segmented } from './controls';
import { LanguageField } from './LanguageField';
import { t } from '../i18n';
import { PairForm } from './connectionCards';
import { SelectionTriggerField } from './SelectionTriggerField';
import { AutoSkillField } from './AutoSkillField';
import { SpeechSettings } from './SpeechSettings';
import { RemoteVoiceSettings } from './VoiceSettings';

/**
 * 원격 전용 설정 (웹·모바일, ADR-026).
 * 학습 데이터와 기본 에이전트·모델은 PC가 정하므로, 이 기기에서는 연결된 PC와 화면 설정만 다룬다.
 * (채팅별 에이전트·모델·노력치는 세션 헤더의 RemoteAgentPicker, ADR-031)
 */
export function RemoteSettings() {
  const settings = useApp((s) => s.settings);
  return (
    <div className="space-y-6">
      <Section title={t('settings.remote.pcTitle')} hint={t('settings.remote.pcHint')}>
        <PcCard />
        <SavedHosts />
      </Section>

      <AppearanceSettings />

      <RemoteVoiceSettings />

      <SpeechSettings />

      <Section title={t('settings.remote.screenTitle')}>
        <LanguageField />
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
      </Section>

      <OldDataCard />
      <RemoteNote />
    </div>
  );
}

/** 저장한 PC가 둘 이상이면 여기서도 전환한다 (ADR-063). 추가는 위 카드의 [다른 PC와 페어링] */
function SavedHosts() {
  const many = useRemoteHosts((s) => s.hosts.length > 1);
  return many ? <HostList addable={false} /> : null;
}

const TONE = { online: 'ok', connecting: 'warn', offline: 'danger', unpaired: 'neutral', unsupported: 'danger' } as const;

/** 연결된 PC 카드: 상태·지문·경로 + 다시 연결/해제, 미페어링이면 페어링 폼 */
function PcCard() {
  const status = useSync((s) => s.status);
  const hostName = useSync((s) => s.hostName);
  const error = useSync((s) => s.error);
  const pairing = useRemotePairing();
  const pairLink = useUi((s) => s.pairLink);
  const [form, setForm] = useState(false);
  const [initialLink, setInitialLink] = useState('');

  // 딥링크(branch://pair)로 열렸으면 링크 폼을 채워 둔다. 연결은 사용자가 지문을 보고 누른다
  useEffect(() => {
    if (!pairLink) return;
    useUi.setState({ pairLink: null });
    setInitialLink(pairLink);
    setForm(true);
  }, [pairLink]);

  const close = () => {
    setForm(false);
    setInitialLink('');
  };

  const onPaired = async (p: RemotePairing | null) => {
    if (p) await setPairing(p);
    close();
  };

  const unpair = async () => {
    const ok = await confirm({
      title: t('settings.remote.unpairTitle'),
      message: t('settings.remote.unpairMessage'),
      confirmLabel: t('settings.remote.unpairConfirm'),
      tone: 'danger',
    });
    if (ok) await setPairing(null);
  };

  const paired = !!pairing && status !== 'unpaired';
  return (
    <div className="rounded-xl border border-line bg-surface p-3.5">
      <div className="flex items-center gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-surface-2 text-fg-2">
          <Laptop size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[14px] font-medium">{paired ? (hostName ?? pairing.bridgeName) : t('settings.remote.noPc')}</div>
          <div className="flex items-center gap-1.5 text-[12px] text-muted">
            <StatusDot tone={TONE[status]} className={status === 'connecting' ? 'animate-pulse' : undefined} />
            {PC_STATUS_LABEL[status]}
            {paired && status === 'online' && <span>· {remoteRoute(pairing.url)}</span>}
          </div>
        </div>
      </div>

      <div className="mt-3 space-y-2 text-[12.5px] text-fg-2">
        {form || !paired ? (
          <>
            {!paired && !form && (
              <ol className="list-decimal space-y-0.5 pl-4">
                <li>{t('settings.remote.pairStep1')}</li>
                <li>{t('settings.remote.pairStep2')}</li>
                <li>{t('settings.remote.pairStep3')}</li>
              </ol>
            )}
            <PairForm key={initialLink} initialLink={initialLink} onPaired={onPaired} onCancel={paired ? close : undefined} />
          </>
        ) : (
          <>
            {status === 'offline' && error && <p className="text-warn">{t('settings.remote.offline')}</p>}
            {status === 'unsupported' && <p className="text-danger">{t('settings.remote.unsupported')}</p>}
            <div className="flex flex-wrap gap-2">
              {status !== 'online' && (
                <Button size="sm" variant="soft" icon={<RefreshCw size={13} />} disabled={status === 'connecting'} onClick={() => syncClient?.reconnect()}>
                  {t('settings.remote.reconnect')}
                </Button>
              )}
              <Button size="sm" variant="ghost" icon={<Link2 size={13} />} onClick={() => setForm(true)}>
                {t('settings.remote.pairOther')}
              </Button>
              <Button size="sm" variant="ghost" icon={<Unlink size={13} />} onClick={() => void unpair()}>
                {t('settings.remote.unpairButton')}
              </Button>
            </div>
            <p className="text-muted">
              {t('settings.remote.fingerprint')} <span className="font-mono">{keyFingerprint(pairing.bridgeKey)}</span>
              {pairing.trust === 'code' && t('settings.remote.codeTrust')}
            </p>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * 이 기기 프로필에 저장한 학습(IndexedDB)이 있으면 알려 준다 (ADR-103).
 * [이 기기에서 쓰기]로 돌아가 이어 쓰거나, 파일로 내보내 PC 앱의 설정 → 백업 → [파일 가져오기]로 옮길 수 있다.
 */
function OldDataCard() {
  const [count, setCount] = useState(0);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    persistence
      .loadAll()
      .then((raw) => alive && setCount(Object.values(raw?.sessions ?? {}).filter((s) => !s.parentId).length))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  if (!count) return null;

  const exportOld = async () => {
    setNote(null);
    try {
      const raw = await persistence.loadAll();
      if (!raw) return;
      const snap = createSnapshot(raw);
      await saveTextFile(backupFileName(snap.createdAt, false), await serializeBackup(snap), 'application/json');
      setNote(t('settings.remote.exported'));
    } catch {
      setNote(t('settings.remote.exportFailed'));
    }
  };

  return (
    <Section
      title={t('settings.remote.oldTitle')}
      hint={t('settings.remote.oldHint', {
        count,
        device: caps.kind === 'mobile' ? t('settings.remote.phone') : t('settings.remote.browser'),
      })}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="soft" icon={<Smartphone size={14} />} onClick={chooseThisDevice}>
          {t('settings.remote.useThisDevice')}
        </Button>
        <Button size="sm" icon={<Download size={14} />} onClick={() => void exportOld()}>
          {t('settings.remote.exportFile')}
        </Button>
      </div>
      {note && <p className="text-[12.5px] text-fg-2">{note}</p>}
    </Section>
  );
}

function RemoteNote() {
  const items = [
    t('settings.remote.note1'),
    t('settings.remote.note2'),
    t('settings.remote.note3'),
    t('settings.remote.note4'),
  ];
  return (
    <div className="flex gap-2.5 rounded-xl bg-surface-2 p-3.5 text-[12.5px] leading-relaxed text-fg-2">
      <Info size={17} className="mt-0.5 shrink-0 text-accent" />
      <div>
        <p className="font-medium text-fg">{t('settings.remote.howTitle')}</p>
        <ul className="mt-1 list-disc space-y-0.5 pl-4">
          {items.map((text) => (
            <li key={text}>{text}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}
