import { createStore, type StoreApi } from 'zustand/vanilla';
import {
  branchQuestion,
  buildChatRequest,
  buildSummaryRequest,
  buildTitleRequest,
  cleanTitle,
  type MessageMap,
} from '../context';
import { newId } from '../id';
import type {
  Anchor,
  Annotation,
  AnnotationPatch,
  AnnotationStyle,
  Attachment,
  BranchKind,
  ConnectionState,
  DropEdge,
  ID,
  Message,
  Overlay,
  PopupWindow,
  ProviderId,
  Session,
  Settings,
  SkillRef,
  SplitNode,
  SummaryDraft,
  ThemePref,
  ViewMode,
  ViewState,
} from '../model';
import { insertLeaf, leaf, leafIds, normalizeLayout, removeLeaf, replaceLeaf, rowLayout, setGroupSizes } from '../splitLayout';
import { MAX_SPLIT } from '../model';
import { applyAnnotationPatch, createAnnotation, isEmptyAnnotation } from '../annotations';
import { isCliId, isValidEffort, sessionModelOptions } from '../cli-options';
import { collectStream, providerError, type ProviderError, type ProviderRegistry } from '../provider';
import { memoryRepository, type Repository } from '../repo';
import { DEFAULT_SETTINGS, defaultConnections, emptyView } from '../seed';
import { descendantIds, type SessionMap } from '../tree';

export const NEW_SESSION_TITLE = '새 학습';

/** 스트리밍 중 부분 응답 저장 간격(ms) */
export const STREAM_SAVE_INTERVAL = 1000;

export type OpenTarget = 'main' | 'split' | 'popup' | 'sheet';

/** 질문에 덧붙이는 첨부·스킬 (IMP-09) */
export interface SendExtra {
  attachments?: Attachment[];
  skill?: SkillRef;
}

const splitLayoutOf = (v: ViewState): SplitNode | undefined =>
  v.splitLayout ?? rowLayout(v.splitSessionIds, v.splitSizes);

/** 배치를 바꾸고 잎 순서·포커스를 맞춘다 */
function withLayout(v: ViewState, layout: SplitNode | undefined, focusId: ID | null, patch: Partial<ViewState>): ViewState {
  const ids = leafIds(layout);
  const fi = focusId ? ids.indexOf(focusId) : -1;
  const next: ViewState = { ...v, ...patch, splitSessionIds: ids, focusedSplitIndex: fi >= 0 ? fi : 0 };
  if (layout) next.splitLayout = layout;
  else delete next.splitLayout;
  return next;
}

export interface AppData {
  sessions: SessionMap;
  messages: MessageMap;
  annotations: Record<ID, Annotation>;
  view: ViewState;
  settings: Settings;
  connections: Record<ProviderId, ConnectionState>;
}

export interface AppState extends AppData {
  summaryDrafts: Record<ID, SummaryDraft>;
  overlay: Overlay;
  /** sessionId → 스트리밍 중인 assistant 메시지 id */
  streaming: Record<ID, ID>;

  // 데이터 교체 (시드/시나리오/영속화 로드)
  load(data: Partial<AppData>): void;

  // 원격 모드: repo에 쓰지 않고 상태만 업데이트
  applyRemote(patches: Partial<AppState>): void;

  // 세션
  newRootSession(id?: ID, opts?: { focus?: boolean }): ID | false;
  deleteSession(id: ID): void;
  renameSession(id: ID, title: string): void;
  setSessionProvider(id: ID, providerId: ProviderId | undefined): void;
  /** 이 채팅의 모델·노력치 덮어쓰기. 값을 비우면(undefined) 연결 기본값을 따른다 */
  setSessionModel(id: ID, patch: { model?: string | undefined; effort?: string | undefined }): void;

  // 메시지
  /** 질문 보내기. 첨부가 있으면 text가 비어도 된다 */
  sendMessage(sessionId: ID, text: string, messageId?: ID, extra?: SendExtra): ID | false;
  stopStream(sessionId: ID): void;
  /** 마지막 실패/중지 응답을 다시 생성. providerId를 주면 세션 provider를 바꾼 뒤 재시도 */
  retry(sessionId: ID, providerId?: ProviderId): boolean;

  // 가지
  createBranch(parentSessionId: ID, anchor: Anchor, kind: BranchKind, customQuestion?: string, ids?: { sessionId?: ID; messageId?: ID }): ID | false;

  // 어노테이션
  addAnnotation(sessionId: ID, anchor: Anchor, init: AnnotationStyle & { note?: string }, id?: ID): ID;
  updateAnnotation(id: ID, patch: AnnotationPatch): void;
  deleteAnnotations(ids: ID[]): void;
  /** upsert: 기존 id가 있으면 createdAt을 유지 */
  putAnnotation(annotation: Annotation): void;

  // 요약
  requestSummary(sessionId: ID): Promise<void>;
  updateSummaryDraft(sessionId: ID, text: string): void;
  discardSummaryDraft(sessionId: ID): void;
  attachSummary(sessionId: ID, text?: string): void;
  removeSummary(sessionId: ID): void;

  // 보기
  openSession(id: ID, target?: OpenTarget): void;
  setMode(mode: ViewMode): void;
  /** 마인드맵을 닫고 이전 보기(분할이 있으면 분할, 없으면 단일)로 */
  closeMindmap(): void;
  /**
   * 세션을 분할 패널에 놓는다 (사이드바에서 끌어 놓기, ADR-035).
   * targetId 패널의 edge 쪽에 새 칸을 만들고, center면 그 패널을 바꾼다. 단일 보기면 현재 세션 옆에 나눈다.
   * 패널이 가득 차 새 칸을 만들 수 없으면 false
   */
  dropToSplit(id: ID, targetId: ID | null, edge: DropEdge): boolean;
  closeSplit(index: number): void;
  focusSplit(index: number): void;
  /** 최상위 분할 그룹 비율 */
  setSplitSizes(sizes: number[]): void;
  /** path(자식 인덱스 경로)의 분할 그룹 비율 */
  setSplitGroupSizes(path: number[], sizes: number[]): void;
  movePopup(popupId: ID, rect: Partial<Pick<PopupWindow, 'x' | 'y' | 'w' | 'h'>>): void;
  focusPopup(popupId: ID): void;
  closePopup(popupId: ID): void;
  /** 팝업을 분할 패널로 옮긴다 */
  dockPopup(popupId: ID): void;
  closeSheet(): void;
  closeAllSheets(): void;
  setOverlay(overlay: Overlay): void;

  // 설정/연결
  setTheme(theme: ThemePref): void;
  updateSettings(patch: Partial<Settings>): void;
  setConnection(providerId: ProviderId, patch: Partial<ConnectionState>): void;
  /** 각 provider의 available()로 연결 상태를 다시 확인한다 (enabled/model은 유지) */
  refreshConnections(ids?: ProviderId[]): Promise<void>;
}

export interface AppStoreOptions {
  registry: ProviderRegistry;
  repo?: Repository;
  initial?: Partial<AppData>;
  /** 팝업 기본 위치 계산용 뷰포트 크기 */
  viewport?: () => { width: number; height: number };
  /** 원격 모드: true이면 repo에 쓰지 않는다 (세션 액션은 SyncClient가 호스트 요청으로 대체) */
  remote?: boolean;
}

export type AppStore = StoreApi<AppState>;

/** 세션에 적용될 provider id */
export function effectiveProviderId(state: Pick<AppData, 'sessions' | 'settings'>, sessionId: ID): ProviderId {
  return state.sessions[sessionId]?.providerId ?? state.settings.defaultProviderId;
}

/** 현재 provider 다음으로 쓸 수 있는(ready & enabled) 대체 provider */
export function nextFallback(
  state: Pick<AppData, 'settings' | 'connections'>,
  current: ProviderId,
): ProviderId | null {
  for (const id of state.settings.fallbackOrder) {
    if (id === current) continue;
    const c = state.connections[id];
    if (c && c.enabled && c.status === 'ready') return id;
  }
  return null;
}

/**
 * 분할 상태를 불변식에 맞춘다: 배치 트리와 splitSessionIds 순서를 맞추고, 포커스 세션을 유지하며,
 * 패널이 하나 이하로 줄면 단일 보기로 돌아간다 (ADR-035).
 */
export function fixSplit(v: ViewState): ViewState {
  const layout = normalizeLayout(v.splitLayout ?? rowLayout(v.splitSessionIds, v.splitSizes), v.splitSessionIds);
  const ids = leafIds(layout);
  const focusedId = v.splitSessionIds[v.focusedSplitIndex];
  const fi = focusedId ? ids.indexOf(focusedId) : -1;
  const next: ViewState = {
    ...v,
    splitSessionIds: ids,
    focusedSplitIndex: fi >= 0 ? fi : Math.min(Math.max(0, v.focusedSplitIndex), Math.max(0, ids.length - 1)),
  };
  delete next.splitSizes;
  if (layout && ids.length >= 2) next.splitLayout = layout;
  else delete next.splitLayout;
  if (ids.length < 2) {
    if (next.mode === 'split') {
      next.mode = 'single';
      next.activeSessionId = ids[0] ?? v.activeSessionId;
    }
    next.splitSessionIds = [];
    next.focusedSplitIndex = 0;
  }
  return next;
}

export function createAppStore(opts: AppStoreOptions): AppStore {
  const { registry } = opts;
  const repo = opts.remote ? memoryRepository() : (opts.repo ?? memoryRepository());
  const viewport = opts.viewport ?? (() => ({ width: 1280, height: 800 }));
  const controllers = new Map<ID, AbortController>();
  const summaryControllers = new Map<ID, AbortController>();

  const store = createStore<AppState>()((set, get) => {
    // ── 내부 헬퍼 ─────────────────────────────────────────
    const patchSession = (id: ID, patch: Partial<Session>) => {
      const cur = get().sessions[id];
      if (!cur) return;
      const next = { ...cur, ...patch };
      set((s) => ({ sessions: { ...s.sessions, [id]: next } }));
      repo.saveSession(next);
    };

    const putMessage = (m: Message, persist = true) => {
      let index = 0;
      set((s) => {
        const list = s.messages[m.sessionId] ?? [];
        const idx = list.findIndex((x) => x.id === m.id);
        index = idx >= 0 ? idx : list.length;
        const next = idx >= 0 ? list.map((x, i) => (i === idx ? m : x)) : [...list, m];
        return { messages: { ...s.messages, [m.sessionId]: next } };
      });
      if (persist) repo.saveMessage(m, index);
    };

    const getMessage = (sessionId: ID, messageId: ID) =>
      get().messages[sessionId]?.find((m) => m.id === messageId);

    const setView = (fn: (v: ViewState) => ViewState) => {
      const next = fixSplit(fn(get().view));
      set({ view: next });
      repo.saveView(next);
    };

    const touch = (sessionId: ID) => patchSession(sessionId, { updatedAt: Date.now() });

    const maybeTitle = async (sessionId: ID) => {
      const s = get().sessions[sessionId];
      if (!s || s.parentId !== null || s.title !== NEW_SESSION_TITLE) return;
      const providerId = effectiveProviderId(get(), sessionId);
      const provider = registry.get(providerId);
      if (!provider) return;
      try {
        const req = {
          ...buildTitleRequest(get().messages[sessionId] ?? []),
          ...sessionModelOptions(get(), sessionId, providerId),
        };
        const raw = await collectStream(provider, req);
        const title = cleanTitle(raw);
        if (title && get().sessions[sessionId]?.title === NEW_SESSION_TITLE) patchSession(sessionId, { title });
      } catch {
        // 제목 생성 실패는 무시 (다음 응답 후 재시도)
      }
    };

    /** assistant 메시지 하나를 스트리밍으로 채운다 */
    const runAssistant = async (sessionId: ID, messageId: ID) => {
      const providerId = effectiveProviderId(get(), sessionId);
      const provider = registry.get(providerId);
      const fail = (error: ProviderError, content?: string) => {
        const m = getMessage(sessionId, messageId);
        if (!m) return;
        putMessage({
          ...m,
          content: content ?? m.content,
          status: error.code === 'aborted' ? 'stopped' : 'error',
          ...(error.code === 'aborted' ? {} : { error: { code: error.code, message: error.message } }),
        });
      };
      const finish = () => {
        controllers.delete(sessionId);
        set((s) => {
          const streaming = { ...s.streaming };
          delete streaming[sessionId];
          return { streaming };
        });
      };

      if (!provider) {
        fail(providerError('unknown', `등록되지 않은 provider: ${providerId}`));
        finish();
        return;
      }

      const ctrl = new AbortController();
      controllers.set(sessionId, ctrl);
      set((s) => ({ streaming: { ...s.streaming, [sessionId]: messageId } }));

      const state = get();
      const req = buildChatRequest({
        sessions: state.sessions,
        messages: state.messages,
        sessionId,
        contextWindow: state.settings.contextWindow,
      });
      Object.assign(req, sessionModelOptions(state, sessionId, providerId));
      req.signal = ctrl.signal;

      let text = '';
      let ok = false;
      // 생성 중에도 주기적으로 저장해 새로고침/종료 시 부분 응답을 남긴다
      let savedAt = Date.now();
      try {
        for await (const ev of provider.stream(req)) {
          if (ev.type === 'delta') {
            text += ev.text;
            const m = getMessage(sessionId, messageId);
            const persist = Date.now() - savedAt >= STREAM_SAVE_INTERVAL;
            if (persist) savedAt = Date.now();
            if (m) putMessage({ ...m, content: text }, persist);
          } else if (ev.type === 'error') {
            fail(ev.error, text);
            break;
          } else {
            const m = getMessage(sessionId, messageId);
            if (m) putMessage({ ...m, content: text, status: 'done' });
            ok = true;
          }
        }
      } catch (e) {
        fail(providerError('unknown', e instanceof Error ? e.message : String(e)), text);
      } finally {
        finish();
      }
      touch(sessionId);
      if (ok) void maybeTitle(sessionId);
    };

    const startAssistant = (sessionId: ID) => {
      const msg: Message = {
        id: newId('m'),
        sessionId,
        role: 'assistant',
        content: '',
        createdAt: Date.now(),
        status: 'streaming',
        providerId: effectiveProviderId(get(), sessionId),
      };
      putMessage(msg);
      void runAssistant(sessionId, msg.id);
    };

    const nextPopup = (sessionId: ID, z: number): PopupWindow => {
      const { width, height } = viewport();
      const n = get().view.popups.length;
      const w = Math.min(440, Math.max(320, Math.round(width * 0.32)));
      const h = Math.min(560, Math.max(360, Math.round(height * 0.62)));
      return {
        id: newId('p'),
        sessionId,
        w,
        h,
        x: Math.max(16, width - w - 40 - n * 28),
        y: Math.max(16, 88 + n * 28),
        z,
      };
    };

    const topZ = () => get().view.popups.reduce((acc, p) => Math.max(acc, p.z), 0);

    // ── 공개 상태/액션 ─────────────────────────────────────
    const initial = opts.initial ?? {};
    return {
      sessions: initial.sessions ?? {},
      messages: initial.messages ?? {},
      annotations: initial.annotations ?? {},
      view: initial.view ?? emptyView(),
      settings: initial.settings ?? DEFAULT_SETTINGS,
      connections: initial.connections ?? defaultConnections(),
      summaryDrafts: {},
      overlay: 'none',
      streaming: {},

      load(data) {
        for (const c of [...controllers.values(), ...summaryControllers.values()]) c.abort();
        controllers.clear();
        summaryControllers.clear();
        set((s) => ({
          sessions: data.sessions ?? s.sessions,
          messages: data.messages ?? s.messages,
          annotations: data.annotations ?? s.annotations,
          view: data.view ?? s.view,
          settings: data.settings ?? s.settings,
          connections: data.connections ?? s.connections,
          summaryDrafts: {},
          streaming: {},
          overlay: 'none',
        }));
      },

      applyRemote(patches) {
        // 원격 모드: repo에 쓰지 않는다
        set(patches as Partial<AppState>);
      },

      newRootSession(id?: ID, opts?: { focus?: boolean }) {
        const sessionId = id ?? newId('s');
        // id 충돌 확인
        if (id && get().sessions[id]) return false;
        if (id && Object.values(get().messages).some((msgs) => msgs.some((m) => m.id === id))) return false;

        const now = Date.now();
        const s: Session = { id: sessionId, parentId: null, rootId: sessionId, title: NEW_SESSION_TITLE, createdAt: now, updatedAt: now };
        set((st) => ({ sessions: { ...st.sessions, [sessionId]: s }, messages: { ...st.messages, [sessionId]: [] } }));
        repo.saveSession(s);

        const focus = opts?.focus !== false;
        if (focus) {
          setView(() => emptyView(sessionId));
        }
        return sessionId;
      },

      deleteSession(id) {
        const ids = descendantIds(get().sessions, id);
        if (!ids.length) return;
        for (const sid of ids) controllers.get(sid)?.abort();
        const gone = new Set(ids);
        const parentId = get().sessions[id]?.parentId ?? null;
        // 삭제될 세션의 어노테이션도 수집
        const annotationsToDelete: ID[] = [];
        for (const [annoId, anno] of Object.entries(get().annotations)) {
          if (gone.has(anno.sessionId)) {
            annotationsToDelete.push(annoId);
          }
        }
        set((s) => {
          const sessions = { ...s.sessions };
          const messages = { ...s.messages };
          const annotations = { ...s.annotations };
          for (const sid of ids) {
            delete sessions[sid];
            delete messages[sid];
          }
          for (const annoId of annotationsToDelete) {
            delete annotations[annoId];
          }
          return { sessions, messages, annotations };
        });
        repo.deleteSessions(ids);
        if (annotationsToDelete.length) repo.deleteAnnotations(annotationsToDelete);
        setView((v) => {
          const split = v.splitSessionIds.filter((x) => !gone.has(x));
          const active = v.activeSessionId && gone.has(v.activeSessionId) ? parentId : v.activeSessionId;
          return {
            ...v,
            activeSessionId: active,
            // 남은 패널이 하나뿐이면 fixSplit이 그 세션을 단일 보기로 연다
            splitSessionIds: split,
            focusedSplitIndex: Math.min(v.focusedSplitIndex, Math.max(0, split.length - 1)),
            popups: v.popups.filter((p) => !gone.has(p.sessionId)),
            sheetSessionIds: v.sheetSessionIds.filter((x) => !gone.has(x)),
          };
        });
      },

      renameSession(id, title) {
        const t = title.trim();
        if (t) patchSession(id, { title: t });
      },

      setSessionProvider(id, providerId) {
        const cur = get().sessions[id];
        if (!cur) return;
        const next: Session = { ...cur };
        if (providerId) next.providerId = providerId;
        else delete next.providerId;
        // 모델·노력치는 provider마다 달라 provider가 바뀌면 덮어쓰기를 버린다
        if (next.modelPref && next.modelPref.providerId !== (providerId ?? get().settings.defaultProviderId)) {
          delete next.modelPref;
        }
        set((s) => ({ sessions: { ...s.sessions, [id]: next } }));
        repo.saveSession(next);
      },

      setSessionModel(id, patch) {
        const cur = get().sessions[id];
        if (!cur) return;
        const providerId = effectiveProviderId(get(), id);
        const prev = cur.modelPref?.providerId === providerId ? cur.modelPref : undefined;
        const model = 'model' in patch ? patch.model : prev?.model;
        let effort = 'effort' in patch ? patch.effort : prev?.effort;
        // 모델을 바꿔 지원하지 않게 된 노력치는 버린다
        if (effort && isCliId(providerId) && !isValidEffort(providerId, effort, model || get().connections[providerId]?.model)) {
          effort = undefined;
        }
        const next: Session = { ...cur };
        if (model || effort) {
          next.modelPref = { providerId, ...(model ? { model } : {}), ...(effort ? { effort } : {}) };
        } else delete next.modelPref;
        set((s) => ({ sessions: { ...s.sessions, [id]: next } }));
        repo.saveSession(next);
      },

      sendMessage(sessionId, text, messageId?: ID, extra?: SendExtra) {
        const content = text.trim();
        const attachments = extra?.attachments?.length ? extra.attachments : undefined;
        if ((!content && !attachments) || !get().sessions[sessionId] || get().streaming[sessionId]) return false;

        // messageId 충돌 확인
        if (messageId && (get().sessions[messageId] || Object.values(get().messages).some((msgs) => msgs.some((m) => m.id === messageId)))) {
          return false;
        }

        const id = messageId ?? newId('m');
        putMessage({
          id,
          sessionId,
          role: 'user',
          content,
          createdAt: Date.now(),
          ...(attachments ? { attachments } : {}),
          ...(extra?.skill ? { skill: extra.skill } : {}),
        });
        touch(sessionId);
        startAssistant(sessionId);
        return id;
      },

      stopStream(sessionId) {
        controllers.get(sessionId)?.abort();
      },

      retry(sessionId, providerId) {
        if (get().streaming[sessionId]) return false;
        if (providerId) get().setSessionProvider(sessionId, providerId);
        const list = get().messages[sessionId] ?? [];
        const last = list[list.length - 1];
        if (!last) return false;
        if (last.role === 'assistant' && (last.status === 'error' || last.status === 'stopped')) {
          set((s) => ({ messages: { ...s.messages, [sessionId]: list.slice(0, -1) } }));
          repo.deleteMessage(last.id);
        } else if (last.role !== 'user') {
          return false;
        }
        startAssistant(sessionId);
        return true;
      },

      createBranch(parentSessionId, anchor, kind, customQuestion, ids?: { sessionId?: ID; messageId?: ID }) {
        const parent = get().sessions[parentSessionId];
        if (!parent) return false;

        const sessionId = ids?.sessionId ?? newId('s');
        // id 충돌 확인
        if (ids?.sessionId && get().sessions[ids.sessionId]) return false;
        if (ids?.sessionId && Object.values(get().messages).some((msgs) => msgs.some((m) => m.id === ids.sessionId))) return false;
        if (ids?.messageId && (get().sessions[ids.messageId] || Object.values(get().messages).some((msgs) => msgs.some((m) => m.id === ids.messageId)))) return false;

        const now = Date.now();
        const title = anchor.text.length > 24 ? `${anchor.text.slice(0, 24)}…` : anchor.text;
        const s: Session = {
          id: sessionId,
          parentId: parent.id,
          rootId: parent.rootId,
          title,
          anchor,
          ...(parent.providerId ? { providerId: parent.providerId } : {}),
          ...(parent.modelPref ? { modelPref: parent.modelPref } : {}),
          createdAt: now,
          updatedAt: now,
        };
        set((st) => ({ sessions: { ...st.sessions, [sessionId]: s }, messages: { ...st.messages, [sessionId]: [] } }));
        repo.saveSession(s);
        touch(parent.id);
        const q = kind === 'custom' ? (customQuestion ?? '').trim() : branchQuestion(kind, anchor.text);
        const msgId = get().sendMessage(sessionId, q || branchQuestion('what', anchor.text), ids?.messageId);
        return msgId ? sessionId : false;
      },

      async requestSummary(sessionId) {
        const s = get().sessions[sessionId];
        if (!s?.parentId) return;
        const providerId = effectiveProviderId(get(), sessionId);
        const provider = registry.get(providerId);
        // 이전 요청이 남아 있으면 중단 (폐기 후 재요청 시 늦게 도착한 응답이 새 초안을 덮지 않도록)
        summaryControllers.get(sessionId)?.abort();
        const ctrl = new AbortController();
        summaryControllers.set(sessionId, ctrl);
        const current = () => summaryControllers.get(sessionId) === ctrl;
        const setDraft = (d: SummaryDraft) => {
          if (current()) set((st) => ({ summaryDrafts: { ...st.summaryDrafts, [sessionId]: d } }));
        };
        if (!provider) {
          setDraft({ status: 'error', text: '', message: 'provider를 찾을 수 없습니다.' });
          summaryControllers.delete(sessionId);
          return;
        }
        setDraft({ status: 'generating', text: '' });
        let partial = '';
        try {
          const req = buildSummaryRequest(s, get().messages[sessionId] ?? []);
          Object.assign(req, sessionModelOptions(get(), sessionId, providerId));
          req.signal = ctrl.signal;
          const text = await collectStream(provider, req, (t) => {
            partial = t;
            setDraft({ status: 'generating', text: t });
          });
          setDraft({ status: 'ready', text: text.trim() });
        } catch (e) {
          const err = e as Partial<ProviderError>;
          if (err?.code !== 'aborted') {
            // 부분 결과는 보존해 사용자가 편집하거나 다시 시도할 수 있게 한다
            setDraft({ status: 'error', text: partial.trim(), message: err?.message ?? '요약 생성에 실패했습니다.' });
          }
        } finally {
          if (current()) summaryControllers.delete(sessionId);
        }
      },

      updateSummaryDraft(sessionId, text) {
        const d = get().summaryDrafts[sessionId];
        if (d?.status === 'ready') set((st) => ({ summaryDrafts: { ...st.summaryDrafts, [sessionId]: { ...d, text } } }));
      },

      discardSummaryDraft(sessionId) {
        summaryControllers.get(sessionId)?.abort();
        summaryControllers.delete(sessionId);
        set((st) => {
          const summaryDrafts = { ...st.summaryDrafts };
          delete summaryDrafts[sessionId];
          return { summaryDrafts };
        });
      },

      attachSummary(sessionId, text) {
        const t = (text ?? get().summaryDrafts[sessionId]?.text ?? '').trim();
        if (!t) return;
        patchSession(sessionId, { summary: t, updatedAt: Date.now() });
        get().discardSummaryDraft(sessionId);
      },

      removeSummary(sessionId) {
        const cur = get().sessions[sessionId];
        if (!cur) return;
        const next = { ...cur };
        delete next.summary;
        set((s) => ({ sessions: { ...s.sessions, [sessionId]: next } }));
        repo.saveSession(next);
      },

      addAnnotation(sessionId, anchor, init, id?: ID) {
        // 세션이 존재하는지 확인
        if (!get().sessions[sessionId]) throw new Error(`세션을 찾을 수 없음: ${sessionId}`);
        const annoId = id ?? newId('a');
        // id 충돌 확인
        if (annoId in get().annotations) throw new Error(`어노테이션 id 충돌: ${annoId}`);
        const anno = createAnnotation(annoId, sessionId, anchor, init, Date.now());
        set((s) => ({ annotations: { ...s.annotations, [annoId]: anno } }));
        repo.saveAnnotation(anno);
        return annoId;
      },

      updateAnnotation(id, patch) {
        const cur = get().annotations[id];
        if (!cur) return;
        const next = applyAnnotationPatch(cur, patch, Date.now());
        // 서식도 메모도 없으면 삭제
        if (isEmptyAnnotation(next)) {
          get().deleteAnnotations([id]);
          return;
        }
        set((s) => ({ annotations: { ...s.annotations, [id]: next } }));
        repo.saveAnnotation(next);
      },

      deleteAnnotations(ids) {
        const toDelete = ids.filter((id) => id in get().annotations);
        if (!toDelete.length) return;
        set((s) => {
          const annotations = { ...s.annotations };
          for (const id of toDelete) delete annotations[id];
          return { annotations };
        });
        repo.deleteAnnotations(toDelete);
      },

      putAnnotation(annotation) {
        // upsert: 기존 annotation이 있으면 createdAt을 유지, 없으면 그대로
        const existing = get().annotations[annotation.id];
        const toSave = existing ? { ...annotation, createdAt: existing.createdAt } : annotation;
        set((s) => ({ annotations: { ...s.annotations, [annotation.id]: toSave } }));
        repo.saveAnnotation(toSave);
      },

      openSession(id, target = 'main') {
        if (!get().sessions[id]) return;
        set({ overlay: 'none' });
        if (target === 'main') {
          setView((v) => {
            if (v.mode === 'split' && v.splitSessionIds.length) {
              const existing = v.splitSessionIds.indexOf(id);
              if (existing >= 0) return { ...v, focusedSplitIndex: existing, activeSessionId: id };
              const cur = v.splitSessionIds[v.focusedSplitIndex];
              if (cur) return withLayout(v, replaceLeaf(splitLayoutOf(v), cur, id), id, { activeSessionId: id, sheetSessionIds: [] });
            }
            return { ...v, mode: 'single', activeSessionId: id, sheetSessionIds: [] };
          });
          return;
        }
        if (target === 'split') {
          setView((v) => {
            const inSplit = v.mode !== 'single' && v.splitSessionIds.length >= 2;
            if (inSplit && v.splitSessionIds.includes(id)) {
              return { ...v, mode: 'split', focusedSplitIndex: v.splitSessionIds.indexOf(id), activeSessionId: id };
            }
            const layout = inSplit ? splitLayoutOf(v) : v.activeSessionId ? leaf(v.activeSessionId) : undefined;
            const ids = leafIds(layout);
            if (!layout || !ids.length) return { ...v, mode: 'single', activeSessionId: id };
            // 가득 차면 마지막 패널을 바꾸고, 아니면 포커스 패널 오른쪽에 붙인다
            const focused = inSplit ? (v.splitSessionIds[v.focusedSplitIndex] ?? ids.at(-1)!) : ids[0]!;
            const next = ids.length >= MAX_SPLIT ? replaceLeaf(layout, ids.at(-1)!, id) : insertLeaf(layout, focused, id, 'right');
            return withLayout(v, next, id, {
              mode: 'split',
              activeSessionId: id,
              popups: v.popups.filter((p) => p.sessionId !== id),
              sheetSessionIds: [],
            });
          });
          return;
        }
        if (target === 'popup') {
          setView((v) => {
            const z = topZ() + 1;
            const existing = v.popups.find((p) => p.sessionId === id);
            if (existing) return { ...v, popups: v.popups.map((p) => (p.id === existing.id ? { ...p, z } : p)) };
            return { ...v, popups: [...v.popups, nextPopup(id, z)] };
          });
          return;
        }
        setView((v) => ({ ...v, sheetSessionIds: [...v.sheetSessionIds.filter((x) => x !== id), id] }));
      },

      setMode(mode) {
        setView((v) => {
          if (mode === 'split') {
            // 패널이 둘 이상일 때만 분할 보기가 된다 (fixSplit)
            return { ...v, mode };
          }
          if (mode === 'single' && v.mode === 'split') {
            const focused = v.splitSessionIds[v.focusedSplitIndex] ?? v.activeSessionId;
            return { ...v, mode, activeSessionId: focused, splitSessionIds: [] };
          }
          return { ...v, mode };
        });
      },

      closeMindmap() {
        setView((v) => (v.mode !== 'mindmap' ? v : { ...v, mode: v.splitSessionIds.length >= 2 ? 'split' : 'single' }));
      },

      dropToSplit(id, targetId, edge) {
        if (!get().sessions[id]) return false;
        const v = get().view;
        const inSplit = v.mode === 'split' && v.splitSessionIds.length >= 2;
        const layout = inSplit ? splitLayoutOf(v) : v.activeSessionId ? leaf(v.activeSessionId) : undefined;
        const ids = leafIds(layout);
        const target = targetId && ids.includes(targetId) ? targetId : ids.at(-1);
        if (!layout || !target || edge === 'center') {
          // 가운데: 그 패널(단일 보기면 메인)을 이 세션으로 바꾼다
          if (inSplit && target) {
            setView((cur) => withLayout(cur, replaceLeaf(splitLayoutOf(cur), target, id), id, { activeSessionId: id, sheetSessionIds: [] }));
          } else get().openSession(id, 'main');
          return true;
        }
        if (target === id) return true;
        if (!ids.includes(id) && ids.length >= MAX_SPLIT) return false;
        setView((cur) =>
          withLayout(cur, insertLeaf(layout, target, id, edge), id, {
            mode: 'split',
            activeSessionId: id,
            popups: cur.popups.filter((p) => p.sessionId !== id),
            sheetSessionIds: [],
          }),
        );
        return true;
      },

      closeSplit(index) {
        setView((v) => {
          const id = v.splitSessionIds[index];
          if (!id) return v;
          const layout = removeLeaf(splitLayoutOf(v), id);
          const ids = leafIds(layout);
          const focusedId = v.splitSessionIds[v.focusedSplitIndex];
          const keep = focusedId && focusedId !== id ? focusedId : (ids[Math.min(index, ids.length - 1)] ?? null);
          return withLayout(v, layout, keep, keep ? { activeSessionId: keep } : {});
        });
      },

      focusSplit(index) {
        setView((v) => ({
          ...v,
          focusedSplitIndex: index,
          activeSessionId: v.splitSessionIds[index] ?? v.activeSessionId,
        }));
      },

      setSplitSizes(sizes) {
        setView((v) => ({ ...v, splitLayout: setGroupSizes(splitLayoutOf(v), [], sizes) }));
      },

      setSplitGroupSizes(path, sizes) {
        setView((v) => ({ ...v, splitLayout: setGroupSizes(splitLayoutOf(v), path, sizes) }));
      },

      movePopup(popupId, rect) {
        setView((v) => ({ ...v, popups: v.popups.map((p) => (p.id === popupId ? { ...p, ...rect } : p)) }));
      },

      focusPopup(popupId) {
        const z = topZ();
        const p = get().view.popups.find((x) => x.id === popupId);
        if (!p || p.z === z) return;
        setView((v) => ({ ...v, popups: v.popups.map((x) => (x.id === popupId ? { ...x, z: z + 1 } : x)) }));
      },

      closePopup(popupId) {
        setView((v) => ({ ...v, popups: v.popups.filter((p) => p.id !== popupId) }));
      },

      dockPopup(popupId) {
        const p = get().view.popups.find((x) => x.id === popupId);
        if (!p) return;
        get().closePopup(popupId);
        get().openSession(p.sessionId, 'split');
      },

      closeSheet() {
        setView((v) => ({ ...v, sheetSessionIds: v.sheetSessionIds.slice(0, -1) }));
      },

      closeAllSheets() {
        setView((v) => ({ ...v, sheetSessionIds: [] }));
      },

      setOverlay(overlay) {
        set({ overlay });
      },

      setTheme(theme) {
        get().updateSettings({ theme });
      },

      updateSettings(patch) {
        const next = { ...get().settings, ...patch };
        set({ settings: next });
        repo.saveSettings(next);
      },

      setConnection(providerId, patch) {
        const cur = get().connections[providerId];
        const next = { ...get().connections, [providerId]: { ...cur, ...patch, providerId } };
        set({ connections: next });
        repo.saveConnections(Object.values(next));
      },

      async refreshConnections(ids) {
        const targets = ids ?? registry.list().map((p) => p.id);
        await Promise.all(
          targets.map(async (id) => {
            const p = registry.get(id);
            if (!p) return;
            const cur = get().connections[id];
            get().setConnection(id, { status: 'checking', enabled: cur?.enabled ?? true });
            let status: ConnectionState['status'] = 'offline';
            let detail: string | undefined;
            try {
              const a = await p.available();
              status = a.status;
              detail = a.detail;
            } catch (e) {
              detail = e instanceof Error ? e.message : String(e);
            }
            get().setConnection(id, { status, detail });
          }),
        );
      },
    };
  });

  return store;
}
