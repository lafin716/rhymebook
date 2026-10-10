import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Tailscale MagicDNS(*.ts.net)로 휴대폰 등 원격 기기에서 접속 허용
const allowedHosts = ['.ts.net', 'localhost'];

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { host: '0.0.0.0', port: 5173, allowedHosts },
  preview: { host: '0.0.0.0', port: 4173, allowedHosts },
});
