import { excerptAround } from './anchor';
import { withTextAttachments } from './attachments';
import { canvasText, parseCanvas } from './canvas';
import { isDocSession } from './page';
import { stripEmbeds } from './pageFormat';
import { stripBranchBlock } from './branch-suggest';
import { defaultPrompt, promptText, type PromptOverrides } from './prompts';
import { t } from './i18n';
import { withSkill } from './skills';
import type { Anchor, ID, Message, Session, SkillRef } from './model';
import type { ChatTurn, StreamRequest } from './provider';
import { pathToRoot, type SessionMap } from './tree';

/** 기본 시스템 프롬프트 (지금 언어) */
export function baseSystem(): string {
  return defaultPrompt('base');
}

/** 가지(앵커) 지시 (지금 언어) */
export function branchInstruction(): string {
  return defaultPrompt('branch');
}

/** 하위 세션 지시 (지금 언어) */
export function subsessionInstruction(): string {
  return defaultPrompt('subsession');
}

export const DEFAULT_CONTEXT_WINDOW = 6;
const MAX_MESSAGE_CHARS = 1500;
const MAX_PAGE_CHARS = 6000;

export type MessageMap = Record<ID, Message[]>;

function clip(text: string, max = MAX_MESSAGE_CHARS): string {
  // 페이지에 넣은 이미지·파일(data URL)은 자리표시로 — base64가 맥락을 다 차지하지 않게 (ADR-077)
  text = stripEmbeds(stripBranchBlock(text));
  return text.length > max ? `${text.slice(0, max)}${t('llm.context.clipped')}` : text;
}

function roleLabel(role: Message['role']): string {
  return role === 'user' ? t('llm.context.user') : t('llm.context.tutor');
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
  /** 사용자가 고친 시스템 프롬프트 (ADR-098) */
  prompts?: PromptOverrides;
}

/**
 * 세션 요청의 system 프롬프트를 만든다.
 * 루트 세션: 기본 시스템 프롬프트
 * 서브세션: 기본 시스템 프롬프트 + 조상 앵커 체인 + 부모의 앵커 메시지까지 최근 N개 대화 + 지시문
 */
export function buildSystemPrompt(opts: BranchContextOptions): string {
  const { sessions, messages, sessionId } = opts;
  const n = opts.contextWindow ?? DEFAULT_CONTEXT_WINDOW;
  const base = promptText('base', opts.prompts);
  const path = pathToRoot(sessions, sessionId);
  const self = path[path.length - 1];
  if (!self || !self.parentId) return base;

  const root = path[0]!;
  const lines: string[] = [base, '', t('llm.context.learningContext'), t('llm.context.rootTopic', { title: root.title }), '', t('llm.context.pathHeading')];

  path.slice(1).forEach((s, i) => {
    if (!s.parentId) return;
    if (!s.anchor) {
      lines.push(t('llm.context.createdSubsession', { n: i + 1, title: s.title }));
      return;
    }
    const parentMsgs = messages[s.parentId] ?? [];
    const msg = parentMsgs.find((m) => m.id === s.anchor!.messageId);
    const range: [number, number] = sessions[s.parentId]?.kind === 'page' ? anchorRange(msg?.content ?? '', s.anchor) : [s.anchor.startOffset, s.anchor.endOffset];
    const ex = msg ? excerptAround(msg.content, ...range) : null;
    const ctx = ex ? t('llm.context.anchorContext', { before: ex.before, text: ex.text, after: ex.after }) : '';
    lines.push(`${i + 1}. "${s.anchor.text}"${ctx}`);
  });

  const parentMsgs = messages[self.parentId] ?? [];
  const anchor = self.anchor;
  const anchorIdx = anchor ? parentMsgs.findIndex((m) => m.id === anchor.messageId) : -1;
  const upto = anchorIdx >= 0 ? parentMsgs.slice(0, anchorIdx + 1) : parentMsgs;
  // 직접 만든 하위 세션은 만든 시점까지의 부모 대화를 본다
  const scoped = anchor ? upto : upto.filter((m) => m.createdAt <= self.createdAt);
  const recent = scoped.filter((m) => m.content.trim() !== '').slice(-n);
  const parentSession = sessions[self.parentId];
  const parentPage = isDocSession(parentSession);
  // 부모가 페이지·캔버스면 대화 대신 문서 본문을 넣는다 (ADR-072, ADR-079)
  const doc = parentPage ? parentMsgs.find((m) => m.role === 'assistant' && m.content.trim() !== '') : undefined;
  if (doc && parentSession?.kind === 'canvas') {
    const text = canvasText(parseCanvas(doc.content), MAX_PAGE_CHARS);
    if (text) lines.push('', t('llm.context.parentCanvas'), text);
  } else if (doc) {
    lines.push('', t('llm.context.parentDoc'), clip(doc.content, MAX_PAGE_CHARS));
  } else if (!parentPage && recent.length) {
    const label = anchor ? t('llm.context.untilAnchor') : t('llm.context.untilCreated');
    lines.push('', t('llm.context.parentChat', { label, count: recent.length }));
    for (const m of recent) lines.push(`[${roleLabel(m.role)}] ${clip(m.content)}`);
  }

  if (anchor) lines.push('', t('llm.context.instruction'), promptText('branch', opts.prompts), t('llm.context.targetQuestion', { text: anchor.text }));
  else lines.push('', t('llm.context.instruction'), promptText('subsession', opts.prompts));
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
        const note = n ? t('llm.context.imageNote', { count: n }) : '';
        return { role: m.role, content: [stripEmbeds(stripBranchBlock(m.content)).trim(), note].filter(Boolean).join('\n\n') || note };
      }
      const binary = m.attachments?.filter((a) => a.kind !== 'text') ?? [];
      const content = withTextAttachments(m.content, m.attachments);
      return {
        role: m.role,
        content: content.trim() ? content : t('llm.context.attachmentFallback'),
        ...(binary.length ? { attachments: binary } : {}),
      };
    });
}

export function buildChatRequest(opts: BranchContextOptions): StreamRequest {
  const msgs = opts.messages[opts.sessionId] ?? [];
  // 스킬은 마지막 질문에만 적용한다
  const lastUser = msgs.findLast((m) => m.role === 'user');
  return {
    // 추천 가지 지시는 채팅 답변에만 — 요약·제목·재정리에는 붙이지 않는다 (ADR-094)
    system: withSkill(`${buildSystemPrompt(opts)}\n\n${promptText('branchSuggest', opts.prompts)}`, lastUser?.skill),
    messages: toTurns(msgs),
    purpose: 'chat',
  };
}

/** 가지 요약 지시 (지금 언어) */
export function summarySystem(): string {
  return defaultPrompt('summary');
}

export function buildSummaryRequest(session: Session, msgs: Message[], prompts?: PromptOverrides): StreamRequest {
  // 캔버스는 JSON 대신 카드 글로 요약한다 (ADR-079)
  const src = session.kind === 'canvas' ? msgs.map((m) => ({ ...m, content: canvasText(parseCanvas(m.content), 2000) })) : msgs;
  const transcript = toTurns(src)
    .map((turn) => `[${roleLabel(turn.role)}] ${clip(turn.content, 2000)}`)
    .join('\n');
  return {
    system: promptText('summary', prompts),
    messages: [{ role: 'user', content: `${t('llm.context.summaryTarget', { target: session.anchor?.text ?? session.title })}\n\n${transcript}` }],
    purpose: 'summary',
  };
}

/** 세션 제목 지시 (지금 언어) */
export function titleSystem(): string {
  return defaultPrompt('title');
}

export function buildTitleRequest(msgs: Message[], prompts?: PromptOverrides): StreamRequest {
  const transcript = toTurns(msgs)
    .slice(0, 2)
    .map((turn) => `[${roleLabel(turn.role)}] ${clip(turn.content, 600)}`)
    .join('\n');
  return { system: promptText('title', prompts), messages: [{ role: 'user', content: transcript }], purpose: 'title' };
}

export function branchQuestion(kind: 'what' | 'detail', text: string): string {
  const label = text.length > 80 ? `${text.slice(0, 80)}…` : text;
  return kind === 'what' ? t('llm.context.branchWhat', { text: label }) : t('llm.context.branchDetail', { text: label });
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

/** 세션 재정리 요청 문구 (지금 언어) */
export function reorganizeRequest(): string {
  return t('llm.context.reorganizeRequest');
}

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
  const lines: string[] = [t('llm.context.sessionHeading')];
  let n = 0;
  for (const turn of toTurns([...source])) {
    if (turn.role === 'user') n++;
    const role = turn.role === 'user' ? t('llm.context.sessionUser') : t('llm.context.sessionAssistant');
    lines.push('', t('llm.context.sessionTurn', { role, n: Math.max(n, 1) }), clip(turn.content, 6000));
  }
  if (notes.length) {
    lines.push('', t('llm.context.notesHeading'));
    notes.forEach((note, i) => {
      const parts = [`[${i + 1}] ${note.title}`];
      if (note.anchorText) parts.push(t('llm.context.noteFrom', { text: clip(note.anchorText, 120) }));
      if (note.summary) parts.push(t('llm.context.noteSummary', { text: clip(note.summary, 300) }));
      lines.push(parts.join(' — '));
    });
  }
  lines.push('', t('llm.context.requestHeading'), reorganizeRequest());
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
  const m = /^\s*(?:\*\*)?(?:질문|Question|質問|问题|問題|Câu hỏi)(?:\*\*)?\s*[:：]\s*(.+?)\s*(?:\*\*)?\s*\n+\s*-{3,}\s*\n([\s\S]*)$/.exec(body);
  if (m && m[1]!.trim() && m[2]!.trim()) return { question: m[1]!.replace(/\*\*/g, '').trim(), answer: m[2]!.trim() };
  return { question: fallbackQuestion, answer: body };
}
