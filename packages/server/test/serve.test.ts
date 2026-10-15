import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createAppStore,
  createBridgeClient,
  createDemoRegistry,
  createRemoteBridgeLink,
  createSyncClient,
  emptyView,
  encodeWav,
  pairWithBridge,
  syncLinkOf,
  type AppStore,
  type RemotePairing,
  type SttModelInfo,
  type SyncClient,
  type WebSocketFactory,
} from '@branch/core';
import { createHeadlessHost, type HeadlessHost, type HeadlessHostOptions } from '../src/engine';

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../bridge/test/fixtures');
const wsFactory: WebSocketFactory = (url) => new WebSocket(url);

const until = async (cond: () => boolean, ms = 8000) => {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error('until: timeout');
    await new Promise((r) => setTimeout(r, 10));
  }
};

let dir: string;
let host: HeadlessHost | null = null;
let clients: SyncClient[] = [];

async function start(extra: Partial<HeadlessHostOptions> = {}) {
  host = await createHeadlessHost({
    dir,
    name: '헤드리스 PC',
    host: '127.0.0.1',
    port: 0,
    saveIntervalMs: 20,
    cliEnv: {
      env: { ...process.env, FAKE_MODE: 'ok' },
      bin: { 'claude-cli': path.join(fixtures, 'fake-claude.mjs'), 'codex-cli': path.join(fixtures, 'fake-codex.mjs') },
    },
    ...extra,
  });
  const { port } = await host.listen();
  return { host, url: `ws://127.0.0.1:${port}` };
}

async function pair(h: HeadlessHost, url: string): Promise<RemotePairing> {
  const session = h.remote.startPairing();
  return pairWithBridge({ offer: { url, bridgeKey: h.bridgeStore.identity.publicKey, token: session.token }, deviceName: '내 폰', wsFactory });
}

/** 웹·모바일 앱과 같은 구성: 원격 모드 스토어 + 동기화 클라이언트 */
async function connect(pairing: RemotePairing): Promise<{ store: AppStore; client: SyncClient; link: ReturnType<typeof createRemoteBridgeLink> }> {
  const store: AppStore = createAppStore({
    registry: createDemoRegistry(() => store.getState().connections),
    initial: { view: emptyView(null) },
    remote: true,
  });
  const link = createRemoteBridgeLink({ getPairing: () => Promise.resolve(pairing), wsFactory });
  const client = createSyncClient({ store, link: syncLinkOf(link), isPaired: async () => true, autoReconnect: false });
  clients.push(client);
  client.start();
  await until(() => client.state.getState().status === 'online');
  return { store, client, link };
}

const answerOf = (store: AppStore, sessionId: string) =>
  Object.values(store.getState().messages[sessionId] ?? []).find((m) => m.role === 'assistant');

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'rhymebook-serve-'));
});
afterEach(async () => {
  for (const c of clients) c.stop();
  clients = [];
  await host?.close();
  host = null;
  await rm(dir, { recursive: true, force: true });
});

describe('rhymebook serve (헤드리스 호스트)', () => {
  it('페어링 → 동기화 → 새 학습·질문 → PC CLI 답변 → 재시작 후에도 유지', { timeout: 20000 }, async () => {
    const first = await start();
    expect(first.host.rootProvider()).toBe('claude-cli');
    const pairing = await pair(first.host, first.url);
    const { store, client } = await connect(pairing);
    expect(client.state.getState().hostName).toBe('헤드리스 PC');

    const sid = store.getState().newRootSession() as string;
    expect(sid).toBeTruthy();
    await until(() => !!first.host.store.getState().sessions[sid]);
    expect(first.host.store.getState().sessions[sid]!.providerId).toBe('claude-cli');
    store.getState().sendMessage(sid, '안녕?');
    await until(() => answerOf(store, sid)?.status === 'done');
    expect(answerOf(store, sid)!.content).toContain('안녕하세요');

    // 재시작: 데이터와 페어링이 그대로
    client.stop();
    await first.host.close();
    const saved = JSON.parse(await readFile(path.join(dir, 'data.json'), 'utf8')) as { sessions: { id: string }[] };
    expect(saved.sessions.map((s) => s.id)).toContain(sid);
    expect(JSON.stringify(saved)).not.toContain(pairing.deviceSecret);

    // --name 없이 다시 켜도 처음 이름 유지
    const second = await start({ port: Number(new URL(first.url).port), name: '' });
    expect(second.host.bridgeStore.name).toBe('헤드리스 PC');
    const again = await connect(pairing);
    await until(() => !!again.store.getState().sessions[sid]);
    again.client.ensureMessages(sid);
    await until(() => answerOf(again.store, sid)?.content.includes('안녕하세요') ?? false);
  });

  it('PC 스킬 폴더(처음엔 기본 예시)를 원격에 목록으로 준다', async () => {
    const s = await start();
    const { client } = await connect(await pair(s.host, s.url));
    const skills = await client.pullSkills();
    expect(skills.length).toBeGreaterThan(0);
    expect(skills.every((k) => /^[a-z0-9-]+$/.test(k.name) && k.prompt.length > 0)).toBe(true);
  });

  it('--no-delete면 원격 삭제를 거절한다', async () => {
    const s = await start({ allowDelete: false });
    const { store, client } = await connect(await pair(s.host, s.url));
    const sid = store.getState().newRootSession() as string;
    expect(sid).toBeTruthy();
    await until(() => !!s.host.store.getState().sessions[sid]);
    store.getState().deleteSession(sid);
    await until(() => client.state.getState().lastFailure?.code === 'forbidden');
    expect(s.host.store.getState().sessions[sid]).toBeTruthy();
  });

  it('음성 입력: 원격 기기가 PC 설정을 보고 바꾸고(켜기·모델 받기) 전사한다 (ADR-047)', { timeout: 15000 }, async () => {
    const BODY = 'tiny-model';
    const MODEL: SttModelInfo = {
      id: 'small-q5_1',
      label: 't',
      note: '',
      file: 'ggml-test.bin',
      size: BODY.length,
      sha256: createHash('sha256').update(BODY).digest('hex'),
    };
    const fakeFetch = (async () => new Response(BODY, { status: 200 })) as typeof fetch;
    const s = await start({ stt: { binCandidates: [path.join(fixtures, 'fake-whisper.mjs')], fetch: fakeFetch, models: [MODEL] } });
    const { link } = await connect(await pair(s.host, s.url));
    const phone = createBridgeClient(link);

    const first = await phone.sttState();
    expect(first).toMatchObject({ enabled: false, ready: false, engine: true, installed: [] });
    await phone.sttManage('enable');
    await phone.sttManage('select', 'small-q5_1');
    await phone.sttManage('download', 'small-q5_1');
    let st = await phone.sttState();
    for (let i = 0; i < 100 && !st.ready; i++) {
      await new Promise((r) => setTimeout(r, 20));
      st = await phone.sttState();
    }
    expect(st).toMatchObject({ enabled: true, ready: true, model: 'small-q5_1', installed: ['small-q5_1'] });
    // PC(서버) 데이터 폴더에 저장된다
    expect(JSON.parse(await readFile(path.join(dir, 'stt', 'settings.json'), 'utf8'))).toMatchObject({ enabled: true, model: 'small-q5_1' });
    expect(await phone.sttStatus()).toEqual({ enabled: true, ready: true });
    const wav = encodeWav(new Float32Array(1600), 16_000);
    expect(await phone.transcribe(Buffer.from(wav).toString('base64'))).toBe(`모델 ${BODY} 길이 ${wav.length} 언어 ko`);
  });

  it('stt: false면 원격에 지원 안 함으로 답한다', async () => {
    const s = await start({ stt: false });
    expect(s.host.stt).toBeNull();
    const { link } = await connect(await pair(s.host, s.url));
    const phone = createBridgeClient(link);
    expect(await phone.sttStatus()).toMatchObject({ enabled: false, ready: false });
    await expect(phone.sttState()).rejects.toThrow('음성 입력을 지원하지 않습니다');
  });

  it('API 키는 저장 파일에 남지 않는다', async () => {
    const s = await start({ apiKeys: { 'anthropic-api': 'sk-ant-test-secret' } });
    s.host.store.getState().setTheme("dark");
    await s.host.close();
    host = null;
    const text = await readFile(path.join(dir, 'data.json'), 'utf8');
    expect(text).not.toContain('sk-ant-test-secret');
  });
});
