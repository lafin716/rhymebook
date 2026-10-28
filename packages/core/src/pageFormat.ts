/* ── 페이지 편집기 선택 서식 · 체크박스 · 첨부 (ADR-077) ── */

/** 선택한 글에 씌우는 인라인 마크다운 서식 */
export type InlineFormat = 'bold' | 'italic' | 'strike' | 'code' | 'link';

export interface FormatResult {
  text: string;
  selStart: number;
  selEnd: number;
}

const MARKS: Record<Exclude<InlineFormat, 'link'>, string> = { bold: '**', italic: '*', strike: '~~', code: '`' };

/** pos부터 dir 방향으로 이어진 ch 개수 */
function run(text: string, pos: number, dir: 1 | -1, ch: string): number {
  let n = 0;
  for (let i = dir === 1 ? pos : pos - 1; i >= 0 && i < text.length && text[i] === ch; i += dir) n++;
  return n;
}

/** 별표 n개가 감싸고 있을 때 굵게·기울임이 켜져 있나 (`***`는 둘 다) */
const starActive = (kind: 'bold' | 'italic', n: number) => (kind === 'bold' ? n >= 2 : n % 2 === 1);

/**
 * [from, to) 구간이 그 서식으로 감싸여 있으면 벗길 왼쪽·오른쪽 표시 구간. 표시는 쪽마다 선택 바깥(바로 앞·뒤)이나
 * 안쪽(맨 앞·끝) 어느 쪽에 있어도 된다 — 여러 줄을 감싼 뒤 다시 누를 때처럼 선택이 표시에 걸쳐 있어도 벗긴다.
 */
function wrapped(text: string, from: number, to: number, kind: Exclude<InlineFormat, 'link'>): [[number, number], [number, number]] | null {
  const mark = MARKS[kind];
  const n = mark.length;
  if (kind === 'bold' || kind === 'italic') {
    const lo = run(text, from, -1, '*');
    const li = lo ? 0 : Math.min(run(text, from, 1, '*'), to - from);
    const ro = run(text, to, 1, '*');
    const ri = ro ? 0 : Math.min(run(text, to, -1, '*'), to - from);
    const k = Math.min(lo || li, ro || ri);
    if (!k || !starActive(kind, k)) return null;
    if ((lo ? 0 : n) + (ro ? 0 : n) >= to - from) return null; // 안쪽 표시를 빼면 글이 남아야
    return [lo ? [from - n, from] : [from, from + n], ro ? [to, to + n] : [to - n, to]];
  }
  const lo = text.slice(from - n, from) === mark;
  const li = !lo && text.slice(from, from + n) === mark;
  const ro = text.slice(to, to + n) === mark;
  const ri = !ro && text.slice(to - n, to) === mark;
  if (!(lo || li) || !(ro || ri)) return null;
  if ((lo ? 0 : n) + (ro ? 0 : n) >= to - from) return null;
  return [lo ? [from - n, from] : [from, from + n], ro ? [to, to + n] : [to - n, to]];
}

/** 줄마다 앞뒤 공백을 뺀 실제 글 구간 (마크다운 서식은 공백 안쪽에만 붙는다) */
function segments(text: string, from: number, to: number): [number, number][] {
  const out: [number, number][] = [];
  let start = from;
  for (let i = from; i <= to; i++) {
    if (i < to && text[i] !== '\n') continue;
    let a = start;
    let b = i;
    while (a < b && /\s/.test(text[a]!)) a++;
    while (b > a && /\s/.test(text[b - 1]!)) b--;
    if (b > a) out.push([a, b]);
    start = i + 1;
  }
  return out;
}

/**
 * 선택 [from, to)에 인라인 서식을 켜거나 끈다. 이미 그 서식으로 감싸여 있으면(표시가 선택 바깥이든 안쪽이든) 벗기고,
 * 아니면 줄마다 앞뒤 공백 안쪽을 감싼다. 링크는 `[글](|)` 꼴로 넣고 주소 자리에 커서를 둔다.
 * 선택이 비었으면 null.
 */
export function toggleInlineFormat(text: string, from: number, to: number, kind: InlineFormat): FormatResult | null {
  if (from > to) [from, to] = [to, from];
  const segs = segments(text, from, to);
  if (!segs.length) return null;
  if (kind === 'link') {
    const [a] = segs[0]!;
    const [, b] = segs[segs.length - 1]!;
    const label = text.slice(a, b).replace(/\s*\n\s*/g, ' ');
    const next = `${text.slice(0, a)}[${label}]()${text.slice(b)}`;
    const caret = a + label.length + 3;
    return { text: next, selStart: caret, selEnd: caret };
  }
  const mark = MARKS[kind];
  const states = segs.map(([a, b]) => wrapped(text, a, b, kind));
  const unwrap = states.every((st) => st !== null);
  // 원문 좌표의 편집 목록 [시작, 끝, 넣을 글]
  const edits: [number, number, string][] = [];
  segs.forEach(([a, b], i) => {
    const st = states[i];
    if (unwrap) edits.push([st![0][0], st![0][1], ''], [st![1][0], st![1][1], '']);
    else if (!st) edits.push([a, a, mark], [b, b, mark]);
  });
  let next = text;
  for (const [ea, eb, ins] of [...edits].sort((x, y) => y[0] - x[0])) next = next.slice(0, ea) + ins + next.slice(eb);
  /** 원문 위치 → 바뀐 글 위치. 같은 자리에 넣은 글은 assoc > 0이면 앞에, 아니면 뒤에 둔다 */
  const map = (pos: number, assoc: 1 | -1) => {
    let p = pos;
    for (const [ea, eb, ins] of edits) {
      if (ea === eb && ea === pos) p += assoc > 0 ? ins.length : 0;
      else if (eb <= pos) p += ins.length - (eb - ea);
      else if (ea < pos) p -= pos - ea;
    }
    return p;
  };
  // 감싼 뒤에는 표시 안쪽 글을, 벗긴 뒤에는 원래 선택을 따라간다
  const selStart = unwrap ? map(from, -1) : map(segs[0]![0], 1);
  const selEnd = unwrap ? map(to, 1) : map(segs[segs.length - 1]![1], -1);
  return { text: next, selStart, selEnd: Math.max(selStart, selEnd) };
}

/**
 * 할 일 목록 항목(`- [ ]`·`1. [x]`)의 체크 상태를 바꾼다. at은 그 목록 항목 표시(`-`·`1.`)가 시작하는 원문 위치.
 * 그 자리에 할 일 항목이 없으면 null.
 */
export function toggleTaskAt(text: string, at: number, checked?: boolean): string | null {
  const re = /(?:[-*+]|\d{1,9}[.)])[ \t]+\[([ xX])\]/y;
  re.lastIndex = at;
  const m = re.exec(text);
  if (!m) return null;
  const box = at + m[0].length - 2;
  const now = m[1] !== ' ';
  const want = checked ?? !now;
  if (want === now) return text;
  return text.slice(0, box) + (want ? 'x' : ' ') + text.slice(box + 1);
}

/**
 * 할 일 목록 항목 표시(`-`·`1.`)의 원문 위치를 문서 순서대로. 펜스 코드 블록 안은 뺀다.
 * 읽기 모드에서 n번째 체크박스를 원문 위치로 옮길 때 쓴다.
 */
export function taskItemOffsets(text: string): number[] {
  const out: number[] = [];
  let fence: string | null = null;
  let pos = 0;
  for (const line of text.split('\n')) {
    const f = /^[ \t]*(?:>[ \t]?)*(`{3,}|~{3,})/.exec(line);
    if (f) {
      if (!fence) fence = f[1]!;
      else if (f[1]![0] === fence[0] && f[1]!.length >= fence.length) fence = null;
    } else if (!fence) {
      const m = /^([ \t]*(?:>[ \t]?)*[ \t]*)(?:[-*+]|\d{1,9}[.)])[ \t]+\[[ xX]\](?=[ \t]|$)/.exec(line);
      if (m) out.push(pos + m[1]!.length);
    }
    pos += line.length + 1;
  }
  return out;
}

/* ── 첨부 (이미지·파일을 data URL로 본문에) ── */

/** 페이지에 바로 넣는 첨부 파일 하나의 최대 크기 (본문에 base64로 들어가므로 작게) */
export const PAGE_EMBED_MAX_BYTES = 3 * 1024 * 1024;

/** 링크 글자: 줄바꿈 없애고 `\`·`[`·`]` 이스케이프 */
const escLabel = (s: string, fallback: string): string =>
  (s.replace(/\s+/g, ' ').trim() || fallback).replace(/[\\[\]]/g, (c) => `\\${c}`);

/** 이미지 `![이름](data:…)` */
export const pageImageMarkdown = (name: string, url: string): string => `![${escLabel(name, '이미지')}](${url})`;

/** 파일 링크 `[📎 이름](data:… "이름")` — 제목은 내려받을 때의 파일 이름 */
export const pageFileMarkdown = (name: string, url: string): string => {
  const label = escLabel(name, '파일');
  const title = (name.replace(/\s+/g, ' ').trim() || '파일').replace(/["\\]/g, '');
  return `[📎 ${label}](${url} "${title}")`;
};

const EMBED_RE = /\]\((data:[\w.+/-]+(?:;[\w=.-]+)*;base64,[A-Za-z0-9+/=]+)/g;
const EMBED_REF = /\]\(embed:(\d+)/g;

/**
 * 본문 속 data URL 첨부를 `embed:N` 자리표시로 바꾼다 — AI에 보낼 때 base64가 맥락을 다 차지하지 않게.
 * restoreEmbeds로 되돌린다.
 */
export function stashEmbeds(text: string): { text: string; embeds: string[] } {
  if (!text.includes('data:')) return { text, embeds: [] };
  const embeds: string[] = [];
  const out = text.replace(EMBED_RE, (_, url: string) => `](embed:${embeds.push(url) - 1}`);
  return { text: out, embeds };
}

/** stashEmbeds가 바꾼 자리표시를 원래 data URL로 되돌린다. 모르는 번호는 그대로 둔다 */
export function restoreEmbeds(text: string, embeds: readonly string[]): string {
  if (!embeds.length) return text;
  return text.replace(EMBED_REF, (all, n: string) => {
    const url = embeds[Number(n)];
    return url === undefined ? all : `](${url}`;
  });
}

/** AI 맥락용 — data URL 첨부를 짧은 표시로 */
export const stripEmbeds = (text: string): string => stashEmbeds(text).text;
