import type { Attachment, ConnectionStatus, ProviderErrorCode, ProviderId, Role, ToolActivity } from './model';

export interface ChatTurn {
  role: Role;
  content: string;
  /** 이미지·PDF 첨부 (텍스트 첨부는 content에 이미 들어 있다) */
  attachments?: Attachment[];
}

export interface StreamRequest {
  system: string;
  messages: ChatTurn[];
  model?: string;
  /** CLI 노력치 (claude --effort, codex model_reasoning_effort) */
  effort?: string;
  signal?: AbortSignal;
  /** 요청 목적. Mock/로깅용 힌트 */
  purpose?: 'chat' | 'summary' | 'title' | 'skill';
  /** 웹 검색·페이지 읽기 도구 허용 (일반 대화에서만 쓴다, ADR-070) */
  webSearch?: boolean;
}

/** 웹 검색 도구를 쓸 수 있는 provider. OpenAI API(Chat Completions)는 지원하지 않는다 (ADR-070) */
export function supportsWebTools(providerId: ProviderId): boolean {
  return providerId !== 'openai-api';
}

/** 같은 id 도구는 갱신하고 새 도구는 뒤에 붙인다. 끝난 도구가 늦게 온 running으로 되돌아가지 않는다 */
export function upsertTool(list: ToolActivity[] | undefined, tool: ToolActivity): ToolActivity[] {
  const cur = list ?? [];
  const i = cur.findIndex((t) => t.id === tool.id);
  if (i < 0) return [...cur, tool];
  const prev = cur[i]!;
  const status = tool.status === 'running' && prev.status !== 'running' ? prev.status : tool.status;
  const next = cur.slice();
  next[i] = { ...prev, ...tool, status };
  return next;
}

/** 도구를 붙일 요청인가: 웹 검색이 켜진 일반 대화 */
export function wantsWebTools(req: Pick<StreamRequest, 'webSearch' | 'purpose'>): boolean {
  return req.webSearch === true && (!req.purpose || req.purpose === 'chat');
}

export interface ProviderError {
  code: ProviderErrorCode;
  message: string;
  retryable: boolean;
}

export type StreamEvent =
  | { type: 'delta'; text: string }
  | { type: 'done'; stopReason?: string }
  | { type: 'error'; error: ProviderError }
  /** 모델이 만든 이미지 (Codex 이미지 생성, ADR-041). 응답 메시지의 첨부가 된다 */
  | { type: 'image'; attachment: Attachment }
  /** 도구 사용 시작·끝 (웹 검색 등, ADR-070). 스트림은 계속된다 */
  | { type: 'tool'; tool: ToolActivity };

export type Availability =
  | { status: 'ready'; detail?: string }
  | { status: Exclude<ConnectionStatus, 'ready' | 'checking'>; detail?: string };

export interface LLMProvider {
  id: ProviderId;
  label: string;
  available(): Promise<Availability>;
  stream(req: StreamRequest): AsyncIterable<StreamEvent>;
}

export const PROVIDER_LABELS: Record<ProviderId, string> = {
  mock: '데모 (Mock)',
  'claude-cli': 'Claude CLI',
  'codex-cli': 'Codex CLI',
  'anthropic-api': 'Anthropic API',
  'openai-api': 'OpenAI API',
  'remote-bridge': '원격 Bridge',
};

export class ProviderRegistry {
  private providers = new Map<ProviderId, LLMProvider>();

  register(p: LLMProvider): this {
    this.providers.set(p.id, p);
    return this;
  }

  get(id: ProviderId): LLMProvider | undefined {
    return this.providers.get(id);
  }

  list(): LLMProvider[] {
    return [...this.providers.values()];
  }
}

export function providerError(code: ProviderErrorCode, message: string): ProviderError {
  return { code, message, retryable: code !== 'auth' && code !== 'aborted' };
}

/** 스트림을 끝까지 소비해 전체 텍스트를 얻는다 (요약/제목 생성용) */
export async function collectStream(
  provider: LLMProvider,
  req: StreamRequest,
  onDelta?: (textSoFar: string) => void,
): Promise<string> {
  let text = '';
  for await (const ev of provider.stream(req)) {
    if (ev.type === 'delta') {
      text += ev.text;
      onDelta?.(text);
    } else if (ev.type === 'error') {
      throw ev.error;
    }
  }
  return text;
}
