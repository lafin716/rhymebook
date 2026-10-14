import { readdir, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ATTACHMENT_LIMITS, newId, type Attachment } from '@branch/core';
import jpeg from 'jpeg-js';
import { PNG } from 'pngjs';

/**
 * Codex 이미지 생성 결과 수집 (ADR-041). codex exec는 만든 이미지를
 * `$CODEX_HOME(기본 ~/.codex)/generated_images/<thread_id>/`에 저장하고 JSON 이벤트로는 알리지 않는다.
 * 우리 실행의 thread 폴더만 읽고 지운다.
 */

const MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};

/** 이보다 큰 PNG는 JPEG로 바꿔 동기화·저장 부담을 줄인다 (생성 PNG는 장당 2~3MB) */
const RECOMPRESS_OVER = 1024 * 1024;
const JPEG_QUALITY = 90;

const THREAD_ID_RE = /^[\w-]{1,128}$/;

export function codexImagesDir(env: NodeJS.ProcessEnv, threadId: string): string | null {
  if (!THREAD_ID_RE.test(threadId)) return null;
  const home = env.CODEX_HOME?.trim() || path.join(os.homedir(), '.codex');
  return path.join(home, 'generated_images', threadId);
}

/** 큰 PNG → JPEG. 실패하거나 더 커지면 원본 */
export function recompress(buf: Buffer, mime: string): { data: Buffer; mime: string } {
  if (mime !== 'image/png' || buf.length <= RECOMPRESS_OVER) return { data: buf, mime };
  try {
    const png = PNG.sync.read(buf);
    // 투명 영역은 흰 배경으로 (JPEG는 알파가 없다)
    const px = png.data;
    for (let i = 0; i < px.length; i += 4) {
      const a = px[i + 3]!;
      if (a === 255) continue;
      const k = a / 255;
      px[i] = Math.round(px[i]! * k + 255 * (1 - k));
      px[i + 1] = Math.round(px[i + 1]! * k + 255 * (1 - k));
      px[i + 2] = Math.round(px[i + 2]! * k + 255 * (1 - k));
      px[i + 3] = 255;
    }
    const out = jpeg.encode({ data: px, width: png.width, height: png.height }, JPEG_QUALITY).data;
    return out.length < buf.length ? { data: Buffer.from(out), mime: 'image/jpeg' } : { data: buf, mime };
  } catch {
    return { data: buf, mime };
  }
}

export interface CollectedImages {
  images: Attachment[];
  /** 한도(장수·크기)를 넘어 버린 수 */
  skipped: number;
}

/** thread 폴더의 이미지를 첨부로 읽는다 (이름순, 메시지 첨부 한도 안에서). 폴더는 지운다 */
export async function collectCodexImages(dir: string): Promise<CollectedImages> {
  const images: Attachment[] = [];
  let skipped = 0;
  let names: string[];
  try {
    names = (await readdir(dir)).sort();
  } catch {
    return { images, skipped };
  }
  let total = 0;
  for (const name of names) {
    const mime = MIME_BY_EXT[path.extname(name).toLowerCase()];
    if (!mime) continue;
    let buf: Buffer;
    try {
      buf = await readFile(path.join(dir, name));
    } catch {
      continue;
    }
    const out = recompress(buf, mime);
    const size = out.data.length;
    if (
      images.length >= ATTACHMENT_LIMITS.count ||
      size > ATTACHMENT_LIMITS.fileBytes ||
      total + size > ATTACHMENT_LIMITS.totalBytes
    ) {
      skipped++;
      continue;
    }
    total += size;
    const ext = out.mime === 'image/jpeg' ? 'jpg' : path.extname(name).slice(1).toLowerCase();
    images.push({
      id: newId('img'),
      kind: 'image',
      name: `생성 이미지 ${images.length + 1}.${ext}`,
      mime: out.mime,
      size,
      data: out.data.toString('base64'),
    });
  }
  await rm(dir, { recursive: true, force: true }).catch(() => {});
  return { images, skipped };
}
