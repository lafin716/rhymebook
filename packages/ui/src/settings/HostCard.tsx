import type { HostPolicy, HostState } from '@branch/core';
import { Check, Copy, MonitorSmartphone, QrCode, Unplug, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { desktop } from '../app/runtime';
import { actions, useApp } from '../app/store';
import { Badge, StatusDot } from '../components/Badge';
import { Button, IconButton } from '../components/Button';
import { cn } from '../lib/cn';
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
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [active]);
  return now;
}

const fmtCode = (c: string) => (c.length === 6 ? `${c.slice(0, 3)} ${c.slice(3)}` : c);

const RELAY_LABEL: Record<HostState['relayState'], string> = { off: '사용 안 함', connecting: '연결 중', ready: '연결됨', offline: '끊김' };

export function HostCard() {
  const s = useHostState();
  const agent = useApp((st) => st.settings.hostAgent ?? 'auto');
  const [busy, setBusy] = useState(false);
  const [linkIdx, setLinkIdx] = useState(0);
  const [copied, setCopied] = useState(false);
  const [relayDraft, setRelayDraft] = useState<string | null>(null);
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
            원격 페어링 열기
            <Badge tone={tone}>
              <StatusDot tone={tone} />
              {s.error ? '오류' : s.running ? `열림 · 포트 ${s.port}` : '닫힘'}
            </Badge>
          </div>
          <p className="truncate text-[12.5px] text-muted">
            {s.running
              ? `${s.name} · 페어링 기기 ${s.devices.length}대${s.devices.some((d) => d.connected) ? ` (접속 ${s.devices.filter((d) => d.connected).length})` : ''}`
              : '켜면 휴대폰·웹에서 이 PC의 CLI로 채팅할 수 있어요.'}
          </p>
        </div>
        <Toggle label="원격 페어링 열기" checked={s.enabled} onChange={(v) => void run(() => host.setEnabled(v))} />
      </div>
      {s.error && <p className="mt-2 text-[12.5px] text-danger">{s.error}</p>}

      {s.enabled && (
        <div className="mt-3 space-y-3 border-t border-line pt-3 text-[12.5px] text-fg-2">
          <label className="flex items-center gap-2">
            <span className="shrink-0 text-muted">원격 요청 에이전트</span>
            <select
              value={agent}
              onChange={(e) => actions().updateSettings({ hostAgent: e.target.value as typeof agent })}
              aria-label="원격 요청 에이전트"
              className="h-8 min-w-0 flex-1 rounded-lg border border-line bg-bg px-2 text-[13px] outline-none focus:border-accent"
            >
              <option value="auto">자동 (준비된 CLI, Claude 우선)</option>
              <option value="claude-cli">Claude CLI</option>
              <option value="codex-cli">Codex CLI</option>
            </select>
          </label>
          <p className="text-muted">모델·노력치는 위 CLI 카드의 기본값을 따르고, 휴대폰·웹에서는 바꿀 수 없어요.</p>

          {pairing && link ? (
            <div className="rounded-lg bg-surface-2 p-3">
              <div className="flex items-start gap-3">
                <img
                  src={`data:image/svg+xml;utf8,${encodeURIComponent(link.qrSvg)}`}
                  alt="페어링 QR 코드"
                  className="h-36 w-36 shrink-0 rounded-md bg-white p-1"
                />
                <div className="min-w-0 flex-1 space-y-2">
                  <p className="font-medium text-fg">휴대폰에서 QR을 찍거나 코드를 입력하세요</p>
                  <p>
                    코드 <span className="font-mono text-[18px] tracking-wider text-fg">{fmtCode(pairing.code)}</span>
                  </p>
                  <p className="text-muted">
                    {left > 0 ? `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')} 후 만료` : '만료됨'}
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
                      링크 복사
                    </Button>
                    <Button size="sm" variant="ghost" icon={<X size={13} />} onClick={() => void run(() => host.cancelPairing())}>
                      취소
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <Button size="sm" variant="soft" icon={<QrCode size={14} />} disabled={busy || !s.running} onClick={() => void run(() => host.startPairing())}>
              휴대폰·웹 연결 (QR)
            </Button>
          )}
          {s.running && !s.addresses.some((a) => a.label !== '로컬') && (
            <p className="text-warn">외부에서 닿을 주소가 없어요. 같은 Wi‑Fi나 Tailscale에 연결하거나 relay를 설정하세요.</p>
          )}

          <p className="text-muted">
            이 PC 지문 <span className="font-mono text-fg-2">{s.fingerprint}</span> — 코드로 연결하면 휴대폰에 보이는 지문과 같은지 확인하세요.
          </p>

          {s.devices.length > 0 && (
            <div>
              <div className="mb-1 flex items-center justify-between">
                <span className="font-medium text-fg">페어링된 기기</span>
                <button type="button" className="text-muted hover:text-danger" onClick={() => void run(() => host.unpair('all'))}>
                  모두 해제
                </button>
              </div>
              <ul className="divide-y divide-line rounded-lg border border-line">
                {s.devices.map((d) => (
                  <li key={d.id} className="flex items-center gap-2 px-2.5 py-1.5">
                    <StatusDot tone={d.connected ? 'ok' : 'neutral'} />
                    <span className="min-w-0 flex-1 truncate">{d.name}</span>
                    <span className="text-[11.5px] text-muted">{d.connected ? '접속 중' : new Date(d.lastSeenAt ?? d.pairedAt).toLocaleDateString()}</span>
                    <IconButton size="sm" label={`${d.name} 페어링 해제`} onClick={() => void run(() => host.unpair(d.id))}>
                      <Unplug size={13} />
                    </IconButton>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <details>
            <summary className="cursor-pointer text-muted hover:text-fg">고급: relay ({RELAY_LABEL[s.relayState]})</summary>
            <p className="mt-1.5 text-muted">같은 네트워크·Tailscale이 아닐 때 relay 서버로 중계해요. 내용은 종단간 암호화돼 relay에서 볼 수 없어요.</p>
            <div className="mt-1.5 flex gap-1.5">
              <input
                value={relayDraft ?? s.relayUrl ?? ''}
                onChange={(e) => setRelayDraft(e.target.value)}
                placeholder="wss://relay.example.com"
                aria-label="relay 주소"
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
                저장
              </Button>
            </div>
          </details>
        </div>
      )}
    </div>
  );
}
