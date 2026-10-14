import { excerptAround } from './anchor';
import { withTextAttachments } from './attachments';
import { withSkill } from './skills';
import type { ID, Message, Session } from './model';
import type { ChatTurn, StreamRequest } from './provider';
import { pathToRoot, type SessionMap } from './tree';

export const BASE_SYSTEM =
  '너는 학습을 돕는 튜터다. 학습자의 수준에 맞춰 정확하고 구조적으로 설명하고, 필요하면 마크다운(목록, 표, 코드 블록)을 사용하라.';

export const BRANCH_INSTRUCTION =
  '학습자가 이 맥락에서 막힌 부분이다. 맥락에 맞춰 짧고 명확하게, 비유와 예시를 들어 설명하라.';

export const DEFAULT_CONTEXT_WINDOW = 6;
const MAX_MESSAGE_CHARS = 1500;

export type MessageMap = Record<ID, Message[]>;

function clip(text: string, max = MAX_MESSAGE_CHARS): string {
  return text.length > max ? `${text.slice(0, max)}…(생략)` : text;
}

function roleLabel(role: Message['role']): string {
  return role === 'user' ? '학습자' : '튜터';
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
  if (!self || !self.parentId || !self.anchor) return BASE_SYSTEM;

  const root = path[0]!;
  const lines: string[] = [BASE_SYSTEM, '', '## 학습 맥락', `루트 주제: ${root.title}`, '', '### 가지 경로 (루트 → 현재)'];

  path.slice(1).forEach((s, i) => {
    if (!s.anchor || !s.parentId) return;
    const parentMsgs = messages[s.parentId] ?? [];
    const msg = parentMsgs.find((m) => m.id === s.anchor!.messageId);
    const ex = msg ? excerptAround(msg.content, s.anchor.startOffset, s.anchor.endOffset) : null;
    const ctx = ex ? ` — 문맥: "${ex.before}[${ex.text}]${ex.after}"` : '';
    lines.push(`${i + 1}. "${s.anchor.text}"${ctx}`);
  });

  const parentMsgs = messages[self.parentId] ?? [];
  const anchorIdx = parentMsgs.findIndex((m) => m.id === self.anchor!.messageId);
  const upto = anchorIdx >= 0 ? parentMsgs.slice(0, anchorIdx + 1) : parentMsgs;
  const recent = upto.filter((m) => m.content.trim() !== '').slice(-n);
  if (recent.length) {
    lines.push('', `### 부모 대화 (앵커 메시지까지 최근 ${recent.length}개)`);
    for (const m of recent) lines.push(`[${roleLabel(m.role)}] ${clip(m.content)}`);
  }

  lines.push('', '## 지시', BRANCH_INSTRUCTION, `현재 질문 대상: "${self.anchor.text}"`);
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
        return { role: m.role, content: [m.content.trim(), note].filter(Boolean).join('\n\n') || note };
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
