import type { Anchor, ID } from './model';

/**
 * 렌더 텍스트(사용자가 보는 텍스트)와 markdown 원문 사이의 매핑 조각.
 * renderText[renderStart + i] === source[sourceStart + i] (0 <= i < length)
 */
export interface TextSegment {
  renderStart: number;
  sourceStart: number;
  length: number;
}

/** 렌더 트리의 텍스트 노드 하나. hint는 노드의 원문 위치(알 수 있을 때) */
export interface RenderTextNode {
  value: string;
  hint?: { start: number; end: number };
  /** hint가 없을 때 노드가 속한 블록(가장 가까운 위치 있는 조상)의 원문 범위. 탐색을 이 안으로 제한한다 */
  bound?: { start: number; end: number };
}

export interface SegmentMap {
  renderText: string;
  segments: TextSegment[];
}

/**
 * 텍스트 노드를 문서 순서대로 받아 렌더↔원문 세그먼트 맵을 만든다.
 * - hint 범위 안에서 탐욕적 정렬: 값의 문자가 원문 문자와 같으면 매칭, 아니면 원문 문자를 건너뜀
 *   (이스케이프 `\*`, 엔티티, 마크다운 기호 등을 흡수)
 * - hint가 없으면(구문 강조로 쪼개진 노드 등) 직전 매칭 이후 커서부터 정렬
 * - 공백만 있는 hint 없는 노드는 블록 사이 개행이므로 매핑하지 않는다
 */
export function buildSegmentMap(nodes: RenderTextNode[], source: string): SegmentMap {
  let renderText = '';
  const segments: TextSegment[] = [];
  let cursor = 0;

  const push = (renderStart: number, sourceStart: number) => {
    const last = segments[segments.length - 1];
    if (
      last &&
      last.renderStart + last.length === renderStart &&
      last.sourceStart + last.length === sourceStart
    ) {
      last.length += 1;
    } else {
      segments.push({ renderStart, sourceStart, length: 1 });
    }
  };

  for (const node of nodes) {
    const base = renderText.length;
    renderText += node.value;
    if (!node.hint && node.value.trim() === '') continue;

    // hint가 있으면 그 범위를 신뢰(중첩 노드 포함). 없으면 커서부터, bound(블록 범위)가 있으면 그 안에서만
    const range = node.hint ?? node.bound;
    let j = node.hint ? Math.max(node.hint.start, 0) : Math.max(cursor, node.bound?.start ?? 0);
    const limit = range ? Math.min(range.end, source.length) : source.length;
    // hint 없는 노드는 첫 글자 위치를 indexOf로 빠르게 찾는다. 블록 밖까지 건너뛰는 오매칭은 버린다
    if (!node.hint) {
      const first = node.value.search(/\S/);
      if (first >= 0) {
        const probe = node.value.slice(first, first + Math.min(8, node.value.length - first));
        const found = source.indexOf(probe, j);
        if (found < 0 || found + probe.length > limit) continue;
        j = Math.max(j, found - first);
      }
    }
    for (let i = 0; i < node.value.length && j < limit; ) {
      if (node.value[i] === source[j]) {
        push(base + i, j);
        i += 1;
        j += 1;
        cursor = j;
      } else {
        j += 1;
      }
    }
  }
  return { renderText, segments };
}

/** 렌더 offset → 원문 offset. 매핑되지 않은 위치면 bias 방향의 가장 가까운 매핑 위치 */
export function renderToSource(
  map: SegmentMap,
  renderOffset: number,
  bias: 'start' | 'end',
): number | null {
  const { segments } = map;
  if (segments.length === 0) return null;
  if (bias === 'start') {
    for (const s of segments) {
      if (renderOffset < s.renderStart) return s.sourceStart;
      if (renderOffset < s.renderStart + s.length) return s.sourceStart + (renderOffset - s.renderStart);
    }
    const last = segments[segments.length - 1]!;
    return last.sourceStart + last.length;
  }
  for (let k = segments.length - 1; k >= 0; k--) {
    const s = segments[k]!;
    if (renderOffset > s.renderStart + s.length) return s.sourceStart + s.length;
    if (renderOffset > s.renderStart) return s.sourceStart + (renderOffset - s.renderStart);
  }
  return segments[0]!.sourceStart;
}

/** 원문 offset → 렌더 offset */
export function sourceToRender(
  map: SegmentMap,
  sourceOffset: number,
  bias: 'start' | 'end',
): number | null {
  const { segments } = map;
  if (segments.length === 0) return null;
  let best: number | null = null;
  let bestDist = Infinity;
  for (const s of segments) {
    const lo = s.sourceStart;
    const hi = s.sourceStart + s.length;
    if (sourceOffset >= lo && sourceOffset < hi) return s.renderStart + (sourceOffset - lo);
    if (bias === 'end' && sourceOffset === hi) return s.renderStart + s.length;
    const cand = sourceOffset < lo ? s.renderStart : s.renderStart + s.length;
    const dist = sourceOffset < lo ? lo - sourceOffset : sourceOffset - hi;
    if (dist < bestDist) {
      bestDist = dist;
      best = cand;
    }
  }
  return best;
}

/** 렌더 범위 선택 → 앵커. 앞뒤 공백은 잘라낸다. 빈 선택이면 null */
export function selectionToAnchor(
  messageId: ID,
  map: SegmentMap,
  renderStart: number,
  renderEnd: number,
): Anchor | null {
  let rs = Math.max(0, Math.min(renderStart, renderEnd));
  let re = Math.min(map.renderText.length, Math.max(renderStart, renderEnd));
  while (rs < re && /\s/.test(map.renderText[rs]!)) rs++;
  while (re > rs && /\s/.test(map.renderText[re - 1]!)) re--;
  if (rs >= re) return null;
  const startOffset = renderToSource(map, rs, 'start');
  const endOffset = renderToSource(map, re, 'end');
  if (startOffset == null || endOffset == null || endOffset <= startOffset) return null;
  return { messageId, text: map.renderText.slice(rs, re), startOffset, endOffset };
}

export interface RenderRange {
  start: number;
  end: number;
}

function normalizeWithIndex(text: string): { norm: string; index: number[] } {
  let norm = '';
  const index: number[] = [];
  let prevSpace = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (/\s/.test(ch)) {
      if (prevSpace) continue;
      prevSpace = true;
      norm += ' ';
    } else {
      prevSpace = false;
      norm += ch;
    }
    index.push(i);
  }
  return { norm, index };
}

/**
 * 앵커 복원: 렌더 텍스트에서 anchor.text 출현 위치를 찾아, 원문 offset이 startOffset에
 * 가장 가까운 후보를 반환한다. 정확 일치가 없으면 공백 정규화 일치를 시도한다.
 */
export function locateAnchor(map: SegmentMap, anchor: Pick<Anchor, 'text' | 'startOffset'>): RenderRange | null {
  const { renderText } = map;
  if (!anchor.text) return null;
  const pick = (cands: RenderRange[]) => {
    let best: RenderRange | null = null;
    let bestDist = Infinity;
    for (const c of cands) {
      const src = renderToSource(map, c.start, 'start');
      const dist = src == null ? Infinity : Math.abs(src - anchor.startOffset);
      if (best == null || dist < bestDist) {
        best = c;
        bestDist = dist;
      }
    }
    return best;
  };

  const exact: RenderRange[] = [];
  for (let i = renderText.indexOf(anchor.text); i >= 0; i = renderText.indexOf(anchor.text, i + 1)) {
    exact.push({ start: i, end: i + anchor.text.length });
  }
  if (exact.length) return pick(exact);

  const { norm, index } = normalizeWithIndex(renderText);
  const needle = anchor.text.replace(/\s+/g, ' ').trim();
  if (!needle) return null;
  const fuzzy: RenderRange[] = [];
  for (let i = norm.indexOf(needle); i >= 0; i = norm.indexOf(needle, i + 1)) {
    const start = index[i]!;
    const end = index[i + needle.length - 1]! + 1;
    fuzzy.push({ start, end });
  }
  return pick(fuzzy);
}

export interface AnchorPiece {
  start: number;
  end: number;
  /** 이 조각에서 클릭 시 열 앵커(가장 짧은 = 가장 안쪽) */
  id: ID;
  /** 이 조각을 덮는 모든 앵커 (바깥 → 안쪽) */
  ids: ID[];
}

/**
 * 겹치거나 중첩된 앵커 범위를 겹치지 않는 조각으로 나눈다.
 * 각 조각은 그 위치를 덮는 앵커 중 가장 짧은 것을 대표로 삼는다(안쪽 가지가 클릭 우선).
 * 같은 위치의 앵커가 여러 개라도 모두 ids에 남으므로 "위치 못 찾음"과 구분된다.
 */
export function layoutAnchorRanges(ranges: (RenderRange & { id: ID })[]): AnchorPiece[] {
  const valid = ranges.filter((r) => r.end > r.start);
  const cuts = [...new Set(valid.flatMap((r) => [r.start, r.end]))].sort((a, b) => a - b);
  const pieces: AnchorPiece[] = [];
  for (let k = 0; k + 1 < cuts.length; k++) {
    const start = cuts[k]!;
    const end = cuts[k + 1]!;
    const cover = valid
      .filter((r) => r.start <= start && r.end >= end)
      .sort((a, b) => b.end - b.start - (a.end - a.start) || a.start - b.start);
    if (!cover.length) continue;
    const ids = cover.map((r) => r.id);
    const prev = pieces[pieces.length - 1];
    const id = ids[ids.length - 1]!;
    if (prev && prev.end === start && prev.id === id && prev.ids.join('|') === ids.join('|')) prev.end = end;
    else pieces.push({ start, end, id, ids });
  }
  return pieces;
}

/** 원문에서 앵커 주변 문맥 발췌 (맥락 상속·앵커 인용용) */
export function excerptAround(
  content: string,
  startOffset: number,
  endOffset: number,
  radius = 60,
): { before: string; text: string; after: string } {
  const s = Math.max(0, Math.min(startOffset, content.length));
  const e = Math.max(s, Math.min(endOffset, content.length));
  let b = Math.max(0, s - radius);
  let a = Math.min(content.length, e + radius);
  // 문장/줄 경계에 맞춰 자르기
  const lb = content.lastIndexOf('\n', s - 1);
  if (lb >= b) b = lb + 1;
  const la = content.indexOf('\n', e);
  if (la >= 0 && la <= a) a = la;
  // 마크다운 강조/코드 기호와 줄머리 표식(제목, 인용, 목록 번호)만 지운다. d_k 같은 밑줄은 보존
  const strip = (t: string) => t.replace(/\*\*|__|`/g, '').replace(/\s+/g, ' ');
  const lineHead = /^\s*(#{1,6}\s|>\s?|[-*]\s|\d+\.\s)/;
  return {
    before: (b > 0 && content[b - 1] !== '\n' ? '…' : '') + strip(content.slice(b, s).replace(lineHead, '')),
    text: strip(content.slice(s, e)),
    after: strip(content.slice(e, a)) + (a < content.length && content[a] !== '\n' ? '…' : ''),
  };
}

/** 마크다운 기호·공백 — 원문과 화면 글자를 견줄 때 양쪽에서 똑같이 뺀다 */
const MARKUP = /[\s*_~`#>\-+[\]|\\]/;
/** 링크·이미지의 주소 부분 `](주소 "제목")` — 화면에 보이지 않으므로 원문에서 건너뛴다 */
const LINK_TARGET = /\]\([^)\s]*(?:\s+"[^"]*")?\)/g;

function stripWithIndex(text: string, skipLinks: boolean): { norm: string; index: number[] } {
  const skip = new Uint8Array(text.length);
  if (skipLinks) {
    for (const m of text.matchAll(LINK_TARGET)) skip.fill(1, m.index, m.index + m[0].length);
  }
  let norm = '';
  const index: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (skip[i] || MARKUP.test(ch)) continue;
    norm += ch;
    index.push(i);
  }
  return { norm, index };
}

/**
 * 마크다운 원문 위에서 앵커 범위를 찾는다 (페이지 편집기 표시용, ADR-086).
 * 마크다운 기호·공백을 양쪽에서 빼고 견주므로 읽기 화면에서 만든 앵커(렌더 글자)도,
 * 편집기에서 만든 앵커(원문 글자)도 찾는다. 저장된 위치가 그대로 맞으면 그 위치를,
 * 아니면 startOffset에 가장 가까운 출현을 돌려준다. 못 찾으면 null.
 */
export function locateSourceAnchor(
  source: string,
  anchor: Pick<Anchor, 'text' | 'startOffset' | 'endOffset'>,
): RenderRange | null {
  const needle = stripWithIndex(anchor.text, false).norm;
  if (!needle) return null;
  const { startOffset: s, endOffset: e } = anchor;
  if (s >= 0 && e > s && e <= source.length && stripWithIndex(source.slice(s, e), true).norm === needle) {
    return { start: s, end: e };
  }
  const { norm, index } = stripWithIndex(source, true);
  let best: RenderRange | null = null;
  let bestDist = Infinity;
  for (let i = norm.indexOf(needle); i >= 0; i = norm.indexOf(needle, i + 1)) {
    const start = index[i]!;
    const dist = Math.abs(start - s);
    if (dist < bestDist) {
      best = { start, end: index[i + needle.length - 1]! + 1 };
      bestDist = dist;
    }
  }
  return best;
}

/** 마크다운 조각을 화면에 보이는 글로 — 편집기에서 고른 원문을 앵커 글·질문 인용으로 쓸 때 */
export function markdownPlainText(md: string): string {
  return md
    .split('\n')
    .map((line) => line.replace(/^\s*(?:#{1,6}\s+|>\s?)*(?:(?:[-*+]|\d+[.)])\s+)?(?:\[[ xX]\]\s+)?/, ''))
    .join('\n')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\*\*|__|~~|`/g, '')
    .replace(/(^|[^\w*])\*(?=\S)|(?<=\S)\*(?=$|[^\w*])/g, '$1')
    .trim();
}
