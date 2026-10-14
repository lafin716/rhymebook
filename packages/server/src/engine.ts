import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  createBridgeServer,
  createRemoteServer,
  createSkillsDir,
  openBridgeStore,
  type BridgeServer,
  type BridgeServerOptions,
  type BridgeStore,
  type RemoteServer,
} from '@branch/bridge';
import {
  createAppStore,
  createBridgeClient,
  createBridgeProviders,
  createRuntimeRegistry,
  createSyncHost,
  defaultSkills,
  emptyView,
  memorySecretStore,
  restoreData,
  RUNTIME_SETTINGS,
  secretName,
  skillFromFolder,
  skillsToSeed,
  toSkillFolder,
  toStoredData,
  type AppStore,
  type BridgeServerMsg,
  type ConnectionState,
  type HostAgent,
  type HostPolicy,
  type ProviderId,
  type Skill,
  type SyncHost,
  type SyncOp,
} from '@branch/core';
import { createFileRepository } from './fileRepo';

/**
 * 헤드리스 호스트 (IMP-14, ADR-040): 데스크톱 렌더러가 하던 일을 Node 프로세스 하나에서 한다.
 * core 스토어(학습 데이터) + core sync host(웹·모바일 거울) + bridge 원격 서버(페어링·E2E 암호화) + 같은 프로세스의 CLI 실행.
 */
export interface HeadlessHostOptions {
  /** 데이터 폴더: data.json, skills/, bridge/ */
  dir: string;
  /** 앱에 보일 이름 (주면 저장된 이름을 바꾼다. 처음 기본값: 컴퓨터 이름) */
  name?: string;
  host?: string;
  port?: number;
  /** 새 학습에 쓸 PC 에이전트 (기본: 저장된 설정 또는 auto) */
  agent?: HostAgent;
  /** 원격 기기의 학습·질문 삭제 허용 (기본 true) */
  allowDelete?: boolean;
  /** API 키 (환경변수에서). 메모리에만 둔다 */
  apiKeys?: Partial<Record<'anthropic-api' | 'openai-api', string>>;
  /** CLI 실행 환경 (테스트에서 가짜 CLI) */
  cliEnv?: BridgeServerOptions['cliEnv'];
  /** 연결 상태 다시 확인 주기 */
  refreshMs?: number;
  /** 저장 간격 */
  saveIntervalMs?: number;
  log?: (msg: string) => void;
  /** 원격 조작 알림 (콘솔 표시용) */
  onRemoteAction?: (op: SyncOp) => void;
}

export interface HeadlessHost {
  store: AppStore;
  bridgeStore: BridgeStore;
  bridge: BridgeServer;
  remote: RemoteServer;
  syncHost: SyncHost;
  /** 새 학습에 쓰일 provider (없으면 설정 기본값) */
  rootProvider(): ProviderId | undefined;
  /** 원격 서버를 연다 (relay 전용이면 부르지 않는다) */
  listen(): Promise<{ port: number }>;
  close(): Promise<void>;
}

const HOST_ORDER: ProviderId[] = ['claude-cli', 'codex-cli', 'anthropic-api', 'openai-api'];

const isUsable = (c: ConnectionState | undefined) => !!c && c.enabled && c.status === 'ready';

export function defaultHome(): string {
  if (process.env.RHYMEBOOK_HOME) return process.env.RHYMEBOOK_HOME;
  if (process.platform === 'win32') return path.join(process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming'), 'rhymebook');
  return path.join(process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), '.config'), 'rhymebook');
}

export async function createHeadlessHost(opts: HeadlessHostOptions): Promise<HeadlessHost> {
  const log = opts.log ?? (() => {});
  await mkdir(opts.dir, { recursive: true, mode: 0o700 });

  // 비밀 값은 메모리에만
  const secrets = memorySecretStore();
  for (const [id, key] of Object.entries(opts.apiKeys ?? {})) if (key) await secrets.set(secretName.apiKey(id), key);

  // CLI: 같은 프로세스의 BridgeServer를 core bridge client로 감싼다 (데스크톱 IPC 대신 직접 호출)
  const bridge = createBridgeServer({ log, ...(opts.cliEnv ? { cliEnv: opts.cliEnv } : {}) });
  const listeners = new Set<(msg: BridgeServerMsg) => void>();
  const conn = bridge.connect((msg) => queueMicrotask(() => listeners.forEach((l) => l(msg))));
  const bridgeClient = createBridgeClient({
    send: (msg) => conn.receive(msg),
    subscribe: (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  });

  // 학습 데이터
  const repo = createFileRepository(path.join(opts.dir, 'data.json'), { log, ...(opts.saveIntervalMs ? { intervalMs: opts.saveIntervalMs } : {}) });
  const raw = repo.load();
  const data = restoreData(
    raw ?? { sessions: [], messages: [], view: emptyView(), settings: RUNTIME_SETTINGS },
  );
  let store: AppStore | null = null;
  const registry = createRuntimeRegistry({
    secrets,
    getConnections: () => store!.getState().connections,
    overrides: createBridgeProviders(bridgeClient),
  });
  store = createAppStore({ registry, repo, initial: data });
  const appStore = store;
  repo.attach(() => toStoredData(appStore.getState()));
  if (!raw) {
    repo.saveSettings(data.settings);
    await repo.flush();
  }

  const agent = (): HostAgent => opts.agent ?? appStore.getState().settings.hostAgent ?? 'auto';
  const rootProvider = (): ProviderId | undefined => {
    const a = agent();
    if (a !== 'auto') return a;
    const conns = appStore.getState().connections;
    return HOST_ORDER.find((p) => isUsable(conns[p]));
  };

  // 스킬: <dir>/skills 폴더를 읽기만 한다. 새 builtin을 한 번 시드한다 (기존 이름의 폴더는 덮어쓰지 않음)
  const skillsDir = createSkillsDir(path.join(opts.dir, 'skills'));
  const skillsStat = await stat(skillsDir.root).catch(() => null);
  if (skillsStat && !skillsStat.isDirectory()) log(`스킬 경로가 폴더가 아닙니다: ${skillsDir.root}`);

  // skills-seeded.json 파일로 시드된 builtin id 추적
  const seededPath = path.join(opts.dir, 'skills-seeded.json');
  let seeded: unknown = undefined;
  try {
    const content = await readFile(seededPath, 'utf-8');
    seeded = JSON.parse(content);
  } catch {
    // 파일 없음 또는 파싱 실패 → 신규 또는 레거시 (이 경우 skillsToSeed가 호환성 처리)
  }

  if (!skillsStat) {
    // 폴더 없음 → 모든 기본값 스킬 시드
    for (const s of defaultSkills()) {
      await skillsDir.write(toSkillFolder(s), {}).catch((e: unknown) => log(`예시 스킬 "${s.name}" 만들기 실패: ${e instanceof Error ? e.message : String(e)}`));
    }
    // 시드된 id 목록 저장
    const { seeded: newSeeded } = skillsToSeed([], seeded);
    await writeFile(seededPath, JSON.stringify(newSeeded), 'utf-8').catch((e: unknown) =>
      log(`스킬 시드 파일 저장 실패: ${e instanceof Error ? e.message : String(e)}`),
    );
  } else {
    // 폴더 있음 → 새로 추가된 builtin만 시드 (기존 이름의 폴더는 건드리지 않음)
    const readSkills = async (): Promise<Skill[]> => {
      const now = Date.now();
      const out: Skill[] = [];
      for (const f of await skillsDir.readAll()) {
        const fields = skillFromFolder(f);
        if (fields) out.push({ id: `k-${fields.name}`, ...fields, createdAt: now, updatedAt: now });
      }
      return out;
    };
    const existing = await readSkills();
    const { add, seeded: newSeeded } = skillsToSeed(existing, seeded);
    for (const s of add) {
      await skillsDir.write(toSkillFolder(s), {}).catch((e: unknown) => log(`예시 스킬 "${s.name}" 만들기 실패: ${e instanceof Error ? e.message : String(e)}`));
    }
    if (add.length) {
      await writeFile(seededPath, JSON.stringify(newSeeded), 'utf-8').catch((e: unknown) =>
        log(`스킬 시드 파일 저장 실패: ${e instanceof Error ? e.message : String(e)}`),
      );
    } else if (!Array.isArray(seeded) && seeded !== true) {
      // 호환성: 기존 값이 없거나 유효하지 않으면 새로운 형식으로 저장
      await writeFile(seededPath, JSON.stringify(newSeeded), 'utf-8').catch((e: unknown) =>
        log(`스킬 시드 파일 저장 실패: ${e instanceof Error ? e.message : String(e)}`),
      );
    }
  }

  const readSkills = async (): Promise<Skill[]> => {
    const now = Date.now();
    const out: Skill[] = [];
    for (const f of await skillsDir.readAll()) {
      const fields = skillFromFolder(f);
      if (fields) out.push({ id: `k-${fields.name}`, ...fields, createdAt: now, updatedAt: now });
    }
    return out;
  };

  const bridgeStore = await openBridgeStore({ dir: path.join(opts.dir, 'bridge'), ...(opts.name ? { name: opts.name } : {}) });
  const allowDelete = opts.allowDelete ?? true;
  let remote: RemoteServer | null = null;
  const syncHost = createSyncHost({
    store: appStore,
    hostName: () => bridgeStore.name,
    send: (peerId, msg) => remote?.syncSend(peerId, msg),
    rootProvider,
    allowDelete: () => allowDelete,
    skills: readSkills,
    onRemoteAction: (_peer, op) => opts.onRemoteAction?.(op),
  });
  // 원격 기기의 직접 요청(스킬 AI 도우미 등)에도 PC 에이전트·모델 기본값을 적용한다
  const policy = (): HostPolicy => {
    const c = appStore.getState().connections;
    const pref = (id: 'claude-cli' | 'codex-cli') => ({
      ...(c[id]?.model ? { model: c[id]!.model } : {}),
      ...(c[id]?.effort ? { effort: c[id]!.effort } : {}),
    });
    return { agent: agent(), options: { 'claude-cli': pref('claude-cli'), 'codex-cli': pref('codex-cli') } };
  };
  remote = createRemoteServer({
    bridge,
    store: bridgeStore,
    host: opts.host ?? '0.0.0.0',
    port: opts.port ?? 7777,
    log,
    policy,
    sync: {
      receive: (peerId, _deviceId, msg) => syncHost.receive(peerId, msg),
      peerGone: (peerId) => syncHost.peerGone(peerId),
    },
  });
  const server = remote;

  // 연결 상태: 시작 시 + 주기적으로 (CLI 설치·로그인 변화 반영)
  await appStore.getState().refreshConnections();
  const refreshTimer = setInterval(() => void appStore.getState().refreshConnections(), opts.refreshMs ?? 5 * 60_000);
  refreshTimer.unref();

  let closed = false;
  return {
    store: appStore,
    bridgeStore,
    bridge,
    remote: server,
    syncHost,
    rootProvider,
    listen: () => server.listen(),
    async close() {
      if (closed) return;
      closed = true;
      clearInterval(refreshTimer);
      // 진행 중 답변을 멈춰 '중지됨'으로 저장한다
      const live = Object.keys(appStore.getState().streaming);
      for (const id of live) appStore.getState().stopStream(id);
      if (live.length) await new Promise((r) => setTimeout(r, 200));
      bridge.shutdown();
      syncHost.dispose();
      conn.close();
      await server.close();
      await repo.flush();
    },
  };
}
