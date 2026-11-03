import { matchLocale, setLocale, t } from '@branch/core';
import { parseArgs } from 'node:util';
import { createRelayServer } from './server';

/**
 * branch-relay — bridge 중계 서버 (Phase 6).
 *   branch-relay [--port 8787] [--host 0.0.0.0] [-v]
 * TLS는 앞단 리버스 프록시(Caddy/nginx 등)에서 종료하고 wss://로 노출한다.
 */
const l = matchLocale(process.env.OCTOBOOKS_LANG);
if (l) setLocale(l);

const usage = () => t('cli.relay.usage');

async function main() {
  const { values } = parseArgs({
    // `pnpm relay -- --port 8787`처럼 pnpm이 넘기는 맨 앞 `--`는 무시한다
    args: process.argv[2] === '--' ? process.argv.slice(3) : process.argv.slice(2),
    options: {
      port: { type: 'string', default: process.env.BRANCH_RELAY_PORT ?? '8787' },
      host: { type: 'string', default: '0.0.0.0' },
      verbose: { type: 'boolean', short: 'v', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });
  if (values.help) {
    console.log(usage());
    return;
  }
  const port = Number(values.port);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error(t('cli.relay.badPort', { port: String(values.port) }));
  const log = values.verbose ? (m: string) => console.error(`[relay] ${m}`) : () => {};
  const relay = createRelayServer({ host: values.host, port, log });
  const { port: bound } = await relay.listen();
  console.log(t('cli.relay.running', { host: values.host, port: bound }));
  console.log(t('cli.relay.bridgeHint'));
  const stop = async () => {
    await relay.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void stop());
  process.on('SIGTERM', () => void stop());
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
