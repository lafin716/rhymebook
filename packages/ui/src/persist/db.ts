import {
  connectionPrefs,
  type BackupTargetId,
  type ConnectionState,
  type ID,
  type Message,
  type Repository,
  type Session,
  type Settings,
  type StoredData,
  type ViewState,
} from '@branch/core';
import Dexie, { type Table } from 'dexie';

/** 메시지 행: 세션 내 순서(seq)를 함께 저장한다 */
type MessageRow = Message & { seq: number };

interface KvRow {
  key: 'view' | 'settings' | 'connections' | 'backup';
  value: unknown;
}

/** 이 기기에 둔 백업 사본 (파일 대상, 모의 드라이브). 본문은 스냅샷 문자열 그대로 */
export interface BackupRow {
  id: string;
  targetId: BackupTargetId;
  at: number;
  size: number;
  encrypted: boolean;
  body: string;
}

const DATA_KEYS: KvRow['key'][] = ['view', 'settings', 'connections'];

/**
 * IndexedDB 스키마 (Dexie). 비밀 값(API 키·페어링 키)은 여기에 저장하지 않는다.
 * 스키마를 바꿀 때는 version(n+1)을 추가하고 upgrade로 이전 데이터를 옮긴다.
 */
export class BranchDB extends Dexie {
  sessions!: Table<Session, ID>;
  messages!: Table<MessageRow, ID>;
  kv!: Table<KvRow, KvRow['key']>;
  backups!: Table<BackupRow, string>;

  constructor(name = 'branch-learn') {
    super(name);
    this.version(1).stores({
      sessions: 'id, parentId, rootId',
      messages: 'id, sessionId, [sessionId+seq]',
      kv: 'key',
    });
    // v2 (Phase 2.5): 백업 사본
    this.version(2).stores({ backups: 'id, targetId, at' });
  }
}

export interface DexieRepository extends Repository {
  /** 저장된 데이터 전체. 비어 있으면 null */
  loadAll(): Promise<StoredData | null>;
  /** 전체 교체 (첫 실행 시드 저장, 백업 복원) */
  replaceAll(data: StoredData): Promise<void>;
  /** 대기 중인 쓰기가 끝날 때까지 기다린다 (테스트·복원 직전) */
  flush(): Promise<void>;
}

export function createDexieRepository(db: BranchDB, onError: (e: unknown) => void = reportError): DexieRepository {
  // 쓰기는 순서대로 이어 붙인다: 같은 레코드의 연속 저장이 뒤바뀌지 않게
  let chain: Promise<unknown> = Promise.resolve();
  const enqueue = (op: () => Promise<unknown>) => {
    chain = chain.then(op).catch(onError);
  };

  const rowsOf = (messages: Message[]): MessageRow[] => {
    const seq = new Map<ID, number>();
    return messages.map((m) => {
      const n = seq.get(m.sessionId) ?? 0;
      seq.set(m.sessionId, n + 1);
      return { ...m, seq: n };
    });
  };
  const settle = async () => {
    let cur: Promise<unknown>;
    do {
      cur = chain;
      await cur;
    } while (cur !== chain);
  };
  const stripSeq = ({ seq: _seq, ...m }: MessageRow): Message => m;

  return {
    saveSession: (s: Session) => enqueue(() => db.sessions.put(s)),
    deleteSessions: (ids: ID[]) =>
      enqueue(() =>
        db.transaction('rw', db.sessions, db.messages, async () => {
          await db.sessions.bulkDelete(ids);
          await db.messages.where('sessionId').anyOf(ids).delete();
        }),
      ),
    saveMessage: (m: Message, index: number) => enqueue(() => db.messages.put({ ...m, seq: index })),
    deleteMessage: (id: ID) => enqueue(() => db.messages.delete(id)),
    saveView: (v: ViewState) => enqueue(() => db.kv.put({ key: 'view', value: v })),
    saveSettings: (s: Settings) => enqueue(() => db.kv.put({ key: 'settings', value: s })),
    saveConnections: (c: ConnectionState[]) =>
      enqueue(() => db.kv.put({ key: 'connections', value: connectionPrefs(c) })),

    async loadAll() {
      await settle();
      return db.transaction('r', db.sessions, db.messages, db.kv, async () => {
        const sessions = await db.sessions.toArray();
        if (sessions.length === 0) return null;
        const rows = await db.messages.orderBy('[sessionId+seq]').toArray();
        const kv = new Map((await db.kv.toArray()).map((r) => [r.key, r.value]));
        return {
          sessions,
          messages: rows.map(stripSeq),
          view: kv.get('view') as ViewState | undefined,
          settings: kv.get('settings') as Partial<Settings> | undefined,
          connections: kv.get('connections') as StoredData['connections'],
        };
      });
    },

    async replaceAll(data) {
      await settle();
      await db.transaction('rw', db.sessions, db.messages, db.kv, async () => {
        // 백업 설정(kv 'backup')은 대화 데이터가 아니므로 남긴다
        await Promise.all([db.sessions.clear(), db.messages.clear(), db.kv.bulkDelete(DATA_KEYS)]);
        await db.sessions.bulkPut(data.sessions);
        await db.messages.bulkPut(rowsOf(data.messages));
        const kv: KvRow[] = [];
        if (data.view) kv.push({ key: 'view', value: data.view });
        if (data.settings) kv.push({ key: 'settings', value: data.settings });
        if (data.connections) kv.push({ key: 'connections', value: data.connections });
        await db.kv.bulkPut(kv);
      });
    },

    flush: settle,
  };
}

function reportError(e: unknown) {
  console.warn('[persist] 저장 실패', e);
}
