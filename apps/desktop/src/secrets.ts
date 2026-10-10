import { safeStorage } from 'electron';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Electron safeStorage(OS 키체인 기반 암호화)로 비밀 값을 저장한다.
 * 파일에는 암호문(base64)만 남는다. 암호화를 쓸 수 없으면 메모리에만 둔다.
 */
export function createSecretVault(dir: string) {
  const file = path.join(dir, 'secrets.json');
  const persistent = safeStorage.isEncryptionAvailable();
  const memory = new Map<string, string>();
  let data: Record<string, string> = {};
  if (persistent) {
    try {
      data = JSON.parse(readFileSync(file, 'utf8')) as Record<string, string>;
    } catch {
      data = {};
    }
  }
  const flush = () => {
    mkdirSync(dir, { recursive: true });
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, JSON.stringify(data), { mode: 0o600 });
    renameSync(tmp, file);
  };

  return {
    persistent,
    get(name: string): string | null {
      if (!persistent) return memory.get(name) ?? null;
      const enc = data[name];
      if (!enc) return null;
      try {
        return safeStorage.decryptString(Buffer.from(enc, 'base64'));
      } catch {
        return null;
      }
    },
    set(name: string, value: string) {
      if (!persistent) {
        memory.set(name, value);
        return;
      }
      data[name] = safeStorage.encryptString(value).toString('base64');
      flush();
    },
    delete(name: string) {
      memory.delete(name);
      if (persistent && name in data) {
        delete data[name];
        flush();
      }
    },
  };
}
