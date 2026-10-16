// Generate all platform assets from the approved cap-and-pencil raster master.
// Run: node scripts/gen-icons.mjs (repository Playwright Chromium required).
/* global Image, document, window -- browser globals inside the isolated asset renderer */
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = await readFile(path.join(root, 'assets/icon/source.png'));
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  // Asset rasterization only: no network, app navigation or user browser profile.
  const mark = await page.evaluate(async (url) => {
    const image = new Image();
    image.src = url;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(image, 0, 0);
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const tile = { left: canvas.width, top: canvas.height, right: 0, bottom: 0 };
    const glyph = { ...tile };
    for (let y = 0; y < canvas.height; y++) {
      for (let x = 0; x < canvas.width; x++) {
        const i = (y * canvas.width + x) * 4;
        const [r, g, b, a] = pixels.data.subarray(i, i + 4);
        if (a > 230) {
          tile.left = Math.min(tile.left, x); tile.top = Math.min(tile.top, y);
          tile.right = Math.max(tile.right, x); tile.bottom = Math.max(tile.bottom, y);
        }
        // Extract the approved white mascot for monochrome tray/adaptive foreground.
        const alpha = a * Math.max(0, Math.min(1, (Math.min(r, g, b) - 160) / 95));
        pixels.data[i] = 255; pixels.data[i + 1] = 255; pixels.data[i + 2] = 255;
        pixels.data[i + 3] = alpha;
        if (alpha > 128) {
          glyph.left = Math.min(glyph.left, x); glyph.top = Math.min(glyph.top, y);
          glyph.right = Math.max(glyph.right, x); glyph.bottom = Math.max(glyph.bottom, y);
        }
      }
    }
    if (tile.right <= tile.left || glyph.right <= glyph.left) throw new Error('Invalid icon source');
    ctx.putImageData(pixels, 0, 0);
    const crop = document.createElement('canvas');
    crop.width = glyph.right - glyph.left + 1;
    crop.height = glyph.bottom - glyph.top + 1;
    crop.getContext('2d').drawImage(canvas, glyph.left, glyph.top, crop.width, crop.height, 0, 0, crop.width, crop.height);
    const mask = new Image();
    mask.src = crop.toDataURL('image/png');
    await mask.decode();
    window.iconAssets = { image, tile, mask };
    return mask.src;
  }, 'data:image/png;base64,' + source.toString('base64'));

  async function png(shape, size, out) {
    const url = await page.evaluate(({ shape, size }) => {
      const { image, tile, mask } = window.iconAssets;
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = size;
      const ctx = canvas.getContext('2d');
      ctx.imageSmoothingQuality = 'high';
      if (shape === 'tray' || shape === 'foreground') {
        const extent = size * (shape === 'foreground' ? 0.50 : 0.92);
        const scale = extent / Math.max(mask.width, mask.height);
        const w = mask.width * scale, h = mask.height * scale;
        ctx.drawImage(mask, (size - w) / 2, (size - h) / 2, w, h);
        if (shape === 'tray') {
          ctx.globalCompositeOperation = 'source-in';
          ctx.fillStyle = '#000000';
          ctx.fillRect(0, 0, size, size);
        }
      } else if (shape === 'rounded') {
        ctx.drawImage(image, 0, 0, size, size);
      } else {
        if (shape === 'circle') {
          ctx.beginPath(); ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2); ctx.clip();
        }
        const gradient = ctx.createLinearGradient(0, 0, 0, size);
        gradient.addColorStop(0, '#087e8b'); gradient.addColorStop(1, '#174958');
        ctx.fillStyle = gradient; ctx.fillRect(0, 0, size, size);
        ctx.drawImage(image, tile.left, tile.top, tile.right - tile.left + 1, tile.bottom - tile.top + 1, 0, 0, size, size);
      }
      return canvas.toDataURL('image/png');
    }, { shape, size });
    const bytes = Buffer.from(url.split(',')[1], 'base64');
    await mkdir(path.dirname(path.join(root, out)), { recursive: true });
    await writeFile(path.join(root, out), bytes);
    console.log(out + ' (' + size + 'px)');
    return url;
  }

  const rounded = await png('rounded', 1024, 'apps/desktop/build/icon.png');
  const ui = await png('rounded', 256, 'packages/ui/src/assets/octobooks-icon.png');
  const favicon = await png('rounded', 64, 'packages/ui/public/favicon.png');
  await png('rounded', 64, 'apps/mobile/public/favicon.png');
  const wrapper = (url, size) => '<svg xmlns="http://www.w3.org/2000/svg" width="' + size + '" height="' + size + '" viewBox="0 0 100 100"><image width="100" height="100" href="' + url + '"/></svg>\n';
  await writeFile(path.join(root, 'assets/icon/icon.svg'), wrapper(rounded, 1024));
  await writeFile(path.join(root, 'assets/icon/glyph.svg'), '<!-- Generated from approved source.png; standalone white mascot. -->\n<image x="0" y="0" width="100" height="100" preserveAspectRatio="xMidYMid meet" href="' + mark + '"/>\n');
  for (const out of ['packages/ui/public/favicon.svg', 'apps/mobile/public/favicon.svg']) await writeFile(path.join(root, out), wrapper(favicon, 64));
  await png('tray', 22, 'apps/desktop/build/trayIcon.png');
  await png('tray', 44, 'apps/desktop/build/trayIcon@2x.png');
  await png('rounded', 180, 'packages/ui/public/apple-touch-icon.png');
  await png('full', 1024, 'apps/mobile/ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png');
  const res = 'apps/mobile/android/app/src/main/res';
  for (const [density, size] of Object.entries({ mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 })) {
    await png('full', size, res + '/mipmap-' + density + '/ic_launcher.png');
    await png('circle', size, res + '/mipmap-' + density + '/ic_launcher_round.png');
    await png('foreground', Math.round(size * 2.25), res + '/mipmap-' + density + '/ic_launcher_foreground.png');
  }
  await writeFile(path.join(root, res + '/values/ic_launcher_background.xml'), '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">#087e8b</color>\n</resources>\n');
  const splash = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 320"><rect width="480" height="320" fill="#eef7f8"/><image x="190" y="90" width="100" height="100" href="' + ui + '"/><text x="240" y="217" text-anchor="middle" fill="#173c4b" font-family="-apple-system,system-ui,sans-serif" font-size="26" font-weight="700" letter-spacing="-1">OctoBooks</text><text x="240" y="241" text-anchor="middle" fill="#087e8b" font-family="system-ui,sans-serif" font-size="8" letter-spacing="2">BRANCH OUT. DIVE DEEP.</text></svg>';
  await writeFile(path.join(root, 'assets/icon/splash.svg'), splash + '\n');
  const splashPaths = ['splash-2732x2732.png', 'splash-2732x2732-1.png', 'splash-2732x2732-2.png'].map((name) => 'apps/mobile/ios/App/App/Assets.xcassets/Splash.imageset/' + name);
  for (const dir of await readdir(path.join(root, res), { withFileTypes: true })) {
    if (!dir.isDirectory() || !dir.name.startsWith('drawable')) continue;
    const out = res + '/' + dir.name + '/splash.png';
    try { await readFile(path.join(root, out)); splashPaths.push(out); } catch { /* No splash in this density. */ }
  }
  for (const out of splashPaths) {
    const previous = await readFile(path.join(root, out));
    const width = previous.readUInt32BE(16), height = previous.readUInt32BE(20);
    await page.setViewportSize({ width, height });
    await page.setContent('<html><body style="margin:0;background:#eef7f8">' + splash.replace('<svg ', '<svg style="width:100vw;height:100vh" ') + '</body></html>');
    await page.screenshot({ path: path.join(root, out) });
    console.log(out + ' (' + width + '×' + height + ')');
  }
} finally {
  await browser.close();
}
