import type { Message } from './model';
import { BOOK_SKILL_ID } from './skills';
import { safeFileName } from './study';

/**
 * /book 스킬이 쓴 책을 PDF로 엮기 위한 구조 파싱 (ADR-044).
 * 스킬 답변(여러 번 "계속"으로 이어진 것 포함)에서 구조 분석·목차 계획·이어쓰기 안내를 걷어 내고
 * 머리말 · 장 · 맺음말/용어 찾아보기로 나눈다.
 */

export type BookPartKind = 'front' | 'chapter' | 'back';

export interface BookPart {
  /** 문서 안 링크용 id (`ch-1`, `front-1`, `back-1`) */
  id: string;
  kind: BookPartKind;
  /** 장 번호 (kind === 'chapter') */
  number?: number;
  title: string;
  /** 제목 줄을 뺀 본문 Markdown */
  markdown: string;
}

export interface Book {
  title: string;
  front: BookPart[];
  chapters: BookPart[];
  back: BookPart[];
}

/** /book 스킬로 보낸 사용자 메시지가 있으면 책 세션 */
export function isBookSession(messages: readonly Message[] | undefined): boolean {
  return !!messages?.some((m) => m.role === 'user' && (m.skill?.id === BOOK_SKILL_ID || m.skill?.name === 'book'));
}

/** 책 본문이 될 답변들 (오류·생성 중 제외, 대화 순서) */
export function collectBookAnswers(messages: readonly Message[]): string[] {
  return messages
    .filter((m) => m.role === 'assistant' && m.status !== 'error' && m.status !== 'streaming' && m.content.trim())
    .map((m) => m.content);
}

export function bookFileName(title: string): string {
  return `${safeFileName(title, 60)}.pdf`;
}

const CONTINUE_LINE = /^\s*[—–-]*\s*\d+\s*장까지\s*썼어요.*$|^.*'계속'이라고\s*보내면.*$/;
const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const SKIP = /^(구조\s*분석|목차|차례|책\s*계획|\d+\s*단계)/;
const FRONT = /^(머리말|서문|들어가며|들어가는\s*글|프롤로그|시작하며)/;
const BACK = /^(맺음말|마치며|나가며|나오며|에필로그|끝맺으며|용어|찾아보기|색인|부록)/;
const CHAPTER = /^(?:제\s*)?(\d{1,3})\s*장(?:[.:：)\s]|$)\s*(.*)$/;

/** 제목 장식(굵게·따옴표·끝 구두점)을 걷어 낸다 */
const cleanHeading = (s: string) =>
  s
    .replace(/[*_`]/g, '')
    .replace(/^[\s"'“”‘’「」『』]+|[\s"'“”‘’「」『』]+$/g, '')
    .trim();

interface Section {
  heading: string;
  body: string;
}

/** 답변 하나 → (H1 제목, ## 섹션들). 첫 제목 앞 잡담과 이어쓰기 안내는 버린다 */
function splitAnswer(text: string): { title?: string; sections: Section[] } {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  let fence: string | null = null;
  let title: string | undefined;
  let sections: Section[] = [];
  let cur: { heading: string; lines: string[] } | null = null;
  const flush = () => {
    if (cur) sections.push({ heading: cur.heading, body: cur.lines.join('\n') });
    cur = null;
  };
  for (const line of lines) {
    const f = FENCE.exec(line);
    if (fence) {
      if (f && f[1]![0] === fence[0] && f[1]!.length >= fence.length && line.trim() === f[1]) fence = null;
      cur?.lines.push(line);
      continue;
    }
    if (f) {
      fence = f[1]!;
      cur?.lines.push(line);
      continue;
    }
    if (CONTINUE_LINE.test(line)) continue;
    const h = /^ {0,3}(#{1,2})\s+(.+?)\s*#*\s*$/.exec(line);
    if (h) {
      flush();
      if (h[1] === '#') {
        // 책 제목 앞(구조 분석·목차 계획)은 버린다
        if (title === undefined) {
          title = cleanHeading(h[2]!);
          sections = [];
        }
        continue;
      }
      cur = { heading: cleanHeading(h[2]!), lines: [] };
      continue;
    }
    cur?.lines.push(line);
  }
  flush();
  return { title, sections };
}

/** 본문 끝의 구분선·빈 줄을 다듬는다 */
const tidy = (md: string) =>
  md
    .replace(/^\s*\n/, '')
    .replace(/(\n\s*(?:-{3,}|\*{3,}|_{3,})\s*)+$/, '')
    .trimEnd();

/** 목차 계획 단계의 "책 제목: …" 줄 (H1이 없을 때) */
function titleFromPlan(answers: readonly string[]): string | undefined {
  for (const a of answers) {
    const m = /책\s*제목\s*(?:\*\*)?\s*[:：]\s*(.+)/.exec(a);
    if (m) {
      const t = cleanHeading(m[1]!.split('\n')[0]!);
      if (t) return t;
    }
  }
  return undefined;
}

/**
 * /book 답변들 → 책 구조.
 * - 제목: 첫 H1 → "책 제목:" 줄 → fallbackTitle(세션 제목에서 📖 뗀 것)
 * - `## N장. 제목`이 장. 같은 장이 여러 번 나오면(목차 계획의 장 제목 등) 본문이 가장 긴 것
 * - 구조 분석·목차·N단계 섹션은 버리고, 머리말류는 앞, 맺음말·용어 찾아보기류는 뒤
 * - 그 밖의 `##` 섹션: 장이 나온 뒤면 직전 장 본문에 붙이고, 앞이면 앞부분
 */
export function parseBook(answers: readonly string[], fallbackTitle: string): Book {
  let title: string | undefined;
  const front: BookPart[] = [];
  const back: BookPart[] = [];
  const chapters = new Map<number, BookPart>();
  let last: BookPart | null = null;

  for (const answer of answers) {
    const { title: t, sections } = splitAnswer(answer);
    if (t && !title) title = t;
    for (const s of sections) {
      const body = tidy(s.body);
      const ch = CHAPTER.exec(s.heading);
      if (ch) {
        const number = Number(ch[1]);
        const name = cleanHeading(ch[2]!.replace(/^[.:：)\-—–\s]+/, '')) || `${number}장`;
        const prev = chapters.get(number);
        if (!prev || body.length > prev.markdown.length) {
          const part: BookPart = { id: `ch-${number}`, kind: 'chapter', number, title: name, markdown: body };
          chapters.set(number, part);
          last = part;
        } else {
          last = prev;
        }
        continue;
      }
      if (SKIP.test(s.heading)) continue;
      if (!body) continue;
      if (FRONT.test(s.heading)) {
        front.push({ id: `front-${front.length + 1}`, kind: 'front', title: s.heading, markdown: body });
        last = null;
      } else if (BACK.test(s.heading)) {
        back.push({ id: `back-${back.length + 1}`, kind: 'back', title: s.heading, markdown: body });
        last = null;
      } else if (last?.kind === 'chapter') {
        last.markdown = `${last.markdown}\n\n## ${s.heading}\n\n${body}`;
      } else if (!chapters.size) {
        front.push({ id: `front-${front.length + 1}`, kind: 'front', title: s.heading, markdown: body });
      } else {
        back.push({ id: `back-${back.length + 1}`, kind: 'back', title: s.heading, markdown: body });
      }
    }
  }

  // 용어 찾아보기는 맨 뒤로
  const glossary = (p: BookPart) => /^(용어|찾아보기|색인)/.test(p.title);
  back.sort((a, b) => Number(glossary(a)) - Number(glossary(b)));

  return {
    title: title || titleFromPlan(answers) || fallbackTitle.replace(/^📖\s*/u, '').trim() || '책',
    front,
    chapters: [...chapters.values()].filter((c) => c.markdown).sort((a, b) => a.number! - b.number!),
    back,
  };
}

/** 장 본문의 `### 절` 제목들 (장 첫 쪽의 "이 장에서 다루는 내용") */
export function chapterSections(markdown: string): string[] {
  const out: string[] = [];
  let fence: string | null = null;
  for (const line of markdown.split('\n')) {
    const f = FENCE.exec(line);
    if (fence) {
      if (f && f[1]![0] === fence[0] && f[1]!.length >= fence.length && line.trim() === f[1]) fence = null;
      continue;
    }
    if (f) {
      fence = f[1]!;
      continue;
    }
    const h = /^ {0,3}###\s+(.+?)\s*#*\s*$/.exec(line);
    if (h) out.push(cleanHeading(h[1]!));
  }
  return out;
}
