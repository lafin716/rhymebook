import { excerptAround } from './anchor';
import type { MessageMap } from './context';
import type { ID, Session } from './model';
import { childrenOf, type SessionMap } from './tree';

/**
 * 이해 노트 — 세션 트리의 가지(앵커 + 요약)를 학습 복습용으로 모은다 (ADR-022).
 * Markdown 노트와 Anki 가져오기용 TSV를 만든다. 순수 함수.
 */
export interface StudyCard {
  sessionId: ID;
  /** 루트 바로 아래 가지 = 1 */
  depth: number;
  /** 계층 번호: "1", "1.2", … */
  number: string;
  title: string;
  /** 루트 → 부모 제목 */
  path: string[];
  /** 가지를 친 원문 텍스트 (앵커) */
  anchorText?: string;
  /** 앵커 주변 원문 (마크다운 기호 제거) */
  context?: { before: string; text: string; after: string };
  summary?: string;
}

export function collectStudyCards(sessions: SessionMap, messages: MessageMap, rootId: ID): StudyCard[] {
  const root = sessions[rootId];
  if (!root) return [];
  const out: StudyCard[] = [];
  const walk = (parent: Session, depth: number, prefix: string, path: string[]) => {
    childrenOf(sessions, parent.id).forEach((s, i) => {
      const number = prefix ? `${prefix}.${i + 1}` : String(i + 1);
      const a = s.anchor;
      const msg = a ? messages[parent.id]?.find((m) => m.id === a.messageId) : undefined;
      out.push({
        sessionId: s.id,
        depth,
        number,
        title: s.title,
        path,
        anchorText: a?.text,
        context: a && msg ? excerptAround(msg.content, a.startOffset, a.endOffset, 60) : undefined,
        summary: s.summary?.trim() || undefined,
      });
      walk(s, depth + 1, number, [...path, s.title]);
    });
  };
  walk(root, 1, '', [root.title]);
  return out;
}

function ymd(ms: number) {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const oneLine = (t: string) => t.replace(/\s+/g, ' ').trim();

/** Markdown 이해 노트: 가지마다 경로 · 원문 인용 · 요약 */
export function buildStudyNotes(
  sessions: SessionMap,
  messages: MessageMap,
  rootId: ID,
  opts: { now?: number } = {},
): string {
  const root = sessions[rootId];
  if (!root) return '';
  const cards = collectStudyCards(sessions, messages, rootId);
  const summarized = cards.filter((c) => c.summary).length;
  const lines: string[] = [
    `# ${oneLine(root.title)}`,
    '',
    `> rhymebook 이해 노트 · ${ymd(opts.now ?? Date.now())} · 가지 ${cards.length}개 · 요약 ${summarized}개`,
    '',
  ];
  if (!cards.length) {
    lines.push('아직 가지가 없습니다. 답변에서 모르는 부분을 선택해 가지를 만들어 보세요.', '');
    return lines.join('\n');
  }
  for (const c of cards) {
    lines.push(`${'#'.repeat(Math.min(6, c.depth + 1))} ${c.number}. ${oneLine(c.title)}`, '');
    if (c.depth > 1) lines.push(`경로: ${c.path.map(oneLine).join(' › ')}`, '');
    if (c.context) {
      lines.push(`> ${oneLine(`${c.context.before}**${c.context.text}**${c.context.after}`)}`, '');
    } else if (c.anchorText) {
      lines.push(`> **${oneLine(c.anchorText)}**`, '');
    }
    lines.push(
      c.summary
        ? `**이해한 내용** — ${c.summary.replace(/\n+/g, ' ')}`
        : '_요약 없음 — 가지에서 [부모에 요약 붙이기]를 하면 채워집니다._',
      '',
    );
  }
  return lines.join('\n');
}

const html = (t: string) =>
  t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/** TSV 칸 안에는 탭·줄바꿈이 없어야 한다 */
const cell = (t: string) => html(t).replace(/\t/g, ' ').replace(/\r?\n/g, '<br>');
const tag = (t: string) => t.replace(/[\s:"]+/g, '_').replace(/^_+|_+$/g, '') || 'untitled';

/**
 * Anki 가져오기용 TSV (파일 › 가져오기). 앞면 = 앵커 + 원문 문맥 + 경로, 뒷면 = 요약.
 * 요약이 없는 가지는 카드가 되지 않는다.
 */
export function buildAnkiDeck(sessions: SessionMap, messages: MessageMap, rootId: ID): { text: string; count: number } {
  const root = sessions[rootId];
  if (!root) return { text: '', count: 0 };
  const cards = collectStudyCards(sessions, messages, rootId).filter((c) => c.summary);
  const rootTag = tag(root.title);
  const rows = cards.map((c) => {
    const term = c.anchorText ?? c.title;
    const front = [
      `<b>${cell(oneLine(term))}</b>`,
      c.context && `<small>${cell(oneLine(c.context.before))}<u>${cell(oneLine(c.context.text))}</u>${cell(oneLine(c.context.after))}</small>`,
      `<small style="color:#888">${cell([...c.path, c.title].map(oneLine).join(' › '))}</small>`,
    ]
      .filter(Boolean)
      .join('<br>');
    return [front, cell(c.summary!), `branch-learn ${rootTag}`].join('\t');
  });
  const header = [
    '#separator:tab',
    '#html:true',
    `#deck:rhymebook::${oneLine(root.title).replace(/[\t:]/g, ' ')}`,
    '#tags column:3',
  ];
  return { text: [...header, ...rows].join('\n') + '\n', count: rows.length };
}

/** 내보내기 파일 이름: 파일 시스템에서 안전한 문자만 */
export function studyNotesFileName(title: string, ext: 'md' | 'txt', now = Date.now()): string {
  const safe = oneLine(title).replace(/[\\/:*?"<>|]+/g, '').slice(0, 40).trim() || '이해 노트';
  return `${safe}-이해노트-${ymd(now)}.${ext}`;
}
