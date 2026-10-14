import type { Annotation, Message, Session, Settings, ViewState } from '../model';
import type { StoredData } from '../persist';
import { decryptText, encryptText, type EncryptedPayload } from './crypto';

/**
 * 백업 스냅샷 (ADR-010). 버전이 있는 JSON 한 덩어리.
 * - 담는 것: 세션 트리·메시지(앵커·요약 포함)·어노테이션(IMP-07)·보기 상태·일반 설정
 * - 담지 않는 것: API 키·페어링 키·로그인 토큰·연결 상태(기기마다 다름)
 */
export const BACKUP_APP = 'branch-learn';
export const BACKUP_SCHEMA_VERSION = 1;

export interface BackupData {
  sessions: Session[];
  messages: Message[];
  annotations?: Annotation[];
  view?: ViewState;
  settings?: Partial<Settings>;
}

export interface BackupSnapshot {
  app: typeof BACKUP_APP;
  schemaVersion: number;
  createdAt: number;
  data: BackupData;
}

/** 암호화된 백업: 시각만 평문, 나머지는 암호문 */
export interface EncryptedBackup {
  app: typeof BACKUP_APP;
  schemaVersion: number;
  createdAt: number;
  encrypted: EncryptedPayload;
}

export type BackupErrorCode = 'invalid' | 'newer-version' | 'passphrase-required' | 'wrong-passphrase';

const BACKUP_MESSAGE: Record<BackupErrorCode, string> = {
  invalid: 'rhymebook 백업 파일이 아니거나 손상되었어요.',
  'newer-version': '더 새 버전의 앱에서 만든 백업이에요. 앱을 업데이트한 뒤 복원하세요.',
  'passphrase-required': '암호로 잠긴 백업이에요. 암호를 입력하세요.',
  'wrong-passphrase': '암호가 맞지 않아요.',
};

export class BackupError extends Error {
  constructor(
    readonly code: BackupErrorCode,
    message = BACKUP_MESSAGE[code],
  ) {
    super(message);
    this.name = 'BackupError';
  }
}

export function createSnapshot(data: StoredData, now = Date.now()): BackupSnapshot {
  return {
    app: BACKUP_APP,
    schemaVersion: BACKUP_SCHEMA_VERSION,
    createdAt: now,
    data: {
      sessions: data.sessions,
      // 생성 중인 응답도 지금까지의 내용으로 담는다 (복원 시 '중지됨'으로 바뀜)
      messages: data.messages,
      ...(data.annotations && data.annotations.length ? { annotations: data.annotations } : {}),
      ...(data.view ? { view: data.view } : {}),
      ...(data.settings ? { settings: data.settings } : {}),
    },
  };
}

/** 스냅샷 → 저장할 문자열. passphrase가 있으면 암호화한다 */
export async function serializeBackup(snapshot: BackupSnapshot, passphrase?: string): Promise<string> {
  const plain = JSON.stringify(snapshot);
  if (!passphrase) return plain;
  const env: EncryptedBackup = {
    app: BACKUP_APP,
    schemaVersion: snapshot.schemaVersion,
    createdAt: snapshot.createdAt,
    encrypted: await encryptText(plain, passphrase),
  };
  return JSON.stringify(env);
}

export interface BackupHeader {
  createdAt: number;
  encrypted: boolean;
}

/** 내용을 풀지 않고 시각·암호 여부만 읽는다 (가져온 파일 목록 표시용) */
export function readBackupHeader(text: string): BackupHeader {
  const raw = parseJson(text);
  checkEnvelope(raw);
  return { createdAt: raw.createdAt as number, encrypted: 'encrypted' in raw };
}

/** 저장된 문자열 → 검증된 스냅샷. 암호화돼 있으면 passphrase로 푼다 */
export async function openBackup(text: string, passphrase?: string): Promise<BackupSnapshot> {
  let raw = parseJson(text);
  checkEnvelope(raw);
  if ('encrypted' in raw) {
    if (!passphrase) throw new BackupError('passphrase-required');
    let plain: string;
    try {
      plain = await decryptText(raw.encrypted as EncryptedPayload, passphrase);
    } catch {
      throw new BackupError('wrong-passphrase');
    }
    raw = parseJson(plain);
    checkEnvelope(raw);
  }
  const data = raw.data as Partial<BackupData> | undefined;
  if (!data || !Array.isArray(data.sessions) || !Array.isArray(data.messages)) throw new BackupError('invalid');
  if (!data.sessions.every(isSession) || !data.messages.every(isMessage)) throw new BackupError('invalid');
  // 어노테이션은 선택적; 있으면 검증하고, 유효하지 않으면 건너뛴다
  const annotations = Array.isArray(data.annotations) ? data.annotations.filter(isAnnotation) : [];
  return {
    app: BACKUP_APP,
    schemaVersion: raw.schemaVersion as number,
    createdAt: raw.createdAt as number,
    data: {
      sessions: data.sessions,
      messages: data.messages,
      ...(annotations.length ? { annotations } : {}),
      ...(data.view && typeof data.view === 'object' ? { view: data.view } : {}),
      ...(data.settings && typeof data.settings === 'object' ? { settings: data.settings } : {}),
    },
  };
}

function parseJson(text: string): Record<string, unknown> {
  try {
    const v: unknown = JSON.parse(text);
    if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>;
  } catch {
    // 아래에서 invalid
  }
  throw new BackupError('invalid');
}

function checkEnvelope(raw: Record<string, unknown>) {
  if (raw.app !== BACKUP_APP || typeof raw.schemaVersion !== 'number' || typeof raw.createdAt !== 'number') {
    throw new BackupError('invalid');
  }
  if (raw.schemaVersion > BACKUP_SCHEMA_VERSION) throw new BackupError('newer-version');
}

const str = (v: unknown) => typeof v === 'string';
const num = (v: unknown) => typeof v === 'number' && Number.isFinite(v);

export function isSession(v: unknown): v is Session {
  const s = v as Session;
  return !!s && str(s.id) && (s.parentId === null || str(s.parentId)) && str(s.rootId) && str(s.title) && num(s.createdAt) && num(s.updatedAt);
}

export function isMessage(v: unknown): v is Message {
  const m = v as Message;
  return !!m && str(m.id) && str(m.sessionId) && (m.role === 'user' || m.role === 'assistant') && str(m.content) && num(m.createdAt);
}

export function isAnnotation(v: unknown): v is Annotation {
  const a = v as Annotation;
  if (!a || !str(a.id) || !str(a.sessionId) || !num(a.createdAt) || !num(a.updatedAt)) return false;
  // anchor 검증
  const anchor = a.anchor as unknown;
  if (!anchor || typeof anchor !== 'object') return false;
  const anc = anchor as Record<string, unknown>;
  if (!str(anc.messageId) || !str(anc.text) || !num(anc.startOffset) || !num(anc.endOffset)) return false;
  const start = anc.startOffset as number;
  const end = anc.endOffset as number;
  if (start < 0 || end <= start) return false;
  // 서식·메모는 선택적
  return true;
}

export type RestoreMode = 'merge' | 'replace';

/**
 * 복원 결과 계산 (순수 함수).
 * - 합치기: 세션 id 기준으로 updatedAt이 더 최근인 쪽을 남기고(메시지도 그 쪽 것을 통째로), 없는 세션은 추가.
 *   보기 상태·설정은 현재 기기 것을 유지한다. 지금 기기에서 지운 세션은 백업에 있으면 다시 생긴다.
 * - 교체: 대화·보기 상태·설정을 백업 것으로 바꾼다.
 * 연결 선호(기기별)는 두 경우 모두 현재 기기 것을 유지한다.
 */
export function applyBackup(local: StoredData, backup: BackupData, mode: RestoreMode): StoredData {
  if (mode === 'replace') {
    return {
      sessions: backup.sessions,
      messages: backup.messages,
      ...(backup.annotations && backup.annotations.length ? { annotations: backup.annotations } : {}),
      ...(backup.view ? { view: backup.view } : {}),
      settings: { ...local.settings, ...backup.settings },
      ...(local.connections ? { connections: local.connections } : {}),
    };
  }
  const sessions = new Map(local.sessions.map((s) => [s.id, s]));
  const fromBackup = new Set<string>();
  for (const s of backup.sessions) {
    const cur = sessions.get(s.id);
    if (!cur || s.updatedAt > cur.updatedAt) {
      sessions.set(s.id, s);
      fromBackup.add(s.id);
    }
  }
  const messages = [
    ...local.messages.filter((m) => !fromBackup.has(m.sessionId)),
    ...backup.messages.filter((m) => fromBackup.has(m.sessionId)),
  ];
  // 어노테이션: 백업에서 가져온 세션의 어노테이션만 사용
  const annotations = [
    ...local.annotations?.filter((a) => !fromBackup.has(a.sessionId)) || [],
    ...backup.annotations?.filter((a) => fromBackup.has(a.sessionId)) || [],
  ];
  return {
    ...local,
    sessions: [...sessions.values()],
    messages,
    ...(annotations.length ? { annotations } : {}),
  };
}

export type AutoBackupMode = 'off' | 'change' | 'daily';

/** 변경 시: 편집이 멈추고 이만큼 지나면 저장 */
export const AUTO_BACKUP_IDLE_MS = 3 * 60_000;
export const DAY_MS = 24 * 3600_000;

/** 자동 백업 시점 판단 (순수 함수). 마지막 백업 이후 변경이 있을 때만 */
export function shouldAutoBackup(p: { mode: AutoBackupMode; lastBackupAt: number; lastChangeAt: number; now: number }): boolean {
  if (p.mode === 'off' || p.lastChangeAt <= p.lastBackupAt) return false;
  if (p.mode === 'change') return p.now - p.lastChangeAt >= AUTO_BACKUP_IDLE_MS;
  return p.now - p.lastBackupAt >= DAY_MS;
}
