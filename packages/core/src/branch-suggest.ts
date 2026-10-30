/**
 * 추천 가지 (ADR-094). 답변 끝의 ```branches 블록에서 챕터별 가지와 이어 갈 질문을 읽고,
 * 챕터 제목이 본문 어디(제목·목록 줄)에 있는지 찾아 그 자리에 가지 버튼을 단다.
 * 블록이 없으면(옛 답변·지시를 안 따른 모델) "1주차·2단계·Chapter 3" 같은 제목을 챕터로 본다.
 */

export const BRANCHES_LANG = 'branches';

export interface BranchSuggestion {
  /** 칩에 보일 짧은 이름 */
  title: string;
  /** 하위 세션의 첫 질문 */
  question: string;
}

export interface BranchSuggestions {
  /** 커리큘럼·로드맵의 챕터 (본문 제목과 같은 글) */
  chapters: BranchSuggestion[];
  /** 이어 갈 만한 질문 */
  next: BranchSuggestion[];
}

export interface LocatedChapter extends BranchSuggestion {
  /** 챕터 줄의 시작 위치 (원문 오프셋) — 렌더러가 제목/목록 노드와 맞춘다 */
  lineStart: number;
  /** 가지를 만들 때 쓸 앵커 범위 — text는 화면에 보이는 글 */
  anchor: { text: string; startOffset: number; endOffset: number };
}

const MAX_TITLE = 40;
const MAX_QUESTION = 300;
const MAX_CHAPTERS = 20;
const MAX_NEXT = 4;

const FENCE_RE = /^ {0,3}(`{3,}|~{3,})/;
const BLOCK_RE = /(?:^|\n) {0,3}```branches[^\n]*\n([\s\S]*?)(?:\n {0,3}```[ \t]*(?=\n|$)|$)/;

/** 답변 지시: 끝에 추천 가지 블록을 붙인다 (채팅 요청에만) */
export const BRANCH_SUGGEST_INSTRUCTION = [
  '## 추천 가지',
  '답변을 마친 뒤 맨 끝에 아래 형식의 ```branches 코드 블록을 하나만 붙여라. 화면에서는 숨겨지고 버튼으로 바뀐다.',
  '```branches',
  '{"chapters":[{"title":"본문에 쓴 챕터 제목 그대로","question":"그 챕터를 배우는 학습자 질문 한 문장"}],"next":[{"title":"20자 이내 이름","question":"이어서 물을 학습자 질문 한 문장"}]}',
  '```',
  '- chapters: 답변이 커리큘럼·로드맵·단계별 계획이면 각 챕터(장·주차·단계)를 본문 제목 글자 그대로 적는다. 아니면 빈 배열.',
  '- next: 지금 답변에서 더 파고들거나 다음에 배울 만한 질문 2~3개.',
  '- 블록 밖에서는 이 블록을 언급하지 마라. 짧은 인사·잡담이면 블록을 생략해도 된다.',
].join('\n');

const cut = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

function item(raw: unknown): BranchSuggestion | null {
  if (typeof raw === 'string') {
    const t = raw.trim();
    return t ? { title: cut(t, MAX_TITLE), question: cut(t, MAX_QUESTION) } : null;
  }
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const title = typeof o.title === 'string' ? o.title.trim() : '';
  const question = typeof o.question === 'string' ? o.question.trim() : '';
  if (!title && !question) return null;
  return { title: cut(title || question, MAX_TITLE), question: cut(question || title, MAX_QUESTION) };
}

function items(raw: unknown, max: number): BranchSuggestion[] {
  if (!Array.isArray(raw)) return [];
  const out: BranchSuggestion[] = [];
  const seen = new Set<string>();
  for (const r of raw) {
    const s = item(r);
    if (!s || seen.has(s.question)) continue;
    seen.add(s.question);
    out.push(s);
    if (out.length >= max) break;
  }
  return out;
}

/** ```branches 블록 본문 → 추천. JSON이 아니면 줄마다 이어 갈 질문으로 본다 */
export function parseBranchBlock(source: string): BranchSuggestions {
  const text = source.trim();
  if (!text) return { chapters: [], next: [] };
  try {
    const data: unknown = JSON.parse(text);
    if (Array.isArray(data)) return { chapters: [], next: items(data, MAX_NEXT) };
    const o = (data ?? {}) as Record<string, unknown>;
    return { chapters: items(o.chapters, MAX_CHAPTERS), next: items(o.next, MAX_NEXT) };
  } catch {
    const lines = text
      .split('\n')
      .map((l) => l.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, '').trim())
      .filter((l) => l && !/^[[\]{}]/.test(l));
    return { chapters: [], next: items(lines, MAX_NEXT) };
  }
}

/** 답변 속 추천 가지 블록 (없으면 null) */
export function extractBranchSuggestions(content: string): BranchSuggestions | null {
  const m = BLOCK_RE.exec(content);
  return m ? parseBranchBlock(m[1] ?? '') : null;
}

/** 추천 가지 블록을 걷어낸 답변 — 맥락·복사·보관에는 보내지 않는다 (스트리밍 중 덜 닫힌 블록 포함) */
export function stripBranchBlock(content: string): string {
  const m = BLOCK_RE.exec(content);
  if (!m) return content;
  return (content.slice(0, m.index) + content.slice(m.index + m[0].length)).replace(/\s+$/, '');
}

/** 비교용 글: 마크다운 기호·번호·문장부호·공백을 빼고 소문자로 */
function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/[`*_~#>[\]()!:：.,·\-–—|/\\'"“”‘’「」『』<>{}]/g, '')
    .replace(/\s+/g, '');
}

/** 제목·목록 줄의 글 부분 (원문 오프셋 포함) */
interface Line {
  lineStart: number;
  textStart: number;
  textEnd: number;
  raw: string;
}

function candidateLines(content: string): Line[] {
  const out: Line[] = [];
  let fence: string | null = null;
  let pos = 0;
  for (const line of content.split('\n')) {
    const start = pos;
    pos += line.length + 1;
    const f = FENCE_RE.exec(line);
    if (f) {
      if (!fence) fence = f[1]![0]!;
      else if (f[1]![0] === fence) fence = null;
      continue;
    }
    if (fence) continue;
    const m = /^( {0,3}#{1,6}\s+| {0,3}(?:[-*+]|\d+[.)])\s+)(.*?)\s*#*\s*$/.exec(line);
    if (!m || !m[2]) continue;
    const textStart = start + m[1]!.length;
    out.push({ lineStart: start, textStart, textEnd: textStart + m[2].length, raw: m[2] });
  }
  return out;
}

/** 원문 글 → 화면 글 (강조·코드·링크 기호를 뺀다) 과 원문에서 그 글이 시작·끝나는 위치 */
function visible(raw: string, textStart: number): { text: string; start: number; end: number } {
  const text = raw
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__|\*|_|~~|`)/g, '')
    .trim();
  // 앵커는 원문 범위 전체. 화면 글이 원문에 그대로 있으면 그 범위로 좁힌다
  const at = raw.indexOf(text);
  if (at >= 0 && text) return { text, start: textStart + at, end: textStart + at + text.length };
  return { text, start: textStart, end: textStart + raw.length };
}

function matches(lineText: string, title: string): boolean {
  const a = norm(lineText);
  const b = norm(title);
  if (!a || !b) return false;
  if (a === b) return true;
  const short = Math.min(a.length, b.length);
  return short >= 4 && (a.startsWith(b) || b.startsWith(a));
}

/** 챕터 제목을 본문 제목·목록 줄과 맞춘다. 찾지 못한 챕터는 따로 돌려준다 */
export function locateChapters(
  content: string,
  chapters: BranchSuggestion[],
): { located: LocatedChapter[]; missing: BranchSuggestion[] } {
  const lines = candidateLines(content);
  const used = new Set<number>();
  const located: LocatedChapter[] = [];
  const missing: BranchSuggestion[] = [];
  for (const ch of chapters) {
    const hit = lines.find((l) => !used.has(l.lineStart) && matches(l.raw, ch.title));
    if (!hit) {
      missing.push(ch);
      continue;
    }
    used.add(hit.lineStart);
    const v = visible(hit.raw, hit.textStart);
    located.push({ ...ch, lineStart: hit.lineStart, anchor: { text: v.text || ch.title, startOffset: v.start, endOffset: v.end } });
  }
  located.sort((a, b) => a.lineStart - b.lineStart);
  return { located, missing };
}

const CHAPTER_HEAD_RE =
  /^(?:제?\s*\d+\s*(?:장|주차|주|단계|일차|강|부|과|챕터|교시|회차|차시)|(?:chapter|week|day|step|part|module|unit|lesson|phase|stage)\s*\d+)/i;

/** 블록 없는 답변에서 챕터 제목 찾기 — "1주차", "2단계", "Chapter 3" 같은 제목이 둘 이상일 때만 */
export function guessChapters(content: string): BranchSuggestion[] {
  const heads = candidateLines(content).filter((l) => /^ {0,3}#/.test(content.slice(l.lineStart, l.textStart)));
  const hits = heads
    .map((l) => visible(l.raw, l.textStart).text)
    .filter((t) => CHAPTER_HEAD_RE.test(t.replace(/^[^\p{L}\p{N}]+/u, '')));
  if (hits.length < 2) return [];
  return hits.slice(0, MAX_CHAPTERS).map((t) => ({
    title: cut(t, MAX_TITLE),
    question: `"${t}" 챕터를 학습하자. 핵심 개념부터 예시와 함께 차근차근 설명해줘.`,
  }));
}

export interface MessageBranchPlan {
  /** 본문 줄에 붙일 챕터 가지 */
  chapters: LocatedChapter[];
  /** 아래 추천 칩 (찾지 못한 챕터 + 이어 갈 질문) */
  next: BranchSuggestion[];
}

/** 답변 하나의 추천 가지 전체 (블록 → 없으면 챕터 추측) */
export function planBranchSuggestions(content: string): MessageBranchPlan {
  const block = extractBranchSuggestions(content);
  // 블록은 코드 펜스라 줄 찾기에서 빠진다 — 원문 그대로 써야 렌더러의 오프셋과 맞는다
  const chapters = block?.chapters.length ? block.chapters : guessChapters(content);
  const { located, missing } = locateChapters(content, chapters);
  const seen = new Set(located.map((c) => c.question));
  const next = [...missing, ...(block?.next ?? [])].filter((s) => !seen.has(s.question) && (seen.add(s.question), true));
  return { chapters: located, next };
}
