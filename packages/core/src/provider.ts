import type { Attachment, ConnectionStatus, ProviderErrorCode, ProviderId, Role } from './model';

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
  | { type: 'image'; attachment: Attachment };

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
