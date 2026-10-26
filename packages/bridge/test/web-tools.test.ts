import { describe, expect, it } from 'vitest';
import { createBridgeClient, type BridgeServerMsg, type BridgeTransport, type StreamEvent } from '@branch/core';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { claudeArgs, codexArgs, createBridgeServer, createClaudeParser, createCodexParser } from '../src';

const dir = path.dirname(fileURLToPath(import.meta.url));

function transport(mode: string): BridgeTransport {
  const server = createBridgeServer({
    cliEnv: { env: { ...process.env, FAKE_MODE: mode }, bin: { 'claude-cli': path.join(dir, 'fixtures/fake-claude.mjs'), 'codex-cli': path.join(dir, 'fixtures/fake-codex.mjs') } },
  });
  const listeners = new Set<(m: BridgeServerMsg) => void>();
  const conn = server.connect((m) => listeners.forEach((l) => l(m)));
  return {
    send: (m) => conn.receive(m),
    subscribe(l) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
}

async function collect(it: AsyncIterable<StreamEvent>): Promise<StreamEvent[]> {
  const out: StreamEvent[] = [];
  for await (const ev of it) out.push(ev);
  return out;
}

const text = (evs: StreamEvent[]) => evs.map((e) => (e.type === 'delta' ? e.text : '')).join('');
const tools = (evs: StreamEvent[]) => evs.flatMap((e) => (e.type === 'tool' ? [e.tool] : []));

describe('웹 검색 도구 (ADR-070)', () => {
  it('claude: 켜면 WebSearch·WebFetch만 허용, 끄면 도구 전부 끔', () => {
    const on = claudeArgs({ systemFile: 's', webSearch: true });
    expect(on[on.indexOf('--tools') + 1]).toBe('WebSearch,WebFetch');
    expect(on[on.indexOf('--allowedTools') + 1]).toBe('WebSearch,WebFetch');
    const off = claudeArgs({ systemFile: 's' });
    expect(off[off.indexOf('--tools') + 1]).toBe('');
    expect(off).not.toContain('--allowedTools');
  });

  it('codex: 켜면 web_search=live, 끄면 disabled (셸은 계속 끔)', () => {
    const on = codexArgs({ webSearch: true });
    expect(on).toContain('web_search=live');
    expect(on).toContain('features.shell_tool=false');
    expect(codexArgs({})).toContain('web_search=disabled');
  });

  it('claude 파서: tool_use → running, tool_result → done + 출처, 도구 뒤 글은 문단을 나눈다', () => {
    const p = createClaudeParser();
    const delta = (t: string) => ({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: t } } });
    const evs = [
      delta('검색할게요.'),
      { type: 'assistant', message: { model: 'claude', content: [{ type: 'text', text: '검색할게요.' }] } },
      { type: 'assistant', message: { model: 'claude', content: [{ type: 'tool_use', id: 't1', name: 'WebFetch', input: { url: 'https://example.com', prompt: '제목' } }] } },
      // 같은 id는 다시 알리지 않는다
      { type: 'assistant', message: { model: 'claude', content: [{ type: 'tool_use', id: 't1', name: 'WebFetch', input: {} }] } },
      {
        type: 'user',
        message: { role: 'user', content: [{ tool_use_id: 't1', type: 'tool_result', content: 'ok' }] },
        tool_use_result: { bytes: 10, code: 200, result: '...', url: 'https://example.com' },
      },
      { type: 'stream_event', event: { type: 'message_start' } },
      delta('Example Domain입니다.'),
      { type: 'result', subtype: 'success', is_error: false, result: '', stop_reason: 'end_turn' },
    ].flatMap((l) => p.line(l));
    expect(text(evs)).toBe('검색할게요.\n\nExample Domain입니다.');
    expect(tools(evs)).toEqual([
      { id: 't1', name: 'web_fetch', status: 'running', url: 'https://example.com' },
      { id: 't1', name: 'web_fetch', status: 'done', url: 'https://example.com', sources: [{ url: 'https://example.com' }] },
    ]);
    expect(evs.at(-1)).toEqual({ type: 'done', stopReason: 'end_turn' });
  });

  it('claude 파서: 실패한 tool_result는 error', () => {
    const p = createClaudeParser();
    p.line({ type: 'assistant', message: { model: 'claude', content: [{ type: 'tool_use', id: 't2', name: 'WebSearch', input: { query: 'q' } }] } });
    const evs = p.line({ type: 'user', message: { content: [{ tool_use_id: 't2', type: 'tool_result', is_error: true, content: 'denied' }] } });
    expect(tools(evs)).toEqual([{ id: 't2', name: 'web_search', status: 'error', query: 'q' }]);
  });

  it('codex 파서: web_search 항목 → running/done (빈 query·결과도 처리)', () => {
    const p = createCodexParser();
    const started = { type: 'item.started', item: { id: 'exec-1', type: 'web_search', query: '', action: { type: 'search', query: '서울 날씨' } } };
    const done = { type: 'item.completed', item: { ...started.item, results: [{ url: 'https://a.example', title: 'A' }] } };
    expect(tools([...p.line(started), ...p.line(done)])).toEqual([
      { id: 'codex-exec-1', name: 'web_search', status: 'running', query: '서울 날씨' },
      { id: 'codex-exec-1', name: 'web_search', status: 'done', query: '서울 날씨', sources: [{ url: 'https://a.example', title: 'A' }] },
    ]);
    const bare = { type: 'item.completed', item: { id: 'exec-2', type: 'web_search', query: '', action: { type: 'other' }, results: [] } };
    expect(tools(p.line(bare))).toEqual([{ id: 'codex-exec-2', name: 'web_search', status: 'done' }]);
  });

  it('bridge: 일반 대화는 도구 이벤트를 chat.tool로 넘기고 스트림을 끝까지 이어 받는다', async () => {
    const client = createBridgeClient(transport('tools'));
    const evs = await collect(client.stream('claude-cli', { system: 's', messages: [{ role: 'user', content: '날씨' }], webSearch: true }));
    expect(text(evs)).toBe('찾아볼게요.\n\n맑아요.');
    expect(tools(evs).map((t) => t.status)).toEqual(['running', 'done']);
    expect(tools(evs)[1]!.sources).toEqual([{ url: 'https://www.weather.go.kr/', title: '기상청' }]);
    expect(evs.at(-1)).toEqual({ type: 'done', stopReason: 'end_turn' });
  });

  it('bridge: 요약 요청이나 꺼진 세션은 도구 없이 실행한다', async () => {
    const client = createBridgeClient(transport('tools'));
    for (const r of [{ webSearch: true, purpose: 'summary' as const }, { webSearch: false }]) {
      const evs = await collect(client.stream('claude-cli', { system: 's', messages: [{ role: 'user', content: '날씨' }], ...r }));
      expect(tools(evs)).toEqual([]);
      expect(text(evs)).toBe('찾아볼게요.맑아요.');
    }
  });
});
