import { parseArgs } from 'node:util';
import { createRelayServer } from './server';

/**
 * branch-relay — bridge 중계 서버 (Phase 6).
 *   branch-relay [--port 8787] [--host 0.0.0.0] [-v]
 * TLS는 앞단 리버스 프록시(Caddy/nginx 등)에서 종료하고 wss://로 노출한다.
 */
const USAGE = `사용법:
  branch-relay [--port 8787] [--host 0.0.0.0] [-v]`;

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
    console.log(USAGE);
    return;
  }
  const port = Number(values.port);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error(`잘못된 포트: ${values.port}`);
  const log = values.verbose ? (m: string) => console.error(`[relay] ${m}`) : () => {};
  const relay = createRelayServer({ host: values.host, port, log });
  const { port: bound } = await relay.listen();
  console.log(`Branch Relay 실행 중: ws://${values.host}:${bound}  (상태: http://${values.host}:${bound}/health)`);
  console.log('bridge: branch-bridge --relay <이 주소>   · 공개 배포 시 TLS(wss://) 프록시 뒤에 두세요.');
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
