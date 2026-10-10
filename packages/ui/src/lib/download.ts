import { mobile } from '../app/runtime';

/** 텍스트를 파일로 저장한다. 모바일 앱은 공유 시트, 그 외는 브라우저 다운로드 */
export async function saveTextFile(name: string, text: string, mime: string): Promise<void> {
  if (mobile?.saveFile) return mobile.saveFile(name, text, mime);
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
