import type { ConnectionState, ID, ModelPref, ProviderId, Session } from './model';

/**
 * CLI provider의 모델·노력치(effort) 선택지 (ADR-023).
 * 설정의 연결 카드가 기본값(ConnectionState.model/effort)을, 채팅이 세션별 덮어쓰기(Session.modelPref)를 정한다.
 * 값은 bridge가 CLI 인자로 넘기기 전에 다시 검증한다(인자 주입 방지).
 */
export type CliId = Extract<ProviderId, 'claude-cli' | 'codex-cli'>;

export interface ModelPreset {
  id: string;
  label: string;
  /** 이 모델이 지원하는 노력치. 없으면 provider 전체 목록 */
  efforts?: readonly string[];
}

export const CLI_EFFORTS: Record<CliId, readonly string[]> = {
  'claude-cli': ['low', 'medium', 'high', 'xhigh', 'max'],
  'codex-cli': ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'],
};

const CODEX_NO_ULTRA = ['low', 'medium', 'high', 'xhigh', 'max'] as const;

export const CLI_MODEL_PRESETS: Record<CliId, readonly ModelPreset[]> = {
  'claude-cli': [
    { id: 'fable', label: 'Fable' },
    { id: 'opus', label: 'Opus' },
    { id: 'sonnet', label: 'Sonnet' },
    { id: 'haiku', label: 'Haiku' },
  ],
  'codex-cli': [
    { id: 'gpt-6.1-sol', label: 'GPT-6.1 Sol' },
    { id: 'gpt-6-astra', label: 'GPT-6 Astra' },
    { id: 'gpt-6-sol', label: 'GPT-6 Sol' },
    { id: 'gpt-6-luna', label: 'GPT-6 Luna', efforts: CODEX_NO_ULTRA },
    { id: 'gpt-5.6-sol', label: 'GPT-5.6 Sol' },
    { id: 'gpt-5.6-terra', label: 'GPT-5.6 Terra' },
    { id: 'gpt-5.6-luna', label: 'GPT-5.6 Luna', efforts: CODEX_NO_ULTRA },
  ],
};

export const EFFORT_LABELS: Record<string, string> = {
  low: '낮음',
  medium: '보통',
  high: '높음',
  xhigh: '매우 높음',
  max: '최대',
  ultra: '울트라',
};

export function isCliId(id: ProviderId): id is CliId {
  return id === 'claude-cli' || id === 'codex-cli';
}

/** 모델 이름 허용 문자: 별칭·전체 이름(claude-opus-5-5, gpt-6.1-sol, opus[1m] 등). '-'로 시작 불가 */
export function isValidModelName(model: string): boolean {
  return /^[A-Za-z0-9][\w.:/\-[\]]{0,79}$/.test(model);
}

/** 모델에 맞는 노력치 목록 (프리셋이 아닌 모델은 provider 전체 목록) */
export function effortsFor(id: CliId, model?: string): readonly string[] {
  const preset = model ? CLI_MODEL_PRESETS[id].find((p) => p.id === model) : undefined;
  return preset?.efforts ?? CLI_EFFORTS[id];
}

export function isValidEffort(id: CliId, effort: string, model?: string): boolean {
  return effortsFor(id, model).includes(effort);
}

export function modelLabel(id: CliId, model: string): string {
  return CLI_MODEL_PRESETS[id].find((p) => p.id === model)?.label ?? model;
}

export interface ModelOptions {
  model?: string;
  effort?: string;
}

/**
 * 요청에 쓸 모델·노력치: 세션 덮어쓰기 → 연결 기본값 → (없으면 CLI/API 기본).
 * 노력치는 CLI provider에만 적용하고, 고른 모델이 지원하지 않으면 뺀다.
 */
export function resolveModelOptions(
  providerId: ProviderId,
  pref: ModelPref | undefined,
  conn: Pick<ConnectionState, 'model' | 'effort'> | undefined,
): ModelOptions {
  // 다른 provider용으로 고른 덮어쓰기는 무시한다 (기본 provider가 바뀐 경우 등)
  const own = pref?.providerId === providerId ? pref : undefined;
  const model = own?.model || conn?.model || undefined;
  const out: ModelOptions = model ? { model } : {};
  if (!isCliId(providerId)) return out;
  const effort = own?.effort || conn?.effort || undefined;
  if (effort && isValidEffort(providerId, effort, model)) out.effort = effort;
  return out;
}

/** 세션에 적용될 모델 옵션 (스토어 상태에서) */
export function sessionModelOptions(
  state: {
    sessions: Record<ID, Session>;
    connections: Record<ProviderId, ConnectionState>;
  },
  sessionId: ID,
  providerId: ProviderId,
): ModelOptions {
  return resolveModelOptions(providerId, state.sessions[sessionId]?.modelPref, state.connections[providerId]);
}
