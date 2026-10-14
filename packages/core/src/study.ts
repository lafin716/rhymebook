import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { isAttachmentList } from './attachments';
import { isAnnotation, isMessage, isSession } from './backup/snapshot';
import type { MessageMap } from './context';
import type { Annotation, ID, Message, Session } from './model';
import { collectStudyCards } from './notes';
import type { SessionMap } from './tree';

/**
 * 학습 꾸러미 (ADR-043). 학습 하나(루트 세션 트리)를 다른 기기로 옮기기 위한 내보내기·가져오기.
 * - zip: `<제목>/README.md`(목차) + 세션마다 Markdown 한 개 + `study.json`(가져오기 원본, 손실 없음)
 * - 가져오기는 study.json만 읽는다. Markdown은 사람·노트 앱(Obsidian 등)용
 * 순수 함수. 책으로 만들기용 학습 원문(buildStudyDigest)도 여기서 만든다.
 */
export const STUDY_APP = 'rhymebook-study';
export const STUDY_VERSION = 1;

export const STUDY_LIMITS = {
  /** 원격(웹·모바일 → PC) 가져오기 한도: study.json 길이 */
  remoteChars: 6_000_000,
  /** zip 안 study.json 압축 해제 한도 (zip 폭탄 차단) */
  unzipBytes: 64 * 1024 * 1024,
  /** 책으로 만들기 학습 원문 기본 길이 */
  digestChars: 120_000,
} as const;

export interface StudyBundle {
  app: typeof STUDY_APP;
  version: number;
  exportedAt: number;
  rootId: ID;
  title: string;
  sessions: Session[];
  messages: Message[];
  annotations: Annotation[];
}

export interface StudySource {
  sessions: SessionMap;
  messages: MessageMap;
  annotations: Record<ID, Annotation>;
}

export type StudyErrorCode = 'invalid' | 'newer-version' | 'conflict';

const STUDY_MESSAGE: Record<StudyErrorCode, string> = {
  invalid: 'rhymebook 학습 파일이 아니거나 손상되었어요.',
  'newer-version': '더 새 버전의 앱에서 내보낸 학습이에요. 앱을 업데이트한 뒤 가져오세요.',
  conflict: '이 기기의 다른 학습과 겹치는 항목이 있어 가져올 수 없어요.',
};

export class StudyError extends Error {
  constructor(
    readonly code: StudyErrorCode,
    message = STUDY_MESSAGE[code],
  ) {
    super(message);
    this.name = 'StudyError';
  }
}

const ID_RE = /^[\w-]{1,64}$/;

/** 루트 세션 트리 하나를 꾸러미로 모은다. 생성 중인 응답은 '중지됨'으로 담는다 */
export function collectStudy(state: StudySource, rootId: ID, now = Date.now()): StudyBundle | null {
  const root = state.sessions[rootId];
  if (!root) return null;
  const ids = [rootId, ...collectStudyCards(state.sessions, state.messages, rootId).map((c) => c.sessionId)];
  const inTree = new Set(ids);
  return {
    app: STUDY_APP,
    version: STUDY_VERSION,
    exportedAt: now,
    rootId,
    title: root.title,
    sessions: ids.map((id) => state.sessions[id]!),
    messages: ids.flatMap((id) => (state.messages[id] ?? []).map((m) => (m.status === 'streaming' ? { ...m, status: 'stopped' as const } : m))),
    annotations: Object.values(state.annotations).filter((a) => inTree.has(a.sessionId)),
  };
}

// ── Markdown 파일 ───────────────────────────────────────

const oneLine = (t: string) => t.replace(/\s+/g, ' ').trim();

function ymd(ms: number) {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** 파일·폴더 이름에 쓸 수 없는 문자를 지우고 길이를 줄인다 */
export function safeFileName(title: string, max = 60): string {
  // eslint-disable-next-line no-control-regex
  const s = oneLine(title.replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ')).replace(/^\.+/, '');
  return [...s].slice(0, max).join('').trim() || '학습';
}

/** "1.2" → "01.02" (파일 이름 정렬용) */
const padNumber = (n: string) =>
  n
    .split('.')
    .map((x) => x.padStart(2, '0'))
    .join('.');

const link = (label: string, file: string) => `[${label.replace(/[[\]]/g, '')}](<${file}>)`;

const quote = (t: string) =>
  t
    .split('\n')
    .map((l) => `> ${l}`)
    .join('\n');

interface StudyNode {
  session: Session;
  /** 루트는 "" */
  number: string;
  file: string;
  parentId: ID | null;
}

function studyNodes(bundle: StudyBundle): StudyNode[] {
  const sessions: SessionMap = Object.fromEntries(bundle.sessions.map((s) => [s.id, s]));
  const root = sessions[bundle.rootId];
  if (!root) return [];
  const nodes: StudyNode[] = [{ session: root, number: '', file: `00 ${safeFileName(root.title)}.md`, parentId: null }];
  for (const c of collectStudyCards(sessions, {}, bundle.rootId)) {
    const s = sessions[c.sessionId]!;
    nodes.push({ session: s, number: c.number, file: `${padNumber(c.number)} ${safeFileName(s.title)}.md`, parentId: s.parentId });
  }
  return nodes;
}

const label = (n: StudyNode) => (n.number ? `${n.number} ${oneLine(n.session.title)}` : oneLine(n.session.title));

function messagesBySession(bundle: StudyBundle): Map<ID, Message[]> {
  const map = new Map<ID, Message[]>();
  for (const m of bundle.messages) {
    const list = map.get(m.sessionId);
    if (list) list.push(m);
    else map.set(m.sessionId, [m]);
  }
  return map;
}

function sessionMarkdown(node: StudyNode, byId: Map<ID, StudyNode>, children: StudyNode[], messages: Message[]): string {
  const s = node.session;
  const lines: string[] = [`# ${label(node)}`, ''];
  const path: StudyNode[] = [];
  for (let p = node.parentId ? byId.get(node.parentId) : undefined; p; p = p.parentId ? byId.get(p.parentId) : undefined) path.unshift(p);
  if (path.length) lines.push(`> 경로: ${path.map((p) => link(label(p), p.file)).join(' › ')} › ${oneLine(s.title)}`, '');
  if (s.anchor?.text) lines.push('**가지 친 원문**', '', quote(s.anchor.text.trim()), '');
  if (s.summary?.trim()) lines.push('## 내가 이해한 것', '', s.summary.trim(), '');
  if (messages.length) {
    lines.push('## 대화', '');
    for (const m of messages) {
      lines.push(m.role === 'user' ? '### 🙋 질문' : '### 💬 답변', '');
      if (m.skill) lines.push(`_스킬: /${m.skill.name}_`, '');
      if (m.content.trim()) lines.push(m.content.trim(), '');
      for (const a of m.attachments ?? []) lines.push(`📎 ${a.name}`, '');
      if (m.status === 'error' || m.status === 'stopped') lines.push(`_(${m.status === 'error' ? '오류' : '중지됨'})_`, '');
    }
  }
  if (children.length) {
    lines.push('## 하위 가지', '');
    for (const c of children) {
      const anchor = c.session.anchor?.text ? ` — 원문 “${oneLine(c.session.anchor.text).slice(0, 80)}”` : '';
      lines.push(`- ${link(label(c), c.file)}${anchor}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

export interface StudyFile {
  path: string;
  content: string;
}

/** 꾸러미 → zip에 넣을 파일 목록 (README·세션 Markdown·study.json) */
export function studyPackFiles(bundle: StudyBundle): StudyFile[] {
  const nodes = studyNodes(bundle);
  const byId = new Map(nodes.map((n) => [n.session.id, n]));
  const msgs = messagesBySession(bundle);
  const kids = new Map<ID, StudyNode[]>();
  for (const n of nodes) {
    if (!n.parentId) continue;
    const list = kids.get(n.parentId);
    if (list) list.push(n);
    else kids.set(n.parentId, [n]);
  }
  const dir = safeFileName(bundle.title);
  const summarized = nodes.filter((n) => n.number && n.session.summary?.trim()).length;
  const readme: string[] = [
    `# ${oneLine(bundle.title)}`,
    '',
    `> rhymebook 학습 꾸러미 · ${ymd(bundle.exportedAt)} · 가지 ${nodes.length - 1}개 · 요약 ${summarized}개 · 메시지 ${bundle.messages.length}개`,
    '',
    '## 목차',
    '',
    ...nodes.map((n) => `${'  '.repeat(n.number ? n.number.split('.').length : 0)}- ${link(label(n), n.file)}`),
    '',
    '## 다른 기기에서 이어서 학습하기',
    '',
    'rhymebook 앱에서 이해 노트 › **학습 가져오기**를 누르고 이 zip 파일(또는 안의 `study.json`)을 고르세요.',
    '같은 학습이 이미 있으면 가지마다 더 최근에 바뀐 쪽을 남기고, 그 기기에만 있는 가지는 그대로 둡니다.',
    '',
  ];
  return [
    { path: `${dir}/README.md`, content: readme.join('\n') },
    ...nodes.map((n) => ({ path: `${dir}/${n.file}`, content: sessionMarkdown(n, byId, kids.get(n.session.id) ?? [], msgs.get(n.session.id) ?? []) })),
    { path: `${dir}/study.json`, content: JSON.stringify(bundle) },
  ];
}

/** 꾸러미 → zip 바이트 */
export function buildStudyPack(bundle: StudyBundle): Uint8Array {
  const files: Record<string, Uint8Array> = {};
  for (const f of studyPackFiles(bundle)) files[f.path] = strToU8(f.content);
  return zipSync(files, { level: 6 });
}

export function studyPackFileName(title: string, now = Date.now()): string {
  return `${safeFileName(title, 40)}-학습-${ymd(now)}.zip`;
}

// ── 가져오기 ────────────────────────────────────────────

const isZip = (b: Uint8Array) => b.length > 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04;

/** zip(꾸러미) 또는 study.json 내용 → 검증된 꾸러미 */
export function readStudyPack(input: Uint8Array | string): StudyBundle {
  let text: string;
  if (typeof input === 'string') text = input;
  else if (isZip(input)) {
    let found: Record<string, Uint8Array>;
    try {
      found = unzipSync(input, {
        filter: (f) => /(^|\/)study\.json$/.test(f.name) && f.originalSize <= STUDY_LIMITS.unzipBytes,
      });
    } catch {
      throw new StudyError('invalid');
    }
    // 가장 얕은 study.json
    const name = Object.keys(found).sort((a, b) => a.split('/').length - b.split('/').length)[0];
    if (!name) throw new StudyError('invalid');
    text = strFromU8(found[name]!);
  } else {
    text = strFromU8(input);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch {
    throw new StudyError('invalid');
  }
  return validateStudyBundle(raw);
}

/**
 * 꾸러미 형식·트리 일관성 검증 (가져오기 파일과 원격 study.import 양쪽).
 * 루트 하나에서 모든 세션이 닿아야 하고, 메시지·어노테이션은 꾸러미 안 세션만 가리킨다.
 * 깨진 어노테이션은 건너뛰고, 생성 중 메시지는 '중지됨'으로 바꾼다.
 */
export function validateStudyBundle(raw: unknown): StudyBundle {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new StudyError('invalid');
  const b = raw as Record<string, unknown>;
  if (b.app !== STUDY_APP || typeof b.version !== 'number' || typeof b.exportedAt !== 'number') throw new StudyError('invalid');
  if (b.version > STUDY_VERSION) throw new StudyError('newer-version');
  const rootId = b.rootId;
  if (typeof rootId !== 'string' || !ID_RE.test(rootId) || typeof b.title !== 'string') throw new StudyError('invalid');
  if (!Array.isArray(b.sessions) || !Array.isArray(b.messages) || (b.annotations !== undefined && !Array.isArray(b.annotations))) {
    throw new StudyError('invalid');
  }

  const sessions = b.sessions as unknown[];
  const ids = new Set<ID>();
  for (const s of sessions) {
    if (!isSession(s) || !ID_RE.test(s.id) || ids.has(s.id) || s.rootId !== rootId) throw new StudyError('invalid');
    if (s.id === rootId ? s.parentId !== null : s.parentId === null) throw new StudyError('invalid');
    ids.add(s.id);
  }
  if (!ids.has(rootId)) throw new StudyError('invalid');
  // 모든 세션이 루트에서 닿는지 (부모 누락·순환 차단)
  const children = new Map<ID, ID[]>();
  for (const s of sessions as Session[]) {
    if (s.parentId === null) continue;
    if (!ids.has(s.parentId)) throw new StudyError('invalid');
    children.set(s.parentId, [...(children.get(s.parentId) ?? []), s.id]);
  }
  const seen = new Set<ID>([rootId]);
  const stack = [rootId];
  while (stack.length) {
    for (const c of children.get(stack.pop()!) ?? []) {
      if (seen.has(c)) continue;
      seen.add(c);
      stack.push(c);
    }
  }
  if (seen.size !== ids.size) throw new StudyError('invalid');

  const msgIds = new Set<ID>();
  const messages: Message[] = [];
  for (const m of b.messages as unknown[]) {
    if (!isMessage(m) || !ID_RE.test(m.id) || msgIds.has(m.id) || ids.has(m.id) || !ids.has(m.sessionId)) throw new StudyError('invalid');
    if (m.attachments !== undefined && !isAttachmentList(m.attachments)) throw new StudyError('invalid');
    msgIds.add(m.id);
    messages.push(m.status === 'streaming' ? { ...m, status: 'stopped' } : m);
  }

  const annoIds = new Set<ID>();
  const annotations = ((b.annotations as unknown[] | undefined) ?? []).filter((a): a is Annotation => {
    if (!isAnnotation(a) || !ID_RE.test(a.id) || annoIds.has(a.id) || !ids.has(a.sessionId) || !msgIds.has(a.anchor.messageId)) return false;
    annoIds.add(a.id);
    return true;
  });

  return {
    app: STUDY_APP,
    version: b.version,
    exportedAt: b.exportedAt,
    rootId,
    title: b.title,
    sessions: sessions as Session[],
    messages,
    annotations,
  };
}

export interface StudyImportResult {
  added: number;
  updated: number;
  /** 이 기기 쪽이 더 최근이라 그대로 둔 세션 */
  kept: number;
  /** 생성 중이라 건너뛴 세션 */
  skipped: number;
}

export interface StudyImportPlan extends StudyImportResult {
  /** 꾸러미 내용으로 쓸 세션 id (추가 + 갱신) */
  apply: ID[];
}

/** 세션이 마지막으로 바뀐 시각: 세션·메시지·어노테이션 중 가장 최근 */
function lastTouched(session: Session, messages: readonly Message[], annotations: readonly Annotation[]): number {
  let t = session.updatedAt;
  for (const m of messages) t = Math.max(t, m.createdAt);
  for (const a of annotations) t = Math.max(t, a.updatedAt);
  return t;
}

/**
 * 가져오기 계획 (순수 함수). 세션 id 기준:
 * - 이 기기에 없으면 추가, 꾸러미 쪽이 더 최근에 바뀌었으면 갱신(메시지·어노테이션 통째로), 아니면 유지
 * - 생성 중인 세션은 건너뛴다. 이 기기에만 있는 가지는 그대로 둔다
 * - id가 이 기기의 다른 학습(다른 세션)과 겹치면 StudyError('conflict')
 */
export function planStudyImport(local: StudySource, bundle: StudyBundle, streaming: Record<ID, ID> = {}): StudyImportPlan {
  const plan: StudyImportPlan = { apply: [], added: 0, updated: 0, kept: 0, skipped: 0 };
  const inBundle = new Set(bundle.sessions.map((s) => s.id));
  for (const s of bundle.sessions) {
    const cur = local.sessions[s.id];
    if (cur && cur.rootId !== bundle.rootId) throw new StudyError('conflict');
  }
  // 메시지·어노테이션 id가 다른 세션 것과 겹치면 저장소에서 덮어쓰게 되므로 막는다
  const localMsgSession = new Map<ID, ID>();
  for (const [sid, list] of Object.entries(local.messages)) for (const m of list) localMsgSession.set(m.id, sid);
  for (const m of bundle.messages) {
    const sid = localMsgSession.get(m.id);
    if ((sid && sid !== m.sessionId) || local.sessions[m.id]) throw new StudyError('conflict');
  }
  for (const a of bundle.annotations) {
    const cur = local.annotations[a.id];
    if (cur && cur.sessionId !== a.sessionId) throw new StudyError('conflict');
  }

  const bMsgs = messagesBySession(bundle);
  const bAnnos = new Map<ID, Annotation[]>();
  for (const a of bundle.annotations) bAnnos.set(a.sessionId, [...(bAnnos.get(a.sessionId) ?? []), a]);
  const localAnnos = new Map<ID, Annotation[]>();
  for (const a of Object.values(local.annotations)) {
    if (inBundle.has(a.sessionId)) localAnnos.set(a.sessionId, [...(localAnnos.get(a.sessionId) ?? []), a]);
  }

  for (const s of bundle.sessions) {
    const cur = local.sessions[s.id];
    if (!cur) {
      plan.apply.push(s.id);
      plan.added++;
    } else if (streaming[s.id]) {
      plan.skipped++;
    } else if (
      lastTouched(s, bMsgs.get(s.id) ?? [], bAnnos.get(s.id) ?? []) >
      lastTouched(cur, local.messages[s.id] ?? [], localAnnos.get(s.id) ?? [])
    ) {
      plan.apply.push(s.id);
      plan.updated++;
    } else {
      plan.kept++;
    }
  }
  return plan;
}

// ── 책으로 만들기 학습 원문 ─────────────────────────────

/**
 * 책으로 만들기에 첨부할 학습 원문 Markdown. 트리 순서로 가지 번호·원문(앵커)·요약·대화를 담는다.
 * maxChars를 넘으면 답변을 비례로 줄이고(앞부분 유지) 줄였다고 적는다. 질문·앵커·요약은 줄이지 않는다.
 */
export function buildStudyDigest(bundle: StudyBundle, maxChars: number = STUDY_LIMITS.digestChars): string {
  const nodes = studyNodes(bundle);
  const msgs = messagesBySession(bundle);
  const render = (answerCap: number) => {
    let cut = 0;
    const lines: string[] = [
      `# 학습 원문: ${oneLine(bundle.title)}`,
      '',
      '> rhymebook 학습 트리. 번호는 가지 위치("1.2" = 1번 가지의 2번째 하위 가지), "가지 친 원문"은 학습자가 모르는 부분으로 선택한 텍스트, "내가 이해한 것"은 학습자가 직접 정리한 요약이다.',
      '',
    ];
    for (const n of nodes) {
      const s = n.session;
      lines.push(`${'#'.repeat(Math.min(6, 2 + (n.number ? n.number.split('.').length - 1 : 0)))} ${n.number ? `[${n.number}] ` : '[루트] '}${oneLine(s.title)}`, '');
      if (s.anchor?.text) lines.push('가지 친 원문:', quote(s.anchor.text.trim()), '');
      if (s.summary?.trim()) lines.push('내가 이해한 것:', quote(s.summary.trim()), '');
      for (const m of msgs.get(s.id) ?? []) {
        let body = m.content.trim();
        if (m.role === 'assistant' && body.length > answerCap) {
          body = `${body.slice(0, answerCap).trimEnd()} …(줄임)`;
          cut++;
        }
        if (!body) continue;
        lines.push(m.role === 'user' ? `**Q.** ${body}` : `**A.** ${body}`, '');
      }
    }
    return { text: lines.join('\n'), cut };
  };
  let out = render(Infinity);
  if (out.text.length <= maxChars) return out.text;
  const noteOf = (cut: number) => `\n> 원문이 길어 답변 ${cut}개를 앞부분만 담았다.\n`;
  // 답변 길이 상한을 이분 탐색으로 맞춘다 (끝의 안내문 자리를 남긴다)
  const budget = maxChars - noteOf(bundle.messages.length).length;
  let lo = 0;
  let hi = Math.max(0, ...bundle.messages.filter((m) => m.role === 'assistant').map((m) => m.content.length));
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (render(mid).text.length <= budget) lo = mid;
    else hi = mid - 1;
  }
  out = render(lo);
  const note = noteOf(out.cut);
  return out.text.length + note.length <= maxChars ? out.text + note : out.text.slice(0, maxChars);
}
