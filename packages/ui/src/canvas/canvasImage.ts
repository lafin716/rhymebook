import { dataUrl } from '../chat/attach';
import type { Attachment } from '@branch/core';

/** 캔버스에 넣는 이미지: 긴 변을 이 값 이하로 줄여 webp(브라우저가 못 쓰면 png)로 다시 인코딩한다 */
const MAX_SIDE = 1600;
const MAX_FILE_BYTES = 25 * 1024 * 1024;

export interface CanvasPicture {
  src: string;
  /** 원본 픽셀 크기 — 배치 때 비율로 쓴다 */
  w: number;
  h: number;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('이미지를 읽지 못했어요.'));
    img.src = url;
  });
}

/** data URL·blob URL 이미지를 캔버스용 data URL로 바꾼다 */
export async function pictureFromUrl(url: string): Promise<CanvasPicture> {
  const img = await loadImage(url);
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  if (!w || !h) throw new Error('이미지를 읽지 못했어요.');
  const scale = Math.min(1, MAX_SIDE / Math.max(w, h));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('이미지를 처리하지 못했어요.');
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return { src: canvas.toDataURL('image/webp', 0.9), w, h };
}

export async function pictureFromFile(file: File): Promise<CanvasPicture> {
  if (!file.type.startsWith('image/')) throw new Error(`${file.name}은(는) 이미지가 아니에요.`);
  if (file.size > MAX_FILE_BYTES) throw new Error(`${file.name}이(가) 너무 커요 (25MB 이하).`);
  const url = URL.createObjectURL(file);
  try {
    return await pictureFromUrl(url);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** 보관함 이미지 항목 */
export const pictureFromAttachment = (a: Attachment): Promise<CanvasPicture> => pictureFromUrl(dataUrl(a));
