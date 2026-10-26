import { beforeEach, describe, expect, it } from 'vitest';
import { opFeature, validateSyncClientMsg } from '../src/bridge/sync';
import { createBridgeClient } from '../src/bridge/client';
import type { BridgeClientMsg, BridgeServerMsg } from '../src/bridge/protocol';
import { supportsWebTools, upsertTool, wantsWebTools, type StreamEvent, type StreamRequest } from '../src/provider';
import { anthropicWebTools, createAnthropicProvider } from '../src/providers/anthropic';
import { createDemoRegistry } from '../src/providers/demo';
import { createMockProvider, mockControl } from '../src/providers/mock';
import type { FetchLike } from '../src/providers/http';
import { createSeed, emptyView, SEED_IDS } from '../src/seed';
import { createAppStore, type AppStore } from '../src/store';

async function events(it: AsyncIterable<StreamEvent>) {
  const out: StreamEvent[] = [];
  for await (const e of it) out.push(e);
  return out;
}

function sse(events: Record<string, unknown>[]): Response {
  const enc = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      for (const e of events) c.enqueue(enc.encode(`event: ${String(e.type)}\ndata: ${JSON.stringify(e)}\n\n`));
      c.close();
    },
  });
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

const text = (evs: StreamEvent[]) => evs.map((e) => (e.type === 'delta' ? e.text : '')).join('');
const tools = (evs: StreamEvent[]) => evs.flatMap((e) => (e.type === 'tool' ? [e.tool] : []));

/** 검색 → 결과 → 글 (pause_turn 없음) */
const searchTurn = (stop: string, i0 = 0) => [
  { type: 'message_start' },
  { type: 'content_block_start', index: i0, content_block: { type: 'text', text: '' } },
  { type: 'content_block_delta', index: i0, delta: { type: 'text_delta', text: '찾아볼게요.' } },
  { type: 'content_block_stop', index: i0 },
  { type: 'content_block_start', index: i0 + 1, content_block: { type: 'server_tool_use', id: 'srvtoolu_1', name: 'web_search', input: {} } },
  { type: 'content_block_delta', index: i0 + 1, delta: { type: 'input_json_delta', partial_json: '{"query":' } },
  { type: 'content_block_delta', index: i0 + 1, delta: { type: 'input_json_delta', partial_json: '"서울 날씨"}' } },
  { type: 'content_block_stop', index: i0 + 1 },
  {
    type: 'content_block_start',
    index: i0 + 2,
    content_block: {
      type: 'web_search_tool_result',
      tool_use_id: 'srvtoolu_1',
      content: [
        { type: 'web_search_result', url: 'https://www.weather.go.kr/', title: '기상청', encrypted_content: 'x' },
        { type: 'web_search_result', url: 'https://example.com/' },
      ],
    },
  },
  { type: 'content_block_stop', index: i0 + 2 },
  { type: 'message_delta', delta: { stop_reason: stop } },
  { type: 'message_stop' },
];

const answerTurn = [
  { type: 'message_start' },
  { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
  { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '맑아요.' } },
  { type: 'content_block_stop', index: 0 },
  { type: 'message_delta', delta: { stop_reason: 'end_turn' } },
  { type: 'message_stop' },
];

describe('웹 도구 공통 (ADR-070)', () => {
  it('일반 대화에서만 도구를 쓰고, OpenAI API는 미지원', () => {
    expect(wantsWebTools({ webSearch: true })).toBe(true);
    expect(wantsWebTools({ webSearch: true, purpose: 'chat' })).toBe(true);
    expect(wantsWebTools({ webSearch: true, purpose: 'summary' })).toBe(false);
    expect(wantsWebTools({ webSearch: false })).toBe(false);
    expect(wantsWebTools({})).toBe(false);
    expect(supportsWebTools('anthropic-api')).toBe(true);
    expect(supportsWebTools('claude-cli')).toBe(true);
    expect(supportsWebTools('openai-api')).toBe(false);
  });

  it('upsertTool: 같은 id는 합치고, 끝난 도구는 running으로 되돌아가지 않는다', () => {
    let list = upsertTool(undefined, { id: 'a', name: 'web_search', status: 'running', query: 'q' });
    list = upsertTool(list, { id: 'b', name: 'web_fetch', status: 'running' });
    list = upsertTool(list, { id: 'a', name: 'web_search', status: 'done', sources: [{ url: 'https://x' }] });
    list = upsertTool(list, { id: 'a', name: 'web_search', status: 'running' });
    expect(list).toEqual([
      { id: 'a', name: 'web_search', status: 'done', query: 'q', sources: [{ url: 'https://x' }] },
      { id: 'b', name: 'web_fetch', status: 'running' },
    ]);
  });

  it('anthropic 도구 버전: 최신 모델은 동적 필터링, 그 밖은 기본', () => {
    expect(anthropicWebTools('claude-opus-5-5').map((t) => t.type)).toEqual(['web_search_20260209', 'web_fetch_20260209']);
    expect(anthropicWebTools('claude-sonnet-4-6').map((t) => t.type)).toEqual(['web_search_20260209', 'web_fetch_20260209']);
    expect(anthropicWebTools('claude-haiku-4-5-20251001').map((t) => t.type)).toEqual(['web_search_20250305', 'web_fetch_20250910']);
  });
});

describe('Anthropic 서버 웹 도구', () => {
  const bodies: Record<string, unknown>[] = [];
  const provider = (turns: Record<string, unknown>[][]) => {
    bodies.length = 0;
    let n = 0;
    const fetch: FetchLike = async (_url, init) => {
      bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return sse(turns[Math.min(n++, turns.length - 1)]!);
    };
    return createAnthropicProvider({ getKey: async () => 'k', fetch, baseUrl: 'http://mock/' });
  };
  const req = (r: Partial<StreamRequest> = {}): StreamRequest => ({ system: 's', messages: [{ role: 'user', content: '날씨' }], model: 'claude-opus-5-5', ...r });

  it('검색 사용 → running/done + 출처, 결과 뒤 글은 문단을 나눈다', async () => {
    const p = provider([[...searchTurn('end_turn').slice(0, -2), ...answerTurn.slice(1, 4).map((e) => ({ ...e, index: 3 })), ...searchTurn('end_turn').slice(-2)]]);
    const evs = await events(p.stream(req({ webSearch: true })));
    expect(bodies[0]!.tools).toEqual(anthropicWebTools('claude-opus-5-5'));
    expect(tools(evs)).toEqual([
      { id: 'srvtoolu_1', name: 'web_search', status: 'running', query: '서울 날씨' },
      { id: 'srvtoolu_1', name: 'web_search', status: 'done', sources: [{ url: 'https://www.weather.go.kr/', title: '기상청' }, { url: 'https://example.com/' }] },
    ]);
    expect(text(evs)).toBe('찾아볼게요.\n\n맑아요.');
    expect(evs.at(-1)).toEqual({ type: 'done', stopReason: 'end_turn' });
  });

  it('pause_turn이면 받은 블록을 assistant 턴으로 붙여 이어 받는다', async () => {
    const p = provider([searchTurn('pause_turn'), answerTurn]);
    const evs = await events(p.stream(req({ webSearch: true })));
    expect(bodies).toHaveLength(2);
    const msgs = bodies[1]!.messages as { role: string; content: { type: string; input?: unknown }[] }[];
    expect(msgs.at(-1)!.role).toBe('assistant');
    expect(msgs.at(-1)!.content.map((b) => b.type)).toEqual(['text', 'server_tool_use', 'web_search_tool_result']);
    expect(msgs.at(-1)!.content[1]!.input).toEqual({ query: '서울 날씨' });
    expect(text(evs)).toBe('찾아볼게요.\n\n맑아요.');
    expect(evs.at(-1)).toEqual({ type: 'done', stopReason: 'end_turn' });
  });

  it('요약 요청·꺼진 세션은 tools를 보내지 않는다', async () => {
    const p = provider([answerTurn]);
    await events(p.stream(req({ webSearch: true, purpose: 'summary' })));
    await events(p.stream(req({ webSearch: false })));
    expect(bodies.every((b) => !('tools' in b))).toBe(true);
  });

  it('검색 오류 결과는 error 상태', async () => {
    const p = provider([
      [
        { type: 'message_start' },
        { type: 'content_block_start', index: 0, content_block: { type: 'web_search_tool_result', tool_use_id: 't', content: { type: 'web_search_tool_result_error', error_code: 'max_uses_exceeded' } } },
        { type: 'message_delta', delta: { stop_reason: 'end_turn' } },
        { type: 'message_stop' },
      ],
    ]);
    expect(tools(await events(p.stream(req({ webSearch: true }))))).toEqual([{ id: 't', name: 'web_search', status: 'error' }]);
  });
});

describe('mock·store 웹 검색', () => {
  beforeEach(() => {
    mockControl.firstTokenDelay = 0;
    mockControl.speed = 0;
    mockControl.failNext = false;
  });

  it('mock은 검색 요청에만 가짜 검색 이벤트를 낸다', async () => {
    const p = createMockProvider();
    const on = await events(p.stream({ system: 's', messages: [{ role: 'user', content: '최신 뉴스 검색해줘' }], webSearch: true }));
    expect(tools(on).map((t) => t.status)).toEqual(['running', 'done']);
    const off = await events(p.stream({ system: 's', messages: [{ role: 'user', content: '최신 뉴스 검색해줘' }] }));
    expect(tools(off)).toEqual([]);
  });

  const idle = (store: AppStore) =>
    new Promise<void>((resolve) => {
      const check = () => (Object.keys(store.getState().streaming).length === 0 ? resolve() : setTimeout(check, 5));
      setTimeout(check, 5);
    });

  it('세션 토글: 기본 켜짐, 끄면 webSearch=false, 답변에 도구 내역이 남는다', async () => {
    const store: AppStore = createAppStore({
      registry: createDemoRegistry(() => store.getState().connections),
      initial: { ...createSeed(0), view: emptyView(SEED_IDS.root) },
    });
    const id = SEED_IDS.root;
    expect(store.getState().sessions[id]!.webSearch).toBeUndefined();
    store.getState().sendMessage(id, '최신 뉴스 검색해줘');
    await idle(store);
    const last = store.getState().messages[id]!.at(-1)!;
    expect(last.tools?.map((t) => [t.name, t.status])).toEqual([['web_search', 'done']]);

    store.getState().setSessionWebSearch(id, false);
    expect(store.getState().sessions[id]!.webSearch).toBe(false);
    store.getState().sendMessage(id, '최신 뉴스 검색해줘');
    await idle(store);
    expect(store.getState().messages[id]!.at(-1)!.tools).toBeUndefined();

    store.getState().setSessionWebSearch(id, true);
    expect('webSearch' in store.getState().sessions[id]!).toBe(false);
  });
});

describe('sync·bridge 웹 검색', () => {
  it('session.agent webSearch 검증과 호스트 기능 요구', () => {
    const act = (op: Record<string, unknown>) => validateSyncClientMsg({ type: 'act', reqId: 'r1', op });
    expect(act({ kind: 'session.agent', sessionId: 's1', webSearch: false })).not.toBeNull();
    expect(act({ kind: 'session.agent', sessionId: 's1', webSearch: 'no' })).toBeNull();
    expect(opFeature({ kind: 'session.agent', sessionId: 's1', webSearch: true })).toBe('websearch');
    expect(opFeature({ kind: 'session.agent', sessionId: 's1', model: 'x' })).toBeUndefined();
  });

  it('bridge client: 일반 대화에 webSearch를 싣고 chat.tool을 tool 이벤트로 넘긴다', async () => {
    const sent: BridgeClientMsg[] = [];
    const listeners = new Set<(m: BridgeServerMsg) => void>();
    const client = createBridgeClient({
      send(m) {
        sent.push(m);
        if (m.type !== 'chat.start') return;
        const reply = (r: BridgeServerMsg) => listeners.forEach((l) => l(r));
        queueMicrotask(() => {
          reply({ type: 'chat.tool', reqId: m.reqId, tool: { id: 't', name: 'web_search', status: 'running' } });
          reply({ type: 'chat.delta', reqId: m.reqId, text: '답' });
          reply({ type: 'chat.done', reqId: m.reqId });
        });
      },
      subscribe(l) {
        listeners.add(l);
        return () => listeners.delete(l);
      },
    });
    const evs = await events(client.stream('claude-cli', { system: 's', messages: [], webSearch: true }));
    expect(evs).toEqual([{ type: 'tool', tool: { id: 't', name: 'web_search', status: 'running' } }, { type: 'delta', text: '답' }, { type: 'done' }]);
    await events(client.stream('claude-cli', { system: 's', messages: [], webSearch: true, purpose: 'title' }));
    const starts = sent.filter((m) => m.type === 'chat.start');
    expect(starts.map((m) => m.webSearch)).toEqual([true, undefined]);
  });
});
