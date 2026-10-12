import { createSnapshot, keyFingerprint, remoteRoute, serializeBackup, backupFileName, type RemotePairing } from '@branch/core';
import { Download, Info, Laptop, Link2, RefreshCw, Unlink } from 'lucide-react';
import { useEffect, useState } from 'react';
import { caps } from '../app/capabilities';
import { useRuntime } from '../app/runtime';
import { actions, persistence, useApp } from '../app/store';
import { setPairing, syncClient, useRemotePairing, useSync } from '../app/sync';
import { useUi } from '../app/uiState';
import { StatusDot } from '../components/Badge';
import { Button } from '../components/Button';
import { confirm } from '../components/ConfirmDialog';
import { PC_STATUS_LABEL } from '../components/PcStatus';
import { saveTextFile } from '../lib/download';
import { Field, Section, Segmented } from './controls';
import { PairForm } from './connectionCards';

/**
 * 원격 전용 설정 (웹·모바일, ADR-026).
 * 학습 데이터·에이전트·모델은 모두 PC가 정하므로, 이 기기에서는 연결된 PC와 화면 설정만 다룬다.
 */
export function RemoteSettings() {
  const settings = useApp((s) => s.settings);
  return (
    <div className="space-y-6">
      <Section title="연결된 PC" hint="이 기기는 PC의 학습 내용을 보여 주고, 질문은 PC로 보내요. 답변은 PC의 CLI가 만들어요.">
        <PcCard />
      </Section>

      <Section title="화면">
        <Field label="테마">
          <Segmented
            value={settings.theme}
            options={[
              ['system', '시스템'],
              ['light', '라이트'],
              ['dark', '다크'],
            ]}
            onChange={(v) => actions().setTheme(v)}
          />
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
      </Section>

      <OldDataCard />
      <RemoteNote />
    </div>
  );
}

const TONE = { online: 'ok', connecting: 'warn', offline: 'danger', unpaired: 'neutral', unsupported: 'danger' } as const;

/** 연결된 PC 카드: 상태·지문·경로 + 다시 연결/해제, 미페어링이면 페어링 폼 */
function PcCard() {
  const demo = useRuntime((s) => s.demo);
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
      title: 'PC 연결을 해제할까요?',
      message: 'PC의 학습 내용은 그대로 남아요. 다시 쓰려면 PC에서 새 페어링 코드를 받아야 해요.',
      confirmLabel: '연결 해제',
      tone: 'danger',
    });
    if (ok) await setPairing(null);
  };

  if (demo) {
    return (
      <div className="rounded-xl border border-line bg-surface p-3.5 text-[12.5px] text-fg-2">
        데모 모드에서는 PC 대신 예시 데이터로 동작해요. 데모를 끝내면 PC 연결로 돌아가요.
      </div>
    );
  }

  const paired = !!pairing && status !== 'unpaired';
  return (
    <div className="rounded-xl border border-line bg-surface p-3.5">
      <div className="flex items-center gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-surface-2 text-fg-2">
          <Laptop size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[14px] font-medium">{paired ? (hostName ?? pairing.bridgeName) : '페어링한 PC 없음'}</div>
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
                <li>PC에서 rhymebook 앱을 열고 설정 → 연결 → [원격 페어링 열기]를 켜요.</li>
                <li>[휴대폰·웹 연결]을 누르면 QR과 6자리 코드가 나와요.</li>
                <li>아래에서 QR을 찍거나 링크·주소와 코드를 입력해요.</li>
              </ol>
            )}
            <PairForm key={initialLink} initialLink={initialLink} onPaired={onPaired} onCancel={paired ? close : undefined} />
          </>
        ) : (
          <>
            {status === 'offline' && error && <p className="text-warn">PC에 연결하지 못했어요. PC 앱이 켜져 있고 원격 페어링이 열려 있는지 확인하세요.</p>}
            {status === 'unsupported' && <p className="text-danger">PC의 rhymebook 앱이 원격 학습을 지원하지 않아요. PC 앱을 최신 버전으로 업데이트하세요.</p>}
            <div className="flex flex-wrap gap-2">
              {status !== 'online' && (
                <Button size="sm" variant="soft" icon={<RefreshCw size={13} />} disabled={status === 'connecting'} onClick={() => syncClient?.reconnect()}>
                  다시 연결
                </Button>
              )}
              <Button size="sm" variant="ghost" icon={<Link2 size={13} />} onClick={() => setForm(true)}>
                다른 PC와 페어링
              </Button>
              <Button size="sm" variant="ghost" icon={<Unlink size={13} />} onClick={() => void unpair()}>
                연결 해제
              </Button>
            </div>
            <p className="text-muted">
              PC 지문 <span className="font-mono">{keyFingerprint(pairing.bridgeKey)}</span>
              {pairing.trust === 'code' && ' · 코드로 연결했어요. PC 화면의 지문과 같은지 확인하세요.'}
            </p>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * 원격 전용 이전에 이 기기에 저장해 둔 학습(IndexedDB)이 있으면 파일로 내보낸다.
 * 내보낸 파일은 PC 앱의 설정 → 백업 → [파일 가져오기]로 옮길 수 있다.
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
      setNote('파일로 내보냈어요. PC 앱의 설정 → 백업 → [파일 가져오기]로 옮길 수 있어요.');
    } catch {
      setNote('내보내지 못했어요. 다시 시도해 주세요.');
    }
  };

  return (
    <Section title="이 기기에 남아 있는 이전 학습" hint={`원격 전용으로 바뀌기 전 이 ${caps.kind === 'mobile' ? '휴대폰' : '브라우저'}에 저장한 학습 ${count}개가 있어요. 지금은 화면에 나오지 않아요.`}>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" icon={<Download size={14} />} onClick={() => void exportOld()}>
          파일로 내보내기
        </Button>
      </div>
      {note && <p className="text-[12.5px] text-fg-2">{note}</p>}
    </Section>
  );
}

function RemoteNote() {
  const items = [
    '학습 기록은 PC에만 저장되고, 이 기기는 연결되어 있는 동안 PC의 내용을 보여 줘요.',
    '질문·가지·요약은 PC로 보내고, 답변은 PC에 로그인된 공식 CLI가 만들어요. 에이전트·모델은 PC 설정을 따라요.',
    'PC에서 진행 중인 답변과 요약 초안도 함께 보여요. PC와 이 기기에서 동시에 볼 수 있어요.',
    '연결은 기기 키로 서명하고 종단간 암호화해요. relay를 거쳐도 내용은 보이지 않아요.',
  ];
  return (
    <div className="flex gap-2.5 rounded-xl bg-surface-2 p-3.5 text-[12.5px] leading-relaxed text-fg-2">
      <Info size={17} className="mt-0.5 shrink-0 text-accent" />
      <div>
        <p className="font-medium text-fg">원격 학습은 이렇게 동작해요</p>
        <ul className="mt-1 list-disc space-y-0.5 pl-4">
          {items.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}
