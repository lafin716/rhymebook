import { describe, expect, it } from 'vitest';
import { createBridgeClient, type BridgeServerMsg, type StreamEvent } from '@branch/core';
import { createBridgeServer } from '../src';

/** 실제 로그인된 CLI로 확인할 때만: BRANCH_REAL_CLI=1 pnpm --filter @branch/bridge test */
const real = process.env.BRANCH_REAL_CLI === '1';

describe.skipIf(!real)('실제 CLI', () => {
  const server = createBridgeServer();
  const listeners = new Set<(m: BridgeServerMsg) => void>();
  const conn = server.connect((m) => listeners.forEach((l) => l(m)));
  const client = createBridgeClient({
    send: (m) => conn.receive(m),
    subscribe(l) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  });

  it('상태', async () => {
    const st = await client.status(true);
    console.log(st);
    expect(st['claude-cli'].status).toBeDefined();
  }, 30_000);

  for (const id of ['claude-cli', 'codex-cli'] as const) {
    it(`${id} 스트리밍`, async () => {
      const evs: StreamEvent[] = [];
      const t0 = Date.now();
      for await (const ev of client.stream(id, {
        system: '한국어로 한 문장으로만 답하세요.',
        messages: [
          { role: 'user', content: '어텐션이 뭐야?' },
          { role: 'assistant', content: '입력의 어느 부분에 집중할지 가중치를 매기는 방법입니다.' },
          { role: 'user', content: '비유로 설명해줘' },
        ],
      })) {
        evs.push(ev);
      }
      const deltas = evs.filter((e) => e.type === 'delta').length;
      console.log(id, `${Date.now() - t0}ms`, `deltas=${deltas}`, JSON.stringify(evs.at(-1)), evs.map((e) => (e.type === 'delta' ? e.text : '')).join(''));
      expect(evs.at(-1)?.type).toBe('done');
    }, 120_000);
  }
});
