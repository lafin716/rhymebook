import { providerError, type Availability, type ChatTurn, type LLMProvider, type StreamEvent, type StreamRequest } from '../provider';
import { readSse } from '../sse';
import { resolveBase, verifyGet, type ApiProviderOptions } from './anthropic';
import { defaultFetch, httpError, maskSecret, thrownError, type FetchLike } from './http';

export const OPENAI_DEFAULT_MODEL = 'gpt-5';
export const OPENAI_BASE_URL = 'https://api.openai.com';

/** OpenAI Chat Completions API (BYOK), stream: true */
export function createOpenAIProvider(opts: ApiProviderOptions): LLMProvider {
  const fetcher = opts.fetch ?? defaultFetch();
  const base = () => resolveBase(opts.baseUrl, OPENAI_BASE_URL);
  return {
    id: opts.id ?? 'openai-api',
    label: opts.label ?? 'OpenAI API',
    async available(): Promise<Availability> {
      const key = await opts.getKey();
      if (!key) return { status: 'no-key' };
      return { status: 'ready', detail: maskSecret(key) };
    },
    async *stream(req: StreamRequest): AsyncIterable<StreamEvent> {
      const key = await opts.getKey();
      if (!key) {
        yield { type: 'error', error: providerError('auth', 'OpenAI API 키가 설정되지 않았습니다.') };
        return;
      }
      const messages = [
        ...(req.system ? [{ role: 'system', content: req.system }] : []),
        ...req.messages.map((m) => ({ role: m.role, content: m.role === 'user' ? openaiContent(m) : m.content })),
      ];
      let res: Response;
      try {
        res = await fetcher(`${base()}/v1/chat/completions`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
          body: JSON.stringify({
            model: req.model || opts.getModel?.() || OPENAI_DEFAULT_MODEL,
            messages,
            stream: true,
            max_completion_tokens: opts.maxTokens ?? (req.purpose === 'chat' || req.purpose === 'skill' || !req.purpose ? 4096 : 1024),
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
          if (ev.data === '[DONE]') {
            yield { type: 'done', stopReason };
            return;
          }
          let data: OpenAIChunk;
          try {
            data = JSON.parse(ev.data) as OpenAIChunk;
          } catch {
            continue;
          }
          if (data.error) {
            yield { type: 'error', error: providerError('network', `OpenAI 오류: ${data.error.message ?? ''}`) };
            return;
          }
          const choice = data.choices?.[0];
          const text = choice?.delta?.content;
          if (text) yield { type: 'delta', text };
          if (choice?.finish_reason) stopReason = choice.finish_reason;
        }
      } catch (e) {
        yield { type: 'error', error: thrownError(e) };
        return;
      }
      if (stopReason) yield { type: 'done', stopReason };
      else yield { type: 'error', error: providerError('network', '응답 스트림이 완료 전에 끊겼습니다.') };
    },
  };
}

/** 첨부가 있으면 content 파트(image_url data URL, PDF는 file) + 텍스트, 없으면 문자열 */
export function openaiContent(turn: ChatTurn): string | Record<string, unknown>[] {
  const files = turn.attachments ?? [];
  if (!files.length) return turn.content;
  return [
    { type: 'text', text: turn.content },
    ...files.map((a) =>
      a.kind === 'image'
        ? { type: 'image_url', image_url: { url: `data:${a.mime};base64,${a.data}` } }
        : { type: 'file', file: { filename: a.name, file_data: `data:application/pdf;base64,${a.data}` } },
    ),
  ];
}

interface OpenAIChunk {
  choices?: { delta?: { content?: string | null }; finish_reason?: string | null }[];
  error?: { message?: string };
}

export async function verifyOpenAIKey(key: string, opts: { baseUrl?: string; fetch?: FetchLike } = {}) {
  return verifyGet(`${resolveBase(opts.baseUrl, OPENAI_BASE_URL)}/v1/models`, { authorization: `Bearer ${key}` }, opts.fetch);
}
