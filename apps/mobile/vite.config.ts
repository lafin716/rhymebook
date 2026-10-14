import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';

// 설정 화면에 표시할 앱 버전
const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

// 모바일 WebView용 빌드. Tailscale MagicDNS(*.ts.net) 접속 허용
const allowedHosts = ['.ts.net', 'localhost'];

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: { 'import.meta.env.VITE_APP_VERSION': JSON.stringify(version) },
  // Capacitor는 앱 내 로컬 서버에서 dist를 제공하므로 상대 경로가 안전하다
  base: './',
  server: { host: '0.0.0.0', port: 5174, allowedHosts },
  preview: { host: '0.0.0.0', port: 4174, allowedHosts },
  build: { outDir: 'dist', emptyOutDir: true },
});
