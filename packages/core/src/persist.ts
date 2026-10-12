import type { MessageMap } from './context';
import type { Annotation, ConnectionState, ID, Message, ProviderId, Session, Settings, ViewState } from './model';
import { DEFAULT_SETTINGS, emptyView, initialConnections } from './seed';
import type { AppData } from './store';

/** 저장소에서 읽은 원본 (어떤 플랫폼 저장소든 이 형태로 넘긴다) */
export interface StoredData {
  sessions: Session[];
  /** 세션 내 순서대로 정렬된 메시지 */
  messages: Message[];
  annotations?: Annotation[];
  view?: ViewState;
  settings?: Partial<Settings>;
  /** 연결은 사용자 선택(enabled, model, effort)만 의미가 있다. 상태는 시작 시 다시 감지한다 */
  connections?: Pick<ConnectionState, 'providerId' | 'enabled' | 'model' | 'effort'>[];
}

/** 연결 상태 중 저장할 값만 남긴다 (상태·키 마스킹 같은 런타임 값 제외) */
export function connectionPrefs(c: ConnectionState[]): NonNullable<StoredData['connections']> {
  return c.map((x) => ({
    providerId: x.providerId,
    enabled: x.enabled,
    ...(x.model ? { model: x.model } : {}),
    ...(x.effort ? { effort: x.effort } : {}),
  }));
}

/**
 * 저장소 원본을 스토어 데이터로 복원한다.
 * - 생성 중이던 메시지(새로고침/종료로 끊김)는 '중지됨'으로 바꿔 부분 응답과 [다시 시도]를 남긴다.
 * - 고아 세션(부모 없음)·메시지는 버리고, 보기 상태는 존재하는 세션만 가리키게 고친다.
 */
export function restoreData(raw: StoredData, base = initialConnections()): AppData {
  const all = new Map(raw.sessions.map((s) => [s.id, s]));
  const sessions: Record<ID, Session> = {};
  const alive = (s: Session): boolean => {
    let cur: Session | undefined = s;
    const seen = new Set<ID>();
    while (cur && cur.parentId !== null) {
      if (seen.has(cur.id)) return false;
      seen.add(cur.id);
      cur = all.get(cur.parentId);
    }
    return !!cur;
  };
  for (const s of raw.sessions) if (alive(s)) sessions[s.id] = s;

  const messages: MessageMap = {};
  for (const id of Object.keys(sessions)) messages[id] = [];
  for (const m of raw.messages) {
    const list = messages[m.sessionId];
    if (!list) continue;
    list.push(m.status === 'streaming' ? { ...m, status: 'stopped' } : m);
  }

  // 어노테이션: 존재하지 않는 세션의 어노테이션은 버린다
  const annotations: Record<ID, Annotation> = {};
  for (const a of raw.annotations ?? []) {
    if (sessions[a.sessionId]) {
      annotations[a.id] = a;
    }
  }

  const connections = { ...base };
  for (const c of raw.connections ?? []) {
    const cur = connections[c.providerId as ProviderId];
    if (!cur) continue;
    connections[c.providerId] = {
      ...cur,
      enabled: c.enabled,
      ...(c.model ? { model: c.model } : {}),
      ...(c.effort ? { effort: c.effort } : {}),
    };
  }

  return {
    sessions,
    messages,
    annotations,
    view: sanitizeView(raw.view, sessions),
    settings: { ...DEFAULT_SETTINGS, ...raw.settings },
    connections,
  };
}

/** 보기 상태가 존재하지 않는 세션을 가리키지 않게 고친다 */
export function sanitizeView(view: ViewState | undefined, sessions: Record<ID, Session>): ViewState {
  const roots = Object.values(sessions)
    .filter((s) => s.parentId === null)
    .sort((a, b) => b.updatedAt - a.updatedAt);
  const fallback = roots[0]?.id ?? null;
  if (!view) return emptyView(fallback);
  const ok = (id: ID) => id in sessions;
  const split = view.splitSessionIds.filter(ok);
  const sizesOk = view.splitSizes && split.length === view.splitSessionIds.length;
  const next: ViewState = {
    ...view,
    activeSessionId: view.activeSessionId && ok(view.activeSessionId) ? view.activeSessionId : fallback,
    splitSessionIds: split,
    focusedSplitIndex: Math.min(Math.max(0, view.focusedSplitIndex), Math.max(0, split.length - 1)),
    popups: view.popups.filter((p) => ok(p.sessionId)),
    sheetSessionIds: view.sheetSessionIds.filter(ok),
  };
  if (!sizesOk) delete next.splitSizes;
  if (next.mode === 'split' && split.length === 0) next.mode = 'single';
  return next;
}

/** 스토어 데이터 → 저장소 원본 (전체 저장/백업용) */
export function toStoredData(data: AppData): StoredData {
  const annotations = Object.values(data.annotations);
  return {
    sessions: Object.values(data.sessions),
    messages: Object.values(data.messages).flat(),
    ...(annotations.length ? { annotations } : {}),
    view: data.view,
    settings: data.settings,
    connections: connectionPrefs(Object.values(data.connections)),
  };
}
