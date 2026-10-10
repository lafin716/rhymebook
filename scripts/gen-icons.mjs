// 앱 아이콘 생성: assets/icon/glyph.svg → 데스크톱·iOS·Android·웹 favicon PNG/SVG
// 실행: node scripts/gen-icons.mjs (Playwright Chromium 필요: pnpm exec playwright install chromium)
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const glyph = (await readFile(path.join(root, 'assets/icon/glyph.svg'), 'utf8')).replace(/<!--[\s\S]*?-->/g, '').trim();
const BG = '#2f7d62';
const BG2 = '#1f5e48';

/** shape: full(정사각 꽉 참) | rounded(macOS식 여백+둥근 사각) | circle | foreground(투명 배경, 안전 영역) */
function svg(shape, size) {
  const grad = `<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${BG}"/><stop offset="1" stop-color="${BG2}"/></linearGradient></defs>`;
  let bg = '';
  let scale = 1;
  if (shape === 'full') bg = `<rect width="100" height="100" fill="url(#g)"/>`;
  if (shape === 'rounded') {
    const inset = 9.8;
    bg = `<rect x="${inset}" y="${inset}" width="${100 - 2 * inset}" height="${100 - 2 * inset}" rx="18" fill="url(#g)"/>`;
    scale = (100 - 2 * inset) / 100;
  }
  if (shape === 'circle') bg = `<circle cx="50" cy="50" r="50" fill="url(#g)"/>`;
  // Android 적응형 아이콘: 108dp 중 가운데 66dp가 안전 영역
  if (shape === 'foreground') scale = 0.62;
  if (shape === 'circle') scale = 0.86;
  const t = (100 - 100 * scale) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 100 100">${grad}${bg}<g transform="translate(${t} ${t}) scale(${scale})">${glyph}</g></svg>`;
}

const browser = await chromium.launch();
const page = await browser.newPage();
async function png(shape, size, out) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg(shape, size)}</body></html>`);
  const buf = await page.locator('svg').screenshot({ omitBackground: shape !== 'full' });
  await mkdir(path.dirname(path.join(root, out)), { recursive: true });
  await writeFile(path.join(root, out), buf);
  console.log(`${out} (${size}px)`);
}

await writeFile(path.join(root, 'assets/icon/icon.svg'), svg('rounded', 1024) + '\n');
await writeFile(path.join(root, 'packages/ui/public/favicon.svg'), svg('rounded', 64) + '\n');
await writeFile(path.join(root, 'apps/mobile/public/favicon.svg'), svg('rounded', 64) + '\n');
await png('rounded', 1024, 'apps/desktop/build/icon.png');
await png('rounded', 180, 'packages/ui/public/apple-touch-icon.png');
await png('full', 1024, 'apps/mobile/ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png');
const res = 'apps/mobile/android/app/src/main/res';
for (const [d, n] of Object.entries({ mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 })) {
  await png('full', n, `${res}/mipmap-${d}/ic_launcher.png`);
  await png('circle', n, `${res}/mipmap-${d}/ic_launcher_round.png`);
  await png('foreground', Math.round(n * 2.25), `${res}/mipmap-${d}/ic_launcher_foreground.png`);
}
await writeFile(
  path.join(root, `${res}/values/ic_launcher_background.xml`),
  `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">${BG}</color>\n</resources>\n`,
);
await browser.close();
