import { CLI_MODEL_PRESETS, EFFORT_LABELS, effortsFor, modelLabel, PROVIDER_LABELS, type CliId, type ID } from '@branch/core';
import { ChevronDown, Cpu, X } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { actions, useApp } from '../app/store';
import { IconButton } from '../components/Button';
import { cn } from '../lib/cn';

const AGENTS: CliId[] = ['claude-cli', 'codex-cli'];
const SHORT: Record<CliId, string> = { 'claude-cli': 'Claude', 'codex-cli': 'Codex' };

/**
 * 원격(웹·모바일): 이 채팅을 PC의 어느 CLI·모델·노력치로 답할지 고른다 (IMP-08, ADR-031).
 * 값은 PC 세션에 저장되고(sync `session.agent`), 비우면 PC 설정의 기본값을 따른다.
 */
export function RemoteAgentPicker({ sessionId, compact }: { sessionId: ID; compact?: boolean }) {
  const own = useApp((s) => s.sessions[sessionId]?.providerId);
  const pref = useApp((s) => s.sessions[sessionId]?.modelPref);
  const [box, setBox] = useState<DOMRect | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);

  const agent = own === 'claude-cli' || own === 'codex-cli' ? own : undefined;
  const mine = agent && pref?.providerId === agent ? pref : undefined;
  const text = agent ? [SHORT[agent], mine?.model && modelLabel(agent, mine.model)].filter(Boolean).join(' · ') : 'PC 기본';

  useEffect(() => {
    if (!box) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (panel.current?.contains(t) || btn.current?.contains(t)) return;
      setBox(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      setBox(null);
      btn.current?.focus();
    };
    const onResize = () => setBox(null);
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', onResize);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('resize', onResize);
    };
  }, [box]);

  const efforts = agent ? effortsFor(agent, mine?.model) : [];
  const presets = agent ? CLI_MODEL_PRESETS[agent] : [];
  const extraModel = agent && mine?.model && !presets.some((p) => p.id === mine.model) ? mine.model : undefined;
  const width = 280;

  return (
    <>
      <button
        ref={btn}
        type="button"
        aria-label={`답할 에이전트·모델: ${text}`}
        aria-expanded={!!box}
        aria-haspopup="dialog"
        title="이 채팅을 답할 PC의 에이전트·모델·노력치"
        onClick={() => setBox((b) => (b ? null : btn.current!.getBoundingClientRect()))}
        className={cn(
          'inline-flex max-w-[9.5rem] shrink-0 items-center gap-1 rounded-lg border px-2 text-[12px] transition-colors',
          compact ? 'h-7' : 'h-8',
          agent ? 'border-accent/40 bg-accent-soft text-accent' : 'border-line bg-surface text-fg-2 hover:bg-surface-2',
        )}
      >
        <Cpu size={13} className="shrink-0" />
        <span className="truncate">{text}</span>
        <ChevronDown size={12} className="shrink-0 opacity-60" />
      </button>
      {box &&
        createPortal(
          <div
            ref={panel}
            role="dialog"
            aria-label="답할 에이전트·모델"
            style={{
              top: box.bottom + 6,
              left: Math.max(8, Math.min(window.innerWidth - width - 8, box.right - width)),
              width,
            }}
            className="animate-pop-in fixed z-[80] space-y-3 rounded-xl border border-line bg-elev p-3 shadow-float"
          >
            <div className="flex items-center gap-2">
              <span className="flex-1 text-[13.5px] font-semibold">이 채팅을 답할 PC 에이전트</span>
              <IconButton size="sm" label="닫기" onClick={() => setBox(null)}>
                <X size={15} />
              </IconButton>
            </div>
            <Row label="에이전트">
              <select
                aria-label="에이전트"
                value={agent ?? ''}
                onChange={(e) => actions().setSessionProvider(sessionId, (e.target.value || undefined) as CliId | undefined)}
                className={SELECT}
              >
                <option value="">PC 기본 (PC 설정)</option>
                {AGENTS.map((id) => (
                  <option key={id} value={id}>
                    {PROVIDER_LABELS[id]}
                  </option>
                ))}
              </select>
            </Row>
            <Row label="모델">
              <select
                aria-label="모델"
                disabled={!agent}
                value={mine?.model ?? ''}
                onChange={(e) => actions().setSessionModel(sessionId, { model: e.target.value || undefined })}
                className={SELECT}
              >
                <option value="">PC 기본 모델</option>
                {presets.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
                {extraModel && <option value={extraModel}>{extraModel}</option>}
              </select>
            </Row>
            <Row label="노력치">
              <select
                aria-label="노력치"
                disabled={!agent}
                value={mine?.effort ?? ''}
                onChange={(e) => actions().setSessionModel(sessionId, { effort: e.target.value || undefined })}
                className={SELECT}
              >
                <option value="">PC 기본 노력치</option>
                {efforts.map((x) => (
                  <option key={x} value={x}>
                    {EFFORT_LABELS[x] ?? x}
                  </option>
                ))}
              </select>
            </Row>
            <p className="text-[12px] leading-snug text-muted">
              {agent
                ? 'PC에 설치·로그인된 CLI로 답해요. 비워 두면 PC 설정의 기본값을 써요.'
                : '에이전트를 고르면 모델·노력치도 바꿀 수 있어요. PC 기본은 PC 설정을 따라요.'}
            </p>
          </div>,
          document.body,
        )}
    </>
  );
}

const SELECT =
  'h-9 w-full rounded-lg border border-line bg-bg px-2.5 text-[13.5px] outline-none focus:border-accent disabled:opacity-50';

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[12px] font-medium text-fg-2">{label}</span>
      {children}
    </label>
  );
}
