import type { ProviderId } from '../model';
import { providerError, type Availability, type LLMProvider, type StreamEvent, type StreamRequest } from '../provider';
import { readSse } from '../sse';
import { defaultFetch, httpError, maskSecret, thrownError, trimBase, type FetchLike } from './http';

export const ANTHROPIC_DEFAULT_MODEL = 'claude-sonnet-5';
export const ANTHROPIC_BASE_URL = 'https://api.anthropic.com';

export interface ApiProviderOptions {
  /** 호출 시점의 키를 돌려준다 (보안 저장소/세션 메모리). 없으면 no-key */
  getKey: () => Promise<string | null | undefined>;
  /** 호출 시점의 모델(설정). 없으면 기본 모델 */
  getModel?: () => string | undefined;
  baseUrl?: string | (() => string | undefined);
  fetch?: FetchLike;
  id?: ProviderId;
  label?: string;
  maxTokens?: number;
}

export function resolveBase(base: ApiProviderOptions['baseUrl'], fallback: string): string {
  const v = typeof base === 'function' ? base() : base;
  return trimBase(v || fallback);
}

/**
 * Anthropic Messages API (BYOK). 브라우저 직접 호출은 공식 opt-in 헤더
 * `anthropic-dangerous-direct-browser-access`로 허용된다(클라이언트 위조 아님, ADR-012).
 */
export function createAnthropicProvider(opts: ApiProviderOptions): LLMProvider {
  const fetcher = opts.fetch ?? defaultFetch();
  const headers = (key: string): Record<string, string> => ({
    'content-type': 'application/json',
    'x-api-key': key,
    'anthropic-version': '2023-06-01',
    'anthropic-dangerous-direct-browser-access': 'true',
  });
  const base = () => resolveBase(opts.baseUrl, ANTHROPIC_BASE_URL);

  return {
    id: opts.id ?? 'anthropic-api',
    label: opts.label ?? 'Anthropic API',
    async available(): Promise<Availability> {
      const key = await opts.getKey();
      if (!key) return { status: 'no-key' };
      return { status: 'ready', detail: maskSecret(key) };
    },
    async *stream(req: StreamRequest): AsyncIterable<StreamEvent> {
      const key = await opts.getKey();
      if (!key) {
        yield { type: 'error', error: providerError('auth', 'Anthropic API 키가 설정되지 않았습니다.') };
        return;
      }
      const messages = req.messages
        .filter((m) => m.role === 'user' || m.role === 'assistant')
        .map((m) => ({ role: m.role, content: m.content }));
      let res: Response;
      try {
        res = await fetcher(`${base()}/v1/messages`, {
          method: 'POST',
          headers: headers(key),
          body: JSON.stringify({
            model: req.model || opts.getModel?.() || ANTHROPIC_DEFAULT_MODEL,
            max_tokens: opts.maxTokens ?? (req.purpose === 'chat' || !req.purpose ? 4096 : 512),
            system: req.system,
            messages,
            stream: true,
          }),
          signal: req.signal,
        });
      } catch (e) {
        yield { type: 'error', error: thrownError(e) };
        return;
      }
      if (!res.ok || !res.body) {
        yield { type: 'error', error: await httpError(res) };
        return;
      }
      let stopReason: string | undefined;
      try {
        for await (const ev of readSse(res.body, req.signal)) {
          if (!ev.data) continue;
          let data: AnthropicEvent;
          try {
            data = JSON.parse(ev.data) as AnthropicEvent;
          } catch {
            continue;
          }
          switch (data.type) {
            case 'content_block_delta':
              if (data.delta?.type === 'text_delta' && data.delta.text) yield { type: 'delta', text: data.delta.text };
              break;
            case 'message_delta':
              stopReason = data.delta?.stop_reason ?? stopReason;
              break;
            case 'message_stop':
              yield { type: 'done', stopReason };
              return;
            case 'error': {
              const t = data.error?.type ?? '';
              const code = t === 'overloaded_error' || t === 'rate_limit_error' ? 'rate-limit' : t === 'authentication_error' ? 'auth' : 'network';
              yield { type: 'error', error: providerError(code, `Anthropic 오류: ${data.error?.message ?? t}`) };
              return;
            }
          }
        }
      } catch (e) {
        yield { type: 'error', error: thrownError(e) };
        return;
      }
      yield { type: 'error', error: providerError('network', '응답 스트림이 완료 전에 끊겼습니다.') };
    },
  };
}

interface AnthropicEvent {
  type: string;
  delta?: { type?: string; text?: string; stop_reason?: string };
  error?: { type?: string; message?: string };
}

/** 키 확인: GET /v1/models (토큰 소모 없음) */
export async function verifyAnthropicKey(key: string, opts: { baseUrl?: string; fetch?: FetchLike } = {}) {
  return verifyGet(`${resolveBase(opts.baseUrl, ANTHROPIC_BASE_URL)}/v1/models?limit=1`, {
    'x-api-key': key,
    'anthropic-version': '2023-06-01',
    'anthropic-dangerous-direct-browser-access': 'true',
  }, opts.fetch);
}

export async function verifyGet(url: string, headers: Record<string, string>, fetch?: FetchLike) {
  try {
    const res = await (fetch ?? defaultFetch())(url, { headers });
    if (res.ok) return { ok: true as const };
    return { ok: false as const, error: await httpError(res) };
  } catch (e) {
    return { ok: false as const, error: thrownError(e) };
  }
}
