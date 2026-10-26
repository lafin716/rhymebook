import type { ProviderId, ToolActivity, ToolSource } from '../model';
import { providerError, wantsWebTools, type Availability, type ChatTurn, type LLMProvider, type StreamEvent, type StreamRequest } from '../provider';
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
      const messages: { role: string; content: unknown }[] = req.messages
        .filter((m) => m.role === 'user' || m.role === 'assistant')
        .map((m) => ({ role: m.role, content: anthropicContent(m) }));
      const model = req.model || opts.getModel?.() || ANTHROPIC_DEFAULT_MODEL;
      const tools = wantsWebTools(req) ? anthropicWebTools(model) : undefined;
      // 서버 도구가 길어지면 pause_turn으로 끊긴다. 받은 블록을 assistant 턴으로 붙여 이어 받는다 (ADR-070)
      let pauseTurns = 0;
      const paused: Record<string, unknown>[] = [];
      let wroteText = false;
      // pause_turn 뒤 이어 받은 글도 도구 결과 뒤라면 문단을 나눈다
      let afterTool = false;
      while (true) {
        let res: Response;
        try {
          res = await fetcher(`${base()}/v1/messages`, {
            method: 'POST',
            headers: headers(key),
            body: JSON.stringify({
              model,
              max_tokens: opts.maxTokens ?? (req.purpose === 'chat' || req.purpose === 'skill' || !req.purpose ? 4096 : 512),
              system: req.system,
              messages,
              ...(tools ? { tools } : {}),
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
        const blocks: Record<string, unknown>[] = [];
        const partial = new Map<number, string>();
        let finished = false;
        try {
          for await (const ev of readSse(res.body, req.signal)) {
            if (!ev.data) continue;
            let data: AnthropicEvent;
            try {
              data = JSON.parse(ev.data) as AnthropicEvent;
            } catch {
              continue;
            }
            const i = data.index ?? 0;
            switch (data.type) {
              case 'content_block_start': {
                const b = data.content_block;
                if (!b) break;
                blocks[i] = { ...b };
                if (b.type === 'text') {
                  // 도구 결과 뒤에 이어지는 글은 앞 글과 문단을 나눈다
                  if (afterTool && wroteText) yield { type: 'delta', text: '\n\n' };
                  afterTool = false;
                  if (typeof b.text === 'string' && b.text) {
                    wroteText = true;
                    yield { type: 'delta', text: b.text };
                  }
                } else if (b.type === 'server_tool_use') {
                  afterTool = true;
                } else {
                  const tool = toolResultActivity(b);
                  if (tool) {
                    afterTool = true;
                    yield { type: 'tool', tool };
                  }
                }
                break;
              }
              case 'content_block_delta': {
                const block = blocks[i];
                if (data.delta?.type === 'text_delta' && data.delta.text) {
                  if (block) block.text = String(block.text ?? '') + data.delta.text;
                  wroteText = true;
                  yield { type: 'delta', text: data.delta.text };
                } else if (data.delta?.type === 'input_json_delta') {
                  partial.set(i, (partial.get(i) ?? '') + (data.delta.partial_json ?? ''));
                } else if (data.delta?.type === 'citations_delta' && block && data.delta.citation) {
                  block.citations = [...((block.citations as unknown[]) ?? []), data.delta.citation];
                }
                break;
              }
              case 'content_block_stop': {
                const block = blocks[i];
                if (block?.type === 'server_tool_use') {
                  let input: Record<string, unknown> = (block.input as Record<string, unknown>) ?? {};
                  const json = partial.get(i);
                  if (json) {
                    try {
                      input = JSON.parse(json) as Record<string, unknown>;
                    } catch {
                      // 깨진 입력은 빈 입력으로 둔다
                    }
                  }
                  block.input = input;
                  yield { type: 'tool', tool: toolUseActivity(String(block.id ?? i), String(block.name ?? 'tool'), input) };
                }
                break;
              }
              case 'message_delta':
                stopReason = data.delta?.stop_reason ?? stopReason;
                break;
              case 'message_stop':
                finished = true;
                break;
              case 'error': {
                const t = data.error?.type ?? '';
                const code = t === 'overloaded_error' || t === 'rate_limit_error' ? 'rate-limit' : t === 'authentication_error' ? 'auth' : 'network';
                yield { type: 'error', error: providerError(code, `Anthropic 오류: ${data.error?.message ?? t}`) };
                return;
              }
            }
            if (finished) break;
          }
        } catch (e) {
          yield { type: 'error', error: thrownError(e) };
          return;
        }
        if (!finished) break;
        if (stopReason === 'pause_turn' && pauseTurns < MAX_PAUSE_TURNS) {
          // 두 번째 이후로는 같은 assistant 턴에 이어 붙인다
          if (pauseTurns++ === 0) messages.push({ role: 'assistant', content: paused });
          paused.push(...blocks.filter(Boolean));
          continue;
        }
        yield { type: 'done', stopReason };
        return;
      }
      yield { type: 'error', error: providerError('network', '응답 스트림이 완료 전에 끊겼습니다.') };
    },
  };
}

/** 첨부가 있으면 content 블록(이미지·PDF 문서 + 텍스트), 없으면 문자열 */
export function anthropicContent(turn: ChatTurn): string | Record<string, unknown>[] {
  const files = turn.attachments ?? [];
  if (!files.length) return turn.content;
  return [
    ...files.map((a) => ({
      type: a.kind === 'image' ? 'image' : 'document',
      source: { type: 'base64', media_type: a.kind === 'image' ? a.mime : 'application/pdf', data: a.data },
    })),
    { type: 'text', text: turn.content },
  ];
}

interface AnthropicEvent {
  type: string;
  index?: number;
  content_block?: Record<string, unknown> & { type?: string };
  delta?: { type?: string; text?: string; stop_reason?: string; partial_json?: string; citation?: unknown };
  error?: { type?: string; message?: string };
}

/** pause_turn 이어 받기 최대 횟수 */
const MAX_PAUSE_TURNS = 5;
/** 응답 하나에서 도구별 최대 사용 횟수 */
const WEB_TOOL_MAX_USES = 5;

/**
 * 웹 검색·페이지 읽기 서버 도구 (ADR-070). 동적 필터링 버전(20260209)은 Opus/Sonnet 4.6 이후·Fable만 되고,
 * 그 밖의 모델(Haiku 4.5 등)은 기본 버전을 쓴다
 */
export function anthropicWebTools(model: string): Record<string, unknown>[] {
  const dynamic = /fable|(opus|sonnet)-(4-[6-9]|[5-9])/.test(model);
  return [
    { type: dynamic ? 'web_search_20260209' : 'web_search_20250305', name: 'web_search', max_uses: WEB_TOOL_MAX_USES },
    { type: dynamic ? 'web_fetch_20260209' : 'web_fetch_20250910', name: 'web_fetch', max_uses: WEB_TOOL_MAX_USES },
  ];
}

function toolUseActivity(id: string, name: string, input: Record<string, unknown>): ToolActivity {
  return {
    id,
    name,
    status: 'running',
    ...(typeof input.query === 'string' && input.query ? { query: input.query } : {}),
    ...(typeof input.url === 'string' && input.url ? { url: input.url } : {}),
  };
}

/** 서버 도구 결과 블록(web_search_tool_result 등)을 도구 사용 끝 이벤트로 */
function toolResultActivity(b: Record<string, unknown>): ToolActivity | null {
  const type = String(b.type ?? '');
  if (!type.endsWith('_tool_result') || typeof b.tool_use_id !== 'string') return null;
  const name = type === 'web_search_tool_result' ? 'web_search' : type === 'web_fetch_tool_result' ? 'web_fetch' : type.replace(/_tool_result$/, '');
  const content = b.content as unknown;
  const isError = !!content && !Array.isArray(content) && typeof content === 'object' && String((content as { type?: unknown }).type ?? '').endsWith('_error');
  const sources: ToolSource[] = [];
  if (Array.isArray(content)) {
    for (const r of content as { url?: unknown; title?: unknown }[]) {
      if (typeof r?.url === 'string') sources.push({ url: r.url, ...(typeof r.title === 'string' && r.title ? { title: r.title } : {}) });
    }
  } else if (!isError && content && typeof content === 'object') {
    const c = content as { url?: unknown; content?: { title?: unknown } };
    if (typeof c.url === 'string') {
      const title = c.content?.title;
      sources.push({ url: c.url, ...(typeof title === 'string' && title ? { title } : {}) });
    }
  }
  return { id: b.tool_use_id, name, status: isError ? 'error' : 'done', ...(sources.length ? { sources } : {}) };
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
