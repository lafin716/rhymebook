// main/preload 번들 (CJS). bridge·core는 번들에 포함하고 electron만 외부로 둔다.
import { build } from 'esbuild';
import { copyFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

const common = {
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  external: ['electron'],
  sourcemap: true,
  logLevel: 'info',
};

await Promise.all([
  build({ ...common, entryPoints: ['src/main.ts'], outfile: 'dist/main.cjs' }),
  build({ ...common, entryPoints: ['src/preload.ts'], outfile: 'dist/preload.cjs' }),
  // 색인·검색 worker (ADR-113). worker_threads가 dist/ragWorker.cjs를 직접 연다
  build({ ...common, entryPoints: ['src/ragWorker.ts'], outfile: 'dist/ragWorker.cjs' }),
]);

// 트레이 아이콘을 main.cjs 옆에 둔다 (패키지 files: dist/**)
await mkdir('dist', { recursive: true });
try {
  await copyFile(path.join('build', 'trayIcon.png'), path.join('dist', 'trayIcon.png'));
  await copyFile(path.join('build', 'trayIcon@2x.png'), path.join('dist', 'trayIcon@2x.png'));
  console.log('Tray icons copied to dist');
} catch (err) {
  console.warn('Warning: Could not copy tray icons:', err.message);
}

// PDF 텍스트 추출용 pdfjs-dist legacy 빌드 (ui 워크스페이스 의존성). worker가 dist/pdfjs/에서 동적 import한다.
// package.json asarUnpack 대상이라 패키지에서도 디스크 경로로 읽는다.
try {
  const uiPkg = createRequire(path.resolve('..', '..', 'packages', 'ui', 'package.json'));
  const pdfjsRoot = path.dirname(uiPkg.resolve('pdfjs-dist/package.json'));
  await mkdir(path.join('dist', 'pdfjs'), { recursive: true });
  for (const f of ['pdf.mjs', 'pdf.worker.mjs']) {
    await copyFile(path.join(pdfjsRoot, 'legacy', 'build', f), path.join('dist', 'pdfjs', f));
  }
  console.log('pdfjs legacy copied to dist/pdfjs');
} catch (err) {
  // 자산이 없으면 패키지가 PDF 색인 없이 조용히 나가므로 빌드를 실패시킨다
  console.error('Error: Could not copy pdfjs-dist:', err.message);
  process.exit(1);
}
