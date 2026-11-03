import os from 'node:os';
import { parseArgs } from 'node:util';
import { intlLocale, matchLocale, setLocale, t, keyFingerprint } from '@branch/core';
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
const l = matchLocale(process.env.OCTOBOOKS_LANG);
if (l) setLocale(l);

const usage = () => t('cli.bridge.usage');

function fmtTime(ms?: number) {
  return ms ? new Date(ms).toLocaleString(intlLocale()) : '-';
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
    console.log(usage());
    return;
  }
  const [cmd = 'serve', arg] = positionals;
  const store = await openBridgeStore({ dir: values.dir, name: values.name ?? os.hostname().replace(/\.local$/, '') });

  if (cmd === 'devices') {
    const list = store.devices();
    if (!list.length) console.log(t('cli.bridge.noDevices'));
    for (const d of list) console.log(t('cli.bridge.deviceLine', { id: d.id, name: d.name, paired: fmtTime(d.pairedAt), seen: fmtTime(d.lastSeenAt) }));
    return;
  }
  if (cmd === 'unpair') {
    if (!arg) throw new Error(t('cli.bridge.unpairMissing'));
    const removed = await store.remove(arg);
    console.log(removed.length ? t('cli.bridge.unpaired', { count: removed.length }) : t('cli.bridge.noSuchDevice'));
    return;
  }
  if (cmd !== 'serve' && cmd !== 'pair') {
    console.error(usage());
    process.exitCode = 2;
    return;
  }

  const port = Number(values.port);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error(t('cli.bridge.badPort', { port: String(values.port) }));
  const log = values.verbose ? (m: string) => console.error(`[bridge] ${m}`) : () => {};
  const bridge = createBridgeServer({ log });
  const server = createRemoteServer({ bridge, store, host: values.host, port, log });
  const relayOnly = values['relay-only'];
  if (relayOnly && !values.relay) throw new Error(t('cli.bridge.relayOnlyNeedsRelay'));
  const bound = relayOnly ? null : (await server.listen()).port;
  let relay: ReturnType<typeof createRelayConnector> | null = null;
  if (values.relay) {
    if (!/^wss?:\/\//i.test(values.relay)) throw new Error(t('cli.bridge.relayScheme'));
    if (/^ws:\/\//i.test(values.relay)) console.warn(t('cli.bridge.insecureRelay'));
    server.setRelay(values.relay);
    relay = createRelayConnector({
      url: values.relay,
      store,
      accept: server.accept,
      log,
      onState: (st) => {
        if (st === 'ready') console.log(t('cli.bridge.relayConnected'));
        else if (st === 'offline') console.log(t('cli.bridge.relayRetrying'));
      },
    });
    if (!(await relay.ready(10_000))) console.warn(t('cli.bridge.relayNotYet'));
  }

  console.log(t('cli.bridge.running', { name: store.name, target: bound === null ? t('cli.bridge.relayOnly') : t('cli.bridge.port', { port: bound }) }));
  console.log(t('cli.bridge.fingerprint', { fingerprint: keyFingerprint(store.identity.publicKey) }));
  for (const a of server.addresses()) console.log(`  ${a.label.padEnd(9)} ${a.url}`);
  const status = await bridge.status(true);
  for (const [id, s] of Object.entries(status)) console.log(`  ${id}: ${s.status}${s.detail ? ` (${s.detail})` : ''}`);

  if (values.pair || cmd === 'pair') {
    const session = server.startPairing();
    const uris = server.pairingUris(session);
    const best = uris[0];
    if (best) {
      console.log(`\n${t('cli.bridge.scanHint')}`);
      qrcode.generate(best.uri, { small: true }, (q) => console.log(q));
      console.log(t('cli.bridge.link', { label: best.address.label, uri: best.uri }));
    }
    console.log(t('cli.bridge.codeLine', { code: session.code }));
    console.log(`${t('cli.bridge.checkFingerprint')}\n`);
    server.onPaired((d) => console.log(t('cli.bridge.paired', { name: d.name, id: d.id })));
  } else if (!store.devices().length) {
    console.log(`\n${t('cli.bridge.noDevicesPair')}`);
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
