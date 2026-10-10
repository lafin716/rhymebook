import { describe, expect, it } from 'vitest';
import type { ConnectionState, ProviderId } from '../src/model';
import { collectStream, type StreamEvent } from '../src/provider';
import { createAnthropicProvider } from '../src/providers/anthropic';
import { defaultConnections } from '../src/seed';
import type { FetchLike } from '../src/providers/http';
import { createOpenAIProvider } from '../src/providers/openai';
import { createRuntimeRegistry } from '../src/providers/runtime';
import { memorySecretStore, secretName } from '../src/secrets';

function sseResponse(blocks: string[], status = 200): Response {
  const enc = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      for (const b of blocks) c.enqueue(enc.encode(b));
      c.close();
    },
  });
  return new Response(body, { status, headers: { 'content-type': 'text/event-stream' } });
}

interface Call {
  url: string;
  init?: RequestInit;
}

function fakeFetch(res: () => Response | Promise<Response>, calls: Call[] = []): FetchLike {
  return async (url, init) => {
    calls.push({ url, init });
    return res();
  };
}

async function events(it: AsyncIterable<StreamEvent>) {
  const out: StreamEvent[] = [];
  for await (const e of it) out.push(e);
  return out;
}

const anthropicBlocks = [
  'event: message_start\ndata: {"type":"message_start"}\n\n',
  'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"안녕"}}\n\n',
  'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"하세요"}}\n\n',
  'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"}}\n\n',
  'event: message_stop\ndata: {"type":"message_stop"}\n\n',
];

describe('AnthropicApiProvider', () => {
  it('SSE를 delta/done으로 변환하고 공식 헤더·본문을 보낸다', async () => {
    const calls: Call[] = [];
    const p = createAnthropicProvider({
      getKey: async () => 'sk-ant-test-1234567890',
      fetch: fakeFetch(() => sseResponse(anthropicBlocks), calls),
      baseUrl: 'http://mock/',
    });
    const evs = await events(p.stream({ system: 'SYS', messages: [{ role: 'user', content: 'Q' }] }));
    expect(evs).toEqual([
      { type: 'delta', text: '안녕' },
      { type: 'delta', text: '하세요' },
      { type: 'done', stopReason: 'end_turn' },
    ]);
    expect(calls[0]!.url).toBe('http://mock/v1/messages');
    const h = calls[0]!.init!.headers as Record<string, string>;
    expect(h['x-api-key']).toBe('sk-ant-test-1234567890');
    expect(h['anthropic-version']).toBe('2023-06-01');
    const body = JSON.parse(calls[0]!.init!.body as string);
    expect(body).toMatchObject({ system: 'SYS', stream: true, messages: [{ role: 'user', content: 'Q' }] });
  });

  it('키가 없으면 no-key / auth 오류', async () => {
    const p = createAnthropicProvider({ getKey: async () => null, fetch: fakeFetch(() => sseResponse([])) });
    expect((await p.available()).status).toBe('no-key');
    const [ev] = await events(p.stream({ system: '', messages: [] }));
    expect(ev).toMatchObject({ type: 'error', error: { code: 'auth', retryable: false } });
  });

  it('available()의 detail은 마스킹된 키다', async () => {
    const p = createAnthropicProvider({ getKey: async () => 'sk-ant-abcdefghijklmnop', fetch: fakeFetch(() => sseResponse([])) });
    const a = await p.available();
    expect(a).toEqual({ status: 'ready', detail: 'sk-a…mnop' });
  });

  it('HTTP 401/429를 auth/rate-limit으로 매핑', async () => {
    for (const [status, code] of [
      [401, 'auth'],
      [429, 'rate-limit'],
      [500, 'network'],
    ] as const) {
      const p = createAnthropicProvider({
        getKey: async () => 'k',
        fetch: fakeFetch(() => new Response(JSON.stringify({ error: { message: 'nope' } }), { status })),
      });
      const [ev] = await events(p.stream({ system: '', messages: [] }));
      expect(ev).toMatchObject({ type: 'error', error: { code } });
    }
  });

  it('fetch 실패(TypeError)는 offline, 중간 끊김은 network', async () => {
    const off = createAnthropicProvider({
      getKey: async () => 'k',
      fetch: async () => {
        throw new TypeError('Failed to fetch');
      },
    });
    expect((await events(off.stream({ system: '', messages: [] })))[0]).toMatchObject({ error: { code: 'offline' } });

    const cut = createAnthropicProvider({ getKey: async () => 'k', fetch: fakeFetch(() => sseResponse(anthropicBlocks.slice(0, 2))) });
    const evs = await events(cut.stream({ system: '', messages: [] }));
    expect(evs.at(-1)).toMatchObject({ type: 'error', error: { code: 'network' } });
    expect(evs[0]).toEqual({ type: 'delta', text: '안녕' });
  });

  it('스트림 중 error 이벤트(overloaded)를 rate-limit으로', async () => {
    const p = createAnthropicProvider({
      getKey: async () => 'k',
      fetch: fakeFetch(() => sseResponse(['event: error\ndata: {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}\n\n'])),
    });
    expect((await events(p.stream({ system: '', messages: [] })))[0]).toMatchObject({ error: { code: 'rate-limit' } });
  });
});

describe('OpenAIApiProvider', () => {
  it('system을 앞에 붙이고 choices.delta.content를 스트리밍한다', async () => {
    const calls: Call[] = [];
    const p = createOpenAIProvider({
      getKey: async () => 'sk-openai',
      getModel: () => 'gpt-test',
      fetch: fakeFetch(
        () =>
          sseResponse([
            'data: {"choices":[{"delta":{"role":"assistant"}}]}\n\n',
            'data: {"choices":[{"delta":{"content":"A"}}]}\n\n',
            'data: {"choices":[{"delta":{"content":"B"},"finish_reason":"stop"}]}\n\n',
            'data: [DONE]\n\n',
          ]),
        calls,
      ),
    });
    const text = await collectStream(p, { system: 'SYS', messages: [{ role: 'user', content: 'Q' }] });
    expect(text).toBe('AB');
    const body = JSON.parse(calls[0]!.init!.body as string);
    expect(body.model).toBe('gpt-test');
    expect(body.messages[0]).toEqual({ role: 'system', content: 'SYS' });
    expect((calls[0]!.init!.headers as Record<string, string>).authorization).toBe('Bearer sk-openai');
  });
});

describe('createRuntimeRegistry', () => {
  const setup = (demo: boolean, patch: Partial<Record<ProviderId, Partial<ConnectionState>>> = {}) => {
    const secrets = memorySecretStore();
    const conns = defaultConnections();
    for (const [id, p] of Object.entries(patch)) Object.assign(conns[id as ProviderId], p);
    const calls: Call[] = [];
    const registry = createRuntimeRegistry({
      secrets,
      getConnections: () => conns,
      isDemo: () => demo,
      fetch: fakeFetch(() => sseResponse(anthropicBlocks), calls),
    });
    return { secrets, registry, calls };
  };

  it('실제 모드: 키가 없으면 no-key, 키를 넣으면 실호출', async () => {
    const { secrets, registry, calls } = setup(false);
    const p = registry.get('anthropic-api')!;
    expect((await p.available()).status).toBe('no-key');
    await secrets.set(secretName.apiKey('anthropic-api'), 'sk-ant-xxxxxxxxxxxx');
    expect((await p.available()).status).toBe('ready');
    expect(await collectStream(p, { system: '', messages: [{ role: 'user', content: 'hi' }] })).toBe('안녕하세요');
    expect(calls).toHaveLength(1);
  });

  it('웹에서 CLI는 not-installed 스텁, 원격 Bridge는 unpaired', async () => {
    const { registry } = setup(false, { 'codex-cli': { enabled: true } });
    expect((await registry.get('claude-cli')!.available()).status).toBe('not-installed');
    expect((await registry.get('remote-bridge')!.available()).status).toBe('unpaired');
    const [ev] = await events(registry.get('codex-cli')!.stream({ system: '', messages: [] }));
    expect(ev).toMatchObject({ type: 'error', error: { code: 'cli' } });
  });

  it('비활성화된 연결은 호출을 막는다', async () => {
    const { secrets, registry, calls } = setup(false, { 'anthropic-api': { enabled: false } });
    await secrets.set(secretName.apiKey('anthropic-api'), 'k');
    const [ev] = await events(registry.get('anthropic-api')!.stream({ system: '', messages: [] }));
    expect(ev).toMatchObject({ type: 'error', error: { code: 'offline' } });
    expect(calls).toHaveLength(0);
  });

  it('데모 모드: 실호출 없이 Mock이 응답', async () => {
    const { registry, calls } = setup(true);
    const p = registry.get('anthropic-api')!;
    expect((await p.available()).status).toBe('ready');
    expect(calls).toHaveLength(0);
  });
});
