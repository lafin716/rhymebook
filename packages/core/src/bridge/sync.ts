import { isValidModelName, type CliId } from '../cli-options';
import { isAttachmentList } from '../attachments';
import { isVaultNode, VAULT_LIMITS } from '../vault';
import type { Anchor, Annotation, Attachment, BranchKind, ID, Message, Session, Skill, SkillRef, SummaryDraft, VaultNode } from '../model';
import { isMarkColor, MARK_FONTS, MAX_NOTE_LENGTH } from '../model';
import { isSkill, isSkillRef, SKILL_LIMITS } from '../skills';
import { STUDY_LIMITS, validateStudyBundle, type StudyBundle } from '../study';

/**
 * 원격 동기화 프로토콜 (ADR-026). 웹·모바일(클라이언트)이 PC 데스크톱 앱(호스트)의 학습 데이터를 보고,
 * 질문·가지·요약 같은 조작을 액션 신호로 보낸다. 실제 CLI 호출과 저장은 호스트 스토어가 한다.
 * 기존 bridge 메시지(chat.start 등)와 같은 E2E 암호화 채널 위에서 오간다.
 */

/** 클라이언트가 호스트에 요청하는 조작. id는 클라이언트가 만든다(낙관적 표시 후 호스트 push가 덮어쓴다) */
export type SyncOp =
  | { kind: 'newRoot'; id: ID }
  /**
   * 빈 마크다운 페이지 (ADR-072). docId는 본문 문서 메시지 id.
   * parentId가 있으면 그 세션의 하위 페이지 (기능 'subpage')
   */
  | { kind: 'page.new'; id: ID; docId: ID; parentId?: ID; pageKind?: 'canvas' }
  /** 앵커 없는 빈 하위 대화 (기능 'subpage') — 첫 질문은 따로 보낸다 */
  | { kind: 'session.child'; id: ID; parentId: ID }
  /** 페이지 본문 바꾸기 (전체 교체) */
  | { kind: 'page.edit'; sessionId: ID; content: string }
  | { kind: 'send'; sessionId: ID; text: string; messageId: ID; attachments?: Attachment[]; skill?: SkillRef }
  | { kind: 'stop'; sessionId: ID }
  | { kind: 'retry'; sessionId: ID }
  | {
      kind: 'branch';
      id: ID;
      parentId: ID;
      anchor: Anchor;
      branch: BranchKind;
      question?: string;
      /** 가지의 첫 질문(user) 메시지 id */
      messageId: ID;
    }
  /** 앵커 없이 직접 질문으로 만드는 하위 세션(각주, IMP-22) */
  | { kind: 'subsession'; id: ID; parentId: ID; question: string; messageId: ID }
  | { kind: 'rename'; sessionId: ID; title: string }
  /**
   * 이 세션을 PC의 어느 CLI·모델·노력치로 답할지 (IMP-08). 있는 키만 바꾸고 null은 PC 기본값으로 되돌린다.
   * providerId를 바꾸면 PC 스토어가 다른 CLI의 모델·노력치 덮어쓰기를 버린다
   */
  | { kind: 'session.agent'; sessionId: ID; providerId?: CliId | null; model?: string | null; effort?: string | null; webSearch?: boolean }
  | { kind: 'delete'; sessionId: ID }
  /** 질문 하나와 답변 삭제 (첫 질문 제외). 세션 삭제와 같은 PC 허용 설정을 따른다 */
  | { kind: 'turn.delete'; sessionId: ID; questionId: ID }
  /** 질문 하나와 답변을 새 하위 세션 id로 분리 (첫 질문 제외) */
  | { kind: 'turn.split'; sessionId: ID; questionId: ID; id: ID }
  /** 질문 하나와 답변을 같은 레벨의 새 세션 id로 분리, 제목은 PC가 AI로 짓는다 (ADR-066) */
  | { kind: 'turn.splitOut'; sessionId: ID; questionId: ID; id: ID }
  /** 질문 하나와 답변을 다른 세션 끝으로 옮기기 (ADR-067) */
  | { kind: 'turn.move'; sessionId: ID; questionId: ID; targetId: ID }
  /** 세션 재정리 (ADR-068). skill이 없으면 PC의 기본 재정리 스킬 */
  | { kind: 'session.reorganize'; sessionId: ID; skill?: SkillRef }
  | { kind: 'summary.request'; sessionId: ID }
  | { kind: 'summary.discard'; sessionId: ID }
  | { kind: 'summary.attach'; sessionId: ID; text?: string }
  | { kind: 'summary.remove'; sessionId: ID }
  | { kind: 'annot.set'; annotation: Annotation }
  | { kind: 'annot.delete'; ids: ID[] }
  | { kind: 'vault.put'; node: VaultNode }
  | { kind: 'vault.delete'; ids: ID[] }
  /** 학습 꾸러미 가져오기 (ADR-043). 꾸러미 JSON 길이는 STUDY_LIMITS.remoteChars 이하 */
  | { kind: 'study.import'; bundle: StudyBundle };

export type SyncOpKind = SyncOp['kind'];

/**
 * 호스트가 sync.snapshot에 싣는 지원 기능. 목록이 없거나 빠진 기능은 옛 PC 앱이라 처리하지 못하므로
 * 클라이언트는 그 op를 보내지 않고 'outdated'로 실패시킨다 (옛 호스트는 모르는 op를 'invalid'로 거절해 원인을 알 수 없다)
 */
export const SYNC_FEATURES = ['subsession', 'vault', 'split', 'turns', 'websearch', 'page', 'subpage', 'canvas'] as const;
export type SyncFeature = (typeof SYNC_FEATURES)[number];
export const OP_FEATURE: Partial<Record<SyncOpKind, SyncFeature>> = {
  subsession: 'subsession',
  'vault.put': 'vault',
  'vault.delete': 'vault',
  'turn.split': 'split',
  'turn.splitOut': 'turns',
  'turn.move': 'turns',
  'session.reorganize': 'turns',
  'page.new': 'page',
  'page.edit': 'page',
  'session.child': 'subpage',
};

/** op에 필요한 호스트 기능. session.agent의 웹 검색 토글은 'websearch' (ADR-070), 하위 페이지는 'subpage' */
export function opFeature(op: SyncOp): SyncFeature | undefined {
  if (op.kind === 'session.agent' && 'webSearch' in op) return 'websearch';
  if (op.kind === 'page.new' && op.pageKind === 'canvas') return 'canvas';
  if (op.kind === 'page.new' && op.parentId !== undefined) return 'subpage';
  return OP_FEATURE[op.kind];
}

export type SyncClientMsg =
  | { type: 'sync.hello' }
  | { type: 'sync.messages'; sessionId: ID }
  /** PC 스킬 목록 요청 (웹·모바일 스킬 관리의 동기화 버튼) */
  | { type: 'sync.skills'; reqId: string }
  | { type: 'act'; reqId: string; op: SyncOp };

export type SyncServerMsg =
  | {
      type: 'sync.snapshot';
      hostName: string;
      sessions: Record<ID, Session>;
      streaming: Record<ID, ID>;
      summaryDrafts: Record<ID, SummaryDraft>;
      annotations?: Annotation[];
      features?: string[];
      /** 메시지가 없는 루트 대화(초안) id — 클라이언트는 빈 메시지로 불러온 것으로 본다 (ADR-074). 옛 호스트는 보내지 않는다 */
      drafts?: ID[];
    }
  /**
   * 세션 메시지 페이지. 4MB 프레임 한도 때문에 바이트 예산(약 1MB)으로 나눠 보낸다.
   * first=true면 클라이언트는 그 세션 메시지를 비우고 시작, done=true면 로드 완료.
   */
  | { type: 'sync.messages'; sessionId: ID; messages: Message[]; first: boolean; done: boolean }
  /** 스트리밍 증분: content[offset..]를 text로 교체(append). offset이 로컬 길이와 다르면 클라이언트는 sync.messages 재요청 */
  | { type: 'sync.append'; sessionId: ID; messageId: ID; offset: number; text: string }
  | { type: 'sync.session'; session: Session }
  | { type: 'sync.session'; deleted: ID[] }
  | { type: 'sync.message'; message: Message }
  | { type: 'sync.message'; sessionId: ID; deleted: ID }
  | { type: 'sync.streaming'; streaming: Record<ID, ID> }
  | { type: 'sync.draft'; sessionId: ID; draft: SummaryDraft | null }
  | { type: 'sync.annot'; annotation: Annotation }
  | { type: 'sync.annot'; deleted: ID[] }
  | { type: 'sync.vault'; nodes: VaultNode[]; first: boolean; done: boolean }
  | { type: 'sync.vault'; node: VaultNode }
  | { type: 'sync.vault'; deleted: ID[] }
  | { type: 'act.result'; reqId: string; ok: boolean; error?: string }
  /**
   * PC 스킬 목록 페이지 (sync.skills 응답, 요청의 reqId를 그대로 붙인다).
   * 바이트 예산·개수(SKILL_LIMITS.count)로 나눠 보내고 done=true면 끝
   */
  | { type: 'sync.skills'; reqId: string; skills: Skill[]; first: boolean; done: boolean }
  /** 호스트가 동기화를 처리할 수 없음 (PC 앱 창 닫힘, 헤드리스 bridge 등) */
  | { type: 'sync.error'; error: string }
  /** 호스트 엔진이 다시 준비됨 → 클라이언트는 sync.hello부터 다시 */
  | { type: 'sync.reset' };

/** 제한값 (악의적/깨진 입력 차단) */
export const SYNC_LIMITS = {
  id: 64,
  title: 200,
  text: 100_000,
  /** 문서(페이지·캔버스) 본문 — 첨부 이미지가 base64로 들어간다 (ADR-079) */
  doc: 8_000_000,
  anchorText: 10_000,
  /** sync.messages 한 페이지 바이트 예산 (JSON 길이 기준) */
  pageBytes: 1_000_000,
  /** 피어당 act 허용량: windowMs 동안 최대 count개 */
  actWindowMs: 10_000,
  actCount: 30,
} as const;

/** 클라이언트가 만든 id 형식. 호스트는 형식 + 기존 id와 충돌 여부를 모두 확인한다 */
export const SYNC_ID_RE = /^[\w-]{1,64}$/;

/** act.result 실패 코드 (UI는 한국어 문구로 변환) */
export type SyncActError =
  | 'invalid' // 형식·범위 오류 (앵커 오프셋 등)
  | 'conflict' // id 충돌
  | 'not-found' // 세션/메시지 없음
  | 'busy' // 이미 스트리밍 중, 피어당 동시 스트림 1개 초과
  | 'rate-limit'
  | 'forbidden' // PC에서 원격 삭제 허용 안 함
  | 'not-ready' // 호스트 엔진 미준비
  | 'outdated' // 호스트(PC 앱)가 이 기능을 모름 — 클라이언트가 보내기 전에 판단
  | 'failed';

/** Validate an individual SyncOp (used by both client and host) */
function validateOp(op: unknown): boolean {
  if (!op || typeof op !== 'object') return false;
  const o = op as Record<string, unknown>;
  const kind = o.kind as string;

  if (kind === 'newRoot') {
    return typeof o.id === 'string' && o.id.length <= SYNC_LIMITS.id && SYNC_ID_RE.test(o.id);
  }
  if (kind === 'send') {
    return (
      typeof o.sessionId === 'string' &&
      SYNC_ID_RE.test(o.sessionId) &&
      typeof o.text === 'string' &&
      o.text.length <= SYNC_LIMITS.text &&
      typeof o.messageId === 'string' &&
      SYNC_ID_RE.test(o.messageId) &&
      (o.attachments === undefined || isAttachmentList(o.attachments)) &&
      (o.skill === undefined || isSkillRef(o.skill)) &&
      Object.keys(o).every((k) => ['kind', 'sessionId', 'text', 'messageId', 'attachments', 'skill'].includes(k))
    );
  }
  if (kind === 'stop') {
    return typeof o.sessionId === 'string' && SYNC_ID_RE.test(o.sessionId);
  }
  if (kind === 'retry') {
    return typeof o.sessionId === 'string' && SYNC_ID_RE.test(o.sessionId);
  }
  if (kind === 'branch') {
    if (
      typeof o.id !== 'string' ||
      !SYNC_ID_RE.test(o.id) ||
      typeof o.parentId !== 'string' ||
      !SYNC_ID_RE.test(o.parentId) ||
      typeof o.messageId !== 'string' ||
      !SYNC_ID_RE.test(o.messageId) ||
      typeof o.branch !== 'string'
    ) {
      return false;
    }
    const anchor = o.anchor as Record<string, unknown> | undefined;
    if (!anchor || typeof anchor.messageId !== 'string' || typeof anchor.text !== 'string') {
      return false;
    }
    if (anchor.text.length > SYNC_LIMITS.anchorText) {
      return false;
    }
    if (typeof anchor.startOffset !== 'number' || anchor.startOffset < 0) {
      return false;
    }
    if (typeof anchor.endOffset !== 'number' || anchor.endOffset <= anchor.startOffset) {
      return false;
    }
    return true;
  }
  if (kind === 'subsession') {
    return (
      typeof o.id === 'string' &&
      SYNC_ID_RE.test(o.id) &&
      typeof o.parentId === 'string' &&
      SYNC_ID_RE.test(o.parentId) &&
      typeof o.messageId === 'string' &&
      SYNC_ID_RE.test(o.messageId) &&
      typeof o.question === 'string' &&
      o.question.trim().length > 0 &&
      o.question.length <= SYNC_LIMITS.text &&
      Object.keys(o).every((k) => ['kind', 'id', 'parentId', 'question', 'messageId'].includes(k))
    );
  }
  if (kind === 'page.new') {
    return (
      typeof o.id === 'string' &&
      o.id.length <= SYNC_LIMITS.id &&
      SYNC_ID_RE.test(o.id) &&
      typeof o.docId === 'string' &&
      o.docId.length <= SYNC_LIMITS.id &&
      SYNC_ID_RE.test(o.docId) &&
      o.id !== o.docId &&
      (o.parentId === undefined || (typeof o.parentId === 'string' && SYNC_ID_RE.test(o.parentId) && o.parentId !== o.id)) &&
      (o.pageKind === undefined || o.pageKind === 'canvas') &&
      Object.keys(o).every((k) => ['kind', 'id', 'docId', 'parentId', 'pageKind'].includes(k))
    );
  }
  if (kind === 'session.child') {
    return (
      typeof o.id === 'string' &&
      SYNC_ID_RE.test(o.id) &&
      typeof o.parentId === 'string' &&
      SYNC_ID_RE.test(o.parentId) &&
      o.id !== o.parentId &&
      Object.keys(o).every((k) => ['kind', 'id', 'parentId'].includes(k))
    );
  }
  if (kind === 'page.edit') {
    return (
      typeof o.sessionId === 'string' &&
      SYNC_ID_RE.test(o.sessionId) &&
      typeof o.content === 'string' &&
      o.content.length <= SYNC_LIMITS.doc &&
      Object.keys(o).every((k) => ['kind', 'sessionId', 'content'].includes(k))
    );
  }
  if (kind === 'rename') {
    return (
      typeof o.sessionId === 'string' &&
      SYNC_ID_RE.test(o.sessionId) &&
      typeof o.title === 'string' &&
      o.title.length <= SYNC_LIMITS.title
    );
  }
  if (kind === 'session.agent') {
    if (typeof o.sessionId !== 'string' || !SYNC_ID_RE.test(o.sessionId)) return false;
    if (!('providerId' in o) && !('model' in o) && !('effort' in o) && !('webSearch' in o)) return false;
    if ('webSearch' in o && typeof o.webSearch !== 'boolean') return false;
    if ('providerId' in o && o.providerId !== null && o.providerId !== 'claude-cli' && o.providerId !== 'codex-cli') return false;
    if ('model' in o && o.model !== null && (typeof o.model !== 'string' || !isValidModelName(o.model))) return false;
    // 노력치가 그 CLI·모델에 맞는지는 호스트 스토어가 확인해 맞지 않으면 버린다
    if ('effort' in o && o.effort !== null && (typeof o.effort !== 'string' || !/^[a-z]{1,16}$/.test(o.effort))) return false;
    const allowed = new Set(['kind', 'sessionId', 'providerId', 'model', 'effort', 'webSearch']);
    return Object.keys(o).every((k) => allowed.has(k));
  }
  if (kind === 'delete') {
    return typeof o.sessionId === 'string' && SYNC_ID_RE.test(o.sessionId);
  }
  if (kind === 'turn.delete') {
    return typeof o.sessionId === 'string' && SYNC_ID_RE.test(o.sessionId) && typeof o.questionId === 'string' && SYNC_ID_RE.test(o.questionId);
  }
  if (kind === 'turn.splitOut' || kind === 'turn.move') {
    const key = kind === 'turn.move' ? 'targetId' : 'id';
    return (
      typeof o.sessionId === 'string' &&
      SYNC_ID_RE.test(o.sessionId) &&
      typeof o.questionId === 'string' &&
      SYNC_ID_RE.test(o.questionId) &&
      typeof o[key] === 'string' &&
      SYNC_ID_RE.test(o[key]) &&
      Object.keys(o).every((k) => ['kind', 'sessionId', 'questionId', key].includes(k))
    );
  }
  if (kind === 'session.reorganize') {
    return (
      typeof o.sessionId === 'string' &&
      SYNC_ID_RE.test(o.sessionId) &&
      (o.skill === undefined || isSkillRef(o.skill)) &&
      Object.keys(o).every((k) => ['kind', 'sessionId', 'skill'].includes(k))
    );
  }
  if (kind === 'turn.split') {
    return (
      typeof o.sessionId === 'string' &&
      SYNC_ID_RE.test(o.sessionId) &&
      typeof o.questionId === 'string' &&
      SYNC_ID_RE.test(o.questionId) &&
      typeof o.id === 'string' &&
      SYNC_ID_RE.test(o.id) &&
      Object.keys(o).every((k) => ['kind', 'sessionId', 'questionId', 'id'].includes(k))
    );
  }
  if (kind === 'summary.request') {
    return typeof o.sessionId === 'string' && SYNC_ID_RE.test(o.sessionId);
  }
  if (kind === 'summary.discard') {
    return typeof o.sessionId === 'string' && SYNC_ID_RE.test(o.sessionId);
  }
  if (kind === 'summary.attach') {
    return (
      typeof o.sessionId === 'string' &&
      SYNC_ID_RE.test(o.sessionId) &&
      (!o.text || (typeof o.text === 'string' && o.text.length <= SYNC_LIMITS.text))
    );
  }
  if (kind === 'summary.remove') {
    return typeof o.sessionId === 'string' && SYNC_ID_RE.test(o.sessionId);
  }
  if (kind === 'annot.set') {
    const anno = o.annotation as Record<string, unknown> | undefined;
    if (!anno || typeof anno !== 'object') return false;
    // 기본 필드
    if (
      typeof anno.id !== 'string' ||
      !SYNC_ID_RE.test(anno.id) ||
      typeof anno.sessionId !== 'string' ||
      !SYNC_ID_RE.test(anno.sessionId) ||
      typeof anno.createdAt !== 'number' ||
      typeof anno.updatedAt !== 'number'
    ) {
      return false;
    }
    // anchor 검증
    const anchor = anno.anchor as Record<string, unknown> | undefined;
    if (
      !anchor ||
      typeof anchor.messageId !== 'string' ||
      !SYNC_ID_RE.test(anchor.messageId) ||
      typeof anchor.text !== 'string' ||
      anchor.text.length > SYNC_LIMITS.anchorText
    ) {
      return false;
    }
    if (
      typeof anchor.startOffset !== 'number' ||
      !Number.isInteger(anchor.startOffset) ||
      anchor.startOffset < 0 ||
      typeof anchor.endOffset !== 'number' ||
      !Number.isInteger(anchor.endOffset) ||
      anchor.endOffset <= (anchor.startOffset as number)
    ) {
      return false;
    }
    // 서식 필드 (있으면 허용 값 확인: 색은 추천 색상 이름 또는 #rrggbb)
    if ('highlight' in anno && anno.highlight !== null && anno.highlight !== undefined) {
      if (!isMarkColor(anno.highlight)) return false;
    }
    if ('underline' in anno && anno.underline !== null && anno.underline !== undefined) {
      if (!isMarkColor(anno.underline)) return false;
    }
    if ('textColor' in anno && anno.textColor !== null && anno.textColor !== undefined) {
      if (!isMarkColor(anno.textColor)) return false;
    }
    if ('font' in anno && anno.font !== null && anno.font !== undefined) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (!MARK_FONTS.includes(anno.font as any)) return false;
    }
    if ('bold' in anno && anno.bold !== null && anno.bold !== undefined) {
      if (typeof anno.bold !== 'boolean') return false;
    }
    if ('italic' in anno && anno.italic !== null && anno.italic !== undefined) {
      if (typeof anno.italic !== 'boolean') return false;
    }
    // note 검증
    if ('note' in anno && anno.note) {
      if (typeof anno.note !== 'string' || anno.note.length > MAX_NOTE_LENGTH) return false;
    }
    // 공개하지 않은 필드가 있으면 거부
    const allowedKeys = new Set(['id', 'sessionId', 'anchor', 'createdAt', 'updatedAt', 'highlight', 'underline', 'textColor', 'font', 'bold', 'italic', 'note']);
    for (const k of Object.keys(anno)) {
      if (!allowedKeys.has(k)) return false;
    }
    return true;
  }
  if (kind === 'annot.delete') {
    if (!Array.isArray(o.ids)) return false;
    return o.ids.length > 0 &&
      o.ids.length <= SYNC_LIMITS.id &&
      o.ids.every((id: unknown) => typeof id === 'string' && SYNC_ID_RE.test(id as string));
  }
  if (kind === 'vault.put') {
    return Object.keys(o).every((k) => k === 'kind' || k === 'node') && isVaultNode(o.node);
  }
  if (kind === 'vault.delete') {
    return (
      Object.keys(o).every((k) => k === 'kind' || k === 'ids') &&
      Array.isArray(o.ids) &&
      o.ids.length > 0 &&
      o.ids.length <= VAULT_LIMITS.deleteIds &&
      o.ids.every((id: unknown) => typeof id === 'string' && SYNC_ID_RE.test(id))
    );
  }
  if (kind === 'study.import') {
    if (Object.keys(o).some((k) => k !== 'kind' && k !== 'bundle')) return false;
    try {
      validateStudyBundle(o.bundle);
      return JSON.stringify(o.bundle).length <= STUDY_LIMITS.remoteChars;
    } catch {
      return false;
    }
  }
  return false;
}

/** 클라이언트 메시지 검증: 형식이 맞으면 SyncClientMsg, 아니면 null */
export function validateSyncClientMsg(raw: unknown): SyncClientMsg | null {
  if (!raw || typeof raw !== 'object') return null;
  const msg = raw as Record<string, unknown>;
  const type = msg.type;

  if (type === 'sync.hello') {
    return msg as SyncClientMsg;
  }
  if (type === 'sync.messages') {
    if (typeof msg.sessionId === 'string' && SYNC_ID_RE.test(msg.sessionId)) {
      return msg as SyncClientMsg;
    }
    return null;
  }
  if (type === 'sync.skills') {
    if (typeof msg.reqId === 'string' && msg.reqId.length <= SYNC_LIMITS.id) return { type: 'sync.skills', reqId: msg.reqId };
    return null;
  }
  if (type === 'act') {
    if (
      typeof msg.reqId === 'string' &&
      msg.reqId.length <= SYNC_LIMITS.id &&
      validateOp(msg.op)
    ) {
      return msg as SyncClientMsg;
    }
    return null;
  }
  return null;
}

/** 서버 메시지 타입 검증 */
export function isSyncServerMsg(raw: unknown): raw is SyncServerMsg {
  if (!raw || typeof raw !== 'object') return false;
  const msg = raw as Record<string, unknown>;
  const type = msg.type;

  if (type === 'sync.snapshot') {
    const features = msg.features as unknown;
    if (features !== undefined && !(Array.isArray(features) && features.length <= 64 && features.every((f) => typeof f === 'string' && f.length <= 64))) return false;
    const drafts = msg.drafts as unknown;
    if (drafts !== undefined && !(Array.isArray(drafts) && drafts.every((d) => typeof d === 'string' && d.length <= SYNC_LIMITS.id))) return false;
    // snapshot.annotations을 검증한다 (있으면)
    const annotations = msg.annotations as unknown;
    if (annotations !== undefined && annotations !== null) {
      if (!Array.isArray(annotations)) return false;
      for (const a of annotations) {
        if (!validateOp({ kind: 'annot.set', annotation: a })) return false;
      }
    }
    return true;
  }

  if (type === 'sync.skills') {
    return (
      typeof msg.reqId === 'string' &&
      Array.isArray(msg.skills) &&
      msg.skills.length <= SKILL_LIMITS.count &&
      msg.skills.every(isSkill) &&
      typeof msg.first === 'boolean' &&
      typeof msg.done === 'boolean'
    );
  }

  if (type === 'sync.annot') {
    const annotation = msg.annotation as unknown;
    const deleted = msg.deleted as unknown;
    if (annotation !== undefined) {
      return validateOp({ kind: 'annot.set', annotation });
    }
    if (Array.isArray(deleted)) {
      return validateOp({ kind: 'annot.delete', ids: deleted });
    }
    return false;
  }

  if (type === 'sync.vault') {
    if (Array.isArray(msg.nodes)) {
      return typeof msg.first === 'boolean' && typeof msg.done === 'boolean' && msg.nodes.every(isVaultNode);
    }
    if (msg.node !== undefined) return isVaultNode(msg.node);
    if (Array.isArray(msg.deleted)) return msg.deleted.every((id: unknown) => typeof id === 'string' && SYNC_ID_RE.test(id));
    return false;
  }

  return (
    type === 'sync.messages' ||
    type === 'sync.append' ||
    type === 'sync.session' ||
    type === 'sync.message' ||
    type === 'sync.streaming' ||
    type === 'sync.draft' ||
    type === 'act.result' ||
    type === 'sync.error' ||
    type === 'sync.reset'
  );
}

/** 메시지 타입 검증 */
export function isSyncClientType(type: unknown): boolean {
  return type === 'sync.hello' || type === 'sync.messages' || type === 'sync.skills' || type === 'act';
}
