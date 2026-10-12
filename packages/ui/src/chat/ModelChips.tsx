import {
  CLI_MODEL_PRESETS,
  EFFORT_LABELS,
  effectiveProviderId,
  effortsFor,
  isCliId,
  modelLabel,
  type CliId,
  type ID,
} from '@branch/core';
import { ChevronDown, Cpu, Gauge } from 'lucide-react';
import type { ReactNode } from 'react';
import { caps } from '../app/capabilities';
import { actions, useApp } from '../app/store';
import { cn } from '../lib/cn';

/**
 * CLI provider 채팅의 모델·노력치 선택 (세션 덮어쓰기, 비우면 설정의 기본값).
 * 웹·모바일은 고를 수 없다 — 원격 요청의 모델·노력치는 PC 설정이 정한다 (ADR-025).
 */
export function ModelChips({ sessionId, compact }: { sessionId: ID; compact?: boolean }) {
  const eff = useApp((s) => effectiveProviderId(s, sessionId));
  const pref = useApp((s) => s.sessions[sessionId]?.modelPref);
  const conn = useApp((s) => s.connections[eff]);
  if (!caps.modelChoice || !isCliId(eff)) return null;
  const own = pref?.providerId === eff ? pref : undefined;
  return <Chips id={eff} sessionId={sessionId} compact={compact} model={own?.model} effort={own?.effort} defModel={conn?.model} defEffort={conn?.effort} />;
}

function Chips({
  id,
  sessionId,
  compact,
  model,
  effort,
  defModel,
  defEffort,
}: {
  id: CliId;
  sessionId: ID;
  compact?: boolean;
  model?: string;
  effort?: string;
  defModel?: string;
  defEffort?: string;
}) {
  const presets = CLI_MODEL_PRESETS[id];
  const curModel = model || defModel;
  const efforts = effortsFor(id, curModel);
  // 프리셋에 없는 모델(설정에서 직접 입력)도 선택지로 보여준다
  const extra = [model, defModel].filter((m, i, a): m is string => !!m && a.indexOf(m) === i && !presets.some((p) => p.id === m));
  const modelText = curModel ? modelLabel(id, curModel) : 'CLI 기본 모델';
  const curEffort = effort || (defEffort && efforts.includes(defEffort) ? defEffort : undefined);
  const effortText = curEffort ? (EFFORT_LABELS[curEffort] ?? curEffort) : '기본 노력치';

  return (
    <div className={cn('flex flex-wrap items-center gap-1.5', compact ? 'mt-1.5' : 'mt-2')}>
      <Chip icon={<Cpu size={12} />} text={modelText} active={!!model} title="이 채팅의 모델">
        <select
          aria-label="이 채팅의 모델"
          value={model ?? ''}
          onChange={(e) => actions().setSessionModel(sessionId, { model: e.target.value || undefined })}
          className="absolute inset-0 cursor-pointer opacity-0"
        >
          <option value="">기본값 ({defModel ? modelLabel(id, defModel) : 'CLI 기본'})</option>
          {presets.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
          {extra.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </Chip>
      <Chip icon={<Gauge size={12} />} text={effortText} active={!!effort} title="이 채팅의 노력치">
        <select
          aria-label="이 채팅의 노력치"
          value={effort ?? ''}
          onChange={(e) => actions().setSessionModel(sessionId, { effort: e.target.value || undefined })}
          className="absolute inset-0 cursor-pointer opacity-0"
        >
          <option value="">기본값 ({defEffort && efforts.includes(defEffort) ? (EFFORT_LABELS[defEffort] ?? defEffort) : 'CLI 기본'})</option>
          {efforts.map((x) => (
            <option key={x} value={x}>
              {EFFORT_LABELS[x] ?? x}
            </option>
          ))}
        </select>
      </Chip>
    </div>
  );
}

function Chip({ icon, text, active, title, children }: { icon: ReactNode; text: string; active: boolean; title: string; children: ReactNode }) {
  return (
    <label
      title={title}
      className={cn(
        'relative inline-flex h-7 max-w-[11rem] items-center gap-1 rounded-full border px-2.5 text-[12px] focus-within:ring-2 focus-within:ring-accent/40',
        active ? 'border-accent/40 bg-accent-soft text-accent' : 'border-line bg-surface text-fg-2 hover:bg-surface-2',
      )}
    >
      <span className="shrink-0 opacity-80">{icon}</span>
      <span className="truncate">{text}</span>
      <ChevronDown size={12} className="shrink-0 opacity-60" />
      {children}
    </label>
  );
}
