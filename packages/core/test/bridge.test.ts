import { describe, expect, it } from 'vitest';
import {
  cliPrompt,
  collectStream,
  createBridgeClient,
  createBridgeProviders,
  withInstructions,
  type BridgeClientMsg,
  type BridgeServerMsg,
  type BridgeTransport,
} from '../src';

/** 메모리 전송로 + 가짜 bridge (요청에 대한 응답을 스크립트로 정의) */
function fakeTransport(onMsg: (m: BridgeClientMsg, reply: (r: BridgeServerMsg) => void) => void) {
  const listeners = new Set<(m: BridgeServerMsg) => void>();
  const disconnects = new Set<() => void>();
  const sent: BridgeClientMsg[] = [];
  let open = true;
  const t: BridgeTransport = {
    send(m) {
      if (!open) throw new Error('closed');
      sent.push(m);
      queueMicrotask(() => onMsg(m, (r) => listeners.forEach((l) => l(r))));
    },
    subscribe(l) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    onDisconnect(l) {
      disconnects.add(l);
      return () => disconnects.delete(l);
    },
  };
  const close = () => {
    open = false;
    disconnects.forEach((l) => l());
  };
  return { t, sent, close, listeners };
}

const READY = { 'claude-cli': { status: 'ready' as const, detail: 'claude 2' }, 'codex-cli': { status: 'not-logged-in' as const } };

describe('cliPrompt', () => {
  it('passes a single message through and wraps history otherwise', () => {
    expect(cliPrompt([{ role: 'user', content: '안녕' }])).toBe('안녕');
    const p = cliPrompt([
      { role: 'user', content: 'Q1' },
      { role: 'assistant', content: 'A1' },
      { role: 'user', content: 'Q2' },
    ]);
    expect(p).toContain('<conversation>\n[학습자]\nQ1\n\n[튜터]\nA1\n</conversation>');
    expect(p.endsWith('\nQ2')).toBe(true);
    expect(cliPrompt([])).toBe('');
  });

  it('prepends instructions only when present', () => {
    expect(withInstructions('', 'x')).toBe('x');
    expect(withInstructions('짧게', 'x')).toBe('<instructions>\n짧게\n</instructions>\n\nx');
  });
});

describe('bridge client', () => {
  it('maps status per provider and shares one in-flight status request', async () => {
    const { t, sent } = fakeTransport((m, reply) => {
      if (m.type === 'status.get') reply({ type: 'status', reqId: m.reqId, providers: READY });
    });
    const providers = createBridgeProviders(createBridgeClient(t));
    const [a, b] = await Promise.all([providers['claude-cli']!.available(), providers['codex-cli']!.available()]);
    expect(a).toEqual({ status: 'ready', detail: 'claude 2' });
    expect(b).toEqual({ status: 'not-logged-in' });
    expect(sent.filter((m) => m.type === 'status.get')).toHaveLength(1);
  });

  it('reports offline when the transport is closed', async () => {
    const { t, close } = fakeTransport(() => undefined);
    close();
    const p = createBridgeProviders(createBridgeClient(t, { offlineMessage: '꺼짐' }))['claude-cli']!;
    expect(await p.available()).toEqual({ status: 'offline', detail: '꺼짐' });
    const evs = [];
    for await (const ev of p.stream({ system: '', messages: [{ role: 'user', content: 'q' }] })) evs.push(ev);
    expect(evs).toEqual([{ type: 'error', error: { code: 'offline', message: '꺼짐', retryable: true } }]);
  });

  it('streams deltas for its own reqId only', async () => {
    const { t, sent } = fakeTransport((m, reply) => {
      if (m.type !== 'chat.start') return;
      reply({ type: 'chat.delta', reqId: 'other', text: 'X' });
      reply({ type: 'chat.delta', reqId: m.reqId, text: '안' });
      reply({ type: 'chat.delta', reqId: m.reqId, text: '녕' });
      reply({ type: 'chat.done', reqId: m.reqId, stopReason: 'end_turn' });
    });
    const p = createBridgeProviders(createBridgeClient(t))['codex-cli']!;
    const text = await collectStream(p, { system: 'S', messages: [{ role: 'user', content: 'q' }], model: 'm1' });
    expect(text).toBe('안녕');
    const start = sent.find((m) => m.type === 'chat.start');
    expect(start).toMatchObject({ providerId: 'codex-cli', system: 'S', model: 'm1' });
    expect(sent.some((m) => m.type === 'chat.abort')).toBe(false);
  });

  it('sends chat.abort and ends with an aborted error when the signal fires', async () => {
    const ac = new AbortController();
    const { t, sent } = fakeTransport((m, reply) => {
      if (m.type === 'chat.start') reply({ type: 'chat.delta', reqId: m.reqId, text: '부분' });
    });
    const p = createBridgeProviders(createBridgeClient(t))['claude-cli']!;
    const evs = [];
    for await (const ev of p.stream({ system: '', messages: [{ role: 'user', content: 'q' }], signal: ac.signal })) {
      evs.push(ev);
      if (ev.type === 'delta') ac.abort();
    }
    expect(evs.map((e) => e.type)).toEqual(['delta', 'error']);
    expect(evs[1]).toMatchObject({ error: { code: 'aborted' } });
    expect(sent.filter((m) => m.type === 'chat.abort')).toHaveLength(1);
  });

  it('ends a running stream with offline when the transport disconnects', async () => {
    const fake = fakeTransport((m, reply) => {
      if (m.type === 'chat.start') {
        reply({ type: 'chat.delta', reqId: m.reqId, text: 'a' });
        queueMicrotask(() => fake.close());
      }
    });
    const p = createBridgeProviders(createBridgeClient(fake.t))['claude-cli']!;
    await expect(collectStream(p, { system: '', messages: [{ role: 'user', content: 'q' }] })).rejects.toMatchObject({ code: 'offline' });
  });

  it('times out a status request that never gets an answer', async () => {
    const { t } = fakeTransport(() => undefined);
    const client = createBridgeClient(t, { statusTimeoutMs: 20 });
    await expect(client.status()).rejects.toThrow('시간이 초과');
  });
});
