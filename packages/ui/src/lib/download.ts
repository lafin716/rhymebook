import { mobile } from '../app/runtime';

/** 텍스트를 파일로 저장한다. 모바일 앱은 공유 시트, 그 외는 브라우저 다운로드 */
export async function saveTextFile(name: string, text: string, mime: string): Promise<void> {
  if (mobile?.saveFile) return mobile.saveFile(name, text, mime);
  download(name, new Blob([text], { type: mime }));
}

/** base64 바이너리(첨부·생성 이미지)를 파일로 저장한다 */
export async function saveBase64File(name: string, base64: string, mime: string): Promise<void> {
  if (mobile?.saveBase64File) return mobile.saveBase64File(name, base64);
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  download(name, new Blob([bytes], { type: mime }));
}

/** 바이트 배열(zip 등)을 파일로 저장한다 */
export async function saveBytesFile(name: string, bytes: Uint8Array, mime: string): Promise<void> {
  if (mobile?.saveBase64File) return mobile.saveBase64File(name, bytesToBase64(bytes));
  download(name, new Blob([bytes as Uint8Array<ArrayBuffer>], { type: mime }));
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

function download(name: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
