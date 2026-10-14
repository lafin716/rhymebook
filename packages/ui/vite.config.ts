import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';

// 설정 화면에 표시할 앱 버전 — 데스크톱 앱 버전을 기준으로 한다
const { version } = JSON.parse(
  readFileSync(new URL('../../apps/desktop/package.json', import.meta.url), 'utf8'),
) as { version: string };

// Tailscale MagicDNS(*.ts.net)로 휴대폰 등 원격 기기에서 접속 허용
const allowedHosts = ['.ts.net', 'localhost'];

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: { 'import.meta.env.VITE_APP_VERSION': JSON.stringify(version) },
  server: { host: '0.0.0.0', port: 5173, allowedHosts },
  preview: { host: '0.0.0.0', port: 4173, allowedHosts },
});
