import { t } from '../i18n';
import { attachmentKindOf, canAddAttachment, formatBytes, newId, ATTACHMENT_LIMITS, PAGE_EMBED_MAX_BYTES, type Attachment } from '@branch/core';

/** 이미지 긴 변 최대 픽셀 (모델이 내부에서 줄이는 크기와 비슷하게, 전송량 절약) */
const IMAGE_MAX_SIDE = 1600;
/** 이보다 크면 크기가 작아도 다시 압축한다 */
const IMAGE_KEEP_BYTES = 1_500_000;

const utf8Bytes = (s: string) => new TextEncoder().encode(s).length;

function readAsBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const url = String(r.result);
      resolve(url.slice(url.indexOf(',') + 1));
    };
    r.onerror = () => reject(r.error ?? new Error(t('chat.attach.readFailed')));
    r.readAsDataURL(blob);
  });
}

/** 큰 이미지는 긴 변 1600px·JPEG로 줄인다. 줄일 필요가 없으면 원본 그대로 */
async function prepareImage(file: Blob, mime: string): Promise<{ blob: Blob; mime: string }> {
  if (mime === 'image/gif' || typeof createImageBitmap !== 'function') return { blob: file, mime };
  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(file);
  } catch {
    return { blob: file, mime };
  }
  const side = Math.max(bmp.width, bmp.height);
  if (side <= IMAGE_MAX_SIDE && file.size <= IMAGE_KEEP_BYTES) {
    bmp.close();
    return { blob: file, mime };
  }
  const scale = Math.min(1, IMAGE_MAX_SIDE / side);
  const w = Math.max(1, Math.round(bmp.width * scale));
  const h = Math.max(1, Math.round(bmp.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    bmp.close();
    return { blob: file, mime };
  }
  // JPEG는 투명을 검게 칠하므로 흰 바탕을 먼저 깐다
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close();
  const out = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.86));
  return out && out.size < file.size ? { blob: out, mime: 'image/jpeg' } : { blob: file, mime };
}

function limitText(problem: 'count' | 'file-size' | 'total-size'): string {
  if (problem === 'count') return t('chat.attach.limitCount', { count: ATTACHMENT_LIMITS.count });
  if (problem === 'file-size') return t('chat.attach.limitFileSize', { size: formatBytes(ATTACHMENT_LIMITS.fileBytes) });
  return t('chat.attach.limitTotalSize', { size: formatBytes(ATTACHMENT_LIMITS.totalBytes) });
}

/** 파일 하나를 첨부로 바꾼다. 실패하면 사용자에게 보일 문구 */
export async function fileToAttachment(file: File, current: readonly Attachment[], fallbackName = t('chat.attach.pastedImage')): Promise<Attachment | string> {
  const name = (file.name || `${fallbackName}.${file.type.split('/')[1] ?? 'png'}`).slice(0, ATTACHMENT_LIMITS.name);
  const kind = attachmentKindOf(name, file.type);
  if (!kind) return t('chat.attach.unsupported', { name });
  try {
    if (kind === 'text') {
      if (file.size > ATTACHMENT_LIMITS.fileBytes) return limitText('file-size');
      const data = await file.text();
      if (data.includes('\u0000')) return t('chat.attach.notText', { name });
      const a: Attachment = { id: newId('f'), kind, name, mime: file.type || 'text/plain', size: utf8Bytes(data), data };
      const problem = canAddAttachment(current, a);
      return problem ? limitText(problem) : a;
    }
    const prepared = kind === 'image' ? await prepareImage(file, file.type) : { blob: file, mime: 'application/pdf' };
    const problem = canAddAttachment(current, { size: prepared.blob.size });
    if (problem) return limitText(problem);
    const data = await readAsBase64(prepared.blob);
    return { id: newId('f'), kind, name, mime: prepared.mime, size: prepared.blob.size, data };
  } catch (e) {
    return e instanceof Error ? e.message : t('chat.attach.unreadable', { name });
  }
}

/** 붙여넣은 긴 텍스트 → 텍스트 첨부 */
export function pastedTextAttachment(text: string, current: readonly Attachment[]): Attachment | string {
  const n = current.filter((a) => a.pasted).length;
  const a: Attachment = {
    id: newId('f'),
    kind: 'text',
    name: n ? t('chat.attach.pastedText', { n: n + 1 }) : t('chat.attach.pastedTextPlain'),
    mime: 'text/plain',
    size: utf8Bytes(text),
    data: text,
    pasted: true,
  };
  const problem = canAddAttachment(current, a);
  return problem ? limitText(problem) : a;
}

export const dataUrl = (a: Attachment) => `data:${a.mime};base64,${a.data}`;

const PAGE_IMAGE = /^image\/(?:png|jpeg|gif|webp)$/;
/** 브라우저가 열면 스크립트가 도는 형식은 내려받기 전용으로 */
const UNSAFE_MIME = /^(?:text\/html|image\/svg\+xml|application\/(?:xhtml\+)?xml|text\/xml)$/i;

/**
 * 페이지 본문에 바로 넣을 첨부 (ADR-077). 이미지는 줄여서, 파일은 그대로 data URL로.
 * 실패하면 사용자에게 보일 문구.
 */
export async function pageEmbed(file: File, kind: 'image' | 'file'): Promise<{ name: string; url: string } | string> {
  const name = file.name || (kind === 'image' ? t('chat.attach.image') : t('chat.attach.file'));
  try {
    let blob: Blob = file;
    let mime = file.type.toLowerCase();
    if (kind === 'image') {
      if (!PAGE_IMAGE.test(mime)) return t('chat.attach.unsupportedPage', { name });
      ({ blob, mime } = await prepareImage(file, mime));
    } else if (!/^[\w.+-]+\/[\w.+-]+$/.test(mime) || UNSAFE_MIME.test(mime)) mime = 'application/octet-stream';
    if (blob.size > PAGE_EMBED_MAX_BYTES) return t('chat.attach.pageTooLarge', { size: formatBytes(PAGE_EMBED_MAX_BYTES) });
    return { name, url: `data:${mime};base64,${await readAsBase64(blob)}` };
  } catch (e) {
    return e instanceof Error ? e.message : t('chat.attach.unreadable', { name });
  }
}
