// main/preload 번들 (CJS). bridge·core는 번들에 포함하고 electron만 외부로 둔다.
import { build } from 'esbuild';
import { copyFile, mkdir } from 'node:fs/promises';
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
