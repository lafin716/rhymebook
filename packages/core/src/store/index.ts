import { createStore, type StoreApi } from 'zustand/vanilla';
import {
  branchQuestion,
  buildChatRequest,
  buildSummaryRequest,
  buildReorganizeRequest,
  buildTitleRequest,
  cleanTitle,
  parseReorganized,
  REORGANIZE_REQUEST,
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
  VaultNode,
} from '../model';
import {
  flipGroupDir,
  insertLeaf,
  leaf,
  leafIds,
  normalizeLayout,
  removeLeaf,
  replaceLeaf,
  rowLayout,
  setGroupSizes,
  swapChildren,
  swapLeaves,
} from '../splitLayout';
import { MAX_SPLIT } from '../model';
import { applyAnnotationPatch, createAnnotation, isEmptyAnnotation } from '../annotations';
import { isCliId, isValidEffort, sessionModelOptions } from '../cli-options';
import { collectStream, providerError, upsertTool, type ProviderError, type ProviderRegistry, type StreamRequest } from '../provider';
import { memoryRepository, type Repository } from '../repo';
import { DEFAULT_SETTINGS, defaultConnections, emptyView } from '../seed';
import { chatTarget, defaultSkills, REORGANIZE_SKILL_ID, skillRef } from '../skills';
import { planStudyImport, type StudyBundle, type StudyImportResult } from '../study';
import { childrenOf, descendantIds, subSessionTitle, type SessionMap } from '../tree';
import { planTurnMove, planTurnSplit, turnMessageIds, type TurnSplitPlan } from '../turns';
import { NEW_CANVAS_TITLE } from '../canvas';
import { NEW_PAGE_TITLE, isDocSession, isPage, pageDoc, renamePageLinks } from '../page';
import { vaultDescendants } from '../vault';

export const NEW_SESSION_TITLE = '새 학습';
export { NEW_PAGE_TITLE };

/** 스트리밍 중 부분 응답 저장 간격(ms) */
export const STREAM_SAVE_INTERVAL = 1000;

export type OpenTarget = 'main' | 'split' | 'popup' | 'sheet';

/** sibling: 하위 세션 대신 같은 레벨(형제, 루트면 새 루트)로 분리하고 AI로 제목을 짓는다 (ADR-066) */
export interface SplitTurnOptions {
  sibling?: boolean;
}

/** 채팅 대신 별도 요청으로 assistant 메시지를 채우는 실행 (재정리) */
interface CustomRun {
  request: StreamRequest;
  /** 완료 텍스트를 반영. 반영하지 못하면 false */
  done(text: string): boolean;
  /** 실패·중지: 임시 메시지를 걷어낸다 (여러 번 불려도 안전해야 한다) */
  failed(): void;
}

/** 재정리 기본 스킬 사본 (사용자가 스킬을 지웠어도 동작) */
export const defaultReorganizeSkill = (): SkillRef => skillRef(defaultSkills(0).find((k) => k.id === REORGANIZE_SKILL_ID)!);

/** 첨부만 있는 질문의 대신 글 */
const plainQuestion = (m: Message) => (m.attachments?.length ? `[첨부] ${m.attachments.map((a) => a.name).join(', ')}` : '세션 재정리');

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
  vault: Record<ID, VaultNode>;
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
  /**
   * 빈 마크다운 페이지를 만든다. 본문은 문서 메시지(docId) 하나 (ADR-072).
   * parentId를 주면 그 세션의 하위 페이지(앵커 없음)로 만든다 — 링크는 부모 본문에 UI가 넣는다. 부모가 없으면 false
   */
  newPage(id?: ID, opts?: { focus?: boolean; docId?: ID; parentId?: ID; kind?: 'canvas' }): ID | false;
  /** 빈 하위 대화(앵커 없음, 메시지 없음)를 만든다. 제목은 기본값, 부모 설정(provider·모델·웹 검색)을 물려받는다. 부모가 없으면 false */
  newSubSession(parentId: ID, id?: ID, opts?: { focus?: boolean }): ID | false;
  /** 페이지 본문을 바꾼다. 페이지가 아니거나 같은 내용이면 false */
  updatePage(sessionId: ID, content: string): boolean;
  deleteSession(id: ID): void;
  /**
   * 학습 꾸러미 가져오기 (ADR-043). 세션별로 더 최근에 바뀐 쪽을 남기고, 이 기기에만 있는 가지는 둔다.
   * 다른 학습과 id가 겹치면 StudyError('conflict')
   */
  importStudy(bundle: StudyBundle): StudyImportResult;
  /**
   * 질문 하나와 그 답변을 지운다. 그 답변에서 뻗은 가지·서식도 함께 지운다.
   * 첫 질문이거나 이 세션이 응답 생성 중이면 false
   */
  deleteTurn(sessionId: ID, questionId: ID): boolean;
  /**
   * 질문 하나와 그 답변을 새 하위 세션(앵커 없음)으로 옮긴다. 그 답변의 가지·서식, 그 질문 중에 만든 각주도 따라간다.
   * 새 세션 id, 첫 질문이거나 응답 생성 중이면 false
   */
  splitTurn(sessionId: ID, questionId: ID, newSessionId?: ID, opts?: SplitTurnOptions): ID | false;
  /**
   * 질문 하나와 그 답변을 다른 세션 끝으로 옮긴다 (분리와 같은 것이 따라간다, ADR-067).
   * 첫 질문, 대상이 없거나 옮길 가지 안쪽, 어느 쪽이든 응답 생성 중이면 false
   */
  moveTurn(sessionId: ID, questionId: ID, targetId: ID): boolean;
  /**
   * 세션 전체를 질문 하나 + 답변 하나로 재정리한다 (기본 스킬 reorganize, ADR-068).
   * 시작하면 true. 성공하면 옛 메시지를 바꾸고 앵커 가지는 각주가 된다. 실패·중지면 그대로 둔다
   */
  reorganizeSession(sessionId: ID, skill?: SkillRef): boolean;
  renameSession(id: ID, title: string): void;
  setSessionProvider(id: ID, providerId: ProviderId | undefined): void;
  /** 이 채팅의 모델·노력치 덮어쓰기. 값을 비우면(undefined) 연결 기본값을 따른다 */
  setSessionModel(id: ID, patch: { model?: string | undefined; effort?: string | undefined }): void;
  /** 이 채팅의 웹 검색·페이지 읽기 도구 켜기/끄기 (기본 켜짐, ADR-070) */
  setSessionWebSearch(id: ID, on: boolean): void;

  // 메시지
  /** 질문 보내기. 첨부가 있으면 text가 비어도 된다 */
  sendMessage(sessionId: ID, text: string, messageId?: ID, extra?: SendExtra): ID | false;
  stopStream(sessionId: ID): void;
  /** 마지막 실패/중지 응답을 다시 생성. providerId를 주면 세션 provider를 바꾼 뒤 재시도 */
  retry(sessionId: ID, providerId?: ProviderId): boolean;

  // 가지
  createBranch(parentSessionId: ID, anchor: Anchor, kind: BranchKind, customQuestion?: string, ids?: { sessionId?: ID; messageId?: ID }): ID | false;
  /** 앵커 없이 직접 질문으로 만드는 하위 세션(각주, IMP-22) */
  createSubSession(parentSessionId: ID, question: string, ids?: { sessionId?: ID; messageId?: ID }): ID | false;

  // 어노테이션
  addAnnotation(sessionId: ID, anchor: Anchor, init: AnnotationStyle & { note?: string }, id?: ID): ID;
  updateAnnotation(id: ID, patch: AnnotationPatch): void;
  deleteAnnotations(ids: ID[]): void;
  /** upsert: 기존 id가 있으면 createdAt을 유지 */
  putAnnotation(annotation: Annotation): void;

  // 보관함
  putVaultNode(node: VaultNode): void;
  deleteVaultNodes(ids: ID[]): void;

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
  /** 이 패널만 남기고 다른 분할 패널을 모두 닫는다 (단일 보기로) */
  closeOtherSplits(id: ID): void;
  focusSplit(index: number): void;
  /** 최상위 분할 그룹 비율 */
  setSplitSizes(sizes: number[]): void;
  /** path(자식 인덱스 경로)의 분할 그룹 비율 */
  setSplitGroupSizes(path: number[], sizes: number[]): void;
  /** 두 분할 패널의 자리를 바꾼다 (칸 비율은 위치에 남음, 포커스는 같은 세션 유지) */
  swapSplit(a: ID, b: ID): void;
  /** path 그룹의 i·j번째 부분트리를 맞바꾼다 (경계선 ⋯ 메뉴 '자리 바꾸기') */
  swapSplitChildren(path: number[], i: number, j: number): void;
  /** path 그룹의 방향을 좌우↔상하로 바꾼다 */
  flipSplitGroup(path: number[]): void;
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

    /** 빈 대화에서 처음 보낸 세션 — 하위 대화도 이 첫 답변 뒤에 제목을 짓는다 */
    const firstTurnUntitled = new Set<ID>();

    /** 대화로 제목을 지어, 그사이 제목이 expected에서 바뀌지 않았을 때만 바꾼다 */
    const aiTitle = async (sessionId: ID, expected: string) => {
      const providerId = effectiveProviderId(get(), sessionId);
      const provider = registry.get(providerId);
      if (!provider) return;
      try {
        const req = {
          ...buildTitleRequest(get().messages[sessionId] ?? [], get().settings.prompts),
          ...sessionModelOptions(get(), sessionId, providerId),
        };
        const raw = await collectStream(provider, req);
        const title = cleanTitle(raw);
        if (title && get().sessions[sessionId]?.title === expected) patchSession(sessionId, { title });
      } catch {
        // 제목 생성 실패는 무시 (지금 제목 유지)
      }
    };

    const maybeTitle = async (sessionId: ID) => {
      const firstTurn = firstTurnUntitled.delete(sessionId);
      const s = get().sessions[sessionId];
      if (!s || s.title !== NEW_SESSION_TITLE) return;
      // 루트 대화는 기존처럼, 하위 대화는 빈 상태에서 처음 보낸 질문 뒤에만 짓는다
      if (s.parentId !== null && !firstTurn) return;
      await aiTitle(sessionId, NEW_SESSION_TITLE);
    };

    /**
     * 질문 하나(계획)를 dest 세션 끝으로 옮긴다. isNew면 dest를 새로 만든다.
     * delta만큼 옮길 메시지·각주의 시각을 민다(각주 자리·맥락 범위가 함께 움직인다).
     * 루트가 바뀌면 따라가는 가지의 자손까지 rootId를 바꾼다
     */
    const relocateTurn = (sessionId: ID, questionId: ID, plan: TurnSplitPlan, dest: Session, isNew: boolean, delta: number) => {
      const st = get();
      const list = st.messages[sessionId] ?? [];
      const moved = new Set(plan.messageIds);
      const from = list.findIndex((m) => m.id === questionId);
      const rest = list.filter((m) => !moved.has(m.id));
      const destList = isNew ? [] : (st.messages[dest.id] ?? []);
      const movedMsgs = list.filter((m) => moved.has(m.id)).map((m) => ({ ...m, sessionId: dest.id, createdAt: m.createdAt + delta }));
      const rootChanged = st.sessions[sessionId]?.rootId !== dest.rootId;
      const changed: Session[] = plan.childIds.map((cid) => {
        const c = st.sessions[cid]!;
        return { ...c, parentId: dest.id, rootId: dest.rootId, ...(c.anchor ? {} : { createdAt: c.createdAt + delta }) };
      });
      if (rootChanged) {
        for (const cid of plan.childIds) {
          for (const d of descendantIds(st.sessions, cid).slice(1)) changed.push({ ...st.sessions[d]!, rootId: dest.rootId });
        }
      }
      const annos = Object.values(st.annotations)
        .filter((a) => a.sessionId === sessionId && moved.has(a.anchor.messageId))
        .map((a) => ({ ...a, sessionId: dest.id }));
      set((s) => ({
        sessions: { ...s.sessions, ...(isNew ? { [dest.id]: dest } : {}), ...Object.fromEntries(changed.map((c) => [c.id, c])) },
        messages: { ...s.messages, [sessionId]: rest, [dest.id]: [...destList, ...movedMsgs] },
        annotations: { ...s.annotations, ...Object.fromEntries(annos.map((a) => [a.id, a])) },
      }));
      if (isNew) repo.saveSession(dest);
      for (const c of changed) repo.saveSession(c);
      movedMsgs.forEach((m, i) => repo.saveMessage(m, destList.length + i));
      // 복원 순서(seq)가 어긋나지 않게 뒤쪽 메시지 위치를 다시 저장
      for (let i = from; i < rest.length; i++) repo.saveMessage(rest[i]!, i);
      for (const a of annos) repo.saveAnnotation(a);
    };

    /** assistant 메시지 하나를 스트리밍으로 채운다 */
    /** 이 턴을 답할 provider·모델·노력치: 스킬 전용 설정 → 세션 설정 (IMP-12) */
    const targetOf = (sessionId: ID, ignoreSkill?: boolean) =>
      chatTarget(get(), sessionId, { usable: (id) => !!registry.get(id), ...(ignoreSkill ? { ignoreSkill } : {}) });

    const runAssistant = async (sessionId: ID, messageId: ID, ignoreSkill?: boolean, custom?: CustomRun) => {
      const target = targetOf(sessionId, ignoreSkill);
      const providerId = target.providerId;
      const provider = registry.get(providerId);
      const fail = (error: ProviderError, content?: string) => {
        if (custom) return custom.failed();
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
      const req =
        custom?.request ??
        buildChatRequest({
          sessions: state.sessions,
          messages: state.messages,
          sessionId,
          contextWindow: state.settings.contextWindow,
          prompts: state.settings.prompts,
        });
      Object.assign(req, target.options);
      // 일반 대화에만 웹 도구를 붙인다. 재정리 같은 내부 요청은 도구 없이 (ADR-070)
      if (!custom) req.webSearch = state.sessions[sessionId]?.webSearch !== false;
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
            // 재정리 중 임시 메시지는 저장하지 않는다 (끝나면 결과만 저장)
            const persist = !custom && Date.now() - savedAt >= STREAM_SAVE_INTERVAL;
            if (persist) savedAt = Date.now();
            if (m) putMessage({ ...m, content: text }, persist);
          } else if (ev.type === 'image') {
            const m = getMessage(sessionId, messageId);
            if (m) putMessage({ ...m, attachments: [...(m.attachments ?? []), ev.attachment] });
          } else if (ev.type === 'tool') {
            const m = getMessage(sessionId, messageId);
            if (m) putMessage({ ...m, tools: upsertTool(m.tools, ev.tool) });
          } else if (ev.type === 'error') {
            fail(ev.error, text);
            break;
          } else if (custom) {
            ok = custom.done(text);
            if (!ok) custom.failed();
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
      if (custom && !ok && getMessage(sessionId, messageId)) custom.failed();
      if (get().sessions[sessionId]) touch(sessionId);
      if (ok && !custom) void maybeTitle(sessionId);
    };

    /** ignoreSkill: 대체 provider로 다시 시도할 때처럼 사용자가 provider를 직접 고르면 스킬 설정을 쓰지 않는다 */
    const startAssistant = (sessionId: ID, ignoreSkill?: boolean) => {
      const msg: Message = {
        id: newId('m'),
        sessionId,
        role: 'assistant',
        content: '',
        createdAt: Date.now(),
        status: 'streaming',
        providerId: targetOf(sessionId, ignoreSkill).providerId,
      };
      putMessage(msg);
      void runAssistant(sessionId, msg.id, ignoreSkill);
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
      vault: initial.vault ?? {},
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
          vault: data.vault ?? s.vault,
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

      newPage(id?: ID, opts?: { focus?: boolean; docId?: ID; parentId?: ID; kind?: 'canvas' }) {
        const sessionId = id ?? newId('s');
        const docId = opts?.docId ?? newId('m');
        const taken = (x: ID) => !!get().sessions[x] || Object.values(get().messages).some((msgs) => msgs.some((m) => m.id === x));
        if (docId === sessionId || (id && taken(id)) || (opts?.docId && taken(opts.docId))) return false;
        const parent = opts?.parentId ? get().sessions[opts.parentId] : undefined;
        if (opts?.parentId && !parent) return false;

        const now = Date.now();
        const s: Session = {
          id: sessionId,
          parentId: parent?.id ?? null,
          rootId: parent ? parent.rootId : sessionId,
          title: opts?.kind === 'canvas' ? NEW_CANVAS_TITLE : NEW_PAGE_TITLE,
          kind: opts?.kind ?? 'page',
          createdAt: now,
          updatedAt: now,
        };
        const doc: Message = { id: docId, sessionId, role: 'assistant', content: '', createdAt: now, status: 'done' };
        set((st) => ({ sessions: { ...st.sessions, [sessionId]: s }, messages: { ...st.messages, [sessionId]: [doc] } }));
        repo.saveSession(s);
        repo.saveMessage(doc, 0);
        if (parent) touch(parent.id);

        if (opts?.focus !== false) setView(() => emptyView(sessionId));
        return sessionId;
      },

      newSubSession(parentId, id?, opts?) {
        const parent = get().sessions[parentId];
        if (!parent) return false;
        const sessionId = id ?? newId('s');
        const taken = (x: ID) => !!get().sessions[x] || Object.values(get().messages).some((msgs) => msgs.some((m) => m.id === x));
        if (id && taken(id)) return false;

        const now = Date.now();
        const s: Session = {
          id: sessionId,
          parentId: parent.id,
          rootId: parent.rootId,
          title: NEW_SESSION_TITLE,
          ...(parent.providerId ? { providerId: parent.providerId } : {}),
          ...(parent.modelPref ? { modelPref: parent.modelPref } : {}),
          ...(parent.webSearch === false ? { webSearch: false } : {}),
          createdAt: now,
          updatedAt: now,
        };
        set((st) => ({ sessions: { ...st.sessions, [sessionId]: s }, messages: { ...st.messages, [sessionId]: [] } }));
        repo.saveSession(s);
        touch(parent.id);

        if (opts?.focus !== false) setView(() => emptyView(sessionId));
        return sessionId;
      },

      updatePage(sessionId, content) {
        if (!isDocSession(get().sessions[sessionId])) return false;
        const doc = pageDoc(get().messages[sessionId]);
        if (!doc) {
          const now = Date.now();
          putMessage({ id: newId('m'), sessionId, role: 'assistant', content, createdAt: now, status: 'done' });
        } else if (doc.content === content) {
          return false;
        } else {
          putMessage({ ...doc, content });
        }
        touch(sessionId);
        return true;
      },

      importStudy(bundle) {
        const st = get();
        const { apply, ...result } = planStudyImport(st, bundle, st.streaming);
        if (!apply.length) return result;
        const ids = new Set(apply);
        const nextMsgs = new Map<ID, Message[]>();
        for (const m of bundle.messages) if (ids.has(m.sessionId)) nextMsgs.set(m.sessionId, [...(nextMsgs.get(m.sessionId) ?? []), m]);
        const nextAnnos = bundle.annotations.filter((a) => ids.has(a.sessionId));
        const keepMsg = new Set(bundle.messages.map((m) => m.id));
        const keepAnno = new Set(nextAnnos.map((a) => a.id));
        const goneMsgs = apply.flatMap((sid) => (st.messages[sid] ?? []).filter((m) => !keepMsg.has(m.id)).map((m) => m.id));
        const goneAnnos = Object.values(st.annotations)
          .filter((a) => ids.has(a.sessionId) && !keepAnno.has(a.id))
          .map((a) => a.id);
        set((s) => {
          const sessions = { ...s.sessions };
          const messages = { ...s.messages };
          const annotations = { ...s.annotations };
          for (const sess of bundle.sessions) {
            if (!ids.has(sess.id)) continue;
            sessions[sess.id] = sess;
            messages[sess.id] = nextMsgs.get(sess.id) ?? [];
          }
          for (const id of goneAnnos) delete annotations[id];
          for (const a of nextAnnos) annotations[a.id] = a;
          return { sessions, messages, annotations };
        });
        for (const id of goneMsgs) repo.deleteMessage(id);
        if (goneAnnos.length) repo.deleteAnnotations(goneAnnos);
        for (const sess of bundle.sessions) {
          if (!ids.has(sess.id)) continue;
          repo.saveSession(sess);
          (nextMsgs.get(sess.id) ?? []).forEach((m, i) => repo.saveMessage(m, i));
        }
        for (const a of nextAnnos) repo.saveAnnotation(a);
        return result;
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

      deleteTurn(sessionId, questionId) {
        if (get().streaming[sessionId]) return false;
        const list = get().messages[sessionId] ?? [];
        const ids = turnMessageIds(list, questionId);
        if (!ids) return false;
        const gone = new Set(ids);
        // 지울 답변에 앵커를 둔 가지(와 하위 가지)
        for (const b of Object.values(get().sessions)) {
          if (b.parentId === sessionId && b.anchor && gone.has(b.anchor.messageId)) get().deleteSession(b.id);
        }
        const annos = Object.values(get().annotations)
          .filter((a) => gone.has(a.anchor.messageId))
          .map((a) => a.id);
        if (annos.length) get().deleteAnnotations(annos);
        const from = list.findIndex((m) => m.id === questionId);
        const next = list.filter((m) => !gone.has(m.id));
        set((s) => ({ messages: { ...s.messages, [sessionId]: next } }));
        for (const id of ids) repo.deleteMessage(id);
        // 복원 순서(seq)가 어긋나지 않게 뒤쪽 메시지 위치를 다시 저장
        for (let i = from; i < next.length; i++) repo.saveMessage(next[i]!, i);
        touch(sessionId);
        return true;
      },

      splitTurn(sessionId, questionId, newSessionId, opts) {
        const st = get();
        const src = st.sessions[sessionId];
        if (!src || isDocSession(src) || st.streaming[sessionId]) return false;
        const list = st.messages[sessionId] ?? [];
        const plan = planTurnSplit(st.sessions, list, sessionId, questionId);
        if (!plan) return false;
        const id = newSessionId ?? newId('s');
        if (st.sessions[id] || st.messages[id]) return false;
        const now = Date.now();
        const title = subSessionTitle(plan.question);
        const inherit = {
          ...(src.providerId ? { providerId: src.providerId } : {}),
          ...(src.modelPref ? { modelPref: src.modelPref } : {}),
          ...(src.webSearch === false ? { webSearch: false } : {}),
        };
        // 형제: 부모가 있으면 같은 부모 아래 각주(원래 세션 바로 뒤 자리), 루트면 새 루트
        const dest: Session = opts?.sibling
          ? src.parentId
            ? { id, parentId: src.parentId, rootId: src.rootId, title, ...inherit, createdAt: src.createdAt + 1, updatedAt: now }
            : { id, parentId: null, rootId: id, title, ...inherit, createdAt: now, updatedAt: now }
          : { id, parentId: src.id, rootId: src.rootId, title, ...inherit, createdAt: plan.createdAt, updatedAt: now };
        relocateTurn(sessionId, questionId, plan, dest, true, 0);
        touch(sessionId);
        if (opts?.sibling) void aiTitle(id, title);
        return id;
      },

      moveTurn(sessionId, questionId, targetId) {
        const st = get();
        if (!st.sessions[sessionId] || st.streaming[sessionId] || st.streaming[targetId]) return false;
        if (isDocSession(st.sessions[sessionId]) || isDocSession(st.sessions[targetId])) return false;
        const list = st.messages[sessionId] ?? [];
        const plan = planTurnMove(st.sessions, list, sessionId, questionId, targetId);
        if (!plan) return false;
        const q = list.find((m) => m.id === questionId)!;
        const last = (st.messages[targetId] ?? []).at(-1);
        // 대상 끝에 붙인다: 질문 시각이 대상 마지막 메시지 뒤가 되도록 민다
        const base = Math.max(Date.now(), (last?.createdAt ?? 0) + 1);
        relocateTurn(sessionId, questionId, plan, st.sessions[targetId]!, false, base - q.createdAt);
        touch(sessionId);
        touch(targetId);
        return true;
      },

      reorganizeSession(sessionId, skill) {
        const st = get();
        if (!st.sessions[sessionId] || isDocSession(st.sessions[sessionId]) || st.streaming[sessionId]) return false;
        const old = st.messages[sessionId] ?? [];
        const firstQ = old.find((m) => m.role === 'user');
        if (!firstQ || !old.some((m) => m.role === 'assistant' && m.content.trim())) return false;
        const ref = skill ?? defaultReorganizeSkill();
        // 재정리 후 모든 하위 세션이 각주가 된다: 만든 순서가 각주 번호
        const notes = childrenOf(st.sessions, sessionId);
        const request = buildReorganizeRequest(
          { sessions: st.sessions, messages: st.messages, sessionId, contextWindow: st.settings.contextWindow, prompts: st.settings.prompts },
          old,
          notes.map((c) => ({ title: c.title, ...(c.anchor ? { anchorText: c.anchor.text } : {}), ...(c.summary ? { summary: c.summary } : {}) })),
          ref,
        );
        const now = Date.now();
        const ask: Message = { id: newId('m'), sessionId, role: 'user', content: REORGANIZE_REQUEST, createdAt: now, skill: ref };
        putMessage(ask, false);
        const reply: Message = {
          id: newId('m'),
          sessionId,
          role: 'assistant',
          content: '',
          createdAt: now + 1,
          status: 'streaming',
          providerId: targetOf(sessionId).providerId,
        };
        putMessage(reply, false);
        const temp = new Set([ask.id, reply.id]);
        const fallback = firstQ.content.trim() || plainQuestion(firstQ);
        void runAssistant(sessionId, reply.id, false, {
          request,
          done(text) {
            const parsed = parseReorganized(text, fallback);
            if (!parsed || !get().sessions[sessionId]) return false;
            const oldIds = new Set(old.map((m) => m.id));
            const q: Message = { id: newId('m'), sessionId, role: 'user', content: parsed.question, createdAt: firstQ.createdAt };
            const a: Message = {
              id: reply.id,
              sessionId,
              role: 'assistant',
              content: parsed.answer,
              createdAt: firstQ.createdAt + 1,
              status: 'done',
              ...(reply.providerId ? { providerId: reply.providerId } : {}),
            };
            // 그사이 들어온 다른 메시지(없어야 정상)는 뒤에 남긴다
            const extra = (get().messages[sessionId] ?? []).filter((m) => !oldIds.has(m.id) && !temp.has(m.id));
            const annos = Object.values(get().annotations)
              .filter((x) => oldIds.has(x.anchor.messageId))
              .map((x) => x.id);
            if (annos.length) get().deleteAnnotations(annos);
            const footnotes = childrenOf(get().sessions, sessionId)
              .filter((c) => c.anchor)
              .map((c) => {
                const next = { ...c };
                delete next.anchor;
                return next;
              });
            const next = [q, a, ...extra];
            set((s) => ({
              sessions: { ...s.sessions, ...Object.fromEntries(footnotes.map((c) => [c.id, c])) },
              messages: { ...s.messages, [sessionId]: next },
            }));
            for (const id of oldIds) repo.deleteMessage(id);
            next.forEach((m, i) => repo.saveMessage(m, i));
            for (const c of footnotes) repo.saveSession(c);
            return true;
          },
          failed() {
            const list = get().messages[sessionId];
            if (!list?.some((m) => temp.has(m.id))) return;
            set((s) => ({ messages: { ...s.messages, [sessionId]: list.filter((m) => !temp.has(m.id)) } }));
          },
        });
        return true;
      },

      renameSession(id, title) {
        const t = title.trim();
        if (!t) return;
        const cur = get().sessions[id];
        patchSession(id, { title: t });
        // 부모가 페이지면 그 본문의 이 세션 링크 글자도 새 제목으로
        const parent = cur?.parentId ? get().sessions[cur.parentId] : undefined;
        if (!parent || !isPage(parent)) return;
        const doc = pageDoc(get().messages[parent.id]);
        if (!doc) return;
        const next = renamePageLinks(doc.content, id, t);
        if (next !== doc.content) get().updatePage(parent.id, next);
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

      setSessionWebSearch(id, on) {
        const cur = get().sessions[id];
        if (!cur || (cur.webSearch !== false) === on) return;
        const next: Session = { ...cur };
        if (on) delete next.webSearch;
        else next.webSearch = false;
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
        const sess = get().sessions[sessionId];
        if ((!content && !attachments) || !sess || isDocSession(sess) || get().streaming[sessionId]) return false;

        // messageId 충돌 확인
        if (messageId && (get().sessions[messageId] || Object.values(get().messages).some((msgs) => msgs.some((m) => m.id === messageId)))) {
          return false;
        }

        const id = messageId ?? newId('m');
        if (!get().messages[sessionId]?.length) firstTurnUntitled.add(sessionId);
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
        if (get().streaming[sessionId] || isDocSession(get().sessions[sessionId])) return false;
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
        startAssistant(sessionId, !!providerId);
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
          ...(parent.webSearch === false ? { webSearch: false } : {}),
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

      createSubSession(parentSessionId, question, ids?: { sessionId?: ID; messageId?: ID }) {
        const parent = get().sessions[parentSessionId];
        const q = question.trim();
        if (!parent || !q) return false;
        const sessionId = ids?.sessionId ?? newId('s');
        const taken = (id: ID) => !!get().sessions[id] || Object.values(get().messages).some((msgs) => msgs.some((m) => m.id === id));
        if (ids?.sessionId && taken(ids.sessionId)) return false;
        if (ids?.messageId && taken(ids.messageId)) return false;

        const now = Date.now();
        const s: Session = {
          id: sessionId,
          parentId: parent.id,
          rootId: parent.rootId,
          title: subSessionTitle(q),
          ...(parent.providerId ? { providerId: parent.providerId } : {}),
          ...(parent.modelPref ? { modelPref: parent.modelPref } : {}),
          ...(parent.webSearch === false ? { webSearch: false } : {}),
          createdAt: now,
          updatedAt: now,
        };
        set((st) => ({ sessions: { ...st.sessions, [sessionId]: s }, messages: { ...st.messages, [sessionId]: [] } }));
        repo.saveSession(s);
        touch(parent.id);
        const msgId = get().sendMessage(sessionId, q, ids?.messageId);
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
          const req = buildSummaryRequest(s, get().messages[sessionId] ?? [], get().settings.prompts);
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

      putVaultNode(node) {
        // upsert: 기존 node가 있으면 createdAt을 유지, 없으면 그대로
        const existing = get().vault[node.id];
        const toSave = existing ? { ...node, createdAt: existing.createdAt } : node;
        set((s) => ({ vault: { ...s.vault, [node.id]: toSave } }));
        repo.saveVaultNode(toSave);
      },

      deleteVaultNodes(ids) {
        // 폴더를 지우면 그 안의 모든 노드도 함께 지운다
        const vault0 = get().vault;
        const all = new Set<ID>();
        for (const id of ids) {
          if (!(id in vault0)) continue;
          all.add(id);
          for (const d of vaultDescendants(vault0, id)) all.add(d);
        }
        const toDelete = [...all];
        if (!toDelete.length) return;
        set((s) => {
          const vault = { ...s.vault };
          for (const id of toDelete) delete vault[id];
          return { vault };
        });
        repo.deleteVaultNodes(toDelete);
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

      closeOtherSplits(id) {
        setView((v) => (v.splitSessionIds.includes(id) ? withLayout(v, { kind: 'leaf', sessionId: id }, id, { activeSessionId: id }) : v));
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

      swapSplit(a, b) {
        setView((v) => {
          const layout = splitLayoutOf(v);
          const next = swapLeaves(layout, a, b);
          return next === layout ? v : withLayout(v, next, v.splitSessionIds[v.focusedSplitIndex] ?? null, {});
        });
      },

      swapSplitChildren(path, i, j) {
        // path는 화면(SplitView)과 같은 정리된 배치 기준
        setView((v) => {
          const layout = normalizeLayout(splitLayoutOf(v), v.splitSessionIds);
          return withLayout(v, swapChildren(layout, path, i, j), v.splitSessionIds[v.focusedSplitIndex] ?? null, {});
        });
      },

      flipSplitGroup(path) {
        setView((v) => {
          const layout = normalizeLayout(splitLayoutOf(v), v.splitSessionIds);
          return withLayout(v, flipGroupDir(layout, path), v.splitSessionIds[v.focusedSplitIndex] ?? null, {});
        });
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
