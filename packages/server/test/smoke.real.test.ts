import { readFile, writeFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import {
  createAppStore,
  createDemoRegistry,
  createRemoteBridgeLink,
  createSyncClient,
  emptyView,
  pairWithBridge,
  parsePairingUri,
  syncLinkOf,
  type AppStore,
  type RemotePairing,
  type WebSocketFactory,
} from '@branch/core';

/**
 * 실제 `rhymebook serve`(빌드 산출물 + 실제 CLI)에 대한 수동 스모크.
 *   RHYMEBOOK_SMOKE_DIR=<serve --dir> RHYMEBOOK_SMOKE_PHASE=ask|verify pnpm --filter @branch/server vitest run test/smoke.real.test.ts
 * ask: out.log의 페어링 링크로 페어링 → 새 학습·질문 → 답변 대기. verify: 같은 페어링으로 재접속해 데이터 확인.
 */
const dir = process.env.RHYMEBOOK_SMOKE_DIR;
const phase = process.env.RHYMEBOOK_SMOKE_PHASE;
const wsFactory: WebSocketFactory = (url) => new WebSocket(url);
const until = async (cond: () => boolean, ms: number) => {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error('until: timeout');
    await new Promise((r) => setTimeout(r, 50));
  }
};

async function connect(pairing: RemotePairing) {
  const store: AppStore = createAppStore({ registry: createDemoRegistry(() => store.getState().connections), initial: { view: emptyView(null) }, remote: true });
  const client = createSyncClient({ store, link: syncLinkOf(createRemoteBridgeLink({ getPairing: async () => pairing, wsFactory })), isPaired: async () => true, autoReconnect: false });
  client.start();
  await until(() => client.state.getState().status === 'online', 10_000);
  return { store, client };
}

describe.skipIf(!dir)('실제 rhymebook serve 스모크', () => {
  it(phase ?? 'ask', { timeout: 180_000 }, async () => {
    const pairFile = `${dir}/smoke-pairing.json`;
    if (phase !== 'verify') {
      const log = await readFile(`${dir}/out.log`, 'utf8');
      const offer = parsePairingUri(/branch:\/\/pair\S+/.exec(log)![0])!;
      const pairing = await pairWithBridge({ offer: { ...offer, url: offer.url.replace(/\/\/[^:/]+:/, '//127.0.0.1:') }, deviceName: '스모크 폰', wsFactory });
      await writeFile(pairFile, JSON.stringify(pairing), { mode: 0o600 });
      const { store, client } = await connect(pairing);
      console.log('hostName', client.state.getState().hostName);
      const sid = store.getState().newRootSession() as string;
      store.getState().sendMessage(sid, '한 문장으로만 답해 줘: 1+1은?');
      const t0 = Date.now();
      let firstDelta = 0;
      await until(() => {
        const a = (store.getState().messages[sid] ?? []).find((m) => m.role === 'assistant');
        if (a?.content && !firstDelta) firstDelta = Date.now() - t0;
        return a?.status === 'done' || a?.status === 'error';
      }, 170_000);
      const a = store.getState().messages[sid]!.find((m) => m.role === 'assistant')!;
      console.log('session', sid, 'provider', store.getState().sessions[sid]?.providerId, 'status', a.status, 'firstDeltaMs', firstDelta, 'totalMs', Date.now() - t0);
      console.log('answer', a.content.slice(0, 200));
      expect(a.status).toBe('done');
      client.stop();
    } else {
      const pairing = JSON.parse(await readFile(pairFile, 'utf8')) as RemotePairing;
      const { store, client } = await connect(pairing);
      const ids = Object.keys(store.getState().sessions);
      console.log('sessions after restart', ids);
      expect(ids.length).toBeGreaterThan(0);
      client.ensureMessages(ids[0]!);
      await until(() => (store.getState().messages[ids[0]!] ?? []).some((m) => m.role === 'assistant' && m.status === 'done'), 10_000);
      console.log('answer after restart', store.getState().messages[ids[0]!]!.find((m) => m.role === 'assistant')!.content.slice(0, 200));
      client.stop();
    }
  });
});
