import type { AppState, AppStore } from '../store';
import { isCliId } from '../cli-options';
import { canDeleteTurn, planTurnMove } from '../turns';
import type { ID, Message, ProviderId, Skill, VaultNode } from '../model';
import { wouldCreateCycle } from '../vault';
import { SKILL_LIMITS } from '../skills';
import { planStudyImport, StudyError, validateStudyBundle } from '../study';
import {
  SYNC_FEATURES,
  SYNC_LIMITS,
  SYNC_ID_RE,
  type SyncOp,
  type SyncClientMsg,
  type SyncServerMsg,
  type SyncActError,
} from '../bridge/sync';

export interface SyncHostOptions {
  store: AppStore;
  hostName: () => string;
  /** peerId '*' = 동기화 중인 모든 피어 (sync.reset에만 쓴다) */
  send: (peerId: string, msg: SyncServerMsg) => void;
  /** 원격이 만든 루트 세션에 적용할 CLI (PC hostAgent). undefined면 기본 provider */
  rootProvider?: () => ProviderId | undefined;
  /** 스트리밍 증분(sync.append)을 모아 보내는 간격. 기본 120ms */
  throttleMs?: number;
  /** 원격 삭제 허용 여부 (PC 설정). 기본 거부 */
  /** 이 피어의 삭제 허용 여부 (PC 설정, 같은 PC의 세션 창은 항상 허용) */
  allowDelete?: (peerId: string) => boolean;
  /**
   * 이 피어의 스킬 전용 provider를 모두 따를지 (같은 PC의 세션 창). 아니면 PC CLI(claude·codex)만 따른다 —
   * 원격 기기는 PC 에이전트만 고를 수 있다 (ADR-031, ADR-038)
   */
  anySkillProvider?: (peerId: string) => boolean;
  onRemoteAction?: (peerId: string, op: SyncOp) => void;
  /** 원격 기기가 받아 갈 PC 스킬 목록 (sync.skills). 없으면 빈 목록 */
  skills?: () => readonly Skill[] | Promise<readonly Skill[]>;
}

export interface SyncHost {
  receive(peerId: string, msg: SyncClientMsg): void;
  /** 피어 연결이 끊김 → 피어 상태 정리 */
  peerGone(peerId: string): void;
  dispose(): void;
  /** 모든 피어에 sync.reset을 보내고 피어 상태를 비운다 (클라이언트는 hello부터 다시) */
  reset(): void;
}

interface PeerState {
  synced: boolean;
  /** 메시지를 받아 간 세션 → 이 세션의 메시지 변경만 push */
  loaded: Set<ID>;
  /** messageId → 이 피어에 보낸 content 길이 (append offset 기준) */
  sentLen: Map<ID, number>;
  /** 이 피어가 시작시킨 스트리밍 세션 (피어당 동시 1개) */
  streams: Set<ID>;
  actCount: number;
  actWindowStart: number;
}

type Synced = Pick<AppState, 'sessions' | 'messages' | 'streaming' | 'summaryDrafts' | 'annotations' | 'vault'>;

/** content 외 필드가 모두 같고 content가 뒤로만 늘었으면 증분으로 보낼 수 있다 */
function appendOnly(prev: Message, next: Message): boolean {
  if (next.content.length < prev.content.length || !next.content.startsWith(prev.content)) return false;
  const keys = new Set([...Object.keys(prev), ...Object.keys(next)]);
  for (const k of keys) {
    if (k === 'content') continue;
    if ((prev as unknown as Record<string, unknown>)[k] !== (next as unknown as Record<string, unknown>)[k]) return false;
  }
  return true;
}

function idTaken(state: Synced, id: ID): boolean {
  if (state.sessions[id]) return true;
  return Object.values(state.messages).some((msgs) => msgs.some((m) => m.id === id));
}

/** 데스크톱(호스트) 스토어 변경을 원격 피어에 내보내고, 피어의 조작(act)을 스토어 액션으로 실행한다 */
export function createSyncHost(opts: SyncHostOptions): SyncHost {
  const { store, hostName, send, rootProvider, throttleMs = 120, allowDelete = () => false, anySkillProvider = () => false, onRemoteAction, skills } = opts;

  const peers = new Map<string, PeerState>();
  const pick = (s: AppState): Synced => ({
    sessions: s.sessions,
    messages: s.messages,
    streaming: s.streaming,
    summaryDrafts: s.summaryDrafts,
    annotations: s.annotations,
    vault: s.vault,
  });
  let last: Synced = pick(store.getState());
  /** 증분 전송 대기 중인 메시지 (messageId → sessionId) */
  const dirty = new Map<ID, ID>();
  let flushTimer: ReturnType<typeof setTimeout> | null = null;

  const newPeer = (): PeerState => ({
    synced: false,
    loaded: new Set(),
    sentLen: new Map(),
    streams: new Set(),
    actCount: 0,
    actWindowStart: 0,
  });

  const syncedPeers = () => [...peers.entries()].filter(([, p]) => p.synced);

  const checkRateLimit = (peer: PeerState): boolean => {
    const now = Date.now();
    if (now - peer.actWindowStart > SYNC_LIMITS.actWindowMs) {
      peer.actCount = 0;
      peer.actWindowStart = now;
    }
    if (peer.actCount >= SYNC_LIMITS.actCount) return false;
    peer.actCount++;
    return true;
  };

  const findMessage = (sessionId: ID, messageId: ID) => store.getState().messages[sessionId]?.find((m) => m.id === messageId);

  const sendFullMessage = (peerId: string, peer: PeerState, message: Message) => {
    send(peerId, { type: 'sync.message', message });
    peer.sentLen.set(message.id, message.content.length);
  };

  /** 대기 중인 증분을 보낸다. 다른 변경을 보내기 전에 먼저 호출해 순서를 지킨다 */
  const flush = () => {
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    if (!dirty.size) return;
    const items = [...dirty.entries()];
    dirty.clear();
    for (const [peerId, peer] of syncedPeers()) {
      for (const [messageId, sessionId] of items) {
        if (!peer.loaded.has(sessionId)) continue;
        const m = findMessage(sessionId, messageId);
        if (!m) continue;
        const from = peer.sentLen.get(messageId);
        if (from === undefined || from > m.content.length) {
          sendFullMessage(peerId, peer, m);
        } else if (m.content.length > from) {
          send(peerId, { type: 'sync.append', sessionId, messageId, offset: from, text: m.content.slice(from) });
          peer.sentLen.set(messageId, m.content.length);
        }
      }
    }
  };

  const scheduleFlush = () => {
    if (flushTimer) return;
    flushTimer = setTimeout(flush, throttleMs);
  };

  const broadcast = (fn: (peerId: string, peer: PeerState) => void) => {
    for (const [peerId, peer] of syncedPeers()) fn(peerId, peer);
  };

  const onChange = (state: AppState) => {
    const prev = last;
    const next = pick(state);
    last = next;
    if (!syncedPeers().length) {
      dirty.clear();
      return;
    }

    // 1) 메시지: 바뀐 세션만, 증분은 모아서
    const full: Message[] = [];
    const removed: { sessionId: ID; id: ID }[] = [];
    if (prev.messages !== next.messages) {
      for (const [sid, list] of Object.entries(next.messages)) {
        const before = prev.messages[sid];
        if (before === list) continue;
        const beforeById = new Map((before ?? []).map((m) => [m.id, m]));
        for (const m of list) {
          const old = beforeById.get(m.id);
          if (old === m) continue;
          if (old && appendOnly(old, m)) dirty.set(m.id, sid);
          else {
            dirty.delete(m.id);
            full.push(m);
          }
        }
        if (before) {
          const now = new Set(list.map((m) => m.id));
          for (const m of before) if (!now.has(m.id)) removed.push({ sessionId: sid, id: m.id });
        }
      }
    }

    const sessionsChanged = prev.sessions !== next.sessions;
    const streamingChanged = prev.streaming !== next.streaming;
    const draftsChanged = prev.summaryDrafts !== next.summaryDrafts;
    const structural = full.length > 0 || removed.length > 0 || sessionsChanged || streamingChanged || draftsChanged;

    // 증분이 아닌 변경이 있으면 쌓인 증분을 먼저 보내 순서를 지킨다
    if (structural) flush();

    if (sessionsChanged) {
      const deleted = Object.keys(prev.sessions).filter((id) => !next.sessions[id]);
      const changed = Object.values(next.sessions).filter((s) => prev.sessions[s.id] !== s);
      broadcast((peerId, peer) => {
        for (const session of changed) send(peerId, { type: 'sync.session', session });
        if (deleted.length) {
          send(peerId, { type: 'sync.session', deleted });
          for (const id of deleted) peer.loaded.delete(id);
        }
      });
    }

    if (full.length || removed.length) {
      broadcast((peerId, peer) => {
        for (const m of full) if (peer.loaded.has(m.sessionId)) sendFullMessage(peerId, peer, m);
        for (const r of removed) {
          if (!peer.loaded.has(r.sessionId)) continue;
          send(peerId, { type: 'sync.message', sessionId: r.sessionId, deleted: r.id });
          peer.sentLen.delete(r.id);
        }
      });
    }

    if (streamingChanged) {
      broadcast((peerId, peer) => {
        for (const sid of [...peer.streams]) if (!next.streaming[sid]) peer.streams.delete(sid);
        send(peerId, { type: 'sync.streaming', streaming: next.streaming });
      });
    }

    if (draftsChanged) {
      const ids = new Set([...Object.keys(prev.summaryDrafts), ...Object.keys(next.summaryDrafts)]);
      const changes = [...ids].filter((id) => prev.summaryDrafts[id] !== next.summaryDrafts[id]);
      broadcast((peerId) => {
        for (const id of changes) send(peerId, { type: 'sync.draft', sessionId: id, draft: next.summaryDrafts[id] ?? null });
      });
    }

    const annotationsChanged = prev.annotations !== next.annotations;
    if (annotationsChanged) {
      const prevIds = new Set(Object.keys(prev.annotations));
      const nextIds = new Set(Object.keys(next.annotations));
      const deleted: ID[] = [];
      for (const id of prevIds) {
        if (!nextIds.has(id)) deleted.push(id);
      }
      broadcast((peerId) => {
        for (const id of nextIds) {
          const p = next.annotations[id];
          if (p && prev.annotations[id] !== p) {
            send(peerId, { type: 'sync.annot', annotation: p });
          }
        }
        if (deleted.length) {
          send(peerId, { type: 'sync.annot', deleted });
        }
      });
    }

    if (prev.vault !== next.vault) {
      const deleted = Object.keys(prev.vault).filter((id) => !next.vault[id]);
      const changed = Object.values(next.vault).filter((n) => prev.vault[n.id] !== n);
      broadcast((peerId) => {
        for (const node of changed) send(peerId, { type: 'sync.vault', node });
        if (deleted.length) send(peerId, { type: 'sync.vault', deleted });
      });
    }

    if (dirty.size) scheduleFlush();
  };

  const unsubscribe = store.subscribe(onChange);

  const sendSnapshot = (peerId: string, peer: PeerState) => {
    flush();
    const state = store.getState();
    peer.synced = true;
    peer.loaded.clear();
    peer.sentLen.clear();
    const annotations = Object.values(state.annotations);
    send(peerId, {
      type: 'sync.snapshot',
      hostName: hostName(),
      sessions: state.sessions,
      streaming: state.streaming,
      summaryDrafts: state.summaryDrafts,
      ...(annotations.length ? { annotations } : {}),
      features: [...SYNC_FEATURES],
    });
    sendVault(peerId);
  };

  /** 보관함을 바이트 예산 페이지로 나눠 보낸다 (이미지가 있어 스냅샷에 넣지 않는다). 비어도 한 페이지는 보낸다 */
  const sendVault = (peerId: string) => {
    let page: VaultNode[] = [];
    let bytes = 0;
    let first = true;
    for (const node of Object.values(store.getState().vault)) {
      const size = JSON.stringify(node).length;
      if (page.length && bytes + size > SYNC_LIMITS.pageBytes) {
        send(peerId, { type: 'sync.vault', nodes: page, first, done: false });
        first = false;
        page = [];
        bytes = 0;
      }
      page.push(node);
      bytes += size;
    }
    send(peerId, { type: 'sync.vault', nodes: page, first, done: true });
  };

  /** 세션 메시지를 바이트 예산 페이지로 나눠 보낸다 */
  const sendMessages = (peerId: string, peer: PeerState, sessionId: ID) => {
    flush();
    const messages = store.getState().messages[sessionId];
    if (!messages) {
      // 없는 세션: 빈 완료 페이지로 응답해 클라이언트가 기다리지 않게 한다
      send(peerId, { type: 'sync.messages', sessionId, messages: [], first: true, done: true });
      return;
    }
    peer.loaded.add(sessionId);
    let page: Message[] = [];
    let bytes = 0;
    let first = true;
    for (const m of messages) {
      const size = JSON.stringify(m).length;
      if (page.length && bytes + size > SYNC_LIMITS.pageBytes) {
        send(peerId, { type: 'sync.messages', sessionId, messages: page, first, done: false });
        first = false;
        page = [];
        bytes = 0;
      }
      page.push(m);
      bytes += size;
      peer.sentLen.set(m.id, m.content.length);
    }
    send(peerId, { type: 'sync.messages', sessionId, messages: page, first, done: true });
  };

  /** PC 스킬 목록을 바이트 예산 페이지로 나눠 보낸다 (스킬 하나는 최대 약 14만 자라 한 페이지에 들어간다) */
  const sendSkills = async (peerId: string, reqId: string) => {
    let list: readonly Skill[] = [];
    try {
      list = (await skills?.()) ?? [];
    } catch {
      /* 목록을 못 읽으면 빈 목록으로 답해 기다리지 않게 한다 */
    }
    // 기다리는 동안 연결이 끊겼으면 보내지 않는다
    if (!peers.get(peerId)?.synced) return;
    let page: Skill[] = [];
    let bytes = 0;
    let first = true;
    for (const s of list) {
      const size = JSON.stringify(s).length;
      if (page.length && (bytes + size > SYNC_LIMITS.pageBytes || page.length >= SKILL_LIMITS.count)) {
        send(peerId, { type: 'sync.skills', reqId, skills: page, first, done: false });
        first = false;
        page = [];
        bytes = 0;
      }
      page.push(s);
      bytes += size;
    }
    send(peerId, { type: 'sync.skills', reqId, skills: page, first, done: true });
  };

  /** 이 피어가 시작시킨 스트림이 아직 진행 중이면 busy */
  const peerBusy = (peer: PeerState): boolean => {
    const streaming = store.getState().streaming;
    for (const sid of [...peer.streams]) if (!streaming[sid]) peer.streams.delete(sid);
    return peer.streams.size > 0;
  };

  const validateOp = (peerId: string, peer: PeerState, op: SyncOp): SyncActError | null => {
    const state = store.getState();
    const has = (id: ID) => !!state.sessions[id];
    switch (op.kind) {
      case 'newRoot':
        if (!SYNC_ID_RE.test(op.id)) return 'invalid';
        return idTaken(state, op.id) ? 'conflict' : null;
      case 'send':
        if (!SYNC_ID_RE.test(op.messageId) || (!op.text.trim() && !op.attachments?.length) || op.text.length > SYNC_LIMITS.text) return 'invalid';
        if (!has(op.sessionId)) return 'not-found';
        if (idTaken(state, op.messageId)) return 'conflict';
        if (state.streaming[op.sessionId] || peerBusy(peer)) return 'busy';
        return null;
      case 'retry':
        if (!has(op.sessionId)) return 'not-found';
        if (state.streaming[op.sessionId] || peerBusy(peer)) return 'busy';
        return null;
      case 'branch': {
        if (!SYNC_ID_RE.test(op.id) || !SYNC_ID_RE.test(op.messageId) || op.id === op.messageId) return 'invalid';
        if (!has(op.parentId)) return 'not-found';
        if (idTaken(state, op.id) || idTaken(state, op.messageId)) return 'conflict';
        const msg = state.messages[op.parentId]?.find((m) => m.id === op.anchor.messageId);
        if (!msg) return 'not-found';
        const { startOffset, endOffset, text } = op.anchor;
        if (!Number.isInteger(startOffset) || !Number.isInteger(endOffset)) return 'invalid';
        if (startOffset < 0 || endOffset > msg.content.length || startOffset >= endOffset) return 'invalid';
        if (text.length > SYNC_LIMITS.anchorText || (op.question?.length ?? 0) > SYNC_LIMITS.text) return 'invalid';
        if (peerBusy(peer)) return 'busy';
        return null;
      }
      case 'subsession':
        if (op.id === op.messageId) return 'invalid';
        if (!has(op.parentId)) return 'not-found';
        if (idTaken(state, op.id) || idTaken(state, op.messageId)) return 'conflict';
        if (peerBusy(peer)) return 'busy';
        return null;
      case 'rename':
        if (op.title.length > SYNC_LIMITS.title || !op.title.trim()) return 'invalid';
        return has(op.sessionId) ? null : 'not-found';
      case 'session.agent':
        return has(op.sessionId) ? null : 'not-found';
      case 'delete':
        if (!has(op.sessionId)) return 'not-found';
        return allowDelete(peerId) ? null : 'forbidden';
      case 'turn.delete':
        if (!has(op.sessionId)) return 'not-found';
        if (!canDeleteTurn(state.messages[op.sessionId] ?? [], op.questionId)) return 'invalid';
        if (state.streaming[op.sessionId]) return 'busy';
        return allowDelete(peerId) ? null : 'forbidden';
      case 'turn.split':
        if (!has(op.sessionId)) return 'not-found';
        if (!canDeleteTurn(state.messages[op.sessionId] ?? [], op.questionId)) return 'invalid';
        if (idTaken(state, op.id)) return 'conflict';
        if (state.streaming[op.sessionId]) return 'busy';
        return null;
      case 'turn.splitOut':
        if (!has(op.sessionId)) return 'not-found';
        if (!canDeleteTurn(state.messages[op.sessionId] ?? [], op.questionId)) return 'invalid';
        if (idTaken(state, op.id)) return 'conflict';
        if (state.streaming[op.sessionId]) return 'busy';
        return null;
      case 'turn.move':
        if (!has(op.sessionId) || !has(op.targetId)) return 'not-found';
        if (!planTurnMove(state.sessions, state.messages[op.sessionId] ?? [], op.sessionId, op.questionId, op.targetId)) return 'invalid';
        if (state.streaming[op.sessionId] || state.streaming[op.targetId]) return 'busy';
        return null;
      case 'session.reorganize':
        if (!has(op.sessionId)) return 'not-found';
        if (state.streaming[op.sessionId] || peerBusy(peer)) return 'busy';
        // 옛 질문·답변을 지우고 바꾸므로 삭제 허용 설정을 따른다
        return allowDelete(peerId) ? null : 'forbidden';
      case 'summary.attach':
        if (op.text && op.text.length > SYNC_LIMITS.text) return 'invalid';
        return has(op.sessionId) ? null : 'not-found';
      case 'stop':
      case 'summary.request':
      case 'summary.discard':
      case 'summary.remove':
        return has(op.sessionId) ? null : 'not-found';
      case 'annot.set': {
        if (!has(op.annotation.sessionId)) return 'not-found';
        const msg = state.messages[op.annotation.sessionId]?.find((m) => m.id === op.annotation.anchor.messageId);
        if (!msg || msg.role !== 'assistant' || op.annotation.anchor.endOffset > msg.content.length) return 'not-found';
        return null;
      }
      case 'annot.delete':
        return null;
      case 'vault.put': {
        const { node } = op;
        const existing = state.vault[node.id];
        if (existing && existing.kind !== node.kind) return 'conflict';
        if (node.parentId !== null) {
          if (state.vault[node.parentId]?.kind !== 'folder') return 'not-found';
          if (node.kind === 'folder' && wouldCreateCycle(state.vault, node.id, node.parentId)) return 'invalid';
        }
        return null;
      }
      case 'vault.delete':
        return null;
      case 'study.import': {
        try {
          const plan = planStudyImport(state, validateStudyBundle(op.bundle), state.streaming);
          // 이미 있는 세션을 덮어쓰면 그 세션의 옛 메시지가 지워질 수 있다 — 삭제 권한과 같이 묶는다
          if (plan.updated > 0 && !allowDelete(peerId)) return 'forbidden';
          return null;
        } catch (e) {
          return e instanceof StudyError && e.code === 'conflict' ? 'conflict' : 'invalid';
        }
      }
    }
    return null;
  };

  const executeOp = (peerId: string, peer: PeerState, op: SyncOp): SyncActError | null => {
    const err = validateOp(peerId, peer, op);
    if (err) return err;
    const s = store.getState();
    try {
      switch (op.kind) {
        case 'newRoot': {
          // 생성 중 나오는 push를 요청한 피어가 받도록 미리 로드 표시
          peer.loaded.add(op.id);
          if (!s.newRootSession(op.id, { focus: false })) {
            peer.loaded.delete(op.id);
            return 'failed';
          }
          const providerId = rootProvider?.();
          if (providerId) store.getState().setSessionProvider(op.id, providerId);
          return null;
        }
        case 'send': {
          let skill = op.skill;
          if (skill?.options && !isCliId(skill.options.providerId) && !anySkillProvider(peerId)) {
            const { options: _o, ...rest } = skill;
            skill = rest;
          }
          if (!s.sendMessage(op.sessionId, op.text, op.messageId, { ...(op.attachments ? { attachments: op.attachments } : {}), ...(skill ? { skill } : {}) })) return 'failed';
          peer.streams.add(op.sessionId);
          return null;
        }
        case 'retry':
          if (!s.retry(op.sessionId)) return 'failed';
          peer.streams.add(op.sessionId);
          return null;
        case 'subsession':
          peer.loaded.add(op.id);
          if (!s.createSubSession(op.parentId, op.question, { sessionId: op.id, messageId: op.messageId })) {
            peer.loaded.delete(op.id);
            return 'failed';
          }
          peer.streams.add(op.id);
          return null;
        case 'branch':
          peer.loaded.add(op.id);
          if (!s.createBranch(op.parentId, op.anchor, op.branch, op.question, { sessionId: op.id, messageId: op.messageId })) {
            peer.loaded.delete(op.id);
            return 'failed';
          }
          peer.streams.add(op.id);
          return null;
        case 'stop':
          s.stopStream(op.sessionId);
          return null;
        case 'rename':
          s.renameSession(op.sessionId, op.title);
          return null;
        case 'session.agent': {
          if ('providerId' in op) s.setSessionProvider(op.sessionId, op.providerId ?? undefined);
          const patch: { model?: string; effort?: string } = {};
          if ('model' in op) patch.model = op.model ?? undefined;
          if ('effort' in op) patch.effort = op.effort ?? undefined;
          if ('model' in op || 'effort' in op) store.getState().setSessionModel(op.sessionId, patch);
          if (typeof op.webSearch === 'boolean') store.getState().setSessionWebSearch(op.sessionId, op.webSearch);
          return null;
        }
        case 'delete':
          s.deleteSession(op.sessionId);
          return null;
        case 'turn.delete':
          if (!s.deleteTurn(op.sessionId, op.questionId)) return 'failed';
          return null;
        case 'turn.split':
          // 요청한 기기가 새 하위 세션의 메시지를 바로 받도록
          peer.loaded.add(op.id);
          if (!s.splitTurn(op.sessionId, op.questionId, op.id)) {
            peer.loaded.delete(op.id);
            return 'failed';
          }
          return null;
        case 'turn.splitOut':
          peer.loaded.add(op.id);
          if (!s.splitTurn(op.sessionId, op.questionId, op.id, { sibling: true })) {
            peer.loaded.delete(op.id);
            return 'failed';
          }
          return null;
        case 'turn.move':
          return s.moveTurn(op.sessionId, op.questionId, op.targetId) ? null : 'failed';
        case 'session.reorganize': {
          let skill = op.skill;
          if (skill?.options && !isCliId(skill.options.providerId) && !anySkillProvider(peerId)) {
            const { options: _o, ...rest } = skill;
            skill = rest;
          }
          if (!s.reorganizeSession(op.sessionId, skill)) return 'failed';
          peer.streams.add(op.sessionId);
          return null;
        }
        case 'summary.request':
          void s.requestSummary(op.sessionId);
          return null;
        case 'summary.discard':
          s.discardSummaryDraft(op.sessionId);
          return null;
        case 'summary.attach':
          s.attachSummary(op.sessionId, op.text);
          return null;
        case 'summary.remove':
          s.removeSummary(op.sessionId);
          return null;
        case 'annot.set':
          try {
            s.putAnnotation(op.annotation);
          } catch {
            return 'failed';
          }
          return null;
        case 'annot.delete':
          s.deleteAnnotations(op.ids);
          return null;
        case 'vault.put':
          s.putVaultNode(op.node);
          return null;
        case 'vault.delete':
          s.deleteVaultNodes(op.ids);
          return null;
        case 'study.import':
          try {
            s.importStudy(validateStudyBundle(op.bundle));
          } catch (e) {
            return e instanceof StudyError && e.code === 'conflict' ? 'conflict' : 'failed';
          }
          return null;
      }
      return null;
    } catch {
      return 'failed';
    }
  };

  return {
    receive(peerId, msg) {
      let peer = peers.get(peerId);
      if (!peer) {
        peer = newPeer();
        peers.set(peerId, peer);
      }

      if (msg.type === 'sync.hello') {
        sendSnapshot(peerId, peer);
        return;
      }
      if (msg.type === 'sync.messages') {
        if (!peer.synced) {
          send(peerId, { type: 'sync.error', error: 'not-ready' });
          return;
        }
        sendMessages(peerId, peer, msg.sessionId);
        return;
      }
      if (msg.type === 'sync.skills') {
        if (!peer.synced) {
          send(peerId, { type: 'sync.error', error: 'not-ready' });
          return;
        }
        void sendSkills(peerId, msg.reqId);
        return;
      }
      // act
      if (!peer.synced) {
        send(peerId, { type: 'act.result', reqId: msg.reqId, ok: false, error: 'not-ready' });
        return;
      }
      if (!checkRateLimit(peer)) {
        send(peerId, { type: 'act.result', reqId: msg.reqId, ok: false, error: 'rate-limit' });
        return;
      }
      const err = executeOp(peerId, peer, msg.op);
      // 실행으로 생긴 변경(sync.session/message)이 act.result보다 먼저 가도록 증분까지 비운다
      flush();
      if (err) {
        send(peerId, { type: 'act.result', reqId: msg.reqId, ok: false, error: err });
        return;
      }
      send(peerId, { type: 'act.result', reqId: msg.reqId, ok: true });
      onRemoteAction?.(peerId, msg.op);
    },

    peerGone(peerId) {
      peers.delete(peerId);
    },

    dispose() {
      unsubscribe();
      if (flushTimer) clearTimeout(flushTimer);
      flushTimer = null;
      dirty.clear();
      peers.clear();
    },

    reset() {
      if (flushTimer) clearTimeout(flushTimer);
      flushTimer = null;
      dirty.clear();
      peers.clear();
      last = pick(store.getState());
      send('*', { type: 'sync.reset' });
    },
  };
}
