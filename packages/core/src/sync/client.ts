import { createStore, type StoreApi } from 'zustand/vanilla';
import type { AppState, AppStore } from '../store';
import { NEW_SESSION_TITLE } from '../store';
import type { Anchor, Annotation, BranchKind, ID, Message, Session, ViewState } from '../model';
import type { SyncOp, SyncOpKind, SyncServerMsg } from '../bridge/sync';
import type { SyncLink } from '../bridge/remote';
import { branchQuestion } from '../context';
import { newId } from '../id';
import { applyAnnotationPatch, createAnnotation, isEmptyAnnotation } from '../annotations';
import { isCliId } from '../cli-options';
import { normalizeLayout } from '../splitLayout';

export type SyncStatus = 'unpaired' | 'connecting' | 'online' | 'offline' | 'unsupported';

/** 조작 실패 알림. UI가 at으로 새 실패를 구분해 토스트를 띄운다 */
export interface SyncActFailure {
  kind: SyncOpKind;
  /** SyncActError 또는 'offline' | 'timeout' */
  code: string;
  at: number;
}

export interface SyncClientState {
  status: SyncStatus;
  hostName?: string;
  /** 연결 실패/호스트 오류 설명 */
  error?: string;
  /** 메시지를 받아 온 세션 */
  loaded: Record<ID, true>;
  lastFailure?: SyncActFailure;
}

export interface SyncClient {
  state: StoreApi<SyncClientState>;
  start(): void;
  stop(): void;
  reconnect(): void;
  /** 세션 메시지를 아직 받지 않았으면 호스트에 요청한다 */
  ensureMessages(sessionId: ID): void;
}

export interface SyncClientOptions {
  store: AppStore;
  link: SyncLink;
  isPaired: () => Promise<boolean>;
  timeoutMs?: number;
  backoff?: { base: number; max: number };
}

/** view에서 사라진 세션 참조를 걷어낸다. 활성 세션이 사라지면 남아 있는 가장 가까운 조상으로 */
function pruneView(v: ViewState, gone: Set<ID>, sessions: Record<ID, Session> = {}): ViewState {
  if (!gone.size) return v;
  const split = v.splitSessionIds.filter((x) => !gone.has(x));
  let active = v.activeSessionId;
  while (active && gone.has(active)) active = sessions[active]?.parentId ?? null;
  return {
    ...v,
    activeSessionId: active,
    splitSessionIds: split,
    splitLayout: normalizeLayout(v.splitLayout, split),
    mode: v.mode === 'split' && split.length < 2 ? 'single' : v.mode,
    focusedSplitIndex: Math.min(v.focusedSplitIndex, Math.max(0, split.length - 1)),
    popups: v.popups.filter((p) => !gone.has(p.sessionId)),
    sheetSessionIds: v.sheetSessionIds.filter((x) => !gone.has(x)),
  };
}

/** view가 보여 주는 세션 (재연결 후 메시지를 다시 받아야 하는 세션) */
function visibleSessions(v: ViewState): ID[] {
  const ids = new Set<ID>();
  if (v.activeSessionId) ids.add(v.activeSessionId);
  for (const id of v.splitSessionIds) ids.add(id);
  for (const p of v.popups) ids.add(p.sessionId);
  for (const id of v.sheetSessionIds) ids.add(id);
  return [...ids];
}

/**
 * 웹·모바일 클라이언트 (ADR-026): PC 호스트 스토어를 미러링하고, 조작은 act 신호로 보낸다.
 * 스토어의 데이터 조작 액션을 원격 버전으로 바꿔 끼우므로 UI 코드는 그대로 쓴다.
 * 낙관적으로 먼저 표시하고, 호스트 push(같은 id)가 덮어쓴다. 거절되면 되돌린다.
 */
export function createSyncClient(opts: SyncClientOptions): SyncClient {
  const { store, link, isPaired, timeoutMs = 15000, backoff = { base: 1000, max: 30000 } } = opts;
  const get = () => store.getState();
  const apply = (patch: Partial<AppState>) => get().applyRemote(patch);

  const state = createStore<SyncClientState>(() => ({ status: 'unpaired', loaded: {} }));
  const setState = (patch: Partial<SyncClientState>) => state.setState(patch);

  let started = false;
  let generation = 0;
  let offMessage: (() => void) | null = null;
  let offDisconnect: (() => void) | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let backoffMs = backoff.base;
  /** 이번 연결에서 메시지를 요청한 세션 */
  const requested = new Set<ID>();
  const pending = new Map<string, { kind: SyncOpKind; rollback: () => void; timer: ReturnType<typeof setTimeout> }>();

  const markLoaded = (sessionId: ID) => {
    requested.add(sessionId);
    if (!state.getState().loaded[sessionId]) setState({ loaded: { ...state.getState().loaded, [sessionId]: true } });
  };

  const fail = (kind: SyncOpKind, code: string) => setState({ lastFailure: { kind, code, at: Date.now() } });

  /** 응답 대기 중인 조작을 버린다. 스냅샷이 진실 원천이므로 되돌리지 않는다 */
  const dropPending = () => {
    for (const p of pending.values()) clearTimeout(p.timer);
    pending.clear();
  };

  const closeListeners = () => {
    offMessage?.();
    offDisconnect?.();
    offMessage = null;
    offDisconnect = null;
  };

  const scheduleReconnect = () => {
    if (!started || retryTimer) return;
    const delay = backoffMs;
    backoffMs = Math.min(backoffMs * 2, backoff.max);
    retryTimer = setTimeout(() => {
      retryTimer = null;
      void connect();
    }, delay);
  };

  const goOffline = (error?: string) => {
    closeListeners();
    dropPending();
    requested.clear();
    setState({ status: 'offline', loaded: {}, ...(error ? { error } : {}) });
    scheduleReconnect();
  };

  const connect = async () => {
    if (!started) return;
    const gen = ++generation;
    closeListeners();
    const paired = await isPaired().catch(() => false);
    if (gen !== generation || !started) return;
    if (!paired) {
      setState({ status: 'unpaired', error: undefined, loaded: {} });
      return;
    }
    setState({ status: 'connecting' });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        link.ensure(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('PC에서 응답이 없습니다.')), timeoutMs);
        }),
      ]);
    } catch (e) {
      if (gen !== generation || !started) return;
      goOffline(e instanceof Error ? e.message : String(e));
      return;
    } finally {
      clearTimeout(timer);
    }
    if (gen !== generation || !started) return;
    offMessage = link.subscribe(handle);
    offDisconnect = link.onDisconnect(() => {
      if (gen === generation) goOffline('PC와 연결이 끊겼습니다.');
    });
    requested.clear();
    // 스냅샷을 받을 때까지는 connecting. 보내지 못하면 다시 시도
    if (!link.send({ type: 'sync.hello' })) goOffline('PC와 연결이 끊겼습니다.');
  };

  const requestMessages = (sessionId: ID, force = false) => {
    if (state.getState().status !== 'online') return;
    if (!force && requested.has(sessionId)) return;
    requested.add(sessionId);
    if (!link.send({ type: 'sync.messages', sessionId })) requested.delete(sessionId);
  };

  const handle = (msg: SyncServerMsg) => {
    const s = get();
    switch (msg.type) {
      case 'sync.snapshot': {
        dropPending();
        requested.clear();
        const gone = new Set(Object.keys(s.sessions).filter((id) => !msg.sessions[id]));
        const annotations = msg.annotations ?? [];
        // 스냅샷에 없는 세션의 annotation을 제거한다
        const filtered: Record<string, typeof annotations[0]> = {};
        for (const a of annotations) {
          if (msg.sessions[a.sessionId]) filtered[a.id] = a;
        }
        apply({
          sessions: msg.sessions,
          messages: {},
          streaming: msg.streaming,
          summaryDrafts: msg.summaryDrafts,
          annotations: filtered,
          view: pruneView(s.view, gone, s.sessions),
        });
        backoffMs = backoff.base;
        setState({ status: 'online', hostName: msg.hostName, error: undefined, loaded: {} });
        for (const id of visibleSessions(get().view)) requestMessages(id);
        return;
      }
      case 'sync.messages': {
        const list = msg.first ? msg.messages : [...(s.messages[msg.sessionId] ?? []), ...msg.messages];
        apply({ messages: { ...s.messages, [msg.sessionId]: list } });
        markLoaded(msg.sessionId);
        return;
      }
      case 'sync.append': {
        if (!state.getState().loaded[msg.sessionId]) return;
        const list = s.messages[msg.sessionId] ?? [];
        const m = list.find((x) => x.id === msg.messageId);
        if (!m || m.content.length !== msg.offset) {
          // 놓친 변경이 있다 → 세션 메시지를 다시 받는다
          requestMessages(msg.sessionId, true);
          return;
        }
        const next = { ...m, content: m.content + msg.text };
        apply({ messages: { ...s.messages, [msg.sessionId]: list.map((x) => (x.id === m.id ? next : x)) } });
        return;
      }
      case 'sync.session': {
        if ('deleted' in msg) {
          const gone = new Set(msg.deleted);
          const sessions = { ...s.sessions };
          const messages = { ...s.messages };
          const annotations = { ...s.annotations };
          for (const id of gone) {
            delete sessions[id];
            delete messages[id];
            requested.delete(id);
            // 삭제된 세션의 annotation도 제거
            for (const [annoId, anno] of Object.entries(annotations)) {
              if (anno.sessionId === id) delete annotations[annoId];
            }
          }
          const loaded = { ...state.getState().loaded };
          for (const id of gone) delete loaded[id];
          setState({ loaded });
          apply({ sessions, messages, annotations, view: pruneView(s.view, gone, s.sessions) });
        } else {
          apply({ sessions: { ...s.sessions, [msg.session.id]: msg.session } });
        }
        return;
      }
      case 'sync.message': {
        const sessionId = 'deleted' in msg ? msg.sessionId : msg.message.sessionId;
        if (!state.getState().loaded[sessionId]) return;
        const list = s.messages[sessionId] ?? [];
        if ('deleted' in msg) {
          apply({ messages: { ...s.messages, [sessionId]: list.filter((m) => m.id !== msg.deleted) } });
        } else {
          const exists = list.some((m) => m.id === msg.message.id);
          const next = exists ? list.map((m) => (m.id === msg.message.id ? msg.message : m)) : [...list, msg.message];
          apply({ messages: { ...s.messages, [sessionId]: next } });
        }
        return;
      }
      case 'sync.streaming':
        apply({ streaming: msg.streaming });
        return;
      case 'sync.draft': {
        const drafts = { ...s.summaryDrafts };
        if (msg.draft) drafts[msg.sessionId] = msg.draft;
        else delete drafts[msg.sessionId];
        apply({ summaryDrafts: drafts });
        return;
      }
      case 'sync.annot': {
        if ('annotation' in msg) {
          apply({ annotations: { ...s.annotations, [msg.annotation.id]: msg.annotation } });
        } else if ('deleted' in msg) {
          const annotations = { ...s.annotations };
          for (const id of msg.deleted) delete annotations[id];
          apply({ annotations });
        }
        return;
      }
      case 'act.result': {
        const p = pending.get(msg.reqId);
        if (!p) return;
        clearTimeout(p.timer);
        pending.delete(msg.reqId);
        if (!msg.ok) {
          p.rollback();
          fail(p.kind, msg.error ?? 'failed');
        }
        return;
      }
      case 'sync.error':
        if (msg.error === 'unsupported') {
          if (started) closeListeners();
          setState({ status: 'unsupported', error: msg.error });
        } else {
          // 호스트 엔진 미준비(PC 앱 창 닫힘 등) → 잠시 후 hello부터 다시
          goOffline(msg.error);
        }
        return;
      case 'sync.reset':
        dropPending();
        void connect();
        return;
    }
  };

  /** 조작 신호를 보낸다. 온라인이 아니거나 보내지 못하면 되돌리고 false */
  const act = (op: SyncOp, rollback: () => void = () => {}): boolean => {
    if (state.getState().status !== 'online') {
      rollback();
      fail(op.kind, 'offline');
      return false;
    }
    const reqId = newId('r');
    const timer = setTimeout(() => {
      if (!pending.delete(reqId)) return;
      rollback();
      fail(op.kind, 'timeout');
      // 실제로 실행되었을 수 있으므로 스냅샷으로 다시 맞춘다
      link.send({ type: 'sync.hello' });
    }, timeoutMs);
    pending.set(reqId, { kind: op.kind, rollback, timer });
    if (!link.send({ type: 'act', reqId, op })) {
      clearTimeout(timer);
      pending.delete(reqId);
      rollback();
      fail(op.kind, 'offline');
      return false;
    }
    return true;
  };

  /** 실패한 어노테이션 op 되돌리기: 아직 낙관적 값(optimistic) 그대로일 때만 이전 값(before)으로 */
  const restoreAnnotation = (id: ID, optimistic: Annotation | undefined, before: Annotation | undefined) => {
    const annotations = { ...get().annotations };
    if (annotations[id] !== optimistic) return;
    if (before) annotations[id] = before;
    else delete annotations[id];
    apply({ annotations });
  };

  /** 아직 낙관적 상태 그대로일 때만 세션을 걷어낸다 */
  const removeSession = (id: ID) => {
    const s = get();
    if (!s.sessions[id]) return;
    const sessions = { ...s.sessions };
    const messages = { ...s.messages };
    delete sessions[id];
    delete messages[id];
    apply({ sessions, messages, view: pruneView(s.view, new Set([id])) });
  };
  const removeMessage = (sessionId: ID, id: ID) => {
    const s = get();
    const list = s.messages[sessionId];
    if (!list?.some((m) => m.id === id)) return;
    apply({ messages: { ...s.messages, [sessionId]: list.filter((m) => m.id !== id) } });
  };
  const userMessage = (sessionId: ID, id: ID, content: string): Message => ({
    id,
    sessionId,
    role: 'user',
    content,
    createdAt: Date.now(),
  });

  const remoteActions: Partial<AppState> = {
    newRootSession(id, o) {
      const sessionId = id ?? newId('s');
      const s = get();
      if (s.sessions[sessionId]) return false;
      const now = Date.now();
      const session: Session = { id: sessionId, parentId: null, rootId: sessionId, title: NEW_SESSION_TITLE, createdAt: now, updatedAt: now };
      apply({
        sessions: { ...s.sessions, [sessionId]: session },
        messages: { ...s.messages, [sessionId]: [] },
        ...(o?.focus === false ? {} : { view: { ...s.view, mode: 'single', activeSessionId: sessionId } }),
      });
      markLoaded(sessionId);
      return act({ kind: 'newRoot', id: sessionId }, () => removeSession(sessionId)) ? sessionId : false;
    },

    sendMessage(sessionId, text, messageId, extra) {
      const content = text.trim();
      const s = get();
      const attachments = extra?.attachments?.length ? extra.attachments : undefined;
      if ((!content && !attachments) || !s.sessions[sessionId] || s.streaming[sessionId]) return false;
      const id = messageId ?? newId('m');
      const more = { ...(attachments ? { attachments } : {}), ...(extra?.skill ? { skill: extra.skill } : {}) };
      apply({ messages: { ...s.messages, [sessionId]: [...(s.messages[sessionId] ?? []), { ...userMessage(sessionId, id, content), ...more }] } });
      return act({ kind: 'send', sessionId, text: content, messageId: id, ...more }, () => removeMessage(sessionId, id)) ? id : false;
    },

    createBranch(parentSessionId: ID, anchor: Anchor, kind: BranchKind, customQuestion?: string, ids?: { sessionId?: ID; messageId?: ID }) {
      const s = get();
      const parent = s.sessions[parentSessionId];
      if (!parent) return false;
      const sessionId = ids?.sessionId ?? newId('s');
      const messageId = ids?.messageId ?? newId('m');
      if (s.sessions[sessionId]) return false;
      const now = Date.now();
      const session: Session = {
        id: sessionId,
        parentId: parent.id,
        rootId: parent.rootId,
        title: anchor.text.length > 24 ? `${anchor.text.slice(0, 24)}…` : anchor.text,
        anchor,
        ...(parent.providerId ? { providerId: parent.providerId } : {}),
        ...(parent.modelPref ? { modelPref: parent.modelPref } : {}),
        createdAt: now,
        updatedAt: now,
      };
      const q = kind === 'custom' ? (customQuestion ?? '').trim() : branchQuestion(kind, anchor.text);
      const question = q || branchQuestion('what', anchor.text);
      apply({
        sessions: { ...s.sessions, [sessionId]: session },
        messages: { ...s.messages, [sessionId]: [userMessage(sessionId, messageId, question)] },
      });
      markLoaded(sessionId);
      const op: SyncOp = {
        kind: 'branch',
        id: sessionId,
        parentId: parentSessionId,
        anchor,
        branch: kind,
        messageId,
        ...(customQuestion !== undefined ? { question: customQuestion } : {}),
      };
      return act(op, () => removeSession(sessionId)) ? sessionId : false;
    },

    stopStream(sessionId) {
      act({ kind: 'stop', sessionId });
    },

    retry(sessionId) {
      if (get().streaming[sessionId]) return false;
      return act({ kind: 'retry', sessionId });
    },

    deleteSession(sessionId) {
      act({ kind: 'delete', sessionId });
    },

    renameSession(sessionId, title) {
      const t = title.trim();
      const s = get();
      const session = s.sessions[sessionId];
      if (!t || !session) return;
      const before = session.title;
      apply({ sessions: { ...s.sessions, [sessionId]: { ...session, title: t } } });
      act({ kind: 'rename', sessionId, title: t }, () => {
        const cur = get().sessions[sessionId];
        if (cur && cur.title === t) apply({ sessions: { ...get().sessions, [sessionId]: { ...cur, title: before } } });
      });
    },

    async requestSummary(sessionId) {
      act({ kind: 'summary.request', sessionId });
    },

    discardSummaryDraft(sessionId) {
      act({ kind: 'summary.discard', sessionId });
    },

    attachSummary(sessionId, text) {
      const t = (text ?? get().summaryDrafts[sessionId]?.text ?? '').trim();
      act({ kind: 'summary.attach', sessionId, ...(t ? { text: t } : {}) });
    },

    removeSummary(sessionId) {
      act({ kind: 'summary.remove', sessionId });
    },

    addAnnotation(sessionId, anchor, init, id) {
      const s = get();
      if (!s.sessions[sessionId]) return '' as ID;
      const annoId = id ?? newId('a');
      if (annoId in s.annotations) return annoId;
      const annotation = createAnnotation(annoId, sessionId, anchor, init, Date.now());
      apply({ annotations: { ...s.annotations, [annoId]: annotation } });
      return act({ kind: 'annot.set', annotation }, () => restoreAnnotation(annoId, annotation, undefined)) ? annoId : '';
    },

    updateAnnotation(id, patch) {
      const s = get();
      const cur = s.annotations[id];
      if (!cur) return;
      const next = applyAnnotationPatch(cur, patch, Date.now());
      // 서식도 메모도 없으면 삭제로 보낸다
      if (isEmptyAnnotation(next)) {
        apply({ annotations: Object.fromEntries(Object.entries(s.annotations).filter(([k]) => k !== id)) });
        act({ kind: 'annot.delete', ids: [id] }, () => restoreAnnotation(id, undefined, cur));
        return;
      }
      apply({ annotations: { ...s.annotations, [id]: next } });
      act({ kind: 'annot.set', annotation: next }, () => restoreAnnotation(id, next, cur));
    },

    deleteAnnotations(ids) {
      const toDelete = ids.filter((id) => id in get().annotations);
      if (!toDelete.length) return;
      const s = get();
      apply({ annotations: Object.fromEntries(Object.entries(s.annotations).filter(([k]) => !toDelete.includes(k))) });
      act({ kind: 'annot.delete', ids: toDelete }, () => {
        for (const id of toDelete) restoreAnnotation(id, undefined, s.annotations[id]);
      });
    },

    // 원격 모드: 이 세션을 PC의 어느 CLI·모델·노력치로 답할지 PC에 요청한다 (PC 기본값은 null)
    setSessionProvider(sessionId, providerId) {
      if (providerId && !isCliId(providerId)) return;
      act({ kind: 'session.agent', sessionId, providerId: providerId ?? null });
    },
    setSessionModel(sessionId, patch) {
      const op: SyncOp = { kind: 'session.agent', sessionId };
      if ('model' in patch) op.model = patch.model ?? null;
      if ('effort' in patch) op.effort = patch.effort ?? null;
      act(op);
    },
    async refreshConnections() {},
  };

  let originals: Partial<AppState> | null = null;
  let offView: (() => void) | null = null;

  return {
    state,

    start() {
      if (started) return;
      started = true;
      const cur = get() as unknown as Record<string, unknown>;
      originals = Object.fromEntries(Object.keys(remoteActions).map((k) => [k, cur[k]])) as Partial<AppState>;
      store.setState(remoteActions);
      // 화면에 열린 세션은 메시지를 자동으로 받아 온다
      offView = store.subscribe((next, prev) => {
        if (next.view !== prev.view) for (const id of visibleSessions(next.view)) requestMessages(id);
      });
      void connect();
    },

    stop() {
      if (!started) return;
      started = false;
      generation++;
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = null;
      closeListeners();
      offView?.();
      offView = null;
      dropPending();
      requested.clear();
      if (originals) store.setState(originals);
      originals = null;
      setState({ status: 'unpaired', loaded: {} });
    },

    reconnect() {
      if (!started) return;
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = null;
      backoffMs = backoff.base;
      dropPending();
      requested.clear();
      setState({ loaded: {} });
      void connect();
    },

    ensureMessages(sessionId) {
      if (!state.getState().loaded[sessionId]) requestMessages(sessionId);
    },
  };
}
