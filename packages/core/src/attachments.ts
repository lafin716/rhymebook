import type { Attachment, AttachmentKind } from './model';

/**
 * 첨부 제한 (ADR-033). 원격 동기화 프레임(16MB, E2E 암호화 후 base64 두 번)에 메시지 하나가 들어가도록
 * 메시지당 원본 합계를 제한한다.
 */
export const ATTACHMENT_LIMITS = {
  /** 메시지당 첨부 수 */
  count: 10,
  /** 파일 하나 원본 바이트 */
  fileBytes: 5 * 1024 * 1024,
  /** 메시지당 원본 합계 */
  totalBytes: 6 * 1024 * 1024,
  /** 이 길이 이상 붙여넣은 텍스트는 첨부 미리보기로 바꾼다 */
  pasteChars: 1200,
  /** 이 줄 수 이상 붙여넣은 텍스트도 첨부로 */
  pasteLines: 25,
  name: 200,
} as const;

export const IMAGE_MIMES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] as const;

const TEXT_EXT =
  /\.(txt|md|markdown|csv|tsv|json|jsonl|xml|html?|css|scss|js|jsx|mjs|cjs|ts|tsx|py|java|kt|kts|c|h|cc|cpp|hpp|cs|go|rs|rb|php|swift|sh|bash|zsh|ps1|bat|sql|ya?ml|toml|ini|cfg|conf|log|tex|r|m|scala|lua|dart|vue|svelte|env|gitignore|dockerfile)$/i;

/** 파일 이름·MIME으로 첨부 종류를 고른다. 지원하지 않으면 null */
export function attachmentKindOf(name: string, mime: string): AttachmentKind | null {
  const m = mime.toLowerCase();
  if ((IMAGE_MIMES as readonly string[]).includes(m)) return 'image';
  if (m === 'application/pdf' || /\.pdf$/i.test(name)) return 'pdf';
  if (m.startsWith('text/') || m === 'application/json' || m === 'application/xml' || TEXT_EXT.test(name)) return 'text';
  return null;
}

/** 이 붙여넣기 텍스트를 첨부 미리보기로 바꿀지 */
export function isLongPaste(text: string): boolean {
  if (text.length >= ATTACHMENT_LIMITS.pasteChars) return true;
  let lines = 1;
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10 && ++lines >= ATTACHMENT_LIMITS.pasteLines) return true;
  return false;
}

/** 첨부 미리보기 문구: 텍스트 첫 줄 */
export function textPreview(data: string, max = 80): string {
  const first = data.trimStart().split('\n', 1)[0] ?? '';
  return first.length > max ? `${first.slice(0, max)}…` : first;
}

/** 사람이 읽는 크기 */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export type AttachmentProblem = 'count' | 'file-size' | 'total-size';

/** 새 첨부를 더할 수 있는지. 문제가 있으면 이유 */
export function canAddAttachment(current: readonly Attachment[], next: Pick<Attachment, 'size'>): AttachmentProblem | null {
  if (current.length >= ATTACHMENT_LIMITS.count) return 'count';
  if (next.size > ATTACHMENT_LIMITS.fileBytes) return 'file-size';
  const sum = current.reduce((a, b) => a + b.size, 0);
  if (sum + next.size > ATTACHMENT_LIMITS.totalBytes) return 'total-size';
  return null;
}

const BASE64_RE = /^[A-Za-z0-9+/]*={0,2}$/;

/** 저장·동기화로 받은 첨부 검증 (모양·종류·크기) */
export function isAttachment(v: unknown): v is Attachment {
  if (!v || typeof v !== 'object') return false;
  const a = v as Record<string, unknown>;
  if (typeof a.id !== 'string' || !/^[\w-]{1,64}$/.test(a.id)) return false;
  if (a.kind !== 'image' && a.kind !== 'pdf' && a.kind !== 'text') return false;
  if (typeof a.name !== 'string' || a.name.length > ATTACHMENT_LIMITS.name) return false;
  if (typeof a.mime !== 'string' || a.mime.length > 100) return false;
  if (typeof a.size !== 'number' || !Number.isFinite(a.size) || a.size < 0 || a.size > ATTACHMENT_LIMITS.fileBytes) return false;
  if (typeof a.data !== 'string') return false;
  if (a.pasted !== undefined && typeof a.pasted !== 'boolean') return false;
  if (a.kind === 'image' && !(IMAGE_MIMES as readonly string[]).includes(a.mime)) return false;
  if (a.kind === 'text') return a.data.length <= ATTACHMENT_LIMITS.fileBytes;
  // base64: 원본 크기의 4/3
  return a.data.length <= Math.ceil((ATTACHMENT_LIMITS.fileBytes * 4) / 3) + 4 && BASE64_RE.test(a.data);
}

/** 메시지 첨부 목록 검증 (개수·합계 포함) */
export function isAttachmentList(v: unknown): v is Attachment[] {
  if (!Array.isArray(v) || v.length > ATTACHMENT_LIMITS.count) return false;
  if (!v.every(isAttachment)) return false;
  return v.reduce((a, b: Attachment) => a + b.size, 0) <= ATTACHMENT_LIMITS.totalBytes;
}

/** 텍스트 첨부를 프롬프트 본문에 붙인다 (모든 provider 공통). 이미지·PDF는 provider가 따로 넣는다 */
export function withTextAttachments(content: string, attachments: readonly Attachment[] | undefined): string {
  const texts = (attachments ?? []).filter((a) => a.kind === 'text');
  if (!texts.length) return content;
  const blocks = texts.map((a) => `<attachment name="${a.name.replace(/"/g, "'")}">\n${a.data}\n</attachment>`);
  return [...blocks, content].filter((s) => s.trim()).join('\n\n');
}

/** 텍스트로만 전달할 수 있는 provider용: 이미지·PDF가 있었다는 사실만 남긴다 */
export function binaryNote(attachments: readonly Attachment[] | undefined): string {
  const names = (attachments ?? []).filter((a) => a.kind !== 'text').map((a) => a.name);
  return names.length ? `(첨부: ${names.join(', ')} — 이 연결에서는 파일 내용을 볼 수 없음)` : '';
}
