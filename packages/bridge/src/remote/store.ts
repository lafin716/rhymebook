import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { generateKeyPair, keyId, publicKeyOf, type KeyPair } from '@branch/core';

/**
 * 헤드리스 bridge의 신원 키와 페어링된 기기 목록.
 * 디렉터리 0700, 파일 0600. 비밀키는 이 파일 밖(로그·출력)으로 내보내지 않는다.
 */
export interface PairedDevice {
  id: string;
  publicKey: string;
  name: string;
  pairedAt: number;
  lastSeenAt?: number;
}

export interface BridgeStore {
  readonly dir: string;
  readonly identity: KeyPair;
  readonly bridgeId: string;
  readonly name: string;
  devices(): PairedDevice[];
  findByKey(publicKey: string): PairedDevice | undefined;
  add(device: Omit<PairedDevice, 'id' | 'pairedAt'>): Promise<PairedDevice>;
  /** id 또는 'all'. 지운 개수 */
  remove(idOrAll: string): Promise<PairedDevice[]>;
  touch(id: string): void;
}

export function defaultBridgeHome(): string {
  if (process.env.BRANCH_BRIDGE_HOME) return process.env.BRANCH_BRIDGE_HOME;
  if (process.platform === 'win32' && process.env.APPDATA) return path.join(process.env.APPDATA, 'branch-bridge');
  return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'branch-bridge');
}

async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(file, 'utf8')) as T;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw new Error(`${file} 을(를) 읽을 수 없습니다: ${e instanceof Error ? e.message : String(e)}`, { cause: e });
  }
}

async function writeSecure(file: string, data: unknown): Promise<void> {
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
  await rename(tmp, file);
  await chmod(file, 0o600).catch(() => {});
}

export async function openBridgeStore(opts: { dir?: string; name?: string } = {}): Promise<BridgeStore> {
  const dir = opts.dir ?? defaultBridgeHome();
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await chmod(dir, 0o700).catch(() => {});
  const idFile = path.join(dir, 'identity.json');
  const devFile = path.join(dir, 'devices.json');

  let saved = await readJson<{ secretKey: string; name?: string }>(idFile);
  if (!saved?.secretKey) {
    saved = { secretKey: generateKeyPair().secretKey, name: opts.name ?? os.hostname().replace(/\.local$/, '') };
    await writeSecure(idFile, saved);
  } else if (opts.name && opts.name !== saved.name) {
    saved = { ...saved, name: opts.name };
    await writeSecure(idFile, saved);
  }
  const identity: KeyPair = { secretKey: saved.secretKey, publicKey: publicKeyOf(saved.secretKey) };
  const name = saved.name || os.hostname();
  let devices = (await readJson<PairedDevice[]>(devFile)) ?? [];
  let dirty = false;
  const persist = () => writeSecure(devFile, devices);
  // lastSeen은 잦은 쓰기를 피해 모아서 저장
  const flushTimer = setInterval(() => {
    if (!dirty) return;
    dirty = false;
    void persist().catch(() => {});
  }, 30_000);
  flushTimer.unref();

  return {
    dir,
    identity,
    bridgeId: keyId(identity.publicKey, 'brg_'),
    name,
    devices: () => devices.slice(),
    findByKey: (publicKey) => devices.find((d) => d.publicKey === publicKey),
    async add(d) {
      const existing = devices.find((x) => x.publicKey === d.publicKey);
      const device: PairedDevice = existing ?? { ...d, id: keyId(d.publicKey, 'dev_'), pairedAt: Date.now() };
      if (!existing) devices = [...devices, device];
      await persist();
      return device;
    },
    async remove(idOrAll) {
      const removed = idOrAll === 'all' ? devices : devices.filter((d) => d.id === idOrAll);
      if (!removed.length) return [];
      devices = devices.filter((d) => !removed.includes(d));
      await persist();
      return removed;
    },
    touch(id) {
      const d = devices.find((x) => x.id === id);
      if (!d) return;
      d.lastSeenAt = Date.now();
      dirty = true;
    },
  };
}
