import os from 'node:os';
import { parseArgs } from 'node:util';
import { keyFingerprint } from '@branch/core';
import qrcode from 'qrcode-terminal';
import { createRelayConnector } from './remote/relay';
import { createRemoteServer } from './remote/server';
import { openBridgeStore } from './remote/store';
import { createBridgeServer } from './server';

/**
 * branch-bridge — 헤드리스 bridge (Phase 4).
 *   branch-bridge [serve] [--pair] [--port 7777] [--host 0.0.0.0] [--name 이름] [--relay wss://…] [--relay-only]
 *   branch-bridge devices
 *   branch-bridge unpair <기기 id | all>
 * 비밀 값(기기 키·bridge 비밀키)은 출력하지 않는다. 페어링 토큰·코드는 화면에만 1회 표시.
 */
const USAGE = `사용법:
  branch-bridge [serve] [--pair] [--port 7777] [--host 0.0.0.0] [--name 이름] [--dir 경로]
                [--relay wss://relay.example.com] [--relay-only]
    --relay       NAT 뒤에서도 접속되도록 relay에 아웃바운드로 등록 (E2E 암호화 유지)
    --relay-only  직접 포트를 열지 않고 relay로만 접속 받기
  branch-bridge pair            (serve --pair 와 같음)
  branch-bridge devices         페어링된 기기 목록
  branch-bridge unpair <id|all> 기기 페어링 해제`;

function fmtTime(ms?: number) {
  return ms ? new Date(ms).toLocaleString() : '-';
}

async function main() {
  const { values, positionals } = parseArgs({
    // `pnpm bridge -- --pair`처럼 pnpm이 넘기는 맨 앞 `--`는 무시한다
    args: process.argv[2] === '--' ? process.argv.slice(3) : process.argv.slice(2),
    allowPositionals: true,
    options: {
      pair: { type: 'boolean', default: false },
      port: { type: 'string', default: process.env.BRANCH_BRIDGE_PORT ?? '7777' },
      host: { type: 'string', default: '0.0.0.0' },
      name: { type: 'string' },
      dir: { type: 'string' },
      relay: { type: 'string', default: process.env.BRANCH_RELAY_URL },
      'relay-only': { type: 'boolean', default: false },
      verbose: { type: 'boolean', short: 'v', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });
  if (values.help) {
    console.log(USAGE);
    return;
  }
  const [cmd = 'serve', arg] = positionals;
  const store = await openBridgeStore({ dir: values.dir, name: values.name ?? os.hostname().replace(/\.local$/, '') });

  if (cmd === 'devices') {
    const list = store.devices();
    if (!list.length) console.log('페어링된 기기가 없습니다.');
    for (const d of list) console.log(`${d.id}  ${d.name}  페어링 ${fmtTime(d.pairedAt)}  최근 ${fmtTime(d.lastSeenAt)}`);
    return;
  }
  if (cmd === 'unpair') {
    if (!arg) throw new Error('해제할 기기 id 또는 all 을 지정하세요.');
    const removed = await store.remove(arg);
    console.log(removed.length ? `${removed.length}개 기기를 해제했습니다.` : '해당 기기가 없습니다.');
    return;
  }
  if (cmd !== 'serve' && cmd !== 'pair') {
    console.error(USAGE);
    process.exitCode = 2;
    return;
  }

  const port = Number(values.port);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error(`잘못된 포트: ${values.port}`);
  const log = values.verbose ? (m: string) => console.error(`[bridge] ${m}`) : () => {};
  const bridge = createBridgeServer({ log });
  const server = createRemoteServer({ bridge, store, host: values.host, port, log });
  const relayOnly = values['relay-only'];
  if (relayOnly && !values.relay) throw new Error('--relay-only 에는 --relay 주소가 필요합니다.');
  const bound = relayOnly ? null : (await server.listen()).port;
  let relay: ReturnType<typeof createRelayConnector> | null = null;
  if (values.relay) {
    if (!/^wss?:\/\//i.test(values.relay)) throw new Error('relay 주소는 ws:// 또는 wss:// 로 시작해야 합니다.');
    if (/^ws:\/\//i.test(values.relay)) console.warn('주의: relay가 ws:// 입니다. 공개 네트워크에서는 wss:// 를 쓰세요 (페이로드는 E2E 암호화됨).');
    server.setRelay(values.relay);
    relay = createRelayConnector({
      url: values.relay,
      store,
      accept: server.accept,
      log,
      onState: (st) => {
        if (st === 'ready') console.log('✓ relay 연결됨');
        else if (st === 'offline') console.log('… relay 연결 끊김, 재시도 중');
      },
    });
    if (!(await relay.ready(10_000))) console.warn('relay에 아직 연결하지 못했습니다. 백그라운드에서 계속 재시도합니다.');
  }

  console.log(`Branch Bridge "${store.name}" 실행 중 (${bound === null ? 'relay 전용' : `포트 ${bound}`})`);
  console.log(`bridge 지문: ${keyFingerprint(store.identity.publicKey)}`);
  for (const a of server.addresses()) console.log(`  ${a.label.padEnd(9)} ${a.url}`);
  const status = await bridge.status(true);
  for (const [id, s] of Object.entries(status)) console.log(`  ${id}: ${s.status}${s.detail ? ` (${s.detail})` : ''}`);

  if (values.pair || cmd === 'pair') {
    const session = server.startPairing();
    const uris = server.pairingUris(session);
    const best = uris[0];
    if (best) {
      console.log('\n앱의 설정 → 원격 Bridge → 페어링 시작에서 아래 QR을 스캔하거나 링크를 붙여 넣으세요.');
      qrcode.generate(best.uri, { small: true }, (q) => console.log(q));
      console.log(`링크 (${best.address.label}): ${best.uri}`);
    }
    console.log(`또는 주소 + 코드 입력: 코드 ${session.code}  (5분 유효, 1회용)`);
    console.log('앱에 표시되는 bridge 지문이 위 지문과 같은지 확인하세요.\n');
    server.onPaired((d) => console.log(`✓ 페어링 완료: ${d.name} (${d.id})`));
  } else if (!store.devices().length) {
    console.log('\n페어링된 기기가 없습니다. --pair 옵션으로 페어링을 시작하세요.');
  }

  const stop = async () => {
    relay?.close();
    await server.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void stop());
  process.on('SIGTERM', () => void stop());
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
