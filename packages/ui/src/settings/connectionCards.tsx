import {
  ANTHROPIC_DEFAULT_MODEL,
  CLI_MODEL_PRESETS,
  EFFORT_LABELS,
  effortsFor,
  isValidModelName,
  keyFingerprint,
  maskSecret,
  normalizeBridgeUrl,
  OPENAI_DEFAULT_MODEL,
  pairWithBridge,
  parsePairingUri,
  RemoteBridgeError,
  secretName,
  verifyAnthropicKey,
  verifyOpenAIKey,
  type ConnectionState,
  type PairingOffer,
  type ProviderId,
  type RemotePairing,
} from '@branch/core';
import { Laptop, KeyRound, RefreshCw, ScanLine, ShieldCheck, Smartphone, TerminalSquare, TriangleAlert } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { caps } from '../app/capabilities';
import { baseUrls, desktop, isDemo, mobile, loadRemotePairing, saveRemotePairing, secrets } from '../app/runtime';
import { actions, useApp } from '../app/store';
import { useUi } from '../app/uiState';
import { Badge, StatusDot } from '../components/Badge';
import { Button } from '../components/Button';
import { cn } from '../lib/cn';
import { providerLabel, STATUS_LABEL, statusTone } from '../lib/connection';
import { t, tx } from '../i18n';
import { Segmented, Toggle } from './controls';

/**
 * 연결 카드 모음 (설정 → 연결, 첫 실행 안내에서 함께 쓴다).
 * 플랫폼별 노출은 caps(ADR-025)를 따른다: CLI 카드는 데스크톱 전용, 웹·모바일은 모델 선택 없음.
 */

export function useConn(id: ProviderId): ConnectionState {
  return useApp((s) => s.connections[id]);
}

export function CardShell({ id, icon, children }: { id: ProviderId; icon: ReactNode; children?: ReactNode }) {
  const c = useConn(id);
  const isDefault = useApp((s) => s.settings.defaultProviderId === id);
  return (
    <div className={cn('rounded-xl border bg-surface p-3.5', c.enabled ? 'border-line' : 'border-dashed border-line')}>
      <div className="flex items-center gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-surface-2 text-fg-2">{icon}</span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[14.5px] font-medium">{providerLabel(id)}</span>
            {isDefault && <Badge tone="accent">{t('settings.card.defaultBadge')}</Badge>}
          </div>
          <div className="flex items-center gap-1.5 text-[12.5px] text-muted">
            <StatusDot tone={statusTone(c)} />
            <span className="shrink-0 whitespace-nowrap">{c.enabled || c.status !== 'ready' ? STATUS_LABEL[c.status] : t('settings.card.off')}</span>
            {c.detail && <span className="min-w-0 truncate">· {c.detail}</span>}
          </div>
        </div>
        <Toggle
          checked={c.enabled}
          label={t('settings.card.useLabel', { label: providerLabel(id) })}
          onChange={(enabled) => actions().setConnection(id, { enabled })}
        />
      </div>
      {children && <div className="mt-3 border-t border-line pt-3">{children}</div>}
    </div>
  );
}

/** 데모 모드의 목업 CLI 감지 결과 (실제 감지는 플랫폼 provider의 available()). 번역은 렌더·실행 때 읽는다 */
function cliMock(id: 'claude-cli' | 'codex-cli'): Pick<ConnectionState, 'status' | 'detail'> {
  return id === 'claude-cli'
    ? { status: 'ready', detail: t('settings.card.mockClaudeDetail') }
    : { status: 'not-logged-in', detail: 'codex 0.48.0' };
}

export function CliCard({ id, install, login }: { id: 'claude-cli' | 'codex-cli'; install: string; login: string }) {
  const c = useConn(id);
  const detect = () => {
    if (!isDemo()) {
      void actions().refreshConnections([id]);
      return;
    }
    actions().setConnection(id, { status: 'checking', detail: t('settings.card.mockChecking') });
    window.setTimeout(() => actions().setConnection(id, cliMock(id)), 800);
  };
  return (
    <CardShell id={id} icon={<TerminalSquare size={18} />}>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" icon={<RefreshCw size={14} className={c.status === 'checking' ? 'animate-spin' : ''} />} onClick={detect} disabled={c.status === 'checking'}>
          {t('settings.card.redetect')}
        </Button>
        {c.status === 'not-installed' && <Hint label={t('settings.card.install')} cmd={install} />}
        {c.status === 'not-logged-in' && <Hint label={t('settings.card.login')} cmd={login} />}
        {c.status === 'offline' && <span className="text-[12.5px] text-danger">{t('settings.card.cliOffline')}</span>}
        {c.status === 'ready' && <span className="text-[12.5px] text-muted">{t('settings.card.cliReady')}</span>}
      </div>
      <CliDefaults id={id} model={c.model} effort={c.effort} />
    </CardShell>
  );
}

const CUSTOM = '__custom__';

/** CLI 기본 모델·노력치. 채팅에서 고른 값이 없으면 이 값을 쓴다 */
function CliDefaults({ id, model, effort }: { id: 'claude-cli' | 'codex-cli'; model?: string; effort?: string }) {
  const presets = CLI_MODEL_PRESETS[id];
  const isPreset = !!model && presets.some((p) => p.id === model);
  const [custom, setCustom] = useState(!!model && !isPreset);
  const [bad, setBad] = useState(false);
  const efforts = effortsFor(id, model);
  const label = providerLabel(id);
  const setModel = (m: string | undefined) => {
    // 바뀐 모델이 지원하지 않는 노력치는 비운다
    const keep = effort && effortsFor(id, m).includes(effort);
    actions().setConnection(id, { model: m, ...(keep ? {} : { effort: undefined }) });
  };
  const selectCls = 'h-8 min-w-0 flex-1 rounded-lg border border-line bg-bg px-2 text-[12.5px] text-fg outline-none focus:border-accent';
  return (
    <div className="mt-3 grid gap-2 border-t border-line pt-3 text-[12.5px] text-muted">
      <label className="flex items-center gap-2">
        <span className="w-14 shrink-0">{t('settings.card.defaultModel')}</span>
        <select
          aria-label={t('settings.card.ariaDefaultModel', { label })}
          value={custom ? CUSTOM : (model ?? '')}
          onChange={(e) => {
            const v = e.target.value;
            setBad(false);
            if (v === CUSTOM) {
              setCustom(true);
              return;
            }
            setCustom(false);
            setModel(v || undefined);
          }}
          className={selectCls}
        >
          <option value="">{t('settings.card.cliDefault')}</option>
          {presets.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label} ({p.id})
            </option>
          ))}
          <option value={CUSTOM}>{t('settings.card.custom')}</option>
        </select>
      </label>
      {custom && (
        <label className="flex items-center gap-2">
          <span className="w-14 shrink-0">{t('settings.card.modelName')}</span>
          <input
            key={model ?? ''}
            defaultValue={isPreset ? '' : (model ?? '')}
            placeholder={id === 'claude-cli' ? 'claude-opus-5-5' : 'gpt-6.1-sol'}
            onBlur={(e) => {
              const v = e.target.value.trim();
              if (v && !isValidModelName(v)) {
                setBad(true);
                return;
              }
              setBad(false);
              setModel(v || undefined);
            }}
            aria-label={t('settings.card.ariaModelName', { label })}
            aria-invalid={bad}
            autoComplete="off"
            spellCheck={false}
            className={cn(
              'h-8 min-w-0 flex-1 rounded-lg border bg-bg px-2.5 font-mono text-[12.5px] text-fg outline-none placeholder:text-muted focus:border-accent',
              bad ? 'border-danger' : 'border-line',
            )}
          />
        </label>
      )}
      {bad && <p className="text-[12px] text-danger">{t('settings.card.invalidModel')}</p>}
      <label className="flex items-center gap-2">
        <span className="w-14 shrink-0">{t('settings.card.effort')}</span>
        <select
          aria-label={t('settings.card.ariaEffort', { label })}
          value={effort && efforts.includes(effort) ? effort : ''}
          onChange={(e) => actions().setConnection(id, { effort: e.target.value || undefined })}
          className={selectCls}
        >
          <option value="">{t('settings.card.cliDefault')}</option>
          {efforts.map((x) => (
            <option key={x} value={x}>
              {EFFORT_LABELS[x] ?? x} ({x})
            </option>
          ))}
        </select>
      </label>
      <p className="text-[12px]">{t('settings.card.effortHint')}</p>
    </div>
  );
}

function Hint({ label, cmd }: { label: string; cmd: string }) {
  return (
    <span className="text-[12.5px] text-fg-2">
      {tx('settings.card.hintLine', {
        label,
        cmd: <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[12px]">{cmd}</code>,
      })}
    </span>
  );
}

const API_META = {
  'anthropic-api': { model: ANTHROPIC_DEFAULT_MODEL, verify: verifyAnthropicKey },
  'openai-api': { model: OPENAI_DEFAULT_MODEL, verify: verifyOpenAIKey },
} as const;

export function ApiCard({ id, prefix }: { id: 'anthropic-api' | 'openai-api'; prefix: string }) {
  const c = useConn(id);
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ tone: 'danger' | 'warn'; text: string } | null>(null);
  // 키 유무는 연결 상태로 판단한다 (키를 바꾸면 상태가 갱신되어 다시 렌더된다)
  const hasKey = isDemo() ? c.status === 'ready' : c.status !== 'no-key';

  const save = async () => {
    const k = key.trim();
    if (!k || busy) return;
    setNote(null);
    if (isDemo()) {
      actions().setConnection(id, { status: 'ready', enabled: true, detail: maskSecret(k) });
      setKey('');
      return;
    }
    // 키는 SecretStore(웹: 탭 메모리, 데스크톱: OS 보안 저장소)에 둔다. 상태/로그에는 마스킹된 값만 남긴다
    setBusy(true);
    actions().setConnection(id, { status: 'checking', detail: t('settings.card.keyChecking') });
    const r = await API_META[id].verify(k, { baseUrl: baseUrls[id] });
    if (!r.ok && r.error.code === 'auth') {
      setNote({ tone: 'danger', text: r.error.message });
      await actions().refreshConnections([id]);
    } else {
      secrets.set(secretName.apiKey(id), k);
      actions().setConnection(id, { enabled: true });
      await actions().refreshConnections([id]);
      if (!r.ok) setNote({ tone: 'warn', text: t('settings.card.keyUnverified', { message: r.error.message }) });
      setKey('');
    }
    setBusy(false);
  };

  const remove = () => {
    setNote(null);
    if (isDemo()) {
      actions().setConnection(id, { status: 'no-key', enabled: false, detail: undefined });
      return;
    }
    secrets.delete(secretName.apiKey(id));
    void actions().refreshConnections([id]);
  };

  return (
    <CardShell id={id} icon={<KeyRound size={18} />}>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <input
          type="password"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder={hasKey ? t('settings.card.keyReplace') : `${prefix}…`}
          aria-label={t('settings.card.keyAria', { label: providerLabel(id) })}
          autoComplete="off"
          className="h-9 min-w-0 flex-1 rounded-lg border border-line bg-bg px-3 font-mono text-[13px] outline-none placeholder:font-sans focus:border-accent"
        />
        <Button size="sm" variant="primary" type="submit" disabled={!key.trim() || busy} className="h-9">
          {busy ? t('settings.card.checking') : t('common.save')}
        </Button>
        {hasKey && (
          <Button size="sm" variant="ghost" className="h-9" onClick={remove}>
            {t('common.delete')}
          </Button>
        )}
      </form>
      {note && <p className={cn('mt-2 text-[12.5px]', note.tone === 'danger' ? 'text-danger' : 'text-warn')}>{note.text}</p>}
      {caps.modelChoice ? (
        <label className="mt-2 flex items-center gap-2 text-[12.5px] text-muted">
          <span className="shrink-0">{t('settings.card.model')}</span>
          <input
            key={c.model ?? ''}
            defaultValue={c.model ?? ''}
            placeholder={API_META[id].model}
            onBlur={(e) => actions().setConnection(id, { model: e.target.value.trim() || undefined })}
            aria-label={t('settings.card.ariaModel', { label: providerLabel(id) })}
            autoComplete="off"
            spellCheck={false}
            className="h-8 min-w-0 flex-1 rounded-lg border border-line bg-bg px-2.5 font-mono text-[12.5px] text-fg outline-none placeholder:text-muted focus:border-accent"
          />
        </label>
      ) : (
        <p className="mt-2 text-[12.5px] text-muted">
          {tx('settings.card.modelFixed', { model: <span className="font-mono text-fg-2">{API_META[id].model}</span> })}
        </p>
      )}
      {secrets.kind === 'os' ? (
        <p className="mt-2 flex items-start gap-1.5 text-[12px] text-muted">
          <ShieldCheck size={13} className="mt-0.5 shrink-0" />
          {t('settings.card.keyOsNote')}
        </p>
      ) : (
        <p className="mt-2 flex items-start gap-1.5 text-[12px] text-warn">
          <TriangleAlert size={13} className="mt-0.5 shrink-0" />
          {desktop || mobile ? t('settings.card.keyMemoryNative') : t('settings.card.keyMemoryWeb')}
        </p>
      )}
    </CardShell>
  );
}

function deviceLabel(): string {
  const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent;
  const os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Mac/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : t('settings.card.deviceOther');
  const app = desktop ? t('settings.card.appDesktop') : mobile ? t('settings.card.appMobile') : t('settings.card.appBrowser');
  return `${os} ${app}`;
}

const BRIDGE_IDS: ProviderId[] = ['remote-bridge'];

export function BridgeCard() {
  const c = useConn('remote-bridge');
  const [form, setForm] = useState(false);
  const [initialLink, setInitialLink] = useState('');
  const [pairing, setPairing] = useState<RemotePairing | null>(null);
  const paired = c.status !== 'unpaired';
  const pairLink = useUi((s) => s.pairLink);

  // 딥링크(branch://pair)로 열렸으면 링크 폼을 채워 둔다. 연결은 사용자가 지문을 보고 누른다
  useEffect(() => {
    if (!pairLink) return;
    useUi.setState({ pairLink: null });
    setInitialLink(pairLink);
    setForm(true);
  }, [pairLink]);

  useEffect(() => {
    if (isDemo()) return;
    let alive = true;
    void loadRemotePairing().then((p) => alive && setPairing(p));
    return () => {
      alive = false;
    };
  }, [c.status]);

  const close = () => {
    setForm(false);
    setInitialLink('');
  };

  const onPaired = async (p: RemotePairing | null) => {
    if (!p) {
      actions().setConnection('remote-bridge', { status: 'ready', enabled: true, detail: t('settings.card.mockBridgeDetail') });
      close();
      return;
    }
    await saveRemotePairing(p);
    actions().setConnection('remote-bridge', { enabled: true });
    setPairing(p);
    close();
    await actions().refreshConnections(BRIDGE_IDS);
  };

  const unpair = async () => {
    if (isDemo()) {
      actions().setConnection('remote-bridge', { status: 'unpaired', enabled: false, detail: undefined });
      return;
    }
    await saveRemotePairing(null);
    setPairing(null);
    await actions().refreshConnections(BRIDGE_IDS);
  };

  return (
    <CardShell id="remote-bridge" icon={<Laptop size={18} />}>
      {form ? (
        <PairForm key={initialLink} initialLink={initialLink} onPaired={onPaired} onCancel={close} />
      ) : paired ? (
        <div className="space-y-2 text-[12.5px] text-fg-2">
          <div className="flex flex-wrap items-center gap-2">
            {c.status !== 'ready' && (
              <Button size="sm" variant="soft" icon={<RefreshCw size={13} />} onClick={() => void actions().refreshConnections(BRIDGE_IDS)}>
                {t('settings.card.reconnect')}
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={() => void unpair()}>
              {t('settings.card.disconnect')}
            </Button>
          </div>
          {pairing && <FingerprintNote pairing={pairing} />}
        </div>
      ) : (
        <div className="space-y-2 text-[12.5px] text-fg-2">
          <p>{t('settings.card.bridgeIntro')}</p>
          <Button size="sm" variant="soft" icon={<Smartphone size={14} />} onClick={() => setForm(true)}>
            {t('settings.card.startPairing')}
          </Button>
        </div>
      )}
    </CardShell>
  );
}

export function FingerprintNote({ pairing }: { pairing: RemotePairing }) {
  return (
    <p className="text-muted">
      {tx('settings.card.fingerprint', { fp: <span className="font-mono">{keyFingerprint(pairing.bridgeKey)}</span> })}
      {pairing.trust === 'code' && t('settings.card.codeTrust')}
    </p>
  );
}

/**
 * 페어링 폼 (링크/QR 또는 주소+코드). 성공하면 onPaired(페어링)를 부른다.
 * 데모 모드에서는 실제로 연결하지 않고 onPaired(null)을 부른다.
 */
export function PairForm({
  initialLink = '',
  onPaired,
  onCancel,
}: {
  initialLink?: string;
  onPaired(p: RemotePairing | null): Promise<void> | void;
  onCancel?(): void;
}) {
  const [mode, setMode] = useState<'link' | 'code'>('link');
  const [link, setLink] = useState(initialLink);
  const [addr, setAddr] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ tone: 'danger' | 'warn'; text: string } | null>(null);

  const pair = async () => {
    if (busy) return;
    setNote(null);
    let offer: PairingOffer | null;
    if (mode === 'link') {
      offer = parsePairingUri(link);
      if (!offer) return setNote({ tone: 'danger', text: t('settings.card.linkInvalid') });
    } else {
      const url = normalizeBridgeUrl(addr);
      const token = code.replace(/\s+/g, '');
      if (!url) return setNote({ tone: 'danger', text: t('settings.card.addrInvalid') });
      if (!/^\d{6}$/.test(token)) return setNote({ tone: 'danger', text: t('settings.card.codeInvalid') });
      offer = { url, token };
    }
    if (isDemo()) return void (await onPaired(null));
    setBusy(true);
    try {
      const p = await pairWithBridge({ offer, deviceName: deviceLabel(), wsFactory: (url) => new WebSocket(url) });
      await onPaired(p);
    } catch (e) {
      setNote({ tone: 'danger', text: e instanceof RemoteBridgeError ? e.message : t('settings.card.pairFailed') });
    } finally {
      setBusy(false);
    }
  };

  // 앱 안 카메라로 QR을 읽어 링크 칸을 채운다. 지문 확인 후 연결은 사용자가 누른다
  const scan = async () => {
    setNote(null);
    try {
      const text = await mobile?.scanQr?.();
      if (!text) return;
      if (!parsePairingUri(text)) return setNote({ tone: 'danger', text: t('settings.card.scanInvalid') });
      setLink(text);
    } catch {
      setNote({ tone: 'danger', text: t('settings.card.cameraFailed') });
    }
  };

  const input =
    'h-9 min-w-0 rounded-lg border border-line bg-bg px-3 font-mono text-[13px] outline-none placeholder:font-sans focus:border-accent';

  return (
    <form
      className="space-y-2.5 text-[12.5px] text-fg-2"
      onSubmit={(e) => {
        e.preventDefault();
        void pair();
      }}
    >
      <Segmented
        value={mode}
        options={[
          ['link', t('settings.card.modeLink')],
          ['code', t('settings.card.modeCode')],
        ]}
        onChange={(m) => {
          setMode(m);
          setNote(null);
        }}
      />
      {mode === 'link' ? (
        <>
          <p>{mobile?.scanQr ? t('settings.card.linkHintScan') : t('settings.card.linkHint')}</p>
          <div className="flex gap-2">
            <input
              value={link}
              onChange={(e) => setLink(e.target.value)}
              placeholder="branch://pair?u=…"
              aria-label={t('settings.card.ariaLink')}
              autoComplete="off"
              spellCheck={false}
              className={cn(input, 'flex-1')}
            />
            {mobile?.scanQr && (
              <Button size="sm" className="h-9" icon={<ScanLine size={14} />} onClick={() => void scan()} disabled={busy}>
                {t('settings.card.scanQr')}
              </Button>
            )}
          </div>
        </>
      ) : (
        <>
          <p>{t('settings.card.codeHint')}</p>
          <div className="flex flex-wrap gap-2">
            <input
              value={addr}
              onChange={(e) => setAddr(e.target.value)}
              placeholder="100.64.0.1:7777"
              aria-label={t('settings.card.ariaAddr')}
              autoComplete="off"
              spellCheck={false}
              className={cn(input, 'flex-[2_1_10rem]')}
            />
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="123 456"
              aria-label={t('settings.card.ariaCode')}
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={7}
              className={cn(input, 'flex-[1_1_6rem] tracking-[0.2em]')}
            />
          </div>
        </>
      )}
      {note && <p className={cn(note.tone === 'danger' ? 'text-danger' : 'text-warn')}>{note.text}</p>}
      <div className="flex gap-2">
        <Button size="sm" variant="primary" type="submit" disabled={busy || (mode === 'link' ? !link.trim() : !addr.trim() || !code.trim())}>
          {busy ? t('settings.card.connecting') : t('settings.card.connect')}
        </Button>
        {onCancel && (
          <Button size="sm" variant="ghost" onClick={onCancel}>
            {t('common.cancel')}
          </Button>
        )}
      </div>
      <p className="text-muted">{t('settings.card.oneTimeNote')}</p>
      {secrets.kind !== 'os' && (
        <p className="flex items-start gap-1.5 text-[12px] text-warn">
          <TriangleAlert size={13} className="mt-0.5 shrink-0" />
          {t('settings.card.webKeyNote')}
        </p>
      )}
    </form>
  );
}

export function PolicyNote() {
  const items = [
    t('settings.card.policy1'),
    t('settings.card.policy2'),
    t('settings.card.policy3'),
    t('settings.card.policy4'),
  ];
  return (
    <div className="flex gap-2.5 rounded-xl bg-surface-2 p-3.5 text-[12.5px] leading-relaxed text-fg-2">
      <ShieldCheck size={17} className="mt-0.5 shrink-0 text-accent" />
      <div>
        <p className="font-medium text-fg">{t('settings.card.policyTitle')}</p>
        <ul className="mt-1 list-disc space-y-0.5 pl-4">
          {items.map((text) => (
            <li key={text}>{text}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}
