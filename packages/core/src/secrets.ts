/**
 * 비밀 값(API 키, 페어링 키, 백업 토큰) 저장소 추상화.
 * - 웹: 탭 메모리(새로고침 시 사라짐) — `memorySecretStore`
 * - Electron: safeStorage, Capacitor: secure storage (각 앱에서 구현 주입)
 * 값은 절대 로그/저장소 스냅샷/백업에 넣지 않는다.
 */
export interface SecretStore {
  /** 'memory' = 탭 메모리(웹), 'os' = OS 보안 저장소 */
  readonly kind: 'memory' | 'os';
  get(name: string): Promise<string | null>;
  set(name: string, value: string): Promise<void>;
  delete(name: string): Promise<void>;
}

export function memorySecretStore(): SecretStore {
  const map = new Map<string, string>();
  return {
    kind: 'memory',
    async get(name) {
      return map.get(name) ?? null;
    },
    async set(name, value) {
      map.set(name, value);
    },
    async delete(name) {
      map.delete(name);
    },
  };
}

/** provider별 API 키 이름 */
export const secretName = {
  apiKey: (providerId: string) => `apikey:${providerId}`,
  /** 백업 대상 토큰 (GitHub PAT, 드라이브 액세스 토큰) */
  backupToken: (targetId: string) => `backup:${targetId}`,
} as const;
