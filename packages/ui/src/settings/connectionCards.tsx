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

export function CliCard({ id, install, login }: { id: 'claude-cli' | 'codex-cli'; install: string; login: string }) {
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
        <span className="w-14 shrink-0">기본 모델</span>
        <select
          aria-label={`${label} 기본 모델`}
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
          <option value="">CLI 기본</option>
          {presets.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label} ({p.id})
            </option>
          ))}
          <option value={CUSTOM}>직접 입력…</option>
        </select>
      </label>
      {custom && (
        <label className="flex items-center gap-2">
          <span className="w-14 shrink-0">모델 이름</span>
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
            aria-label={`${label} 모델 이름`}
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
      {bad && <p className="text-[12px] text-danger">영문·숫자·. _ - : / [ ] 만 쓸 수 있어요.</p>}
      <label className="flex items-center gap-2">
        <span className="w-14 shrink-0">노력치</span>
        <select
          aria-label={`${label} 기본 노력치`}
          value={effort && efforts.includes(effort) ? effort : ''}
          onChange={(e) => actions().setConnection(id, { effort: e.target.value || undefined })}
          className={selectCls}
        >
          <option value="">CLI 기본</option>
          {efforts.map((x) => (
            <option key={x} value={x}>
              {EFFORT_LABELS[x] ?? x} ({x})
            </option>
          ))}
        </select>
      </label>
      <p className="text-[12px]">채팅 입력창 아래에서 대화마다 바꿀 수 있어요.</p>
    </div>
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
      {caps.modelChoice ? (
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
      ) : (
        <p className="mt-2 text-[12.5px] text-muted">
          모델 <span className="font-mono text-fg-2">{API_META[id].model}</span> (기본값 고정 · 모델은 PC 앱에서 고를 수 있어요)
        </p>
      )}
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

const BRIDGE_IDS: ProviderId[] = ['remote-bridge'];

export function BridgeCard() {
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
          {!caps.modelChoice && <p className="text-muted">답변은 PC의 CLI가 만들고, 에이전트·모델·노력치는 PC 설정을 따라요.</p>}
        </div>
      ) : (
        <div className="space-y-2 text-[12.5px] text-fg-2">
          {caps.localCli ? (
            <p>다른 PC의 rhymebook 앱에서 [원격 페어링 열기]를 켜면 나오는 QR 링크나 주소·코드로 연결해요.</p>
          ) : (
            <ol className="list-decimal space-y-0.5 pl-4">
              <li>PC의 rhymebook 앱에서 설정 → 연결 → [원격 페어링 열기]를 켜요.</li>
              <li>[휴대폰 연결]을 누르면 QR과 6자리 코드가 나와요.</li>
              <li>아래 [페어링 시작]에서 QR을 찍거나 링크·코드를 입력해요.</li>
            </ol>
          )}
          <p className="text-muted">
            앱이 없는 PC라면 <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[12px]">npx @branch/bridge --pair</code> 로도 열 수 있어요.
          </p>
          <Button size="sm" variant="soft" icon={<Smartphone size={14} />} onClick={() => setForm(true)}>
            페어링 시작
          </Button>
        </div>
      )}
    </CardShell>
  );
}

export function PolicyNote() {
  const items = caps.localCli
    ? [
        '구독 계정은 내가 설치하고 로그인한 공식 CLI를 실행하는 방식으로만 연결합니다.',
        '앱은 로그인 토큰 파일을 읽거나 복사하지 않고, 클라이언트 헤더를 흉내 내지 않습니다.',
        '대화 기록과 가지 맥락은 앱이 보관하며, CLI는 요청마다 새로 실행됩니다 (도구 비활성화, 읽기 전용).',
        '원격 페어링을 열면 페어링한 기기의 요청도 이 PC의 CLI로 실행되고, 에이전트·모델·노력치는 이 PC 설정을 따릅니다.',
      ]
    : [
        '이 기기에서는 CLI를 실행하지 않습니다. 구독 계정은 내 PC와 페어링해 PC의 공식 CLI로만 씁니다.',
        '원격 요청의 에이전트·모델·노력치는 PC 설정이 정하며, 이 기기에서 바꿀 수 없습니다.',
        '페어링 연결은 기기 키로 서명하고 종단간 암호화합니다. relay를 거쳐도 내용은 보이지 않습니다.',
      ];
  return (
    <div className="flex gap-2.5 rounded-xl bg-surface-2 p-3.5 text-[12.5px] leading-relaxed text-fg-2">
      <ShieldCheck size={17} className="mt-0.5 shrink-0 text-accent" />
      <div>
        <p className="font-medium text-fg">연결 정책</p>
        <ul className="mt-1 list-disc space-y-0.5 pl-4">
          {items.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}
