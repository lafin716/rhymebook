import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'dev.branchlearn.app',
  appName: 'Branch Learn',
  webDir: 'dist',
  android: {
    // 원격 bridge(ws://, LAN/Tailscale)는 앱 계층에서 E2E 암호화된다 (ADR-018, ADR-019)
    allowMixedContent: true,
  },
  ios: {
    contentInset: 'never',
  },
};

export default config;
