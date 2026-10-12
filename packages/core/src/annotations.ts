import type { Anchor, Annotation, AnnotationPatch, AnnotationStyle, ID } from './model';
import { MAX_NOTE_LENGTH } from './model';

/** 어노테이션이 비어있는지 확인 (서식도 메모도 없음) */
export function isEmptyAnnotation(a: Annotation): boolean {
  return (
    !a.highlight &&
    !a.underline &&
    !a.textColor &&
    !a.font &&
    !a.bold &&
    !a.italic &&
    !a.note
  );
}

/** 메모를 정규화: 공백 제거, 길이 제한 */
export function sanitizeNote(note: string | null | undefined): string | undefined {
  if (!note) return undefined;
  const trimmed = note.trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, MAX_NOTE_LENGTH);
}

/** 주어진 messageId를 포함하는 어노테이션을 startOffset 순서로 반환 */
export function annotationsForMessage(
  annotations: Record<ID, Annotation>,
  messageId: ID,
): Annotation[] {
  return Object.values(annotations)
    .filter((a) => a.anchor.messageId === messageId)
    .sort((a, b) => a.anchor.startOffset - b.anchor.startOffset);
}

/**
 * 주어진 범위와 겹치는 어노테이션 찾기.
 * 범위: [start, end) (exclusive end)
 */
export function findAnnotationsOverlapping(
  annotations: Record<ID, Annotation>,
  messageId: ID,
  start: number,
  end: number,
): Annotation[] {
  return annotationsForMessage(annotations, messageId).filter((a) => {
    const aStart = a.anchor.startOffset;
    const aEnd = a.anchor.endOffset;
    // [start, end)와 [aStart, aEnd)가 겹치는가?
    return aStart < end && aEnd > start;
  });
}

/**
 * 정확히 같은 범위의 어노테이션 찾기.
 */
export function findExactAnnotation(
  annotations: Record<ID, Annotation>,
  messageId: ID,
  start: number,
  end: number,
): Annotation | undefined {
  return annotationsForMessage(annotations, messageId).find(
    (a) => a.anchor.startOffset === start && a.anchor.endOffset === end,
  );
}

const STYLE_KEYS = ['highlight', 'underline', 'textColor', 'font', 'bold', 'italic'] as const;

/** 새 어노테이션 값 (빈 서식·빈 메모 필드는 생략) */
export function createAnnotation(
  id: ID,
  sessionId: ID,
  anchor: Anchor,
  init: AnnotationStyle & { note?: string },
  now: number,
): Annotation {
  const a: Annotation = { id, sessionId, anchor, createdAt: now, updatedAt: now };
  for (const k of STYLE_KEYS) if (init[k]) (a as unknown as Record<string, unknown>)[k] = init[k];
  const note = sanitizeNote(init.note);
  if (note) a.note = note;
  return a;
}

/** 패치 적용 (null = 지우기). 결과가 비었는지는 isEmptyAnnotation으로 판단한다 */
export function applyAnnotationPatch(cur: Annotation, patch: AnnotationPatch, now: number): Annotation {
  const next: Annotation = { ...cur, updatedAt: now };
  const rec = next as unknown as Record<string, unknown>;
  for (const k of STYLE_KEYS) {
    if (!(k in patch)) continue;
    const v = patch[k];
    if (v === null || v === false) delete rec[k];
    else if (v !== undefined) rec[k] = v;
  }
  if ('note' in patch && patch.note !== undefined) {
    const note = sanitizeNote(patch.note);
    if (note) next.note = note;
    else delete next.note;
  }
  return next;
}
