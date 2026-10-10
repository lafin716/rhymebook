import {
  ANTHROPIC_DEFAULT_MODEL,
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
import {
  ArrowDown,
  ArrowUp,
  Bot,
  KeyRound,
  Laptop,
  RefreshCw,
  ScanLine,
  ShieldCheck,
  Smartphone,
  TerminalSquare,
  TriangleAlert,
  X,
} from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { baseUrls, desktop, isDemo, mobile, loadRemotePairing, saveRemotePairing, secrets } from '../app/runtime';
import { actions, useApp } from '../app/store';
import { useUi } from '../app/uiState';
import { Badge, StatusDot } from '../components/Badge';
import { Button, IconButton } from '../components/Button';
import { Modal } from '../components/Modal';
import { cn } from '../lib/cn';
import { Field, Section, Segmented, Toggle } from './controls';
import { BackupTab } from './BackupTab';
import { providerKind, providerLabel, STATUS_LABEL, statusTone } from '../lib/connection';

type Tab = 'connections' | 'backup' | 'general';

export function SettingsModal() {
  const open = useApp((s) => s.overlay === 'settings');
  const [tab, setTab] = useState<Tab>('connections');
  const pairLink = useUi((s) => s.pairLink);
  const close = () => actions().setOverlay('none');
  if (pairLink && tab !== 'connections') setTab('connections');
  return (
    <Modal open={open} onClose={close} label="설정" className="md:max-w-2xl">
      <div className="flex h-13 shrink-0 items-center gap-2 border-b border-line px-4">
        <h2 className="flex-1 text-[16px] font-semibold">설정</h2>
        <IconButton label="설정 닫기" onClick={close}>
          <X size={18} />
        </IconButton>
      </div>
      <div role="tablist" className="flex shrink-0 gap-1 border-b border-line px-3">
        {(
          [
            ['connections', '연결'],
            ['backup', '백업'],
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
        {tab === 'connections' ? <ConnectionsTab /> : tab === 'backup' ? <BackupTab /> : <GeneralTab />}
      </div>
    </Modal>
  );
}

/* ── 연결 탭 ───────────────────────────────────────────── */

function ConnectionsTab() {
  return (
    <div className="space-y-5">
      <Section title="구독 계정 (내 PC의 공식 CLI)" hint="이 기기에 설치·로그인된 공식 CLI를 그대로 실행합니다. 데스크톱 앱 또는 원격 Bridge에서 사용할 수 있어요.">
        <CliCard id="claude-cli" install="npm i -g @anthropic-ai/claude-code" login="claude auth login" />
        <CliCard id="codex-cli" install="npm i -g @openai/codex" login="codex login" />
      </Section>
      <Section title="API 키" hint="공개 배포의 기본 연결 방식입니다.">
        <ApiCard id="anthropic-api" prefix="sk-ant-" />
        <ApiCard id="openai-api" prefix="sk-" />
      </Section>
      <Section title="원격 Bridge" hint="집 PC의 CLI를 휴대폰·웹에서 쓰려면 PC에서 bridge를 실행하고 페어링하세요.">
        <BridgeCard />
      </Section>
      <Section title="데모">
        <CardShell id="mock" icon={<Bot size={18} />} />
      </Section>
      <PolicyNote />
    </div>
  );
}


function useConn(id: ProviderId): ConnectionState {
  return useApp((s) => s.connections[id]);
}

function CardShell({ id, icon, children }: { id: ProviderId; icon: ReactNode; children?: ReactNode }) {
  const c = useConn(id);
  const isDefault = useApp((s) => s.settings.defaultProviderId === id);
  return (
    <div className={cn('rounded-xl border bg-surface p-3.5', c.enabled ? 'border-line' : 'border-dashed border-line')}>
      <div className="flex items-center gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-surface-2 text-fg-2">{icon}</span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[14.5px] font-medium">{providerLabel(id)}</span>
            {isDefault && <Badge tone="accent">기본</Badge>}
          </div>
          <div className="flex items-center gap-1.5 text-[12.5px] text-muted">
            <StatusDot tone={statusTone(c)} />
            <span className="shrink-0 whitespace-nowrap">{c.enabled || c.status !== 'ready' ? STATUS_LABEL[c.status] : '꺼짐'}</span>
            {c.detail && <span className="min-w-0 truncate">· {c.detail}</span>}
          </div>
        </div>
        <Toggle
          checked={c.enabled}
          label={`${providerLabel(id)} 사용`}
          onChange={(enabled) => actions().setConnection(id, { enabled })}
        />
      </div>
      {children && <div className="mt-3 border-t border-line pt-3">{children}</div>}
    </div>
  );
}


/** 데모 모드의 목업 CLI 감지 결과 (실제 감지는 플랫폼 provider의 available()) */
const CLI_MOCK: Record<'claude-cli' | 'codex-cli', Pick<ConnectionState, 'status' | 'detail'>> = {
  'claude-cli': { status: 'ready', detail: 'claude 2.1.4 · 로그인됨' },
  'codex-cli': { status: 'not-logged-in', detail: 'codex 0.48.0' },
};

function CliCard({ id, install, login }: { id: 'claude-cli' | 'codex-cli'; install: string; login: string }) {
  const c = useConn(id);
  const detect = () => {
    if (!isDemo()) {
      void actions().refreshConnections([id]);
      return;
    }
    actions().setConnection(id, { status: 'checking', detail: 'PATH에서 찾는 중…' });
    window.setTimeout(() => actions().setConnection(id, CLI_MOCK[id]), 800);
  };
  return (
    <CardShell id={id} icon={<TerminalSquare size={18} />}>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" icon={<RefreshCw size={14} className={c.status === 'checking' ? 'animate-spin' : ''} />} onClick={detect} disabled={c.status === 'checking'}>
          다시 감지
        </Button>
        {c.status === 'not-installed' && <Hint label="설치" cmd={install} />}
        {c.status === 'not-logged-in' && <Hint label="로그인" cmd={login} />}
        {c.status === 'offline' && <span className="text-[12.5px] text-danger">CLI 프로세스에 연결할 수 없어요. 앱을 재시작하거나 bridge를 확인하세요.</span>}
        {c.status === 'ready' && <span className="text-[12.5px] text-muted">도구 비활성화 · 매 요청 무상태 실행</span>}
      </div>
    </CardShell>
  );
}

function Hint({ label, cmd }: { label: string; cmd: string }) {
  return (
    <span className="text-[12.5px] text-fg-2">
      {label}: <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[12px]">{cmd}</code>
    </span>
  );
}

const API_META = {
  'anthropic-api': { model: ANTHROPIC_DEFAULT_MODEL, verify: verifyAnthropicKey },
  'openai-api': { model: OPENAI_DEFAULT_MODEL, verify: verifyOpenAIKey },
} as const;

function ApiCard({ id, prefix }: { id: 'anthropic-api' | 'openai-api'; prefix: string }) {
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
    actions().setConnection(id, { status: 'checking', detail: '키 확인 중…' });
    const r = await API_META[id].verify(k, { baseUrl: baseUrls[id] });
    if (!r.ok && r.error.code === 'auth') {
      setNote({ tone: 'danger', text: r.error.message });
      await actions().refreshConnections([id]);
    } else {
      secrets.set(secretName.apiKey(id), k);
      actions().setConnection(id, { enabled: true });
      await actions().refreshConnections([id]);
      if (!r.ok) setNote({ tone: 'warn', text: `키를 저장했지만 확인하지 못했어요: ${r.error.message}` });
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
          placeholder={hasKey ? '새 키로 교체' : `${prefix}…`}
          aria-label={`${providerLabel(id)} 키`}
          autoComplete="off"
          className="h-9 min-w-0 flex-1 rounded-lg border border-line bg-bg px-3 font-mono text-[13px] outline-none placeholder:font-sans focus:border-accent"
        />
        <Button size="sm" variant="primary" type="submit" disabled={!key.trim() || busy} className="h-9">
          {busy ? '확인 중' : '저장'}
        </Button>
        {hasKey && (
          <Button size="sm" variant="ghost" className="h-9" onClick={remove}>
            삭제
          </Button>
        )}
      </form>
      {note && <p className={cn('mt-2 text-[12.5px]', note.tone === 'danger' ? 'text-danger' : 'text-warn')}>{note.text}</p>}
      <label className="mt-2 flex items-center gap-2 text-[12.5px] text-muted">
        <span className="shrink-0">모델</span>
        <input
          key={c.model ?? ''}
          defaultValue={c.model ?? ''}
          placeholder={API_META[id].model}
          onBlur={(e) => actions().setConnection(id, { model: e.target.value.trim() || undefined })}
          aria-label={`${providerLabel(id)} 모델`}
          autoComplete="off"
          spellCheck={false}
          className="h-8 min-w-0 flex-1 rounded-lg border border-line bg-bg px-2.5 font-mono text-[12.5px] text-fg outline-none placeholder:text-muted focus:border-accent"
        />
      </label>
      {secrets.kind === 'os' ? (
        <p className="mt-2 flex items-start gap-1.5 text-[12px] text-muted">
          <ShieldCheck size={13} className="mt-0.5 shrink-0" />
          키는 이 기기의 OS 보안 저장소에 암호화해 보관합니다.
        </p>
      ) : (
        <p className="mt-2 flex items-start gap-1.5 text-[12px] text-warn">
          <TriangleAlert size={13} className="mt-0.5 shrink-0" />
          {desktop || mobile
            ? '이 기기에서 OS 보안 저장소를 쓸 수 없어 키를 메모리에만 보관합니다. 앱을 다시 열면 지워집니다.'
            : '웹에서는 키를 이 탭의 메모리에만 보관하고 새로고침하면 지워집니다. 데스크톱·모바일 앱은 OS 보안 저장소에 저장합니다.'}
        </p>
      )}
    </CardShell>
  );
}

function deviceLabel(): string {
  const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent;
  const os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Mac/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : '기기';
  const app = desktop ? '데스크톱 앱' : mobile ? '앱' : '브라우저';
  return `${os} ${app}`;
}

const BRIDGE_IDS: ProviderId[] = ['remote-bridge', 'claude-cli', 'codex-cli'];

function BridgeCard() {
  const c = useConn('remote-bridge');
  const [form, setForm] = useState(false);
  const [mode, setMode] = useState<'link' | 'code'>('link');
  const [link, setLink] = useState('');
  const [addr, setAddr] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ tone: 'danger' | 'warn'; text: string } | null>(null);
  const [pairing, setPairing] = useState<RemotePairing | null>(null);
  const paired = c.status !== 'unpaired';
  const pairLink = useUi((s) => s.pairLink);

  // 딥링크(branch://pair)로 열렸으면 링크 폼을 채워 둔다. 연결은 사용자가 지문을 보고 누른다
  useEffect(() => {
    if (!pairLink) return;
    useUi.setState({ pairLink: null });
    setForm(true);
    setMode('link');
    setLink(pairLink);
    setNote(null);
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
    setNote(null);
    setLink('');
    setCode('');
  };

  const pair = async () => {
    if (busy) return;
    setNote(null);
    let offer: PairingOffer | null;
    if (mode === 'link') {
      offer = parsePairingUri(link);
      if (!offer) return setNote({ tone: 'danger', text: 'branch://pair 로 시작하는 페어링 링크를 그대로 붙여 넣어 주세요.' });
    } else {
      const url = normalizeBridgeUrl(addr);
      const token = code.replace(/\s+/g, '');
      if (!url) return setNote({ tone: 'danger', text: 'bridge 주소를 확인해 주세요. 예: 100.64.0.1:7777' });
      if (!/^\d{6}$/.test(token)) return setNote({ tone: 'danger', text: '6자리 숫자 코드를 입력해 주세요.' });
      offer = { url, token };
    }
    if (isDemo()) {
      actions().setConnection('remote-bridge', { status: 'ready', enabled: true, detail: 'MacBook-Pro · LAN 직접 연결 · 지연 18ms' });
      close();
      return;
    }
    setBusy(true);
    try {
      const p = await pairWithBridge({ offer, deviceName: deviceLabel(), wsFactory: (url) => new WebSocket(url) });
      await saveRemotePairing(p);
      actions().setConnection('remote-bridge', { enabled: true });
      setPairing(p);
      close();
      await actions().refreshConnections(BRIDGE_IDS);
    } catch (e) {
      setNote({ tone: 'danger', text: e instanceof RemoteBridgeError ? e.message : '페어링하지 못했어요. bridge가 실행 중인지 확인하세요.' });
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
      if (!parsePairingUri(text)) return setNote({ tone: 'danger', text: 'Branch Bridge 페어링 QR이 아니에요. PC의 bridge 화면을 스캔해 주세요.' });
      setLink(text);
    } catch {
      setNote({ tone: 'danger', text: '카메라를 열지 못했어요. 설정에서 카메라 권한을 허용해 주세요.' });
    }
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

  const input =
    'h-9 min-w-0 rounded-lg border border-line bg-bg px-3 font-mono text-[13px] outline-none placeholder:font-sans focus:border-accent';

  return (
    <CardShell id="remote-bridge" icon={<Laptop size={18} />}>
      {form ? (
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
              ['link', '페어링 링크'],
              ['code', '주소 + 코드'],
            ]}
            onChange={(m) => {
              setMode(m);
              setNote(null);
            }}
          />
          {mode === 'link' ? (
            <>
              <p>
                {mobile?.scanQr
                  ? '[QR 스캔]으로 PC 화면의 QR을 찍거나, 표시된 링크를 붙여 넣으세요.'
                  : 'PC 화면의 QR을 휴대폰 카메라로 스캔하거나, 표시된 링크를 붙여 넣으세요.'}
              </p>
              <div className="flex gap-2">
                <input
                  value={link}
                  onChange={(e) => setLink(e.target.value)}
                  placeholder="branch://pair?u=…"
                  aria-label="페어링 링크"
                  autoComplete="off"
                  spellCheck={false}
                  className={cn(input, 'flex-1')}
                />
                {mobile?.scanQr && (
                  <Button size="sm" className="h-9" icon={<ScanLine size={14} />} onClick={() => void scan()} disabled={busy}>
                    QR 스캔
                  </Button>
                )}
              </div>
            </>
          ) : (
            <>
              <p>PC 화면에 표시된 주소와 6자리 코드를 입력하세요.</p>
              <div className="flex flex-wrap gap-2">
                <input
                  value={addr}
                  onChange={(e) => setAddr(e.target.value)}
                  placeholder="100.64.0.1:7777"
                  aria-label="bridge 주소"
                  autoComplete="off"
                  spellCheck={false}
                  className={cn(input, 'flex-[2_1_10rem]')}
                />
                <input
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="123 456"
                  aria-label="페어링 코드"
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
              {busy ? '연결 중' : '연결'}
            </Button>
            <Button size="sm" variant="ghost" onClick={close}>
              취소
            </Button>
          </div>
          <p className="text-muted">1회용 코드는 5분 후 만료돼요. 연결은 기기 키로 서명하고 종단간 암호화합니다.</p>
          {secrets.kind !== 'os' && (
            <p className="flex items-start gap-1.5 text-[12px] text-warn">
              <TriangleAlert size={13} className="mt-0.5 shrink-0" />
              웹에서는 기기 키를 이 탭의 메모리에만 보관해 새로고침하면 다시 페어링해야 합니다.
            </p>
          )}
        </form>
      ) : paired ? (
        <div className="space-y-2 text-[12.5px] text-fg-2">
          <div className="flex flex-wrap items-center gap-2">
            {c.status !== 'ready' && (
              <Button size="sm" variant="soft" icon={<RefreshCw size={13} />} onClick={() => void actions().refreshConnections(BRIDGE_IDS)}>
                다시 연결
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={() => void unpair()}>
              연결 해제
            </Button>
          </div>
          {pairing && (
            <p className="text-muted">
              bridge 지문 <span className="font-mono">{keyFingerprint(pairing.bridgeKey)}</span>
              {pairing.trust === 'code' && ' · 코드로 연결했어요. PC 화면의 지문과 같은지 확인하세요.'}
            </p>
          )}
        </div>
      ) : (
        <div className="space-y-2 text-[12.5px] text-fg-2">
          <p>
            PC에서 <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[12px]">npx @branch/bridge --pair</code> 를 실행하면 페어링 화면이 나와요.
          </p>
          <Button size="sm" variant="soft" icon={<Smartphone size={14} />} onClick={() => setForm(true)}>
            페어링 시작
          </Button>
        </div>
      )}
    </CardShell>
  );
}

function PolicyNote() {
  return (
    <div className="flex gap-2.5 rounded-xl bg-surface-2 p-3.5 text-[12.5px] leading-relaxed text-fg-2">
      <ShieldCheck size={17} className="mt-0.5 shrink-0 text-accent" />
      <div>
        <p className="font-medium text-fg">연결 정책</p>
        <ul className="mt-1 list-disc space-y-0.5 pl-4">
          <li>구독 계정은 내가 설치하고 로그인한 공식 CLI를 실행하는 방식으로만 연결합니다.</li>
          <li>앱은 로그인 토큰 파일을 읽거나 복사하지 않고, 클라이언트 헤더를 흉내 내지 않습니다.</li>
          <li>대화 기록과 가지 맥락은 앱이 보관하며, CLI는 요청마다 새로 실행됩니다 (도구 비활성화, 읽기 전용).</li>
        </ul>
      </div>
    </div>
  );
}

/* ── 일반 탭 ───────────────────────────────────────────── */

const ALL: ProviderId[] = ['anthropic-api', 'openai-api', 'claude-cli', 'codex-cli', 'remote-bridge', 'mock'];

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
          {ALL.map((p) => (
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


