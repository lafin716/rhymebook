import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import type { Plugin } from 'vite';

/** pdf.js가 PDF를 그릴 때 읽는 파일들 (한글 CMap·기본 글꼴·이미지 복호화 wasm·색 프로필). 스크립트 실행용 quickjs는 쓰지 않는다 */
const DIRS = ['cmaps', 'standard_fonts', 'wasm', 'iccs'];
const PREFIX = '/pdfjs/';

/**
 * pdfjs-dist의 보조 파일을 `pdfjs/<폴더>/`로 내보낸다 (빌드) / 그 경로로 제공한다 (개발 서버).
 * 앱은 `new URL('pdfjs/cmaps/', document.baseURI)`로 찾는다 — 상대 경로라 file://(데스크톱)·Capacitor에서도 맞다.
 */
export function pdfjsAssets(): Plugin {
  const root = dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json'));
  const files = () =>
    DIRS.flatMap((d) =>
      readdirSync(join(root, d))
        .filter((f) => !f.startsWith('quickjs'))
        .map((f) => ({ name: `${d}/${f}`, path: join(root, d, f) })),
    );
  return {
    name: 'branch-pdfjs-assets',
    configureServer(server) {
      const known = new Map(files().map((f) => [f.name, f.path]));
      server.middlewares.use((req, res, next) => {
        const url = (req.url ?? '').split('?')[0] ?? '';
        const at = url.indexOf(PREFIX);
        const path = at >= 0 ? known.get(decodeURIComponent(url.slice(at + PREFIX.length))) : undefined;
        if (!path) return next();
        res.setHeader('Content-Type', path.endsWith('.wasm') ? 'application/wasm' : path.endsWith('.js') ? 'text/javascript' : 'application/octet-stream');
        res.end(readFileSync(path));
      });
    },
    generateBundle() {
      for (const f of files()) this.emitFile({ type: 'asset', fileName: `pdfjs/${f.name}`, source: readFileSync(f.path) });
    },
  };
}
