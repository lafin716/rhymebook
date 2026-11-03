import type { HostPolicy, HostState } from '@branch/core';
import { Check, Copy, MonitorSmartphone, QrCode, Unplug, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { desktop } from '../app/runtime';
import { actions, useApp } from '../app/store';
import { remoteDeleteAllowed, setRemoteDeleteAllowed } from '../app/sync';
import { Badge, StatusDot } from '../components/Badge';
import { Button, IconButton } from '../components/Button';
import { cn } from '../lib/cn';
import { t, tx, type MessageKey } from '../i18n';
import { Toggle } from './controls';

/**
 * 원격 페어링 열기 (데스크톱 전용, ADR-025).
 * 이 PC를 bridge로 열어 휴대폰·웹이 페어링해 쓴다. QR·코드는 화면에만 보이고 저장·로그하지 않는다.
 */
const host = desktop?.host;

export function useHostState(): HostState | null {
  const [state, setState] = useState<HostState | null>(null);
  useEffect(() => {
    if (!host) return;
    let alive = true;
    void host.getState().then((s) => alive && setState(s));
    const off = host.onChange((s) => alive && setState(s));
    return () => {
      alive = false;
      off();
    };
  }, []);
  return state;
}

/** PC 설정(호스트 에이전트, CLI 기본 모델·노력치)을 원격 요청 정책으로 보낸다 */
export function useHostPolicySync() {
  const agent = useApp((s) => s.settings.hostAgent ?? 'auto');
  const claude = useApp((s) => s.connections['claude-cli']);
  const codex = useApp((s) => s.connections['codex-cli']);
  useEffect(() => {
    if (!host) return;
    const pick = (c: { model?: string; effort?: string }) => ({ ...(c.model ? { model: c.model } : {}), ...(c.effort ? { effort: c.effort } : {}) });
    const policy: HostPolicy = { agent, options: { 'claude-cli': pick(claude), 'codex-cli': pick(codex) } };
    void host.setPolicy(policy);
  }, [agent, claude.model, claude.effort, codex.model, codex.effort]); // eslint-disable-line react-hooks/exhaustive-deps
}

function useNow(active: boolean) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [active]);
  return now;
}

const fmtCode = (c: string) => (c.length === 6 ? `${c.slice(0, 3)} ${c.slice(3)}` : c);

/** 렌더 때 t()로 읽는다 (모듈 상수에 번역 문자열을 넣지 않는다) */
const RELAY_STATE_KEY: Record<HostState['relayState'], MessageKey> = {
  off: 'settings.host.relayOff',
  connecting: 'settings.host.relayConnecting',
  ready: 'settings.host.relayReady',
  offline: 'settings.host.relayOffline',
};

export function HostCard() {
  const s = useHostState();
  const agent = useApp((st) => st.settings.hostAgent ?? 'auto');
  const [busy, setBusy] = useState(false);
  const [linkIdx, setLinkIdx] = useState(0);
  const [copied, setCopied] = useState(false);
  const [relayDraft, setRelayDraft] = useState<string | null>(null);
  const [allowDelete, setAllowDelete] = useState(remoteDeleteAllowed);
  const now = useNow(!!s?.pairing);
  if (!host || !s) return null;

  const run = async (f: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await f();
    } finally {
      setBusy(false);
    }
  };
  const pairing = s.pairing;
  const link = pairing?.links[Math.min(linkIdx, pairing.links.length - 1)];
  const left = pairing ? Math.max(0, Math.ceil((pairing.expiresAt - now) / 1000)) : 0;
  const tone = s.error ? 'danger' : s.running ? 'ok' : 'neutral';
  const connectedCount = s.devices.filter((d) => d.connected).length;

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* 클립보드 권한 없음 */
    }
  };

  return (
    <div className="rounded-xl border border-line bg-surface p-3.5">
      <div className="flex items-center gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-surface-2 text-fg-2">
          <MonitorSmartphone size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-[14px] font-medium">
            {t('settings.host.openTitle')}
            <Badge tone={tone}>
              <StatusDot tone={tone} />
              {s.error
                ? t('settings.host.badgeError')
                : s.running
                  ? t('settings.host.badgeOpen', { port: s.port ?? '' })
                  : t('settings.host.badgeClosed')}
            </Badge>
          </div>
          <p className="truncate text-[12.5px] text-muted">
            {s.running
              ? `${t('settings.host.summaryRunning', { name: s.name, n: s.devices.length })}${connectedCount > 0 ? t('settings.host.connectedSuffix', { n: connectedCount }) : ''}`
              : t('settings.host.summaryClosed')}
          </p>
        </div>
        <Toggle label={t('settings.host.openTitle')} checked={s.enabled} onChange={(v) => void run(() => host.setEnabled(v))} />
      </div>
      {s.error && <p className="mt-2 text-[12.5px] text-danger">{s.error}</p>}

      {s.enabled && (
        <div className="mt-3 space-y-3 border-t border-line pt-3 text-[12.5px] text-fg-2">
          <label className="flex items-center gap-2">
            <span className="shrink-0 text-muted">{t('settings.host.agentLabel')}</span>
            <select
              value={agent}
              onChange={(e) => actions().updateSettings({ hostAgent: e.target.value as typeof agent })}
              aria-label={t('settings.host.agentLabel')}
              className="h-8 min-w-0 flex-1 rounded-lg border border-line bg-bg px-2 text-[13px] outline-none focus:border-accent"
            >
              <option value="auto">{t('settings.host.agentAuto')}</option>
              <option value="claude-cli">Claude CLI</option>
              <option value="codex-cli">Codex CLI</option>
            </select>
          </label>
          <p className="text-muted">{t('settings.host.modelNote')}</p>
          <div className="flex items-center gap-2">
            <span className="min-w-0 flex-1">
              {t('settings.host.deleteLabel')}
              <span className="block text-muted">{t('settings.host.deleteHint')}</span>
            </span>
            <Toggle
              label={t('settings.host.deleteLabel')}
              checked={allowDelete}
              onChange={(v) => {
                setRemoteDeleteAllowed(v);
                setAllowDelete(v);
              }}
            />
          </div>

          {pairing && link ? (
            <div className="rounded-lg bg-surface-2 p-3">
              <div className="flex items-start gap-3">
                <img
                  src={`data:image/svg+xml;utf8,${encodeURIComponent(link.qrSvg)}`}
                  alt={t('settings.host.qrAlt')}
                  className="h-36 w-36 shrink-0 rounded-md bg-white p-1"
                />
                <div className="min-w-0 flex-1 space-y-2">
                  <p className="font-medium text-fg">{t('settings.host.qrScan')}</p>
                  <p>
                    {t('settings.host.code')} <span className="font-mono text-[18px] tracking-wider text-fg">{fmtCode(pairing.code)}</span>
                  </p>
                  <p className="text-muted">
                    {left > 0
                      ? t('settings.host.expiresIn', { time: `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}` })
                      : t('settings.host.expired')}
                  </p>
                  {pairing.links.length > 1 && (
                    <div className="flex flex-wrap gap-1">
                      {pairing.links.map((l, i) => (
                        <button
                          key={l.url}
                          type="button"
                          onClick={() => setLinkIdx(i)}
                          className={cn('rounded-md px-2 py-0.5', i === linkIdx ? 'bg-accent-soft text-accent' : 'bg-surface text-muted hover:text-fg')}
                        >
                          {l.label}
                        </button>
                      ))}
                    </div>
                  )}
                  <p className="truncate font-mono text-[11.5px] text-muted">{link.url}</p>
                  <div className="flex flex-wrap gap-1.5">
                    <Button size="sm" icon={copied ? <Check size={13} /> : <Copy size={13} />} onClick={() => void copy(link.uri)}>
                      {t('settings.host.copyLink')}
                    </Button>
                    <Button size="sm" variant="ghost" icon={<X size={13} />} onClick={() => void run(() => host.cancelPairing())}>
                      {t('common.cancel')}
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <Button size="sm" variant="soft" icon={<QrCode size={14} />} disabled={busy || !s.running} onClick={() => void run(() => host.startPairing())}>
              {t('settings.host.startQr')}
            </Button>
          )}
          {s.running && !s.addresses.some((a) => (a.kind ? a.kind !== 'local' : a.label !== '로컬')) &&<p className="text-warn">{t('settings.host.noAddress')}</p>}

          <p className="text-muted">
            {tx('settings.host.fingerprint', { fp: <span className="font-mono text-fg-2">{s.fingerprint}</span> })}
          </p>

          {s.devices.length > 0 && (
            <div>
              <div className="mb-1 flex items-center justify-between">
                <span className="font-medium text-fg">{t('settings.host.devicesTitle')}</span>
                <button type="button" className="text-muted hover:text-danger" onClick={() => void run(() => host.unpair('all'))}>
                  {t('settings.host.unpairAll')}
                </button>
              </div>
              <ul className="divide-y divide-line rounded-lg border border-line">
                {s.devices.map((d) => (
                  <li key={d.id} className="flex items-center gap-2 px-2.5 py-1.5">
                    <StatusDot tone={d.connected ? 'ok' : 'neutral'} />
                    <span className="min-w-0 flex-1 truncate">{d.name}</span>
                    <span className="text-[11.5px] text-muted">
                      {d.connected ? t('settings.host.connectedNow') : new Date(d.lastSeenAt ?? d.pairedAt).toLocaleDateString()}
                    </span>
                    <IconButton size="sm" label={t('settings.host.unpairOne', { name: d.name })} onClick={() => void run(() => host.unpair(d.id))}>
                      <Unplug size={13} />
                    </IconButton>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <details>
            <summary className="cursor-pointer text-muted hover:text-fg">
              {t('settings.host.advanced', { state: t(RELAY_STATE_KEY[s.relayState]) })}
            </summary>
            <p className="mt-1.5 text-muted">{t('settings.host.relayHint')}</p>
            <div className="mt-1.5 flex gap-1.5">
              <input
                value={relayDraft ?? s.relayUrl ?? ''}
                onChange={(e) => setRelayDraft(e.target.value)}
                placeholder="wss://relay.example.com"
                aria-label={t('settings.host.relayAria')}
                autoComplete="off"
                spellCheck={false}
                className="h-8 min-w-0 flex-1 rounded-lg border border-line bg-bg px-2.5 font-mono text-[12.5px] text-fg outline-none placeholder:text-muted focus:border-accent"
              />
              <Button
                size="sm"
                disabled={busy || relayDraft === null}
                onClick={() =>
                  void run(async () => {
                    await host.setRelay(relayDraft?.trim() || null);
                    setRelayDraft(null);
                  })
                }
              >
                {t('common.save')}
              </Button>
            </div>
          </details>
        </div>
      )}
    </div>
  );
}
