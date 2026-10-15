import path from 'node:path';
import { parseArgs } from 'node:util';
import { createRelayConnector, openBridgeStore } from '@branch/bridge';
import { keyFingerprint, sttModel, type HostAgent } from '@branch/core';
import qrcode from 'qrcode-terminal';
import { createHeadlessHost, defaultHome } from './engine';

/**
 * rhymebook — 헤드리스 호스트 (IMP-14, ADR-040).
 * 데스크톱 앱 없이 이 PC에 학습 데이터를 두고, 모바일·웹 앱이 페어링해 그대로 쓴다.
 * 비밀 값(API 키·기기 키·bridge 비밀키)은 출력하지 않는다. 페어링 토큰·코드는 화면에만 1회 표시.
 */
const USAGE = `사용법:
  rhymebook serve [--pair] [--port 7777] [--host 0.0.0.0] [--name 이름] [--dir 경로]
                  [--agent auto|claude-cli|codex-cli] [--no-delete]
                  [--relay wss://relay.example.com] [--relay-only]
                  [--whisper-cli 경로] [-v]
    --dir         데이터 폴더 (기본 $RHYMEBOOK_HOME 또는 ~/.config/rhymebook)
    --agent       새 학습에 쓸 PC 에이전트 (기본 auto: claude → codex → API 키 순)
    --no-delete   원격 기기에서 학습·질문 삭제를 막기
    --relay       NAT 뒤에서도 접속되도록 relay에 아웃바운드로 등록 (E2E 암호화 유지)
    --relay-only  직접 포트를 열지 않고 relay로만 접속 받기
    --whisper-cli 음성 입력에 쓸 whisper-cli 경로 (기본: $BRANCH_WHISPER_CLI → PATH)
  rhymebook pair            (serve --pair 와 같음)
  rhymebook devices         페어링된 기기 목록
  rhymebook unpair <id|all> 기기 페어링 해제

API 키는 환경변수 ANTHROPIC_API_KEY / OPENAI_API_KEY 로 줄 수 있습니다 (메모리에만 보관).
음성 입력은 whisper-cli(brew install whisper-cpp 등)가 있으면 쓸 수 있고,
켜기·모델 받기는 페어링한 앱의 설정 > 음성 입력에서 합니다.`;

const AGENTS: HostAgent[] = ['auto', 'claude-cli', 'codex-cli'];

function fmtTime(ms?: number) {
  return ms ? new Date(ms).toLocaleString() : '-';
}

async function main() {
  const { values, positionals } = parseArgs({
    // `pnpm rhymebook -- serve`처럼 pnpm이 넘기는 맨 앞 `--`는 무시한다
    args: process.argv[2] === '--' ? process.argv.slice(3) : process.argv.slice(2),
    allowPositionals: true,
    options: {
      pair: { type: 'boolean', default: false },
      port: { type: 'string', default: process.env.RHYMEBOOK_PORT ?? '7777' },
      host: { type: 'string', default: '0.0.0.0' },
      name: { type: 'string' },
      dir: { type: 'string' },
      agent: { type: 'string' },
      'no-delete': { type: 'boolean', default: false },
      relay: { type: 'string', default: process.env.BRANCH_RELAY_URL },
      'relay-only': { type: 'boolean', default: false },
      'whisper-cli': { type: 'string' },
      verbose: { type: 'boolean', short: 'v', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });
  const [cmd, arg] = positionals;
  if (values.help || !cmd) {
    console.log(USAGE);
    return;
  }
  const dir = path.resolve(values.dir ?? defaultHome());
  // 이름은 처음 실행 때 정해져 저장된다. --name을 줄 때만 바꾼다
  const name = values.name;

  if (cmd === 'devices' || cmd === 'unpair') {
    const store = await openBridgeStore({ dir: path.join(dir, 'bridge'), ...(name ? { name } : {}) });
    if (cmd === 'devices') {
      const list = store.devices();
      if (!list.length) console.log('페어링된 기기가 없습니다.');
      for (const d of list) console.log(`${d.id}  ${d.name}  페어링 ${fmtTime(d.pairedAt)}  최근 ${fmtTime(d.lastSeenAt)}`);
      return;
    }
    if (!arg) throw new Error('해제할 기기 id 또는 all 을 지정하세요.');
    const removed = await store.remove(arg);
    console.log(removed.length ? `${removed.length}개 기기를 해제했습니다. 실행 중인 serve는 다시 시작해야 연결이 끊깁니다.` : '해당 기기가 없습니다.');
    return;
  }
  if (cmd !== 'serve' && cmd !== 'pair') {
    console.error(USAGE);
    process.exitCode = 2;
    return;
  }

  const port = Number(values.port);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error(`잘못된 포트: ${values.port}`);
  const agent = values.agent as HostAgent | undefined;
  if (agent !== undefined && !AGENTS.includes(agent)) throw new Error(`--agent 는 ${AGENTS.join(' | ')} 중 하나여야 합니다.`);
  const relayOnly = values['relay-only'];
  if (relayOnly && !values.relay) throw new Error('--relay-only 에는 --relay 주소가 필요합니다.');
  if (values.relay && !/^wss?:\/\//i.test(values.relay)) throw new Error('relay 주소는 ws:// 또는 wss:// 로 시작해야 합니다.');

  const log = values.verbose ? (m: string) => console.error(`[rhymebook] ${m}`) : () => {};
  const host = await createHeadlessHost({
    dir,
    ...(name ? { name } : {}),
    host: values.host,
    port,
    ...(agent ? { agent } : {}),
    allowDelete: !values['no-delete'],
    ...(values['whisper-cli'] ? { stt: { binCandidates: [path.resolve(values['whisper-cli'])] } } : {}),
    apiKeys: { 'anthropic-api': process.env.ANTHROPIC_API_KEY, 'openai-api': process.env.OPENAI_API_KEY },
    log,
    onRemoteAction: (op) => log(`원격 조작: ${op.kind}`),
  });
  const { remote, bridgeStore } = host;

  const bound = relayOnly ? null : (await host.listen()).port;
  let relay: ReturnType<typeof createRelayConnector> | null = null;
  if (values.relay) {
    if (/^ws:\/\//i.test(values.relay)) console.warn('주의: relay가 ws:// 입니다. 공개 네트워크에서는 wss:// 를 쓰세요 (페이로드는 E2E 암호화됨).');
    remote.setRelay(values.relay);
    relay = createRelayConnector({
      url: values.relay,
      store: bridgeStore,
      accept: remote.accept,
      log,
      onState: (st) => {
        if (st === 'ready') console.log('✓ relay 연결됨');
        else if (st === 'offline') console.log('… relay 연결 끊김, 재시도 중');
      },
    });
    if (!(await relay.ready(10_000))) console.warn('relay에 아직 연결하지 못했습니다. 백그라운드에서 계속 재시도합니다.');
  }

  const sessions = Object.keys(host.store.getState().sessions).length;
  console.log(`rhymebook "${bridgeStore.name}" 실행 중 (${bound === null ? 'relay 전용' : `포트 ${bound}`})`);
  console.log(`데이터: ${dir}  (학습 ${sessions}개)`);
  console.log(`bridge 지문: ${keyFingerprint(bridgeStore.identity.publicKey)}`);
  for (const a of remote.addresses()) console.log(`  ${a.label.padEnd(9)} ${a.url}`);
  const conns = host.store.getState().connections;
  for (const id of ['claude-cli', 'codex-cli', 'anthropic-api', 'openai-api'] as const) {
    const c = conns[id];
    if (c) console.log(`  ${id}: ${c.status}${c.detail ? ` (${c.detail})` : ''}`);
  }
  const root = host.rootProvider();
  console.log(root ? `새 학습 에이전트: ${root}` : '주의: 사용할 수 있는 에이전트가 없습니다. claude/codex CLI에 로그인하거나 API 키 환경변수를 주세요.');
  if (values['no-delete']) console.log('원격 삭제: 막음');
  if (host.stt) {
    const v = await host.stt.state();
    const model = sttModel(v.model)?.label ?? v.model;
    const parts = [v.enabled ? '켜짐' : '꺼짐', `모델 ${model}${v.installed.includes(v.model) ? '' : ' (받지 않음)'}`];
    if (!v.engine) parts.push('whisper-cli 없음 — brew install whisper-cpp 또는 --whisper-cli 경로');
    console.log(`음성 입력: ${parts.join(' · ')}${v.ready ? '' : '  (앱의 설정 > 음성 입력에서 켜고 모델을 받을 수 있어요)'}`);
  }

  if (values.pair || cmd === 'pair') {
    const session = remote.startPairing();
    const best = remote.pairingUris(session)[0];
    if (best) {
      console.log('\n앱의 "내 PC와 연결하기"에서 아래 QR을 스캔하거나 링크를 붙여 넣으세요.');
      qrcode.generate(best.uri, { small: true }, (q) => console.log(q));
      console.log(`링크 (${best.address.label}): ${best.uri}`);
    }
    console.log(`또는 주소 + 코드 입력: 코드 ${session.code}  (5분 유효, 1회용)`);
    console.log('앱에 표시되는 bridge 지문이 위 지문과 같은지 확인하세요.\n');
  } else if (!bridgeStore.devices().length) {
    console.log('\n페어링된 기기가 없습니다. --pair 옵션으로 페어링을 시작하세요.');
  }
  remote.onPaired((d) => console.log(`✓ 페어링 완료: ${d.name} (${d.id})`));

  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    console.log('종료하는 중… (저장)');
    relay?.close();
    await host.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void stop());
  process.on('SIGTERM', () => void stop());
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
