import { excerptAround } from './anchor';
import { withTextAttachments } from './attachments';
import { stripEmbeds } from './pageFormat';
import { withSkill } from './skills';
import type { Anchor, ID, Message, Session, SkillRef } from './model';
import type { ChatTurn, StreamRequest } from './provider';
import { pathToRoot, type SessionMap } from './tree';

export const BASE_SYSTEM =
  '너는 학습을 돕는 튜터다. 학습자의 수준에 맞춰 정확하고 구조적으로 설명하고, 필요하면 마크다운(목록, 표, 코드 블록)을 사용하라.';

export const BRANCH_INSTRUCTION =
  '학습자가 이 맥락에서 막힌 부분이다. 맥락에 맞춰 짧고 명확하게, 비유와 예시를 들어 설명하라.';

export const SUBSESSION_INSTRUCTION =
  '학습자가 이 대화를 보다가 직접 이어서 묻는 하위 질문이다. 부모 대화의 맥락을 바탕으로 짧고 명확하게, 비유와 예시를 들어 설명하라.';

export const DEFAULT_CONTEXT_WINDOW = 6;
const MAX_MESSAGE_CHARS = 1500;
const MAX_PAGE_CHARS = 6000;

export type MessageMap = Record<ID, Message[]>;

function clip(text: string, max = MAX_MESSAGE_CHARS): string {
  // 페이지에 넣은 이미지·파일(data URL)은 자리표시로 — base64가 맥락을 다 차지하지 않게 (ADR-077)
  text = stripEmbeds(text);
  return text.length > max ? `${text.slice(0, max)}…(생략)` : text;
}

function roleLabel(role: Message['role']): string {
  return role === 'user' ? '학습자' : '튜터';
}

/**
 * 앵커의 원문 범위. 페이지처럼 본문을 고친 뒤면 저장된 위치가 어긋날 수 있어,
 * 그 자리에 앵커 글이 없으면 가장 가까운 같은 글로 옮긴다 (ADR-072)
 */
function anchorRange(content: string, anchor: Anchor): [number, number] {
  const { text, startOffset: s, endOffset: e } = anchor;
  if (!text || content.slice(s, e) === text || content.slice(s, e).replace(/\*\*|__|`/g, '') === text) return [s, e];
  let best = -1;
  for (let i = content.indexOf(text); i >= 0; i = content.indexOf(text, i + 1)) {
    if (best < 0 || Math.abs(i - s) < Math.abs(best - s)) best = i;
  }
  return best >= 0 ? [best, best + text.length] : [s, e];
}

export interface BranchContextOptions {
  sessions: SessionMap;
  messages: MessageMap;
  sessionId: ID;
  contextWindow?: number;
}

/**
 * 세션 요청의 system 프롬프트를 만든다.
 * 루트 세션: BASE_SYSTEM
 * 서브세션: BASE_SYSTEM + 조상 앵커 체인 + 부모의 앵커 메시지까지 최근 N개 대화 + 지시문
 */
export function buildSystemPrompt(opts: BranchContextOptions): string {
  const { sessions, messages, sessionId } = opts;
  const n = opts.contextWindow ?? DEFAULT_CONTEXT_WINDOW;
  const path = pathToRoot(sessions, sessionId);
  const self = path[path.length - 1];
  if (!self || !self.parentId) return BASE_SYSTEM;

  const root = path[0]!;
  const lines: string[] = [BASE_SYSTEM, '', '## 학습 맥락', `루트 주제: ${root.title}`, '', '### 가지 경로 (루트 → 현재)'];

  path.slice(1).forEach((s, i) => {
    if (!s.parentId) return;
    if (!s.anchor) {
      lines.push(`${i + 1}. (직접 만든 하위 세션) "${s.title}"`);
      return;
    }
    const parentMsgs = messages[s.parentId] ?? [];
    const msg = parentMsgs.find((m) => m.id === s.anchor!.messageId);
    const range: [number, number] = sessions[s.parentId]?.kind === 'page' ? anchorRange(msg?.content ?? '', s.anchor) : [s.anchor.startOffset, s.anchor.endOffset];
    const ex = msg ? excerptAround(msg.content, ...range) : null;
    const ctx = ex ? ` — 문맥: "${ex.before}[${ex.text}]${ex.after}"` : '';
    lines.push(`${i + 1}. "${s.anchor.text}"${ctx}`);
  });

  const parentMsgs = messages[self.parentId] ?? [];
  const anchor = self.anchor;
  const anchorIdx = anchor ? parentMsgs.findIndex((m) => m.id === anchor.messageId) : -1;
  const upto = anchorIdx >= 0 ? parentMsgs.slice(0, anchorIdx + 1) : parentMsgs;
  // 직접 만든 하위 세션은 만든 시점까지의 부모 대화를 본다
  const scoped = anchor ? upto : upto.filter((m) => m.createdAt <= self.createdAt);
  const recent = scoped.filter((m) => m.content.trim() !== '').slice(-n);
  const parentPage = sessions[self.parentId]?.kind === 'page';
  // 부모가 페이지면 대화 대신 문서 본문을 넣는다 (ADR-072)
  const doc = parentPage ? parentMsgs.find((m) => m.role === 'assistant' && m.content.trim() !== '') : undefined;
  if (doc) {
    lines.push('', '### 부모 문서 (학습자가 쓴 페이지)', clip(doc.content, MAX_PAGE_CHARS));
  } else if (!parentPage && recent.length) {
    const label = anchor ? '앵커 메시지까지' : '하위 세션을 만들 때까지';
    lines.push('', `### 부모 대화 (${label} 최근 ${recent.length}개)`);
    for (const m of recent) lines.push(`[${roleLabel(m.role)}] ${clip(m.content)}`);
  }

  if (anchor) lines.push('', '## 지시', BRANCH_INSTRUCTION, `현재 질문 대상: "${anchor.text}"`);
  else lines.push('', '## 지시', SUBSESSION_INSTRUCTION);
  return lines.join('\n');
}

/** 세션 메시지를 provider 요청 턴으로 변환 (스트리밍 중/오류 메시지 제외) */
export function toTurns(msgs: Message[]): ChatTurn[] {
  return msgs
    .filter((m) => m.status !== 'streaming' && m.status !== 'error' && (m.content.trim() !== '' || !!m.attachments?.length))
    .map((m) => {
      if (m.role === 'assistant') {
        // 응답 이미지(Codex 생성)는 다시 보내지 않고 메모만 남긴다 — API는 assistant 턴 이미지를 받지 않는다 (ADR-041)
        const n = m.attachments?.filter((a) => a.kind === 'image').length ?? 0;
        const note = n ? `[이미지 ${n}장을 만들어 보여 줌]` : '';
        return { role: m.role, content: [stripEmbeds(m.content).trim(), note].filter(Boolean).join('\n\n') || note };
      }
      const binary = m.attachments?.filter((a) => a.kind !== 'text') ?? [];
      const content = withTextAttachments(m.content, m.attachments);
      return {
        role: m.role,
        content: content.trim() ? content : '첨부한 내용을 봐 줘.',
        ...(binary.length ? { attachments: binary } : {}),
      };
    });
}

export function buildChatRequest(opts: BranchContextOptions): StreamRequest {
  const msgs = opts.messages[opts.sessionId] ?? [];
  // 스킬은 마지막 질문에만 적용한다
  const lastUser = msgs.findLast((m) => m.role === 'user');
  return {
    system: withSkill(buildSystemPrompt(opts), lastUser?.skill),
    messages: toTurns(msgs),
    purpose: 'chat',
  };
}

export const SUMMARY_SYSTEM =
  '다음은 학습자가 하나의 개념을 묻고 이해한 대화다. 학습자가 이해한 핵심을 한국어 1~2문장으로 요약하라. 서두 없이 요약문만 출력하라.';

export function buildSummaryRequest(session: Session, msgs: Message[]): StreamRequest {
  const transcript = toTurns(msgs)
    .map((t) => `[${roleLabel(t.role)}] ${clip(t.content, 2000)}`)
    .join('\n');
  return {
    system: SUMMARY_SYSTEM,
    messages: [{ role: 'user', content: `질문 대상: "${session.anchor?.text ?? session.title}"\n\n${transcript}` }],
    purpose: 'summary',
  };
}

export const TITLE_SYSTEM =
  '다음 대화의 주제를 5~20자의 한국어 제목으로 만들어라. 따옴표나 마침표 없이 제목만 출력하라.';

export function buildTitleRequest(msgs: Message[]): StreamRequest {
  const transcript = toTurns(msgs)
    .slice(0, 2)
    .map((t) => `[${roleLabel(t.role)}] ${clip(t.content, 600)}`)
    .join('\n');
  return { system: TITLE_SYSTEM, messages: [{ role: 'user', content: transcript }], purpose: 'title' };
}

export function branchQuestion(kind: 'what' | 'detail', text: string): string {
  const t = text.length > 80 ? `${text.slice(0, 80)}…` : text;
  return kind === 'what' ? `"${t}"이(가) 뭐야?` : `"${t}"에 대해 더 자세히 설명해줘.`;
}

export function cleanTitle(raw: string): string {
  return raw.replace(/["'“”‘’.。]/g, '').replace(/\s+/g, ' ').trim().slice(0, 30);
}

/** 재정리 요청에 실을 각주(하위 세션) 한 개 */
export interface ReorganizeNote {
  title: string;
  /** 본문에서 고른 글 (앵커 가지였으면) */
  anchorText?: string;
  summary?: string;
}

export const REORGANIZE_REQUEST = '이 세션의 대화 전체를 하나의 질문과 하나의 답변으로 재정리해 줘.';

/**
 * 세션 재정리 요청: system은 세션 맥락 + 재정리 스킬, 사용자 턴 하나에 대화 전문과 각주 목록을 싣는다.
 * notes 순서가 재정리 후 각주 번호다.
 */
export function buildReorganizeRequest(
  opts: BranchContextOptions,
  source: readonly Message[],
  notes: readonly ReorganizeNote[],
  skill: SkillRef | undefined,
): StreamRequest {
  const lines: string[] = ['## 세션 대화'];
  let n = 0;
  for (const t of toTurns([...source])) {
    if (t.role === 'user') n++;
    lines.push('', `### ${t.role === 'user' ? '질문' : '답변'} ${Math.max(n, 1)}`, clip(t.content, 6000));
  }
  if (notes.length) {
    lines.push('', '## 각주 (재정리 후 이 번호로 가리킨다)');
    notes.forEach((note, i) => {
      const parts = [`[${i + 1}] ${note.title}`];
      if (note.anchorText) parts.push(`본문의 "${clip(note.anchorText, 120)}"에서 파생`);
      if (note.summary) parts.push(`요약: ${clip(note.summary, 300)}`);
      lines.push(parts.join(' — '));
    });
  }
  lines.push('', '## 요청', REORGANIZE_REQUEST);
  return {
    system: withSkill(buildSystemPrompt(opts), skill),
    messages: [{ role: 'user', content: lines.join('\n') }],
    purpose: 'chat',
  };
}

/** 재정리 응답을 질문/답변으로 나눈다. 형식을 어기면 질문은 fallback, 전체를 답변으로 */
export function parseReorganized(text: string, fallbackQuestion: string): { question: string; answer: string } | null {
  const body = text.replace(/^\uFEFF/, '').trim();
  if (!body) return null;
  const m = /^\s*(?:\*\*)?질문(?:\*\*)?\s*[:：]\s*(.+?)\s*(?:\*\*)?\s*\n+\s*-{3,}\s*\n([\s\S]*)$/.exec(body);
  if (m && m[1]!.trim() && m[2]!.trim()) return { question: m[1]!.replace(/\*\*/g, '').trim(), answer: m[2]!.trim() };
  return { question: fallbackQuestion, answer: body };
}
